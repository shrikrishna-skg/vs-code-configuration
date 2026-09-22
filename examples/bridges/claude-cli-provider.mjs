#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";

const HOST = "127.0.0.1";
const PORT = 32123;
const ALLOWED_TOOLS = "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Agent,Skill";
const DEFAULT_DIRECTORY = "/Users/shri/Documents/Codex";
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_SCHEMA_DESCRIPTION_CHARS = 320;
const MAX_CLAUDE_SESSIONS = 32;
const REQUEST_CACHE_MS = 30 * 1000;
const SESSION_STATE_FILE = resolve(homedir(), ".local/state/kilo/claude-cli-provider-state.json");
const TOOL_SYSTEM_PROMPT_FILE = resolve(homedir(), ".config/kilo/bridges/fable-lead-system.md");
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i;
const EMBEDDED_DATA_URL = /data:([^;,]+);base64,[A-Za-z0-9+/=\r\n]+/g;
let claudeQueue = Promise.resolve();
let stateWrite = Promise.resolve();
let subscriptionLimit = null;
let claudeBinary = null;
let claudeAuth = null;
const claudeSessions = [];
// Tool-mode steps run no CLI tools, so the full harness system prompt is dead
// weight. Empty means the file is missing and the default harness is used.
// --exclude-dynamic-system-prompt-sections is deliberately not passed: the CLI
// ignores it whenever --system-prompt is present.
const toolSystemPrompt = await readFile(TOOL_SYSTEM_PROMPT_FILE, "utf8").catch((error) => {
  process.stderr.write(`Could not read ${TOOL_SYSTEM_PROMPT_FILE}, falling back to the default Claude system prompt: ${error.message}\n`);
  return "";
});

const profiles = {
  "opus-5-fast": { name: "Claude Opus 5 Fast (Local CLI)", model: "opus", effort: "low" },
  "opus-5-high": { name: "Claude Opus 5 High (Local CLI)", model: "opus", effort: "high" },
  "fable-5-1-high": { name: "Claude Fable 5.1 High (Local CLI)", model: "fable", effort: "high" },
  "fable-5-1-max": { name: "Claude Fable 5.1 Max (Local CLI)", model: "fable", effort: "max" }
};

function cleanClaudeEnvironment(toolMode = false) {
  const environment = { ...process.env };
  // Always use the signed-in Claude subscription. Never inherit API/gateway credentials.
  delete environment.ANTHROPIC_API_KEY;
  delete environment.ANTHROPIC_AUTH_TOKEN;
  delete environment.ANTHROPIC_BASE_URL;
  // Tool-mode runs decide, they never touch the workspace, so Stop hooks that
  // verify a workspace have nothing to check.
  if (toolMode) environment.CLAUDE_BRIDGE_TOOL_MODE = "1";
  else delete environment.CLAUDE_BRIDGE_TOOL_MODE;
  return environment;
}

function versionParts(name) {
  return (name.match(/\d+/g) || []).map(Number);
}

function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (rightParts[index] || 0) - (leftParts[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

async function resolveClaudeBinary() {
  const candidates = [
    process.env.KILO_CLAUDE_BIN,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    resolve(homedir(), ".local/bin/claude")
  ].filter(Boolean);
  const extensionsDirectory = resolve(homedir(), ".vscode/extensions");
  try {
    const extensions = (await readdir(extensionsDirectory))
      .filter((name) => name.startsWith("anthropic.claude-code-"))
      .sort(compareVersions);
    for (const extension of extensions) {
      candidates.push(join(extensionsDirectory, extension, "resources/native-binary/claude"));
    }
  } catch {}
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error("Could not find an executable local Claude CLI. Install or update the Claude Code VS Code extension.");
}

function readClaudeAuth(binary) {
  return new Promise((resolveAuth, reject) => {
    const child = spawn(binary, ["auth", "status", "--json"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: cleanClaudeEnvironment()
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        const status = JSON.parse(stdout);
        if (code !== 0 || !status.loggedIn || status.authMethod !== "claude.ai") {
          throw new Error("Claude CLI must be signed in with the Claude subscription (claude.ai), not an API key");
        }
        resolveAuth({ authMethod: status.authMethod, subscriptionType: status.subscriptionType || "unknown" });
      } catch (error) {
        reject(new Error(stderr.trim() || error.message));
      }
    });
  });
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(value));
}

function nextLocalReset(message, now = new Date()) {
  const match = message.match(/resets\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!match) return new Date(now.getTime() + 5 * 60 * 1000);
  let hour = Number(match[1]) % 12;
  if (match[3].toLowerCase() === "pm") hour += 12;
  const reset = new Date(now);
  reset.setHours(hour, Number(match[2]), 0, 0);
  if (reset <= now) reset.setDate(reset.getDate() + 1);
  return reset;
}

function cachedSubscriptionError() {
  if (!subscriptionLimit) return null;
  if (subscriptionLimit.until <= new Date()) {
    subscriptionLimit = null;
    return null;
  }
  return subscriptionLimit;
}

function rememberSubscriptionLimit(message) {
  subscriptionLimit = { message, until: nextLocalReset(message) };
  process.stdout.write(`${JSON.stringify({ event: "subscription_limit", until: subscriptionLimit.until.toISOString() })}\n`);
  saveProviderState();
}

function queueClaude(task) {
  const queued = claudeQueue.catch(() => {}).then(task);
  claudeQueue = queued.catch(() => {});
  return queued;
}

function cancellationError() {
  const error = new Error("Claude CLI request was cancelled");
  error.status = 499;
  return error;
}

