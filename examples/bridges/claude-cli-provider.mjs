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
// Also the whole built-in tool list in conversation mode: other tools would
// only be denied, yet their schemas cost ~24K prompt tokens per step. Skill is
// absent because skills are disabled; Kilo supplies its own.
const ALLOWED_TOOLS = "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Agent";
const DEFAULT_DIRECTORY = "/Users/shri/Documents/Codex";
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_SCHEMA_DESCRIPTION_CHARS = 320;
const MAX_CLAUDE_SESSIONS = 128;
const REQUEST_CACHE_MS = 30 * 1000;
const STATUS_DELAY_MS = 10 * 1000;
const SESSION_STATE_FILE = resolve(homedir(), ".local/state/kilo/claude-cli-provider-state.json");
const TOOL_SYSTEM_PROMPT_FILE = resolve(homedir(), ".config/kilo/bridges/fable-lead-system.md");
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i;
const EMBEDDED_DATA_URL = /data:([^;,]+);base64,[A-Za-z0-9+/=\r\n]+/g;
// "You've hit your session limit · resets 9:30pm", "hit your 5-hour limit", "5-hour limit reached ∙ resets 3pm",
// "usage limit reached". Not "Output token limit reached" or "rate limit reached".
const SUBSCRIPTION_LIMIT = /hit your (?:[\w-]+ ){0,3}limit|\b(?:usage|session|weekly|daily|\d+-hour|opus|sonnet|fable) limit reached/i;
// "resets 9:30pm", "resets Sep 29 at 3pm", "resets Oct 3, 9pm"
const RESET_TIME = /resets\s+(?:at\s+)?(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// ponytail: a fixed cap on parallel CLI runs across all chats, not an adaptive
// one; parallel runs share one subscription's rate limit. Upgrade path is
// backing off the cap when the CLI reports rate limiting.
const CLAUDE_CONCURRENCY = Math.min(8, Math.max(1, Number.parseInt(process.env.CLAUDE_BRIDGE_CONCURRENCY, 10) || 3));
const conversationLocks = new Map();
const claudeSlotWaiters = [];
let activeClaude = 0;
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
  "opus-5-5-fast": { name: "Claude Opus 5.5 Fast (Local CLI)", model: "claude-opus-5-5", effort: "low" },
  "opus-5-5-medium": { name: "Claude Opus 5.5 Medium (Local CLI)", model: "claude-opus-5-5", effort: "medium" },
  "opus-5-5-high": { name: "Claude Opus 5.5 High (Local CLI)", model: "claude-opus-5-5", effort: "high" },
  "fable-5-1-high": { name: "Claude Fable 5.1 High (Local CLI)", model: "fable", effort: "high" },
  "fable-5-1-medium": { name: "Claude Fable 5.1 Medium (Local CLI)", model: "fable", effort: "medium" },
  "fable-5-1-max": { name: "Claude Fable 5.1 Max (Local CLI)", model: "fable", effort: "max" }
};

function cleanClaudeEnvironment(toolMode = false) {
  const environment = { ...process.env };
  // Always use the signed-in Claude subscription. Never inherit API/gateway credentials.
  delete environment.ANTHROPIC_API_KEY;
  delete environment.ANTHROPIC_AUTH_TOKEN;
  delete environment.ANTHROPIC_BASE_URL;
  // Kilo sends its own instructions (project AGENTS.md/CLAUDE.md included) and
  // memory, so the CLI's CLAUDE.md files and auto-memory are duplicate context.
  environment.CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1";
  environment.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
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
        resolveAuth({ authMethod: status.authMethod, subscriptionType: status.subscriptionType || "unknown", email: status.email || null });
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

// Wall-clock parts of date in zone (undefined = local zone).
function wallParts(date, zone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return { year: value.year, month: value.month - 1, day: value.day, ms: Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second) };
}

// The instant a wall-clock time in zone happens. Date.UTC normalizes day and
// month overflow; the second pass settles DST transitions.
function zonedDate(zone, year, month, day, hour, minute) {
  const wall = Date.UTC(year, month, day, hour, minute);
  let instant = wall - (wallParts(new Date(wall), zone).ms - wall);
  instant = wall - (wallParts(new Date(instant), zone).ms - instant);
  return new Date(instant);
}

function nextLocalReset(message, now = new Date()) {
  const match = message.match(RESET_TIME);
  if (!match) return new Date(now.getTime() + 5 * 60 * 1000);
  const [, month, day, hourText, minute = "0", meridiem] = match;
  let zone = message.match(/\(([A-Za-z]+(?:\/[\w+-]+)+)\)/)?.[1];
  try { wallParts(now, zone); } catch { zone = undefined; }
  const today = wallParts(now, zone);
  const hour = Number(hourText) % 12 + (meridiem.toLowerCase() === "pm" ? 12 : 0);
  const monthIndex = month ? MONTHS.indexOf(month.slice(0, 3).toLowerCase()) : today.month;
  const date = month ? Number(day) : today.day;
  const reset = zonedDate(zone, today.year, monthIndex, date, hour, Number(minute));
  // Up to an hour late is the reset that just passed, so the limit is already
  // over; rolling it to tomorrow would lock the bridge out for a day.
  if (now - reset < 60 * 60 * 1000) return reset;
  return month
    ? zonedDate(zone, today.year + 1, monthIndex, date, hour, Number(minute))
    : zonedDate(zone, today.year, monthIndex, date + 1, hour, Number(minute));
}

