#!/usr/bin/env node
// Local Codex model router: native OpenAI models plus authenticated Claude CLI models.

import assert from "node:assert/strict";
import { KILO_MODELS, kiloInvocation, kiloResult } from "./kilo-route.mjs";
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CODEX_CLAUDE_ROUTER_PORT || 43128);
const CLAUDE = process.env.CODEX_CLAUDE_BINARY || path.join(os.homedir(), ".vscode/extensions/anthropic.claude-code-2.1.274-darwin-arm64/resources/native-binary/claude");
const OPENAI_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const MODELS_CACHE = path.join(os.homedir(), ".codex/models_cache.json");
const ALLOWED_TOOLS = "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Agent,Skill";

const CLAUDE_MODELS = {
  "claude-opus-5": { displayName: "Claude Opus 5", model: "opus", effort: "high", priority: 50 },
  "claude-opus-5-fast": { displayName: "Claude Opus 5 Fast", model: "opus", effort: "high", priority: 51 },
  "claude-fable-5-1": { displayName: "Fable 5.1", model: "fable", effort: "high", priority: 52 },
  "claude-fable-5-1-max": { displayName: "Fable 5.1 Max", model: "fable", effort: "high", priority: 53 },
};

function catalogEntry(template, slug, profile) {
  return {
    ...structuredClone(template),
    slug,
    display_name: profile.displayName,
    description: profile.agent ? `Runs through Kilo: ${profile.model}. ${profile.agent === "codex-astra-lead" ? "Scoped DeepSeek/GLM delegation." : "Independent coding; delegation disabled."}` : `Runs through the authenticated local Claude CLI (${profile.effort} effort).`,
    default_reasoning_level: profile.effort,
    supported_reasoning_levels: (profile.efforts || [profile.effort]).map(effort => ({ effort, description: `${effort} reasoning` })),
    shell_type: "unified_exec",
    visibility: "list",
    supported_in_api: true,
    priority: profile.priority,
    context_window: 200000,
    max_context_window: 200000,
    effective_context_window_percent: 90,
    input_modalities: profile.inputModalities || ["text", "image"],
    supports_search_tool: false,
    support_verbosity: false,
    supports_image_detail_original: false,
    experimental_supported_tools: [],
    additional_speed_tiers: [],
    service_tiers: [{ id: "priority", name: "Local CLI", description: "Runs through the local Claude CLI." }],
    tool_mode: "default",
    multi_agent_version: "disabled",
  };
}

async function modelCatalog() {
  const cache = JSON.parse(await readFile(MODELS_CACHE, "utf8"));
  const nativeModels = cache.models.filter((model) => !CLAUDE_MODELS[model.slug] && !KILO_MODELS[model.slug]);
  const template = nativeModels.find((model) => model.slug === "gpt-5.6-sol") || nativeModels[0];
  assert.ok(template, "Codex model cache is empty");
  const claudeModels = Object.entries({ ...CLAUDE_MODELS, ...KILO_MODELS }).map(([slug, profile]) => catalogEntry(template, slug, profile));
  return { ...cache, models: [...nativeModels, ...claudeModels] };
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "input_text" || part?.type === "output_text" || part?.type === "text")
    .map((part) => part.text || "")
    .join("\n");
}

function toolOutputText(output) {
  if (typeof output === "string") return output;
  const text = contentText(output);
  if (text) return text;
  return output == null ? "" : JSON.stringify(output);
}

async function promptFromRequest(body) {
  let attachmentDirectory = null;
  let attachmentIndex = 0;
  const attachmentFiles = [];
  const messages = [];
  try {
  for (const item of Array.isArray(body.input) ? body.input : []) {
    if (item?.type === "function_call_output" || item?.type === "custom_tool_call_output") {
      const text = toolOutputText(item.output);
      if (text) messages.push(`TOOL RESULT${item.name ? ` (${item.name})` : ""}:\n${text}`);
      continue;
    }
    if (item?.type !== "message") continue;
    const parts = [contentText(item.content)];
    for (const part of Array.isArray(item.content) ? item.content : []) {
      if (part?.type !== "input_image") continue;
      const source = part.image_url || part.url;
      const data = typeof source === "string" ? source.match(/^data:image\/(png|jpeg|gif|webp);base64,(.+)$/s) : null;
      if (data) {
        attachmentDirectory ||= await mkdtemp(path.join(os.tmpdir(), "codex-router-images-"));
        const extension = data[1] === "jpeg" ? "jpg" : data[1];
        const filename = path.join(attachmentDirectory, `image-${++attachmentIndex}.${extension}`);
        const image = Buffer.from(data[2], "base64");
        if (!image.length) throw new Error("Attached image is empty.");
        await writeFile(filename, image);
        attachmentFiles.push(filename);
        parts.push(`[Attached image ${attachmentIndex}: ${filename}]`);
      } else if (typeof source === "string" && source.startsWith("data:image/")) {
        throw new Error("Unsupported attached image type. Use PNG, JPEG, GIF or WEBP.");
      } else if (typeof source === "string") {
        parts.push(`[Attached image URL: ${source}]`);
      }
    }
    const text = parts.filter(Boolean).join("\n");
    if (text) messages.push(`${String(item.role || "user").toUpperCase()}:\n${text}`);
  }
  } catch (error) {
    if (attachmentDirectory) await rm(attachmentDirectory, { recursive: true, force: true });
    throw error;
  }
  const prompt = [body.instructions ? `CODEX INSTRUCTIONS:\n${body.instructions}` : "", ...messages].filter(Boolean).join("\n\n");
  return { prompt, attachmentDirectory, attachmentFiles };
}