function compactTextForHash(text) {
  return text.replace(EMBEDDED_DATA_URL, (value, mimeType) =>
    `[Embedded ${mimeType} attachment sha256=${createHash("sha256").update(value).digest("hex")}]`
  );
}

function jsonForHash(value) {
  return JSON.stringify(value, (key, nested) => typeof nested === "string" ? compactTextForHash(nested) : nested);
}

function messageHashes(messages) {
  return (Array.isArray(messages) ? messages : []).map((message) =>
    createHash("sha256").update(jsonForHash(message)).digest("hex")
  );
}

function sameHashes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

// Kilo rewrites message 0 mid-task: its system <env> block grows. The first
// user turn is what actually identifies a conversation.
// ponytail: two tasks in one directory opening with byte-identical first user
// turns would share a CLI session. Upgrade path is a Kilo-supplied task id.
function conversationAnchor(hashes) {
  return hashes.length > 1 ? hashes[1] : "";
}

function matchingClaudeSession(model, cwd, hashes) {
  const candidates = claudeSessions.filter((session) => session.model === model && session.cwd === cwd);
  const exact = candidates.find((session) => sameHashes(session.hashes, hashes));
  if (exact?.result && Date.now() - exact.resultAt <= REQUEST_CACHE_MS) {
    return { session: exact, cached: true, start: hashes.length };
  }
  const anchor = conversationAnchor(hashes);
  const continued = anchor ? candidates
    .filter((session) => conversationAnchor(session.hashes) === anchor)
    .sort((left, right) =>
      commonPrefixLength(right.hashes, hashes) - commonPrefixLength(left.hashes, hashes) || right.lastUsed - left.lastUsed
    )[0] : null;
  return continued ? { session: continued, cached: false, start: continued.hashes.length } : null;
}

// Kilo edits messages the CLI already saw: it compacts old tool outputs in
// place (part.state.time.compacted) and regrows the system <env> block. Send
// the unseen tail plus whatever changed, instead of replaying the whole
// transcript because one old message no longer matches.
function sessionDelta(session, messages, hashes) {
  const delta = messages.filter((message, index) => index >= session.hashes.length || session.hashes[index] !== hashes[index]);
  return delta.length ? delta : messages.slice(-1);
}

function rememberClaudeSession(session) {
  session.lastUsed = Date.now();
  if (!claudeSessions.includes(session)) claudeSessions.push(session);
  claudeSessions.sort((left, right) => right.lastUsed - left.lastUsed);
  claudeSessions.splice(MAX_CLAUDE_SESSIONS);
  saveProviderState();
}