// Kilo retries 429 responses exponentially and shows a reply with no content
// meanwhile. The bridge already knows the reset time, so a non-retryable 400
// with a readable message is what actually reaches the chat.
function subscriptionLimitError(limit) {
  const resetsAt = limit.until.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const error = new Error(`Claude subscription usage limit reached; resets at ${resetsAt}. Claude CLI said: ${limit.message}`);
  error.status = 400;
  error.type = "subscription_limit_error";
  return error;
}

function cachedSubscriptionError() {
  if (!subscriptionLimit) return null;
  if (subscriptionLimit.until <= new Date()) {
    subscriptionLimit = null;
    return null;
  }
  return subscriptionLimit;
}

// A limit belongs to the account that hit it; after a CLI account switch a
// persisted one no longer applies.
function persistedLimit(saved, account, now = new Date()) {
  const until = new Date(saved?.until);
  return saved?.message && account && saved.account === account && until > now ? { message: saved.message, until, account } : null;
}

function rememberSubscriptionLimit(message) {
  subscriptionLimit = { message, until: nextLocalReset(message), account: claudeAuth?.email || null };
  process.stdout.write(`${JSON.stringify({ event: "subscription_limit", until: subscriptionLimit.until.toISOString() })}\n`);
  saveProviderState();
  return subscriptionLimit;
}

// One conversation runs one CLI job at a time, in arrival order, so a CLI
// session is never resumed twice at once. matchingClaudeSession only continues
// sessions with the same model, cwd and anchor, i.e. the same lock key.
function withConversationLock(key, task) {
  const queued = (conversationLocks.get(key) || Promise.resolve()).then(task);
  const tail = queued.catch(() => {});
  conversationLocks.set(key, tail);
  tail.then(() => { if (conversationLocks.get(key) === tail) conversationLocks.delete(key); });
  return queued;
}

// Different conversations share CLAUDE_CONCURRENCY CLI slots, first come first served.
async function withClaudeSlot(task) {
  if (activeClaude < CLAUDE_CONCURRENCY) activeClaude += 1;
  else await new Promise((resolveSlot) => claudeSlotWaiters.push(resolveSlot));
  try {
    return await task();
  } finally {
    // Hand the slot straight to the next waiter so a newcomer cannot jump the line.
    const next = claudeSlotWaiters.shift();
    if (next) next();
    else activeClaude -= 1;
  }
}

function conversationLockKey(model, cwd, anchor) {
  return JSON.stringify([model, cwd, anchor]);
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
// user turn is what actually identifies a conversation. VS Code opens with a
// user message of workspace context (<environment_info>/<workspace_info>) that
// every chat in a workspace shares, so only then does the next user message
// join the anchor. Kilo's first user turn anchors alone, as before.
// Without roles (sessions saved before anchors were stored) it is message 1.
// ponytail: two tasks in one directory opening with byte-identical first user
// turns would share a CLI session. Upgrade path is a client-supplied task id.
function conversationAnchor(hashes, messages = null) {
  if (!messages) return hashes.length > 1 ? hashes[1] : "";
  const first = messages.findIndex((message) => !["system", "developer"].includes(message?.role));
  if (first < 0) return "";
  const vscodeContext = messages[first].role === "user" && /<(?:environment|workspace)_info>/.test(contentText(messages[first].content));
  return vscodeContext && messages[first + 1]?.role === "user" ? `${hashes[first]}:${hashes[first + 1]}` : hashes[first];
}

function matchingClaudeSession(model, cwd, hashes, anchor = conversationAnchor(hashes)) {
  const candidates = claudeSessions.filter((session) => session.model === model && session.cwd === cwd);
  const exact = candidates.find((session) => sameHashes(session.hashes, hashes));
  if (exact?.result && Date.now() - exact.resultAt <= REQUEST_CACHE_MS) {
    return { session: exact, cached: true, start: hashes.length };
  }
  const continued = anchor ? candidates
    .filter((session) => (session.anchor ?? conversationAnchor(session.hashes)) === anchor)
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
    subscriptionLimit: subscriptionLimit ? { message: subscriptionLimit.message, until: subscriptionLimit.until.toISOString(), account: subscriptionLimit.account } : null,
    sessions: claudeSessions.map(({ id, model, cwd, hashes, anchor, toolsHash, lastUsed }) => ({ id, model, cwd, hashes, anchor, toolsHash, lastUsed }))
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
      claudeSessions.push({ ...session, anchor: typeof session.anchor === "string" ? session.anchor : undefined, toolsHash: typeof session.toolsHash === "string" ? session.toolsHash : "", result: null, resultAt: 0 });
    }
    subscriptionLimit = persistedLimit(state.subscriptionLimit, claudeAuth?.email);
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
    "The user supplied the image files below. Use the Read tool to inspect every image relevant to this request before answering or making a tool-call decision. Do not say an image is unavailable merely because it is a local path.",
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

// VS Code's Copilot Chat fetcher always sends X-VSCode-User-Agent-Library-Version
// and, unless overridden, a GitHubCopilotChat/<version> user agent. Kilo sends
// neither and shows tok/s itself, so only VS Code gets the footer.
function wantsThroughputFooter(headers) {
  return Boolean(headers["x-vscode-user-agent-library-version"]) || /^GitHubCopilotChat\//.test(headers["user-agent"] || "");
}

// Kilo's footer ("203.9 t/s   3:44 PM · 48s"; "112 t/s" drops ".0"; the gap is three U+00A0), same as openrouter-speed-proxy.mjs.
// The CLI hands over its answer in one piece, so callers pass the end-to-end time
// as generationMs too: an average, not a live rate.
function throughputFooter(outputTokens, generationMs, elapsedMs, doneAt = new Date()) {
  const rate = generationMs > 0 ? outputTokens / (generationMs / 1000) : 0;
  const hours = doneAt.getHours();
  const clock = `${hours % 12 || 12}:${String(doneAt.getMinutes()).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  const seconds = Math.round(elapsedMs / 1000);
  const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${rate.toFixed(1).replace(/\.0$/, "")} t/s\u00a0\u00a0\u00a0${clock} · ${elapsed}`;
}

// VS Code sends earlier answers back verbatim; the CLI must not see (and start
// imitating) the footer. Matches the new format and the old "⚡ **x tok/s**" one.
const THROUGHPUT_FOOTER = /\n\n(?:---\n⚡ \*\*[\d.]+ tok\/s\*\* · \d+ output tokens · [\d.]+s|[\d.]+ t\/s(?: · |\u00a0{3})\d{1,2}:\d{2} [AP]M · (?:\d+m )?\d+s)\s*$/;

function conversationTranscript(messages) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const role = typeof message?.role === "string" ? message.role.toUpperCase() : "MESSAGE";
    const text = contentText(message?.content);
    const parts = [message?.role === "assistant" ? text.replace(THROUGHPUT_FOOTER, "") : text];
    if (message?.tool_calls) parts.push(`Tool calls: ${jsonForPrompt(message.tool_calls)}`);
    if (message?.tool_call_id) parts.push(`Tool call ID: ${message.tool_call_id}`);
    return `[${role}]\n${parts.filter(Boolean).join("\n")}`;
  }).join("\n\n");
}