function workingDirectory(prompt) {
  const tagged = prompt.match(/<cwd>([^<]+)<\/cwd>/)?.[1]?.trim();
  if (tagged && path.isAbsolute(tagged) && existsSync(tagged)) return tagged;
  if (tagged) console.error(`${new Date().toISOString()} workspace unavailable, using router cwd: ${tagged}`);
  return process.cwd();
}

function responseObject(id, model, status, output = [], usage = null) {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    completed_at: status === "completed" ? Math.floor(Date.now() / 1000) : null,
    status,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model,
    output,
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: null,
    store: false,
    temperature: null,
    text: { format: { type: "text" } },
    tool_choice: "auto",
    tools: [],
    top_p: null,
    truncation: "disabled",
    usage,
    user: null,
    metadata: {},
  };
}

function writeEvent(response, event) {
  response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

async function runClaude(request, response, body, profile) {
  const { prompt, attachmentDirectory, attachmentFiles } = await promptFromRequest(body);
  let spec;
  try {
    spec = profile.agent ? await kiloInvocation(profile, prompt, body.reasoning?.effort, attachmentFiles) : null;
  } catch (error) {
    if (attachmentDirectory) await rm(attachmentDirectory, { recursive: true, force: true });
    throw error;
  }
  const cwd = spec?.cwd || workingDirectory(prompt);
  const responseId = `resp_${randomUUID().replaceAll("-", "")}`;
  const itemId = `msg_${randomUUID().replaceAll("-", "")}`;
  let sequence = 0;
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  writeEvent(response, { type: "response.created", response: responseObject(responseId, body.model, "in_progress"), sequence_number: sequence++ });
  writeEvent(response, { type: "response.in_progress", response: responseObject(responseId, body.model, "in_progress"), sequence_number: sequence++ });

  const child = spawn(spec?.command || CLAUDE, spec?.args || [
    "-p",
    "--model", profile.model,
    "--effort", profile.effort,
    "--name", `Codex - ${profile.displayName}`,
    "--output-format", "json",
    "--no-session-persistence",
    "--permission-mode", "acceptEdits",
    `--allowedTools=${ALLOWED_TOOLS}`,
  ], { cwd, env: spec?.env || process.env, detached: Boolean(spec), stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);
  const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), 15000);
  const cancelClaude = () => {
    if (!response.writableEnded) {
      try { if (spec) process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM"); } catch {}
    }
  };
  response.once("close", cancelClaude);
  const executionTimeout = spec ? setTimeout(() => {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
  }, 600000) : null;

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  let exit;
  try {
    exit = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
  } finally {
    clearInterval(heartbeat);
    clearTimeout(executionTimeout);
    response.off("close", cancelClaude);
    if (attachmentDirectory) await rm(attachmentDirectory, { recursive: true, force: true });
  }
  if (exit.code !== 0 || exit.signal) throw new Error(stderr.trim() || `${spec ? 'Kilo' : 'Claude'} CLI exited with ${exit.signal || exit.code}`);
  const payload = spec ? kiloResult(stdout) : JSON.parse(stdout);
  if (payload.is_error) throw new Error(payload.result || "Claude CLI returned an error");
  const text = payload.result || "Claude completed the task without a text response.";
  const content = [{ type: "output_text", text, annotations: [], logprobs: [] }];
  const item = { id: itemId, type: "message", status: "completed", role: "assistant", content };
  writeEvent(response, { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] }, sequence_number: sequence++ });
  writeEvent(response, { type: "response.content_part.added", item_id: itemId, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [], logprobs: [] }, sequence_number: sequence++ });
  writeEvent(response, { type: "response.output_text.delta", item_id: itemId, output_index: 0, content_index: 0, delta: text, logprobs: [], sequence_number: sequence++ });
  writeEvent(response, { type: "response.output_text.done", item_id: itemId, output_index: 0, content_index: 0, text, logprobs: [], sequence_number: sequence++ });
  writeEvent(response, { type: "response.content_part.done", item_id: itemId, output_index: 0, content_index: 0, part: content[0], sequence_number: sequence++ });
  writeEvent(response, { type: "response.output_item.done", output_index: 0, item, sequence_number: sequence++ });
  const usage = {
    input_tokens: payload.usage?.input_tokens || 0,
    input_tokens_details: { cached_tokens: payload.usage?.cache_read_input_tokens || 0 },
    output_tokens: payload.usage?.output_tokens || 0,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: (payload.usage?.input_tokens || 0) + (payload.usage?.output_tokens || 0),
  };
  writeEvent(response, { type: "response.completed", response: responseObject(responseId, body.model, "completed", [item], usage), sequence_number: sequence++ });
  response.end();
}