function saveProviderState() {
  const state = {
    subscriptionLimit: subscriptionLimit ? { message: subscriptionLimit.message, until: subscriptionLimit.until.toISOString() } : null,
    sessions: claudeSessions.map(({ id, model, cwd, hashes, toolsHash, lastUsed }) => ({ id, model, cwd, hashes, toolsHash, lastUsed }))
  };
  stateWrite = stateWrite.catch(() => {}).then(async () => {
    await mkdir(dirname(SESSION_STATE_FILE), { recursive: true });
    const temporary = `${SESSION_STATE_FILE}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await rename(temporary, SESSION_STATE_FILE);
  }).catch((error) => process.stderr.write(`Could not save Claude session state: ${error.message}\n`));
  return stateWrite;
}

async function loadProviderState() {
  try {
    const state = JSON.parse(await readFile(SESSION_STATE_FILE, "utf8"));
    const loaded = Array.isArray(state.sessions) ? state.sessions : [];
    for (const session of loaded.slice(0, MAX_CLAUDE_SESSIONS)) {
      if (typeof session?.id !== "string" || typeof session?.model !== "string" || typeof session?.cwd !== "string" || !Array.isArray(session?.hashes)) continue;
      claudeSessions.push({ ...session, toolsHash: typeof session.toolsHash === "string" ? session.toolsHash : "", result: null, resultAt: 0 });
    }
    const until = new Date(state.subscriptionLimit?.until);
    if (state.subscriptionLimit?.message && until > new Date()) {
      subscriptionLimit = { message: state.subscriptionLimit.message, until };
    }
    process.stdout.write(`${JSON.stringify({ event: "state_loaded", sessions: claudeSessions.length, limitedUntil: subscriptionLimit?.until?.toISOString() || null })}\n`);
  } catch (error) {
    if (error.code !== "ENOENT") process.stderr.write(`Could not load Claude session state: ${error.message}\n`);
  }
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function imageSource(part) {
  const value = part?.image_url?.url || part?.image_url || part?.url;
  return typeof value === "string" ? value : null;
}

function imageParts(messages) {
  return (Array.isArray(messages) ? messages : []).flatMap((message) =>
    Array.isArray(message?.content) ? message.content : []
  ).filter((part) => ["image", "image_url", "input_image"].includes(part?.type));
}

async function materializeImageAttachments(messages) {
  let directory = null;
  const files = [];
  let totalBytes = 0;
  try {
    for (const part of imageParts(messages)) {
      const source = imageSource(part);
      if (!source || !source.startsWith("data:")) continue;
      const match = source.match(IMAGE_DATA_URL);
      if (!match) throw new Error("Unsupported image attachment. Use PNG, JPEG, GIF, or WEBP.");
      const image = Buffer.from(match[2], "base64");
      if (!image.length) throw new Error("Attached image is empty.");
      totalBytes += image.length;
      if (totalBytes > MAX_IMAGE_BYTES) throw new Error("Attached images exceed the 24 MB bridge limit.");
      directory ||= await mkdtemp(join(tmpdir(), "kilo-claude-images-"));
      const extension = match[1].toLowerCase() === "image/jpeg" ? "jpg" : match[1].slice("image/".length).toLowerCase();
      const file = join(directory, `image-${files.length + 1}.${extension}`);
      await writeFile(file, image, { mode: 0o600 });
      files.push(file);
    }
    return { directory, files };
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function removeImageAttachments(attachments) {
  if (attachments?.directory) await rm(attachments.directory, { recursive: true, force: true });
}

function imageAttachmentPrompt(files) {
  if (!files.length) return "";
  return [
    "IMAGE ATTACHMENTS",
    "The user supplied the image files below. Use the Read tool to inspect every image relevant to this request before answering or making a Kilo decision. Do not say an image is unavailable merely because it is a local path.",
    ...files.map((file, index) => `${index + 1}. ${file}`)
  ].join("\n");
}

function compactText(text) {
  return text.replace(/data:([^;,]+);base64,[A-Za-z0-9+/=\r\n]+/g, (value, mimeType) =>
    `[Embedded ${mimeType} attachment omitted from text prompt: ${value.length} characters]`
  );
}

function jsonForPrompt(value) {
  return JSON.stringify(value, (key, nested) => {
    if (typeof nested === "string") {
      if ((key === "data" || key === "base64") && nested.length > 4096) {
        return `[Embedded binary omitted: ${nested.length} characters]`;
      }
      return compactText(nested);
    }
    return nested;
  });
}

function contentText(content) {
  if (typeof content === "string") return compactText(content);
  if (!Array.isArray(content)) return content == null ? "" : jsonForPrompt(content);
  return content.map((part) => {
    if (typeof part === "string") return compactText(part);
    if (part?.type === "text" && typeof part.text === "string") return compactText(part.text);
    if (["image", "image_url", "input_image"].includes(part?.type)) {
      const url = imageSource(part);
      if (typeof url === "string" && !url.startsWith("data:")) return `[Image attachment: ${url.slice(0, 2048)}]`;
      return "[Embedded image attachment is available to the Claude Read tool.]";
    }
    return jsonForPrompt(part);
  }).join("\n");
}

function conversationTranscript(messages) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const role = typeof message?.role === "string" ? message.role.toUpperCase() : "MESSAGE";
    const parts = [contentText(message?.content)];
    if (message?.tool_calls) parts.push(`Tool calls: ${jsonForPrompt(message.tool_calls)}`);
    if (message?.tool_call_id) parts.push(`Tool call ID: ${message.tool_call_id}`);
    return `[${role}]\n${parts.filter(Boolean).join("\n")}`;
  }).join("\n\n");
}

function conversationPrompt(messages, imageFiles = []) {
  const transcript = conversationTranscript(messages);

  return [
    "Complete the Kilo Code request below using your own Claude Code tools.",
    "You are running through the authenticated local Claude CLI. Perform required file and terminal work directly, verify it, and return a concise final result.",
    "Do not ask Kilo to execute tool calls and do not claim to have used an external Claude API or gateway.",
    imageAttachmentPrompt(imageFiles),
    "",
    transcript
  ].join("\n");
}

function compactTools(tools) {
  return tools.map((tool) => ({
    name: tool?.function?.name,
    description: (tool?.function?.description || "").slice(0, MAX_SCHEMA_DESCRIPTION_CHARS),
    parameters: compactSchema(tool?.function?.parameters || { type: "object" })
  })).filter((tool) => tool.name);
}

function toolsCatalogHash(tools) {
  return tools.length ? createHash("sha256").update(jsonForHash(compactTools(tools))).digest("hex") : "";
}

function kiloToolPrompt(messages, tools, imageFiles = [], knownCatalog = "") {
  // ponytail: a resumed step trusts the CLI to still remember the catalog it
  // was sent earlier in this session. After autocompact the schemas may be
  // summarized away. Ceiling accepted because --json-schema still pins the
  // legal tool names; upgrade path is the resend-on-invalid-decision retry.
  const catalog = knownCatalog
    ? `AVAILABLE KILO TOOLS: unchanged since earlier in this session (catalog #${knownCatalog.slice(0, 8)})`
    : `AVAILABLE KILO TOOLS\n${JSON.stringify(compactTools(tools))}`;

  return [
    "You are the model driving a Kilo Code agent through the authenticated local Claude CLI.",
    "Follow the complete conversation and its system instructions. Kilo, not this CLI process, owns all file, terminal, web, and subagent execution.",
    "Return exactly one decision: either a final answer or one Kilo tool call. Never claim a tool ran until its result appears in a later TOOL message.",
    "For a final answer, set kind to final, put the answer in content, set tool_name to an empty string, and arguments to an empty object.",
    "For a tool call, set kind to tool_call, content to an empty string, tool_name to one available tool name, and arguments to a valid object matching that tool's parameters.",
    "Use Kilo's task tool when the engineering-lead policy calls for delegation; do not substitute Claude CLI background agents.",
    imageAttachmentPrompt(imageFiles),
    "",
    catalog,
    "",
    conversationTranscript(messages)
  ].join("\n");
}

function normalizeUsage(usage) {
  const value = usage && typeof usage === "object" ? usage : {};
  const number = (field) => Number.isFinite(Number(value[field])) ? Number(value[field]) : 0;
  const promptTokens = number("input_tokens") + number("cache_creation_input_tokens") + number("cache_read_input_tokens");
  const completionTokens = number("output_tokens");
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens
  };
}

function missingClaudeSession(error) {
  return /(?:session|conversation).*(?:not found|does not exist|missing)|could not find.*(?:session|conversation)/i.test(error?.message || "");
}

function compactSchema(value) {
  if (Array.isArray(value)) return value.map(compactSchema);
  if (!value || typeof value !== "object") return value;

  const compacted = {};
  for (const [key, nested] of Object.entries(value)) {
    if (["title", "examples", "example", "default", "$schema"].includes(key)) continue;
    if (key === "description" && typeof nested === "string") {
      compacted[key] = nested.slice(0, MAX_SCHEMA_DESCRIPTION_CHARS);
      continue;
    }
    compacted[key] = compactSchema(nested);
  }
  return compacted;
}

function toolDecisionSchema(tools) {
  const names = tools.map((tool) => tool?.function?.name).filter(Boolean);
  return {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["final", "tool_call"] },
      content: { type: "string" },
      tool_name: { type: "string", enum: ["", ...names] },
      arguments: { type: "object", additionalProperties: true }
    },
    required: ["kind", "content", "tool_name", "arguments"],
    additionalProperties: false
  };
}