function conversationPrompt(messages, imageFiles = []) {
  const transcript = conversationTranscript(messages);

  return [
    "Complete the coding-agent request below (from Kilo Code or VS Code) using your own Claude Code tools.",
    "You are running through the authenticated local Claude CLI. Perform required file and terminal work directly, verify it, and return a concise final result.",
    "Do not ask the client to execute tool calls and do not claim to have used an external Claude API or gateway.",
    imageAttachmentPrompt(imageFiles),
    "",
    transcript
  ].join("\n");
}

function compactTools(tools) {
  return tools.map((tool) => ({
    name: tool?.function?.name,
    // apply_patch's description is its patch-format spec (about 1.1K chars);
    // cut, Fable writes malformed patches.
    description: tool?.function?.name === "apply_patch" ? tool.function.description || "" : (tool?.function?.description || "").slice(0, MAX_SCHEMA_DESCRIPTION_CHARS),
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
    ? `AVAILABLE CLIENT TOOLS: unchanged since earlier in this session (catalog #${knownCatalog.slice(0, 8)})`
    : `AVAILABLE CLIENT TOOLS\n${JSON.stringify(compactTools(tools))}`;

  return [
    "You are the model driving a coding agent (Kilo Code or VS Code) through the authenticated local Claude CLI.",
    "Follow the complete conversation and its system instructions. The agent client, not this CLI process, owns all file, terminal, web, and subagent execution.",
    "Return one decision: a final answer, or one or more client tool calls. Batch independent calls (several reads or searches, edits to different files) into one decision; a call that needs another call's result waits for a later turn. Never claim a tool ran until its result appears in a later TOOL message.",
    "For a final answer, set kind to final, put the answer in content, and set tool_calls to an empty array.",
    "For tool calls, set kind to tool_call, content to an empty string, and tool_calls to a list of { tool_name, arguments } where tool_name is an available tool and arguments is a valid object matching its parameters.",
    "Use the client's own subagent tool (Kilo's task tool) when the engineering-lead policy calls for delegation; do not substitute Claude CLI background agents.",
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
      tool_calls: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tool_name: { type: "string", enum: names },
            arguments: { type: "object", additionalProperties: true }
          },
          required: ["tool_name", "arguments"],
          additionalProperties: false
        }
      }
    },
    required: ["kind", "content", "tool_calls"],
    additionalProperties: false
  };
}

// The CLI's decision for a tool-mode step: a final answer, or one or more
// Kilo tool calls that Kilo runs and answers together.
function parseDecision(payload, tools) {
  let decision = payload.structured_output;
  if (!decision && payload.result) {
    try { decision = JSON.parse(payload.result); } catch {}
  }
  const calls = decision?.kind === "tool_call" && Array.isArray(decision.tool_calls) ? decision.tool_calls : [];
  if (!decision || !["final", "tool_call"].includes(decision.kind) || (decision.kind === "tool_call" && !calls.length)) {
    throw new Error("Claude CLI did not return a valid Kilo decision");
  }
  const unavailable = calls.find((call) => !tools.some((tool) => tool?.function?.name === call?.tool_name));
  if (unavailable) throw new Error(`Claude CLI requested an unavailable Kilo tool: ${unavailable?.tool_name}`);
  return decision;
}