async function forwardOpenAI(request, response, bodyBuffer) {
  const headers = { ...request.headers };
  for (const name of ["host", "content-length", "connection", "accept-encoding"]) delete headers[name];
  const upstream = await fetch(OPENAI_RESPONSES_URL, { method: "POST", headers, body: bodyBuffer });
  const responseHeaders = {};
  for (const [name, value] of upstream.headers) {
    if (!new Set(["content-length", "content-encoding", "connection", "transfer-encoding"]).has(name)) responseHeaders[name] = value;
  }
  response.writeHead(upstream.status, responseHeaders);
  if (upstream.body) for await (const chunk of upstream.body) response.write(chunk);
  response.end();
}

async function handler(request, response) {
  let requestedModel = "unknown";
  try {
    if (request.method === "GET" && request.url.startsWith("/health")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, models: Object.keys({ ...CLAUDE_MODELS, ...KILO_MODELS }) }));
      return;
    }
    if (request.method === "GET" && request.url.startsWith("/v1/models")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(await modelCatalog()));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Not found" } }));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyBuffer = Buffer.concat(chunks);
    const body = JSON.parse(bodyBuffer);
    requestedModel = body.model || requestedModel;
    console.log(`${new Date().toISOString()} model=${body.model || "unknown"} bytes=${bodyBuffer.length}`);
    const profile = Object.hasOwn(CLAUDE_MODELS, body.model) ? CLAUDE_MODELS[body.model] : Object.hasOwn(KILO_MODELS, body.model) ? KILO_MODELS[body.model] : null;
    if (profile) await runClaude(request, response, body, profile);
    else await forwardOpenAI(request, response, bodyBuffer);
  } catch (error) {
    console.error(`${new Date().toISOString()} ${error.stack || error.message}`);
    if (response.headersSent && !response.destroyed) {
      const failed = responseObject(`resp_${randomUUID().replaceAll("-", "")}`, requestedModel, "failed");
      failed.error = { code: "local_cli_bridge_error", message: error.message };
      writeEvent(response, { type: "response.failed", response: failed, sequence_number: 999999 });
      response.end();
    } else {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: error.message, type: "local_cli_bridge_error" } }));
    }
  }
}

if (process.argv.includes("--self-test")) {
  assert.ok(Object.values(CLAUDE_MODELS).every(({ effort }) => effort === "high"));
  const testPrompt = await promptFromRequest({ input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }] });
  assert.match(testPrompt.prompt, /USER:\nhello/);
  assert.equal(testPrompt.attachmentDirectory, null);
  const toolPrompt = await promptFromRequest({ input: [{ type: "function_call_output", name: "create_thread", output: "delegated prompt" }] });
  assert.match(toolPrompt.prompt, /TOOL RESULT \(create_thread\):\ndelegated prompt/);
  assert.equal(workingDirectory("<cwd>/tmp</cwd>"), "/tmp");
  assert.equal(workingDirectory("<cwd>/path/that/does/not/exist</cwd>"), process.cwd());
  let eventFrame = "";
  writeEvent({ write: (value) => { eventFrame = value; } }, { type: "response.completed" });
  assert.match(eventFrame, /^event: response\.completed\ndata: /);
  console.log("self-test passed");
} else {
  const server = http.createServer(handler);
  server.listen(PORT, HOST, () => console.log(`Codex Claude router listening on http://${HOST}:${server.address().port}`));
}