function candidateDirectories(text) {
  const matches = [];
  const patterns = [
    /<cwd>\s*([^<\n]+?)\s*<\/cwd>/gi,
    /(?:current working directory|working directory|workspace directory|workspace root|cwd)\s*(?:is|:|=)\s*[`"']?([^\n<`"']+)/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) matches.push(match[1].trim());
  }
  return matches;
}

async function workingDirectory(prompt) {
  for (const raw of candidateDirectories(prompt)) {
    const expanded = raw.startsWith("~/") ? resolve(homedir(), raw.slice(2)) : resolve(raw);
    if (expanded === "/" || expanded === homedir()) continue;
    try {
      if ((await stat(expanded)).isDirectory()) return expanded;
    } catch {}
  }
  return DEFAULT_DIRECTORY;
}

function claudeArgs(profile, tools, session, imageDirectory = null, streaming = false) {
  const args = [
    "-p",
    "--model", profile.model,
    "--effort", profile.effort,
    "--name", `Kilo Favorite - ${profile.name}`,
    // stream-json still ends with the same result line as --output-format json,
    // so the decision, usage and error handling below are unchanged. The CLI
    // rejects stream-json under --print without --verbose.
    ...(streaming
      ? ["--output-format", "stream-json", "--verbose", "--include-partial-messages"]
      : ["--output-format", "json"]),
    "--autocompact", "auto",
    session.resume ? "--resume" : "--session-id", session.id
  ];
  if (imageDirectory) args.push("--add-dir", imageDirectory);
  if (tools.length) {
    if (toolSystemPrompt) args.push("--system-prompt", toolSystemPrompt);
    args.push(
      "--safe-mode",
      "--tools", imageDirectory ? "Read" : "",
      "--json-schema", JSON.stringify(toolDecisionSchema(tools))
    );
  } else {
    args.push(
      "--permission-mode", "acceptEdits",
      `--allowedTools=${ALLOWED_TOOLS}`
    );
  }
  return args;
}

// How much of a partially received JSON string body can be decoded right now.
// Stops before a half-arrived escape so JSON.parse never sees a dangling "\".
function safeStringSpan(raw, start) {
  let index = start;
  while (index < raw.length) {
    const character = raw[index];
    if (character === "\"") return { end: index, closed: true };
    if (character !== "\\") {
      index += 1;
      continue;
    }
    const escape = raw[index + 1];
    if (escape === undefined) break;
    if (escape === "u") {
      if (index + 6 > raw.length) break;
      index += 6;
      continue;
    }
    index += 2;
  }
  return { end: index, closed: false };
}

// The CLI emits the Kilo decision as StructuredOutput input_json_delta
// fragments. Only a final answer's content may leave early; a tool call must
// stay one atomic decision, so nothing is released until "kind":"final" has
// actually arrived and the decision object is still validated from the CLI's
// result line afterwards.
function createDecisionStream() {
  let raw = "";
  let cursor = -1;
  let streamed = "";
  return {
    get text() { return streamed; },
    push(fragment) {
      raw += fragment;
      if (cursor < 0) {
        if (!/"kind"\s*:\s*"final"/.test(raw)) return "";
        const opening = /"content"\s*:\s*"/.exec(raw);
        if (!opening) return "";
        cursor = opening.index + opening[0].length;
      }
      const span = safeStringSpan(raw, cursor);
      if (span.end <= cursor) return "";
      const piece = JSON.parse(`"${raw.slice(cursor, span.end)}"`);
      cursor = span.end;
      streamed += piece;
      return piece;
    }
  };
}

function runClaude(profile, prompt, cwd, signal, tools = [], session, imageDirectory = null, onText = null) {
  return new Promise((resolveResult, reject) => {
    if (signal.aborted) return reject(cancellationError());
    const args = claudeArgs(profile, tools, session, imageDirectory, Boolean(onText));
    const child = spawn(claudeBinary, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: cleanClaudeEnvironment(tools.length > 0)
    });

    let stdout = "";
    let stderr = "";
    let pending = "";
    let streamedPayload = null;
    const decisionStream = onText ? createDecisionStream() : null;
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") reject(error);
    });
    child.stdin.end(prompt);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (!decisionStream) return;
      pending += text;
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (!line.startsWith("{")) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === "result") {
          streamedPayload = event;
          continue;
        }
        const delta = event.type === "stream_event" && event.event?.type === "content_block_delta" ? event.event.delta : null;
        if (delta?.type !== "input_json_delta" || typeof delta.partial_json !== "string") continue;
        const piece = decisionStream.push(delta.partial_json);
        if (piece) onText(piece);
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    const cancel = () => child.kill("SIGTERM");
    signal.addEventListener("abort", cancel, { once: true });
    child.on("close", (code, stoppedBy) => {
      signal.removeEventListener("abort", cancel);
      if (stoppedBy || signal.aborted) return reject(cancellationError());
      let payload = streamedPayload;
      if (!payload) {
        try {
          payload = JSON.parse(stdout);
        } catch {
          return reject(new Error(stderr.trim() || stdout.trim() || `Claude CLI exited with code ${code}`));
        }
      }
      if (code !== 0 || payload.is_error) {
        const error = new Error(payload.result || stderr.trim() || `Claude CLI exited with code ${code}`);
        error.status = payload.api_error_status || (error.message.includes("session limit") ? 429 : 500);
        return reject(error);
      }
      if (tools.length) {
        let decision = payload.structured_output;
        if (!decision && payload.result) {
          try { decision = JSON.parse(payload.result); } catch {}
        }
        if (!decision || !["final", "tool_call"].includes(decision.kind)) {
          return reject(new Error("Claude CLI did not return a valid Kilo decision"));
        }
        if (decision.kind === "tool_call" && !tools.some((tool) => tool?.function?.name === decision.tool_name)) {
          return reject(new Error(`Claude CLI requested an unavailable Kilo tool: ${decision.tool_name}`));
        }
        return resolveResult({ decision, usage: normalizeUsage(payload.usage) });
      }
      resolveResult({ text: payload.result || "Claude completed the task without a text response.", usage: normalizeUsage(payload.usage) });
    });
  });
}

