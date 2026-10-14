#!/usr/bin/env node
// Live check for the Claude CLI bridge's warm-process feature.
// Contract: GET /health exposes warm {enabled, limit, idleMs, processes[]{pid,cwd,busy,idleForMs}}.
// Only this file is writable; the bridge itself is read-only.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const base = flag("--base") || "http://127.0.0.1:32123";
const model = flag("--model") || "opus-5-5-fast";
const REQUEST_TIMEOUT_MS = 120000;
const HEALTH_TIMEOUT_MS = 15000;

const tools = [{
  type: "function",
  function: {
    name: "read",
    description: "Read a file from disk.",
    parameters: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] }
  }
}];

async function health() {
  const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`GET /health -> HTTP ${response.status}`);
  return response.json();
}

// Processes whose cwd resolves to the same place as directory (macOS /var vs /private/var).
function warmForCwd(report, directory) {
  let target;
  try { target = realpathSync(directory); } catch { target = directory; }
  return (Array.isArray(report.warm?.processes) ? report.warm.processes : []).filter((entry) => {
    try { return realpathSync(entry.cwd) === target; } catch { return false; }
  });
}

// One OpenAI-compatible streaming request. Returns content, tool_calls, timings.
async function chat(messages) {
  const started = Date.now();
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true, tools, messages }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ttft = 0;
  let done = 0;
  let content = "";
  const toolCalls = [];
  for (;;) {
    const { value, done: streamDone } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") { done ||= Date.now(); continue; }
      let event;
      try { event = JSON.parse(payload); } catch { continue; }
      if (event.error) throw new Error(`stream error: ${event.error.message || JSON.stringify(event.error)}`);
      ttft ||= Date.now();
      const choice = event.choices?.[0];
      if (choice?.delta?.content) content += choice.delta.content;
      if (choice?.delta?.tool_calls) toolCalls.push(...choice.delta.tool_calls);
      if (choice?.finish_reason) done ||= Date.now();
    }
    if (streamDone) break;
  }
  done ||= Date.now();
  return { content, toolCalls, ttft: ttft - started, done: done - started };
}

function printStep(name, request, ok, reason) {
  const ttft = request ? `${request.ttft}ms` : "-";
  const done = request ? `${request.done}ms` : "-";
  process.stdout.write(`${name}: ttft=${ttft} done=${done} ${ok ? "PASS" : "FAIL"}${reason ? `: ${reason}` : ""}\n`);
}

async function runStep(name, fn) {
  try {
    const { request, ok, reason } = await fn();
    printStep(name, request, ok, reason);
    return { ok, request };
  } catch (error) {
    printStep(name, null, false, error.message);
    return { ok: false, request: null };
  }
}

function waitGone(pid, timeoutMs = 10000) {
  const until = Date.now() + timeoutMs;
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  return new Promise((resolve) => {
    const poll = () => {
      if (!alive()) resolve(true);
      else if (Date.now() >= until) resolve(false);
      else setTimeout(poll, 100);
    };
    poll();
  });
}

const ASK1 = { role: "user", content: "Remember this code word: BANANA. Reply with exactly OK and call no tools." };
const ASK_CODE_WORD = { role: "user", content: "What is the code word? Reply with the code word only." };

// The initial /health gate runs before any chat request, so a bridge without the
// feature spends no model quota and sends nothing to /v1/chat/completions.
let gate;
try {
  gate = await health();
} catch (error) {
  process.stdout.write(`health check failed: ${error.message}\n`);
  process.exit(2);
}
if (!gate.warm || typeof gate.warm !== "object") {
  process.stdout.write("bridge has no warm support\n");
  process.exit(2);
}
if (!gate.warm.enabled) {
  process.stdout.write("bridge warm process is disabled\n");
  process.exit(2);
}

let directory = null;
let pid1 = null;
async function run() {
  directory = mkdtempSync(join(tmpdir(), "claude-warm-check-"));
  const system = { role: "system", content: `Warm-process live check. <cwd>${directory}</cwd>` };
  let messages = [system, ASK1];

  const step1 = await runStep("step1", async () => {
    const request = await chat(messages);
    const entries = warmForCwd(await health(), directory);
    if (request.toolCalls.length) return { request, ok: false, reason: `model called a tool (${request.toolCalls.length} call(s))` };
    if (!/OK/i.test(request.content)) return { request, ok: false, reason: `no final OK answer (got ${JSON.stringify(request.content.slice(0, 80))})` };
    if (entries.length !== 1) return { request, ok: false, reason: `expected exactly 1 warm process for cwd, got ${entries.length}` };
    pid1 = entries[0].pid;
    return { request, ok: true, reason: `warm pid ${pid1}` };
  });
  if (!step1.ok) return false;
  messages = [...messages, { role: "assistant", content: step1.request.content }, ASK_CODE_WORD];

  const step2 = await runStep("step2", async () => {
    const request = await chat(messages);
    const entries = warmForCwd(await health(), directory);
    if (!/BANANA/.test(request.content)) return { request, ok: false, reason: `answer missing BANANA (got ${JSON.stringify(request.content.slice(0, 80))})` };
    if (entries.length !== 1) return { request, ok: false, reason: `expected exactly 1 warm process for cwd, got ${entries.length}` };
    if (entries[0].pid !== pid1) return { request, ok: false, reason: `pid changed ${pid1} -> ${entries[0].pid}; process was not reused` };
    return { request, ok: true, reason: `reused pid ${pid1}` };
  });
  if (!step2.ok) return false;
  messages = [...messages, { role: "assistant", content: step2.request.content }, ASK_CODE_WORD];

  const step3 = await runStep("step3", async () => {
    // Only ever the pid whose cwd matched this check's temp directory.
    process.kill(pid1, "SIGTERM");
    if (!await waitGone(pid1)) throw new Error(`pid ${pid1} did not exit after SIGTERM`);
    const request = await chat(messages);
    if (!/BANANA/.test(request.content)) return { request, ok: false, reason: `answer missing BANANA after restart (got ${JSON.stringify(request.content.slice(0, 80))})` };
    return { request, ok: true, reason: `recovered after killing pid ${pid1}` };
  });
  if (!step3.ok) return false;
  messages = [...messages, { role: "assistant", content: step3.request.content }, ASK_CODE_WORD];

  await runStep("step4", async () => {
    const request = await chat(messages);
    const entries = warmForCwd(await health(), directory);
    if (!entries.length) return { request, ok: true, reason: "warning: no warm process for cwd after restart" };
    if (entries[0].pid === pid1) return { request, ok: true, reason: `warning: pid ${pid1} still present, expected a replacement` };
    return { request, ok: true, reason: `new warm pid ${entries[0].pid}` };
  });
  return true;
}

let passed = false;
try {
  passed = await run();
} finally {
  if (directory) {
    // Do not leave this check's warm process (about 277MB) waiting out the idle timeout.
    try { for (const entry of warmForCwd(await health(), directory)) process.kill(entry.pid, "SIGTERM"); } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
}
process.stdout.write(`${passed ? "PASS" : "FAIL"}\n`);
process.exit(passed ? 0 : 1);