// OpenAI tool_calls entries; index is required in stream deltas and ignored elsewhere.
function openAiToolCalls(decision) {
  return decision.tool_calls.map((call, index) => ({
    index,
    id: `call_${randomUUID().replaceAll("-", "")}`,
    type: "function",
    function: { name: call.tool_name, arguments: JSON.stringify(call.arguments || {}) }
  }));
}

function candidateDirectories(text) {
  const matches = [];
  const patterns = [
    /<cwd>\s*([^<\n]+?)\s*<\/cwd>/gi,
    /(?:current working directory|working directory|workspace directory|workspace root|cwd)\s*(?:is|:|=)\s*[`"']?([^\n<`"']+)/gi,
    // VS Code's <workspace_info>; last, so Kilo's own markers still win.
    /workspace with the following folders:\s*\n-\s*([^\n]+)/gi
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
    // Tool mode gets the same trimming from --safe-mode, which would also drop
    // the user's hooks (guard-secrets) that conversation mode's tools need.
    args.push(
      "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      "--disable-slash-commands",
      "--tools", ALLOWED_TOOLS,
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
        error.status = payload.api_error_status || (SUBSCRIPTION_LIMIT.test(error.message) ? 429 : 500);
        return reject(error);
      }
      if (tools.length) {
        try {
          return resolveResult({ decision: parseDecision(payload, tools), usage: normalizeUsage(payload.usage) });
        } catch (error) {
          return reject(error);
        }
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

function sendError(response, error) {
  if (response.destroyed || response.writableEnded) return;
  const status = [400, 429, 499].includes(error.status) ? error.status : 500;
  const type = error.type || (status === 429 ? "rate_limit_error" : status === 499 ? "cancelled" : "local_cli_error");
  if (!response.headersSent) {
    const headers = error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {};
    return sendJson(response, status, { error: { message: error.message, type } }, headers);
  }
  // SSE headers already went out, so an error event is the only way Kilo can
  // still show why the stream stopped (e.g. a subscription limit mid-answer).
  response.end(`data: ${JSON.stringify({ error: { message: error.message, type } })}\n\n`);
}

// footer is "" (Kilo) or a text suffix for final answers; tool calls never get one.
function streamCompletion(writer, result, footer = "") {
  if (result.decision?.kind === "tool_call") {
    writer.chunk({ tool_calls: openAiToolCalls(result.decision) });
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
  writer.content(footer);
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
      concurrency: { limit: CLAUDE_CONCURRENCY, active: activeClaude, queued: claudeSlotWaiters.length, conversations: conversationLocks.size },
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

  const startedAt = Date.now();
  let firstOutputAt = 0;
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
      userAgent: request.headers["user-agent"] || null,
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
    const hashes = messageHashes(body.messages);
    const anchor = conversationAnchor(hashes, body.messages);
    const result = await withConversationLock(conversationLockKey(body.model, cwd, anchor), async () => {
      if (controller.signal.aborted) throw cancellationError();
      const matched = matchingClaudeSession(body.model, cwd, hashes, anchor);
      // A repeat of a just-finished request never waits behind other chats.
      if (matched?.cached) {
        matched.session.lastUsed = Date.now();
        process.stdout.write(`${JSON.stringify({ event: "session_cache_hit", session: matched.session.id })}\n`);
        return matched.session.result;
      }
      return withClaudeSlot(() => runConversationStep(matched));
    });
    async function runConversationStep(matched) {
      if (controller.signal.aborted) throw cancellationError();
      const limited = cachedSubscriptionError();
      if (limited) throw subscriptionLimitError(limited);
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
      const onText = writer ? (text) => {
        firstOutputAt ||= Date.now();
        writer.content(text);
      } : null;
      // One reasoning delta so a long step is not a silent spinner. Delayed so
      // quick failures (subscription limit) still get a plain HTTP error; Kilo
      // keeps it as reasoning_content, which the transcript never forwards.
      const status = writer && setTimeout(() => {
        if (!firstOutputAt) writer.chunk({ reasoning_content: `${profile.name.replace(/ \(.*/, "")} is working...` });
      }, STATUS_DELAY_MS);
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
        // Stored with the result, so a cached repeat reports the real run time.
        output.elapsedMs = Date.now() - startedAt;
        session.toolsHash = catalogHash;
        session.hashes = hashes;
        session.anchor = anchor;
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
          promptChars: prompt.length,
          // First streamed delta, else the finished result (sent right after this line).
          ttftMs: (firstOutputAt || Date.now()) - startedAt
        })}\n`);
        return output;
      } catch (error) {
        if (error.status === 429 && SUBSCRIPTION_LIMIT.test(error.message)) {
          throw subscriptionLimitError(rememberSubscriptionLimit(error.message));
        }
        throw error;
      } finally {
        clearTimeout(status);
        await removeImageAttachments(attachments);
      }
    }
    const elapsedMs = result.elapsedMs ?? Date.now() - startedAt;
    const footer = wantsThroughputFooter(request.headers) ? `\n\n${throughputFooter(result.usage?.completion_tokens ?? 0, elapsedMs, elapsedMs)}` : "";
    if (body.stream) return streamCompletion(writer || createStreamWriter(response, id, body.model), result, footer);
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
            tool_calls: openAiToolCalls(result.decision)
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
      choices: [{ index: 0, message: { role: "assistant", content: footer ? `${result.decision?.content ?? result.text ?? ""}${footer}` : result.decision?.content ?? result.text }, finish_reason: "stop" }],
      usage: result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });
  } catch (error) {
    sendError(response, error);
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
  // Kilo (openai-compatible) never inlines MCP images such as a Peekaboo
  // see/image capture in the role "tool" message: it appends a user message
  // "Attached media from tool result:" with an image_url part. That capture
  // must reach Claude as a Read-able file, and its base64 must stay out of the prompt.
  const peekabooStep = [
    { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Peekaboo_see", arguments: "{\"app_target\":\"Code\"}" } }] },
    { role: "tool", tool_call_id: "call_1", content: "UI State Captured\nSnapshot: s1" },
    { role: "user", content: [{ type: "text", text: "Attached media from tool result:" }, { type: "image_url", image_url: { url: image } }] }
  ];
  const captured = await materializeImageAttachments(peekabooStep);
  try {
    const capturePrompt = kiloToolPrompt(peekabooStep, [{ type: "function", function: { name: "Peekaboo_see" } }], captured.files);
    if (captured.files.length !== 1 || !capturePrompt.includes(captured.files[0]) || capturePrompt.includes("iVBORw0KGgo")) {
      throw new Error("A Peekaboo tool-result screenshot does not reach Claude as a Read-able file");
    }
  } finally {
    await removeImageAttachments(captured);
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

  // [CLI text, is a subscription limit]
  for (const [text, expected] of [
    ["You've hit your 5-hour limit · resets 3pm", true],
    ["You've hit your session limit · resets 9:30pm", true],
    ["5-hour limit reached ∙ resets 3pm", true],
    ["Claude usage limit reached. Your limit will reset at 3pm", true],
    ["Output token limit reached", false],
    ["API Error: rate limit reached", false]
  ]) {
    if (SUBSCRIPTION_LIMIT.test(text) !== expected) throw new Error(`Subscription limit misclassified: ${text}`);
  }
  // [CLI text, now, expected reset; null = the reset has already passed]
  for (const [text, now, expected] of [
    ["You've hit your session limit · resets 9:30pm (America/Chicago)", "2026-09-19T22:30:00Z", "2026-09-20T02:30:00.000Z"],
    ["You've hit your session limit · resets 9:30pm (Asia/Kolkata)", "2026-09-19T12:00:00Z", "2026-09-19T16:00:00.000Z"],
    ["You've hit your weekly limit · resets Sep 29 at 3pm (America/Chicago)", "2026-09-22T12:00:00Z", "2026-09-29T20:00:00.000Z"],
    ["Weekly limit reached ∙ resets Oct 3, 9pm (America/Chicago)", "2026-09-22T12:00:00Z", "2026-10-04T02:00:00.000Z"],
    ["You've hit your weekly limit · resets Jan 2 at 9am (America/Chicago)", "2026-12-30T12:00:00Z", "2027-01-02T15:00:00.000Z"],
    ["You've hit your 5-hour limit · resets 3pm (America/Chicago)", "2026-09-22T20:00:10Z", null],
    ["You've hit your 5-hour limit · resets 1pm (America/Chicago)", "2026-09-22T20:30:00Z", "2026-09-23T18:00:00.000Z"]
  ]) {
    const reset = nextLocalReset(text, new Date(now));
    if (expected ? reset.toISOString() !== expected : reset > new Date(now)) {
      throw new Error(`Claude subscription reset time was not parsed correctly: ${text} at ${now} gave ${reset.toISOString()}`);
    }
  }
  const savedLimit = { message: "You've hit your session limit", until: "2026-09-19T23:00:00Z", account: "a@example.com" };
  const beforeReset = new Date("2026-09-19T22:00:00Z");
  if (!persistedLimit(savedLimit, "a@example.com", beforeReset) || persistedLimit(savedLimit, "b@example.com", beforeReset)
    || persistedLimit({ ...savedLimit, account: undefined }, "a@example.com", beforeReset) || persistedLimit(savedLimit, "a@example.com", new Date("2026-09-19T23:30:00Z"))) {
    throw new Error("A persisted subscription limit is not bound to its account and reset time");
  }
  const midStream = { headersSent: true, destroyed: false, writableEnded: false, end(body) { this.body = body; } };
  sendError(midStream, subscriptionLimitError({ message: "You've hit your session limit", until: new Date() }));
  if (JSON.parse(midStream.body?.replace(/^data: /, "") || "{}").error?.type !== "subscription_limit_error") {
    throw new Error("A subscription limit after SSE headers is not sent as an SSE error event");
  }
  // A stub CLI replays the real limit result line, so the whole path from CLI
  // output to the error Kilo displays is exercised without spending quota.
  const stubDirectory = await mkdtemp(join(tmpdir(), "claude-limit-stub-"));
  try {
    const limitLine = JSON.stringify({ type: "result", is_error: true, result: "You've hit your session limit · resets 9pm (America/Chicago)" });
    await writeFile(join(stubDirectory, "claude"), `#!/bin/sh\ncat >/dev/null\ncat <<'EOF'\n${limitLine}\nEOF\nexit 1\n`, { mode: 0o755 });
    claudeBinary = join(stubDirectory, "claude");
    const limitError = await runClaude(profiles["fable-5-1-high"], "hi", DEFAULT_DIRECTORY, new AbortController().signal, [], { id: "test", resume: false }).catch((error) => error);
    const shown = limitError.status === 429 && SUBSCRIPTION_LIMIT.test(limitError.message) && subscriptionLimitError({ message: limitError.message, until: nextLocalReset(limitError.message, new Date("2026-09-19T22:30:00Z")) });
    if (!shown || shown.status !== 400 || shown.type !== "subscription_limit_error" || !/^Claude subscription usage limit reached; resets at Sep \d+, \d+:00\s[AP]M .*You've hit your session limit/.test(shown.message)) {
      throw new Error(`A Claude subscription limit is not surfaced to Kilo as a readable, non-retryable error: ${shown?.message || limitError.message}`);
    }
  } finally {
    claudeBinary = null;
    await rm(stubDirectory, { recursive: true, force: true });
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
  const chatArgs = resumeArgs.join(" ");
  if (cleanEnvironment.CLAUDE_CODE_DISABLE_CLAUDE_MDS !== "1" || !chatArgs.includes("--strict-mcp-config --mcp-config {\"mcpServers\":{}}") || !chatArgs.includes("--disable-slash-commands") || resumeArgs[resumeArgs.indexOf("--tools") + 1] !== ALLOWED_TOOLS) {
    throw new Error("Conversation mode still loads CLAUDE.md, MCP servers, skills or tools the bridge never allows");
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
  const patchSpec = "*** Begin Patch ".repeat(80);
  const [keptPatch, cutRead] = compactTools([{ function: { name: "apply_patch", description: patchSpec, parameters: { type: "object", properties: { patchText: { type: "string", description: "p".repeat(600) } } } } }, ...decisionTools]);
  if (keptPatch.description !== patchSpec || keptPatch.parameters.properties.patchText.description.length !== MAX_SCHEMA_DESCRIPTION_CHARS || cutRead.description.length !== MAX_SCHEMA_DESCRIPTION_CHARS) {
    throw new Error("Only apply_patch's top-level description may bypass the tool description cap");
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
  const finalDecision = JSON.stringify({ kind: "final", content: answer, tool_calls: [] });
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
  const callDecision = JSON.stringify({ kind: "tool_call", content: "this must never reach Kilo early", tool_calls: [{ tool_name: "read", arguments: { filePath: "a.txt" } }] });
  const callStream = createDecisionStream();
  for (let index = 0; index < callDecision.length; index += 3) {
    if (callStream.push(callDecision.slice(index, index + 3)) !== "") {
      throw new Error("A Kilo tool call leaked text before the decision was complete");
    }
  }

  // Several independent Kilo tool calls in one decision become one OpenAI
  // assistant turn with one tool_calls entry each, so Kilo runs them together.
  const multiTools = [...decisionTools, { type: "function", function: { name: "grep", parameters: { type: "object" } } }];
  const multiDecision = parseDecision({ result: JSON.stringify({ kind: "tool_call", content: "", tool_calls: [{ tool_name: "read", arguments: { filePath: "a.js" } }, { tool_name: "grep", arguments: { pattern: "x" } }] }) }, multiTools);
  const streamed = { headersSent: false, writeHead() { this.headersSent = true; }, write(body) { this.body = (this.body || "") + body; }, end(body) { this.body += body; } };
  streamCompletion(createStreamWriter(streamed, "id", "fable-5-1-high"), { decision: multiDecision });
  const emitted = streamed.body.split("\n\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)).choices[0]);
  const emittedCalls = emitted.flatMap((choice) => choice.delta.tool_calls || []);
  if (emittedCalls.map((call) => `${call.index}:${call.function.name}:${call.function.arguments}`).join() !== `0:read:{"filePath":"a.js"},1:grep:{"pattern":"x"}` || new Set(emittedCalls.map((call) => call.id)).size !== 2 || emitted.at(-1).finish_reason !== "tool_calls") {
    throw new Error("A multi-call Kilo decision was not emitted as separate OpenAI tool_calls");
  }
  // The tok/s footer: VS Code only, final answers only, never fed back to the CLI.
  const footer = `\n\n${throughputFooter(300, 10000, 10000)}`;
  if (throughputFooter(9786, 48000, 48000, new Date(2026, 8, 23, 15, 44)) !== "203.9 t/s\u00a0\u00a0\u00a03:44 PM · 48s" || throughputFooter(5, 0, 72400, new Date(2026, 0, 1, 0, 5)) !== "0 t/s\u00a0\u00a0\u00a012:05 AM · 1m 12s") {
    throw new Error("The throughput footer no longer matches Kilo's format");
  }
  if (!wantsThroughputFooter({ "user-agent": "GitHubCopilotChat/0.67.0", "x-vscode-user-agent-library-version": "electron-fetch" }) || !wantsThroughputFooter({ "x-vscode-user-agent-library-version": "node-http" })
    || wantsThroughputFooter({ "user-agent": "ai-sdk/openai-compatible/1.0.0 runtime/bun/1.3.0" }) || wantsThroughputFooter({ "user-agent": "Kilo-Code/7.7.7" }) || wantsThroughputFooter({})) {
    throw new Error("The VS Code / Kilo client discriminator is wrong");
  }
  const sse = () => ({ headersSent: false, writeHead() { this.headersSent = true; }, write(body) { this.body = (this.body || "") + body; }, end(body) { this.body += body; } });
  const deltas = (stream) => stream.body.split("\n\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)).choices[0]);
  const withFooter = sse();
  streamCompletion(createStreamWriter(withFooter, "id", "opus-5-5-fast"), { text: "Hi.", usage: {} }, footer);
  const footerDeltas = deltas(withFooter);
  if (footerDeltas.map((choice) => choice.delta.content || "").join("") !== `Hi.${footer}` || footerDeltas.at(-2).delta.content !== footer || footerDeltas.at(-1).finish_reason !== "stop") {
    throw new Error("The VS Code footer is not the last text chunk of a final answer");
  }
  const withoutFooter = sse();
  streamCompletion(createStreamWriter(withoutFooter, "id", "opus-5-5-fast"), { text: "Hi.", usage: {} });
  const callsWithFooter = sse();
  streamCompletion(createStreamWriter(callsWithFooter, "id", "fable-5-1-high"), { decision: multiDecision }, footer);
  if (deltas(withoutFooter).map((choice) => choice.delta.content || "").join("") !== "Hi." || deltas(callsWithFooter).some((choice) => choice.delta.content)) {
    throw new Error("A Kilo answer or a tool-call turn received the throughput footer");
  }
  if (conversationTranscript([{ role: "assistant", content: `Done.${footer}` }, { role: "assistant", content: "Old.\n\n---\n⚡ **30.0 tok/s** · 300 output tokens · 10.0s" }, { role: "user", content: `Quote:${footer}` }]) !== `[ASSISTANT]\nDone.\n\n[ASSISTANT]\nOld.\n\n[USER]\nQuote:${footer}`) {
    throw new Error("An earlier VS Code answer's footer still reaches the CLI");
  }
  if (toolDecisionSchema(multiTools).properties.tool_calls.items.properties.tool_name.enum.join() !== "read,grep") {
    throw new Error("The decision schema does not pin tool_calls to the Kilo catalog");
  }
  for (const [decision, pattern] of [
    [{ kind: "tool_call", content: "", tool_calls: [] }, /valid Kilo decision/],
    [{ kind: "tool_call", content: "", tool_calls: [{ tool_name: "read", arguments: {} }, { tool_name: "bash", arguments: {} }] }, /unavailable Kilo tool: bash/]
  ]) {
    let failure = null;
    try { parseDecision({ structured_output: decision }, multiTools); } catch (error) { failure = error; }
    if (!pattern.test(failure?.message || "")) throw new Error(`An invalid multi-call decision was accepted: ${JSON.stringify(decision)}`);
  }
  if (parseDecision({ structured_output: { kind: "final", content: "done", tool_calls: [] } }, multiTools).content !== "done") {
    throw new Error("A final answer is no longer accepted as a Kilo decision");
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

  // VS Code (Copilot Chat Custom Endpoint) shape: snake_case tools plus MCP
  // tools, a workspace-context user message before the request, and tool-result
  // images inlined as image_url parts of the role "tool" message.
  const vscodeTools = ["read_file", "replace_string_in_file", "run_in_terminal", "mcp_peekaboo_see"]
    .map((name) => ({ type: "function", function: { name, description: `${name} tool`, parameters: { type: "object", properties: { filePath: { type: "string" } } } } }));
  const vscodeContext = { role: "user", content: "<environment_info>macOS</environment_info>\n<workspace_info>\nI am working in a workspace with the following folders:\n- /tmp \n</workspace_info>" };
  const vscodeChat = [
    { role: "system", content: "You are an expert AI programming assistant." },
    vscodeContext,
    { role: "user", content: "<userRequest>\nTake a screenshot of VS Code\n</userRequest>" },
    { role: "assistant", content: "", tool_calls: [{ id: "call_v1", type: "function", function: { name: "mcp_peekaboo_see", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_v1", content: [{ type: "text", text: "UI State Captured" }, { type: "image_url", image_url: { url: image, media_type: "image/png" } }] }
  ];
  if (toolDecisionSchema(vscodeTools).properties.tool_calls.items.properties.tool_name.enum.join() !== "read_file,replace_string_in_file,run_in_terminal,mcp_peekaboo_see"
    || parseDecision({ structured_output: { kind: "tool_call", content: "", tool_calls: [{ tool_name: "replace_string_in_file", arguments: { filePath: "a" } }] } }, vscodeTools).tool_calls[0].tool_name !== "replace_string_in_file") {
    throw new Error("VS Code tool names are not accepted as client tool calls");
  }
  const vscodeImage = await materializeImageAttachments(vscodeChat);
  try {
    const vscodePrompt = kiloToolPrompt(vscodeChat, vscodeTools, vscodeImage.files);
    if (vscodeImage.files.length !== 1 || !vscodePrompt.includes(vscodeImage.files[0]) || vscodePrompt.includes("iVBORw0KGgo") || !vscodePrompt.includes("\"mcp_peekaboo_see\"") || /Kilo/.test(vscodePrompt.replace("Kilo Code or VS Code", "").replace("Kilo's task tool", ""))) {
      throw new Error("A VS Code tool-result image does not reach Claude as a Read-able file, or the prompt is Kilo-only");
    }
  } finally {
    await removeImageAttachments(vscodeImage);
  }
  if (await workingDirectory(contentText(vscodeContext.content)) !== "/tmp") {
    throw new Error("The VS Code workspace folder is not used as the CLI working directory");
  }
  // One bridge serves Kilo and VS Code: each conversation keeps its own CLI
  // session and lock, and different conversations run in parallel. Two VS Code chats in one
  // workspace share the context message, so it cannot be the anchor alone.
  const kiloChat = [{ role: "system", content: "<env>kilo</env>" }, { role: "user", content: "Fix the bug" }, { role: "assistant", content: "", tool_calls: [{ id: "call_k1", type: "function", function: { name: "read", arguments: "{}" } }] }];
  const otherVscodeChat = [vscodeChat[0], vscodeContext, { role: "user", content: "<userRequest>\nExplain this repo\n</userRequest>" }];
  const shapes = [kiloChat, vscodeChat, otherVscodeChat].map((messages) => {
    const hashes = messageHashes(messages);
    return { hashes, anchor: conversationAnchor(hashes, messages) };
  });
  // A Kilo turn can follow an aborted one with no assistant reply in between.
  const kiloRetry = [...kiloChat.slice(0, 2), { role: "user", content: "Try again" }];
  if (shapes[0].anchor !== conversationAnchor(shapes[0].hashes) || conversationAnchor(messageHashes(kiloChat.slice(0, 2)), kiloChat.slice(0, 2)) !== shapes[0].anchor
    || conversationAnchor(messageHashes(kiloRetry), kiloRetry) !== shapes[0].anchor) {
    throw new Error("The Kilo conversation anchor changed");
  }
  const parallel = shapes.slice(0, 2).map(({ hashes, anchor }, index) => ({ id: `parallel-${index}`, model: "opus-5-5-fast", cwd: DEFAULT_DIRECTORY, hashes, anchor, result: null, resultAt: 0, lastUsed: Date.now() }));
  claudeSessions.push(...parallel);
  try {
    const nextStep = (messages, extra) => {
      const hashes = messageHashes([...messages, extra]);
      return matchingClaudeSession("opus-5-5-fast", DEFAULT_DIRECTORY, hashes, conversationAnchor(hashes, [...messages, extra]))?.session.id;
    };
    const toolResult = { role: "tool", tool_call_id: "call_x", content: "ok" };
    if (nextStep(kiloChat, toolResult) !== "parallel-0" || nextStep(vscodeChat, toolResult) !== "parallel-1" || nextStep(otherVscodeChat, toolResult)) {
      throw new Error("Concurrent Kilo and VS Code conversations do not map to distinct Claude sessions");
    }
  } finally {
    claudeSessions.splice(claudeSessions.indexOf(parallel[0]), 2);
  }

  // The request handler's scheduling: conversation lock, then a CLI slot.
  // Fake 40 ms jobs stand in for runClaude and record when they ran.
  const runs = [];
  let running = 0;
  let peak = 0;
  const fakeJob = (key, label, fail = false) => withConversationLock(key, () => withClaudeSlot(async () => {
    const run = { label, start: performance.now() };
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolveJob) => setTimeout(resolveJob, 40));
    running -= 1;
    run.end = performance.now();
    runs.push(run);
    if (fail) throw new Error("fake failure");
  }));
  const keyFor = (messages) => {
    const hashes = messageHashes(messages);
    return conversationLockKey("opus-5-5-fast", DEFAULT_DIRECTORY, conversationAnchor(hashes, messages));
  };
  const toolStep = { role: "tool", tool_call_id: "call_k1", content: "ok" };
  if (keyFor(kiloChat) !== keyFor([...kiloChat, toolStep]) || keyFor(kiloChat) === keyFor(vscodeChat) || keyFor(vscodeChat) === keyFor(otherVscodeChat)) {
    throw new Error("Conversation lock keys do not follow the conversation anchor");
  }
  const overlaps = (left, right) => left.start < right.end && right.start < left.end;
  const byLabel = (label) => runs.find((run) => run.label === label);
  await Promise.all([fakeJob(keyFor(kiloChat), "kilo"), fakeJob(keyFor(vscodeChat), "vscode")]);
  if (CLAUDE_CONCURRENCY > 1 && !overlaps(byLabel("kilo"), byLabel("vscode"))) {
    throw new Error("Independent Kilo and VS Code conversations still run one after another");
  }
  runs.length = 0;
  await Promise.all([
    fakeJob(keyFor(kiloChat), "step-1", true).catch(() => {}),
    fakeJob(keyFor([...kiloChat, toolStep]), "step-2"),
    fakeJob(keyFor([...kiloChat, toolStep, { role: "user", content: "next" }]), "step-3")
  ]);
  if (runs.map((run) => run.label).join() !== "step-1,step-2,step-3" || overlaps(byLabel("step-1"), byLabel("step-2")) || overlaps(byLabel("step-2"), byLabel("step-3"))) {
    throw new Error("Two steps of one conversation overlapped, ran out of order, or a failure jammed its lock");
  }
  runs.length = 0;
  peak = 0;
  const capped = Array.from({ length: CLAUDE_CONCURRENCY + 2 }, (unused, index) => `chat-${index}`);
  await Promise.all(capped.map((label) => fakeJob(label, label)));
  const starts = [...runs].sort((left, right) => left.start - right.start).map((run) => run.label);
  if (peak !== CLAUDE_CONCURRENCY || runs.length !== capped.length || starts.join() !== capped.join()) {
    throw new Error(`The CLI concurrency cap was not respected in order: peak ${peak} of ${CLAUDE_CONCURRENCY}, starts ${starts.join()}`);
  }
  if (activeClaude !== 0 || claudeSlotWaiters.length || conversationLocks.size) {
    throw new Error("CLI slots or conversation locks leaked after the jobs finished");
  }
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