// Headers are written on the first chunk, not up front: until the CLI produces
// something the request can still fail into a normal JSON error response.
function createStreamWriter(response, id, model) {
  let sent = "";
  return {
    get text() { return sent; },
    chunk(delta, finishReason = null, usage = undefined) {
      if (!response.headersSent) {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });
        this.chunk({ role: "assistant" });
      }
      response.write(`data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...(usage ? { usage } : {})
      })}\n\n`);
    },
    content(text) {
      if (!text) return;
      sent += text;
      this.chunk({ content: text });
    },
    finish() {
      response.end("data: [DONE]\n\n");
    }
  };
}

function streamCompletion(writer, result) {
  if (result.decision?.kind === "tool_call") {
    writer.chunk({
      tool_calls: [{
        index: 0,
        id: `call_${randomUUID().replaceAll("-", "")}`,
        type: "function",
        function: {
          name: result.decision.tool_name,
          arguments: JSON.stringify(result.decision.arguments || {})
        }
      }]
    });
    writer.chunk({}, "tool_calls", result.usage);
    return writer.finish();
  }
  const answer = result.decision?.content ?? result.text ?? "";
  // ponytail: SSE deltas cannot be retracted, so a CLI retry that replaced an
  // already-streamed answer would duplicate rather than truncate it. Only
  // reachable if a run streams a valid "kind":"final" and then fails; upgrade
  // path is buffering the first delta until the result line lands.
  if (!answer.startsWith(writer.text)) {
    process.stdout.write(`${JSON.stringify({ event: "stream_diverged", streamedChars: writer.text.length })}\n`);
    writer.content(answer);
  } else {
    writer.content(answer.slice(writer.text.length));
  }
  writer.chunk({}, "stop", result.usage);
  writer.finish();
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
    return sendJson(response, 200, {
      status: "ok",
      transport: "authenticated-local-claude-cli",
      authMethod: claudeAuth?.authMethod || null,
      subscriptionType: claudeAuth?.subscriptionType || null,
      serialized: true,
      sessionReuse: true,
      sessions: claudeSessions.length,
      limitedUntil: cachedSubscriptionError()?.until?.toISOString() || null
    });
  }
  if (request.method === "GET" && url.pathname === "/v1/models") {
    return sendJson(response, 200, {
      object: "list",
      data: Object.entries(profiles).map(([id, profile]) => ({ id, name: profile.name, object: "model", owned_by: "local-claude-cli" }))
    });
  }
  if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
    return sendJson(response, 404, { error: { message: "Not found", type: "invalid_request_error" } });
  }

  const controller = new AbortController();
  request.on("aborted", () => controller.abort());
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
  });
  try {
    const body = await readJson(request);
    process.stdout.write(`${JSON.stringify({
      event: "request",
      at: new Date().toISOString(),
      keys: Object.keys(body).sort(),
      model: body.model,
      messages: Array.isArray(body.messages) ? body.messages.length : 0,
      messageShape: (Array.isArray(body.messages) ? body.messages : []).slice(0, 3).map((message) => ({
        role: message?.role,
        contentType: Array.isArray(message?.content) ? "array" : typeof message?.content,
        contentChars: contentText(message?.content).length,
        tags: [...new Set(contentText(message?.content).matchAll(/<([A-Za-z][A-Za-z0-9_-]*)\b/g))].map((match) => match[1]).slice(0, 24)
      })),
      tools: Array.isArray(body.tools) ? body.tools.length : 0,
      stream: Boolean(body.stream),
      metadataKeys: body.metadata && typeof body.metadata === "object" ? Object.keys(body.metadata).sort() : []
    })}\n`);
    const profile = profiles[body.model];
    if (!profile) return sendJson(response, 400, { error: { message: `Unknown local Claude profile: ${body.model}` } });
    const tools = Array.isArray(body.tools) ? body.tools.filter((tool) => tool?.type === "function") : [];
    const fullPrompt = tools.length ? kiloToolPrompt(body.messages, tools) : conversationPrompt(body.messages);
    const cwd = await workingDirectory(fullPrompt);
    const id = `chatcmpl-local-${Date.now()}`;
    // Only tool mode streams. Conversation mode lets the CLI run its own tools,
    // so its deltas include narration between tool calls, not just the answer
    // Kilo currently receives from the result line.
    const writer = body.stream && tools.length ? createStreamWriter(response, id, body.model) : null;
    const result = await queueClaude(async () => {
      if (controller.signal.aborted) throw cancellationError();
      const hashes = messageHashes(body.messages);
      const matched = matchingClaudeSession(body.model, cwd, hashes);
      if (matched?.cached) {
        matched.session.lastUsed = Date.now();
        process.stdout.write(`${JSON.stringify({ event: "session_cache_hit", session: matched.session.id })}\n`);
        return matched.session.result;
      }
      const limited = cachedSubscriptionError();
      if (limited) {
        const error = new Error(limited.message);
        // Kilo retries 429 responses exponentially. The bridge already knows the
        // real reset time, so fail this request immediately instead of leaving a
        // chat "Thinking" for hours or generating a retry storm.
        error.status = 400;
        error.type = "subscription_limit_error";
        throw error;
      }
      const session = matched?.session || {
        id: randomUUID(),
        model: body.model,
        cwd,
        hashes: [],
        toolsHash: "",
        result: null,
        resultAt: 0,
        lastUsed: Date.now()
      };
      let deltaMessages = matched ? sessionDelta(matched.session, body.messages, hashes) : body.messages;
      const unseenMessages = matched ? Math.max(0, hashes.length - matched.start) : hashes.length;
      let attachments = { directory: null, files: [] };
      let prompt = "";
      const onText = writer ? (text) => writer.content(text) : null;
      const catalogHash = toolsCatalogHash(tools);
      let resumed = Boolean(matched);
      // The catalog only has to be described once per CLI session.
      let knownCatalog = resumed && catalogHash && session.toolsHash === catalogHash ? catalogHash : "";
      try {
        attachments = await materializeImageAttachments(deltaMessages);
        prompt = tools.length ? kiloToolPrompt(deltaMessages, tools, attachments.files, knownCatalog) : conversationPrompt(deltaMessages, attachments.files);
        let recoveredSession = false;
        let output;
        try {
          output = await runClaude(profile, prompt, cwd, controller.signal, tools, { id: session.id, resume: resumed }, attachments.directory, onText);
        } catch (error) {
          if (knownCatalog && !controller.signal.aborted && /Kilo decision|unavailable Kilo tool/i.test(error.message)) {
            knownCatalog = "";
            prompt = kiloToolPrompt(deltaMessages, tools, attachments.files, "");
            process.stdout.write(`${JSON.stringify({ event: "catalog_resent", session: session.id })}\n`);
            output = await runClaude(profile, prompt, cwd, controller.signal, tools, { id: session.id, resume: resumed }, attachments.directory, onText);
          } else if (!resumed || !missingClaudeSession(error) || controller.signal.aborted) {
            throw error;
          } else {
            const missingSession = session.id;
            session.id = randomUUID();
            session.hashes = [];
            deltaMessages = body.messages;
            await removeImageAttachments(attachments);
            attachments = await materializeImageAttachments(deltaMessages);
            prompt = tools.length ? kiloToolPrompt(deltaMessages, tools, attachments.files) : conversationPrompt(deltaMessages, attachments.files);
            resumed = false;
            recoveredSession = true;
            process.stdout.write(`${JSON.stringify({ event: "session_missing", session: missingSession, replacement: session.id })}\n`);
            output = await runClaude(profile, prompt, cwd, controller.signal, tools, { id: session.id, resume: false }, attachments.directory, onText);
          }
        }
        session.toolsHash = catalogHash;
        session.hashes = hashes;
        session.result = output;
        session.resultAt = Date.now();
        rememberClaudeSession(session);
        process.stdout.write(`${JSON.stringify({
          event: recoveredSession ? "session_recovered" : resumed ? "session_resumed" : "session_started",
          session: session.id,
          messages: hashes.length,
          deltaMessages: deltaMessages.length,
          rewrittenMessages: Math.max(0, deltaMessages.length - unseenMessages),
          imageFiles: attachments.files.length,
          promptChars: prompt.length
        })}\n`);
        return output;
      } catch (error) {
        if (error.status === 429 && /session limit/i.test(error.message)) {
          rememberSubscriptionLimit(error.message);
          error.status = 400;
          error.type = "subscription_limit_error";
        }
        throw error;
      } finally {
        await removeImageAttachments(attachments);
      }
    });
    if (body.stream) return streamCompletion(writer || createStreamWriter(response, id, body.model), result);
    if (result.decision?.kind === "tool_call") {
      return sendJson(response, 200, {
        id,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: `call_${randomUUID().replaceAll("-", "")}`,
              type: "function",
              function: {
                name: result.decision.tool_name,
                arguments: JSON.stringify(result.decision.arguments || {})
              }
            }]
          },
          finish_reason: "tool_calls"
        }],
        usage: result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });
    }
    return sendJson(response, 200, {
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: result.decision?.content ?? result.text }, finish_reason: "stop" }],
      usage: result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });
  } catch (error) {
    if (!response.headersSent && !response.destroyed) {
      const status = [400, 429, 499].includes(error.status) ? error.status : 500;
      const headers = error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {};
      const type = error.type || (status === 429 ? "rate_limit_error" : status === 499 ? "cancelled" : "local_cli_error");
      return sendJson(response, status, { error: { message: error.message, type } }, headers);
    }
    if (!response.destroyed) response.end();
  }
});

function shutdown() {
  server.close(() => process.exit(0));
}

if (process.argv.includes("--self-test")) {
  const embeddedImage = `data:image/png;base64,${"A".repeat(2 * 1024 * 1024)}`;
  const compactedImage = contentText([{ type: "image_url", image_url: { url: embeddedImage } }]);
  if (compactedImage.length > 512 || compactedImage.includes("AAAA")) {
    throw new Error("Embedded image data was not removed from the Claude text prompt");
  }

  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const attachments = await materializeImageAttachments([{ content: [{ type: "input_image", image_url: image }] }]);
  try {
    if (attachments.files.length !== 1 || !imageAttachmentPrompt(attachments.files).includes("Use the Read tool")) {
      throw new Error("Embedded image attachments were not materialized for Claude");
    }
    const imageArgs = claudeArgs(profiles["fable-5-1-high"], [{}], { id: "11111111-1111-4111-8111-111111111111", resume: false }, attachments.directory);
    if (!imageArgs.includes("--add-dir") || imageArgs[imageArgs.indexOf("--tools") + 1] !== "Read") {
      throw new Error("Claude image attachments do not have restricted Read access");
    }
  } finally {
    await removeImageAttachments(attachments);
  }
  if (messageHashes([{ content: [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }] }])[0] === messageHashes([{ content: [{ type: "input_image", image_url: "data:image/png;base64,BBBB" }] }])[0]) {
    throw new Error("Distinct embedded images share a Claude session hash");
  }

  const compacted = compactSchema({
    type: "object",
    title: "discard me",
    description: "x".repeat(4096),
    properties: { query: { type: "string", description: "y".repeat(4096) } },
    required: ["query"]
  });
  if (compacted.title || compacted.description.length > MAX_SCHEMA_DESCRIPTION_CHARS || compacted.properties.query.description.length > MAX_SCHEMA_DESCRIPTION_CHARS) {
    throw new Error("Tool schemas were not compacted");
  }

  const reset = nextLocalReset("You've hit your session limit · resets 9:30pm (America/Chicago)", new Date(2026, 8, 19, 17, 30));
  if (reset.getHours() !== 21 || reset.getMinutes() !== 30 || reset.getDate() !== 19) {
    throw new Error("Claude subscription reset time was not parsed correctly");
  }

  const firstArgs = claudeArgs(profiles["fable-5-1-high"], [], { id: "11111111-1111-4111-8111-111111111111", resume: false });
  const resumeArgs = claudeArgs(profiles["fable-5-1-high"], [], { id: "11111111-1111-4111-8111-111111111111", resume: true });
  if (!firstArgs.includes("--session-id") || !resumeArgs.includes("--resume") || firstArgs.includes("--no-session-persistence")) {
    throw new Error("Claude CLI sessions are not configured for persistent resume");
  }

  const usage = normalizeUsage({
    input_tokens: 10,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 30,
    output_tokens: 5
  });
  if (usage.prompt_tokens !== 60 || usage.completion_tokens !== 5 || usage.total_tokens !== 65) {
    throw new Error("Claude usage was not normalized for Kilo context accounting");
  }

  if (!missingClaudeSession(new Error("Session not found")) || missingClaudeSession(new Error("Network unavailable"))) {
    throw new Error("Missing Claude session errors were not classified correctly");
  }

  const cleanEnvironment = cleanClaudeEnvironment();
  if (cleanEnvironment.ANTHROPIC_API_KEY || cleanEnvironment.ANTHROPIC_AUTH_TOKEN || cleanEnvironment.ANTHROPIC_BASE_URL) {
    throw new Error("Anthropic API/gateway credentials were not removed from the Claude CLI environment");
  }
  if (cleanEnvironment.CLAUDE_BRIDGE_TOOL_MODE || cleanClaudeEnvironment(true).CLAUDE_BRIDGE_TOOL_MODE !== "1") {
    throw new Error("Tool-mode runs are not marked for the Claude Stop hook");
  }

  const decisionTools = [{ type: "function", function: { name: "read", description: "z".repeat(600), parameters: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] } } }];
  const toolArgs = claudeArgs(profiles["fable-5-1-high"], decisionTools, { id: "11111111-1111-4111-8111-111111111111", resume: true });
  if (toolSystemPrompt.length > 2800 || !toolArgs.includes("--system-prompt") || toolArgs.includes("--exclude-dynamic-system-prompt-sections")) {
    throw new Error("Tool-mode runs do not use the compact Fable system prompt");
  }
  if (resumeArgs.includes("--system-prompt")) {
    throw new Error("Conversation mode must keep the default Claude system prompt");
  }
  const catalogHash = toolsCatalogHash(decisionTools);
  const fullCatalogPrompt = kiloToolPrompt([{ role: "user", content: "hi" }], decisionTools);
  const knownCatalogPrompt = kiloToolPrompt([{ role: "user", content: "hi" }], decisionTools, [], catalogHash);
  if (catalogHash !== toolsCatalogHash(decisionTools) || catalogHash === toolsCatalogHash([...decisionTools, { type: "function", function: { name: "write" } }])) {
    throw new Error("The Kilo tool catalog hash is not stable per catalog");
  }
  if (!fullCatalogPrompt.includes("\"filePath\"") || knownCatalogPrompt.includes("\"filePath\"") || !knownCatalogPrompt.includes(`catalog #${catalogHash.slice(0, 8)}`) || knownCatalogPrompt.length >= fullCatalogPrompt.length) {
    throw new Error("A resumed step still resends the full Kilo tool catalog");
  }

  const streamArgs = claudeArgs(profiles["fable-5-1-high"], decisionTools, { id: "11111111-1111-4111-8111-111111111111", resume: true }, null, true);
  if (!streamArgs.includes("--include-partial-messages") || streamArgs[streamArgs.indexOf("--output-format") + 1] !== "stream-json" || !streamArgs.includes("--verbose")) {
    throw new Error("A streamed run does not ask the Claude CLI for partial messages");
  }
  if (toolArgs.includes("--include-partial-messages") || toolArgs[toolArgs.indexOf("--output-format") + 1] !== "json") {
    throw new Error("A non-streamed run no longer uses the single-result JSON output format");
  }

  // The CLI hands the decision over in arbitrary fragments, so a delta can end
  // inside a \" or a \uXXXX escape. Three-character slices force both.
  const answer = "Line one\nLine \"two\" é \\  done";
  const finalDecision = JSON.stringify({ kind: "final", content: answer, tool_name: "", arguments: {} });
  const finalStream = createDecisionStream();
  let streamedAnswer = "";
  for (let index = 0; index < finalDecision.length; index += 3) {
    streamedAnswer += finalStream.push(finalDecision.slice(index, index + 3));
  }
  if (streamedAnswer !== answer || finalStream.text !== answer) {
    throw new Error(`A streamed final answer was not reassembled exactly: ${JSON.stringify(streamedAnswer)}`);
  }
  const partialStream = createDecisionStream();
  if (partialStream.push(`{"kind": "fin`) !== "" || partialStream.push(`al", "content": "half`) !== "half") {
    throw new Error("Streaming started before the decision was known to be a final answer");
  }
  const callDecision = JSON.stringify({ kind: "tool_call", content: "this must never reach Kilo early", tool_name: "read", arguments: { filePath: "a.txt" } });
  const callStream = createDecisionStream();
  for (let index = 0; index < callDecision.length; index += 3) {
    if (callStream.push(callDecision.slice(index, index + 3)) !== "") {
      throw new Error("A Kilo tool call leaked text before the decision was complete");
    }
  }

  const cancelled = new AbortController();
  cancelled.abort();
  try {
    await runClaude(profiles["fable-5-1-high"], "cancelled", DEFAULT_DIRECTORY, cancelled.signal, [], { id: "test", resume: false });
    throw new Error("A cancelled queued request would still launch Claude");
  } catch (error) {
    if (error.status !== 499) throw error;
  }

  const testSession = {
    id: "test",
    model: "fable-5-1-high",
    cwd: DEFAULT_DIRECTORY,
    hashes: ["a", "b"],
    result: { text: "cached" },
    resultAt: Date.now(),
    lastUsed: Date.now()
  };
  claudeSessions.push(testSession);
  if (!matchingClaudeSession("fable-5-1-high", DEFAULT_DIRECTORY, ["a", "b"])?.cached || matchingClaudeSession("fable-5-1-high", DEFAULT_DIRECTORY, ["a", "b", "c"])?.start !== 2) {
    throw new Error("Claude session matching failed");
  }
  if (matchingClaudeSession("fable-5-1-high", DEFAULT_DIRECTORY, ["a", "z", "c"])) {
    throw new Error("A different Kilo conversation matched an unrelated Claude session");
  }
  // Kilo compacts old tool outputs in place and regrows the system <env> block,
  // so messages the CLI already saw change. One rewrite must not replay the
  // whole transcript.
  const rewriteSession = {
    id: "rewrite",
    model: "fable-5-1-high",
    cwd: DEFAULT_DIRECTORY,
    hashes: ["sys", "task", "call", "output", "reply"],
    result: null,
    resultAt: 0,
    lastUsed: Date.now()
  };
  claudeSessions.push(rewriteSession);
  const rewrittenHashes = ["sys-grown", "task", "call", "output-compacted", "reply", "next"];
  const rewriteMatch = matchingClaudeSession("fable-5-1-high", DEFAULT_DIRECTORY, rewrittenHashes);
  const rewrittenMessages = rewrittenHashes.map((hash, index) => ({ role: "user", content: `m${index}` }));
  const delta = rewriteMatch && sessionDelta(rewriteMatch.session, rewrittenMessages, rewrittenHashes);
  if (rewriteMatch?.session.id !== "rewrite" || delta.length !== 3 || delta.map((message) => message.content).join() !== "m0,m3,m5") {
    throw new Error("A rewritten earlier message still replays the whole Kilo transcript");
  }
  if (sessionDelta(rewriteSession, rewrittenMessages.slice(0, 5), rewriteSession.hashes).length !== 1) {
    throw new Error("A repeated identical Kilo request does not resend just its newest message");
  }
  claudeSessions.pop();
  claudeSessions.pop();
  process.stdout.write("Claude prompt compaction self-test passed.\n");
} else {
  claudeBinary = await resolveClaudeBinary();
  claudeAuth = await readClaudeAuth(claudeBinary);
  await loadProviderState();
  server.listen(PORT, HOST, () => {
    process.stdout.write(`${JSON.stringify({
      event: "provider_started",
      endpoint: `http://${HOST}:${PORT}/v1`,
      authMethod: claudeAuth.authMethod,
      subscriptionType: claudeAuth.subscriptionType
    })}\n`);
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
