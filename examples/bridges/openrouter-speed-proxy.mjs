#!/usr/bin/env node
// Speed proxy for VS Code Copilot Chat: appends Kilo's speed footer
// ("203.9 t/s   3:44 PM · 48s"; "112 t/s" drops ".0"; the gap is three U+00A0) to final answers. Node stdlib only; listens on
// 127.0.0.1 only. Routes by request model: deepseek/* goes to the official DeepSeek
// API with the key Kilo stores in ~/.local/share/kilo/auth.json ("deepseek"), read per
// request; every other model goes to OpenRouter with the client's Authorization header
// forwarded unchanged. The proxy never logs headers, keys or bodies.
// Live copy: ~/.config/kilo/bridges/openrouter-speed-proxy.mjs (LaunchAgent ai.kilo.openrouter-speed-proxy).
// Usage: node openrouter-speed-proxy.mjs [--self-test]
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const HOST = "127.0.0.1";
const PORT = Number(process.env.OPENROUTER_SPEED_PROXY_PORT || 32126);
const UPSTREAM = "https://openrouter.ai/api";
const DEEPSEEK = "https://api.deepseek.com";
const LITHOS = "https://api.lithosai.cloud";
const DEEPSEEK_MODELS = { "deepseek/deepseek-v4.1-flash": "deepseek-flash" }; // VS Code id -> DeepSeek API id
const KILO_AUTH = process.env.KILO_AUTH_FILE || `${homedir()}/.local/share/kilo/auth.json`;
const FORWARD_HEADERS = ["authorization", "content-type", "accept", "http-referer", "x-title"];

const deepseekKey = () => {
  const key = JSON.parse(readFileSync(KILO_AUTH, "utf8")).deepseek?.key;
  if (!key) throw new Error("no deepseek key in Kilo auth.json");
  return key;
};

// Picks the upstream for a parsed chat request. DeepSeek: upstream model id, proxy-held key
// (the client's OpenRouter key is never sent there) and no OpenRouter-only fields.
// GLM on OpenRouter gets Kilo's throughput sort unless the client chose its own provider.
function route(json, headers, readKey = deepseekKey, lithos = false) {
  if (lithos) return { base: LITHOS, name: "lithos", headers };
  if (/^z-ai\/glm-/.test(json?.model || "")) json.provider ??= { sort: "throughput" };
  if (!/^deepseek\//.test(json?.model || "")) return { base: UPSTREAM, name: "openrouter", headers };
  json.model = DEEPSEEK_MODELS[json.model] ?? json.model.slice("deepseek/".length);
  json.reasoning_effort ??= json.reasoning?.effort;
  for (const field of ["reasoning", "provider", "usage", "transforms", "models", "route"]) delete json[field];
  const { "http-referer": _r, "x-title": _t, ...rest } = headers;
  return { base: DEEPSEEK, name: "deepseek", headers: { ...rest, authorization: `Bearer ${readKey()}` } };
}

// Same client check as claude-cli-provider.mjs: only VS Code gets the footer.
function wantsThroughputFooter(headers) {
  return Boolean(headers["x-vscode-user-agent-library-version"]) || /^GitHubCopilotChat\//.test(headers["user-agent"] || "");
}

// Kilo's footer. Rate is over generation time (first token to last); elapsed is end to end.
function throughputFooter(outputTokens, generationMs, elapsedMs, doneAt = new Date()) {
  const rate = generationMs > 0 ? outputTokens / (generationMs / 1000) : 0;
  const hours = doneAt.getHours();
  const clock = `${hours % 12 || 12}:${String(doneAt.getMinutes()).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  const seconds = Math.round(elapsedMs / 1000);
  const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${rate.toFixed(1).replace(/\.0$/, "")} t/s\u00a0\u00a0\u00a0${clock} · ${elapsed}`;
}

// VS Code sends earlier answers back verbatim; the model must not see (and imitate) footers.
const THROUGHPUT_FOOTER = /\n\n(?:---\n⚡ \*\*[\d.]+ tok\/s\*\* · \d+ output tokens · [\d.]+s|[\d.]+ t\/s(?: · |\u00a0{3})\d{1,2}:\d{2} [AP]M · (?:\d+m )?\d+s)\s*$/;

function stripFooters(messages) {
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role !== "assistant") continue;
    if (typeof message.content === "string") message.content = message.content.replace(THROUGHPUT_FOOTER, "");
    else if (Array.isArray(message.content)) {
      const last = message.content.findLast((part) => part?.type === "text" && typeof part.text === "string");
      if (last) last.text = last.text.replace(THROUGHPUT_FOOTER, "");
    }
  }
}

// Rewrites one upstream SSE stream. Content passes through as it arrives; only the tail
// from the finish_reason chunk on is held until [DONE] so the footer (which needs the
// usage chunk) lands as the last content delta before the finish chunk.
function createSseRelay(write, { footer, startedAt, now = () => Date.now(), clock = () => new Date() }) {
  let buffer = "", firstTokenAt = 0, lastTokenAt = 0, text = false, tools = false, usage = null, finish = null;
  const held = [];
  const flush = (done) => {
    if (finish && footer && text && !tools && usage?.completion_tokens) {
      const end = lastTokenAt || now();
      const content = `\n\n${throughputFooter(usage.completion_tokens, end - (firstTokenAt || startedAt), now() - startedAt, clock())}`;
      const { id, object, created, model } = finish;
      write(`data: ${JSON.stringify({ id, object, created, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
      footer = false; // once, even if the stream also ends after [DONE]
    }
    for (const event of held.splice(0)) write(event);
    if (done) write(done);
  };
  const event = (raw) => {
    const data = raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (data === "[DONE]") return flush(`${raw}\n\n`);
    let chunk = null;
    try { chunk = data ? JSON.parse(data) : null; } catch {}
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta || {};
    if (delta.content || delta.reasoning || delta.reasoning_content || delta.tool_calls) {
      firstTokenAt ||= now();
      lastTokenAt = now();
    }
    if (delta.content) text = true;
    if (delta.tool_calls || choice?.finish_reason === "tool_calls") tools = true;
    if (chunk?.usage) usage = chunk.usage;
    if (choice?.finish_reason && !finish) finish = chunk;
    if (finish) held.push(`${raw}\n\n`);
    else write(`${raw}\n\n`);
  };
  return {
    get usage() { return usage; },
    push(piece) {
      buffer += piece.replace(/\r\n/g, "\n");
      let at;
      while ((at = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (raw) event(raw);
      }
    },
    end() {
      if (buffer.trim()) event(buffer.trimEnd());
      buffer = "";
      flush();
    }
  };
}

let active = 0, served = 0;

async function proxy(request, response) {
  const startedAt = Date.now();
  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  const lithos = url.pathname.startsWith("/lithos/v1/");
  if (lithos) url.pathname = url.pathname.slice("/lithos".length);
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let body = Buffer.concat(chunks);
  let json = null, footer = false, model = null;
  let target = { base: lithos ? LITHOS : UPSTREAM, name: lithos ? "lithos" : "openrouter", headers: Object.fromEntries(FORWARD_HEADERS.filter((name) => request.headers[name]).map((name) => [name, request.headers[name]])) };
  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    try { json = JSON.parse(body.toString("utf8")); } catch {}
    if (json) {
      model = json.model ?? null;
      stripFooters(json.messages);
      if (json.stream) json.stream_options = { ...json.stream_options, include_usage: true };
      target = route(json, target.headers, deepseekKey, lithos);
      body = Buffer.from(JSON.stringify(json));
      footer = lithos || wantsThroughputFooter(request.headers);
    }
  }
  const controller = new AbortController();
  response.on("close", () => { if (!response.writableFinished) controller.abort(); });
  const upstream = await fetch(`${target.base}${url.pathname}${url.search}`, {
    method: request.method,
    headers: target.headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : body,
    signal: controller.signal
  });
  const type = upstream.headers.get("content-type") || "application/json";
  let usage = null;
  if (json?.stream && upstream.ok && type.includes("text/event-stream")) {
    response.writeHead(upstream.status, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
    const relay = createSseRelay((text) => response.write(text), { footer, startedAt });
    const decoder = new TextDecoder();
    for await (const piece of upstream.body) relay.push(decoder.decode(piece, { stream: true }));
    relay.push(decoder.decode());
    relay.end();
    response.end();
    usage = relay.usage;
  } else {
    let payload = Buffer.from(await upstream.arrayBuffer());
    if (json && upstream.ok && type.includes("application/json")) {
      try {
        const result = JSON.parse(payload.toString("utf8"));
        usage = result.usage;
        const message = result.choices?.[0]?.message;
        const elapsed = Date.now() - startedAt;
        if (footer && typeof message?.content === "string" && message.content && !message.tool_calls?.length && usage?.completion_tokens) {
          message.content += `\n\n${throughputFooter(usage.completion_tokens, elapsed, elapsed)}`;
          payload = Buffer.from(JSON.stringify(result));
        }
      } catch {}
    }
    response.writeHead(upstream.status, { "content-type": type, "content-length": payload.length });
    response.end(payload);
  }
  // Metadata only: never headers, keys or message bodies.
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), path: url.pathname, model, upstream: target.name, stream: Boolean(json?.stream), status: upstream.status, vscode: footer, ms: Date.now() - startedAt, usage: usage ? { completion_tokens: usage.completion_tokens } : undefined })}\n`);
}

if (process.argv.includes("--self-test")) {
  const lithosBody = { model: "deepseek-ai/DeepSeek-V4.1-Flash-ultra", reasoning_effort: "high" };
  assert.deepEqual(route(lithosBody, { authorization: "Bearer test-key" }, () => { throw Error("wrong credential source"); }, true), {
    base: LITHOS, name: "lithos", headers: { authorization: "Bearer test-key" }
  });
  assert.deepEqual(lithosBody, { model: "deepseek-ai/DeepSeek-V4.1-Flash-ultra", reasoning_effort: "high" });
  const at = new Date(2026, 8, 23, 15, 44, 5);
  assert.equal(throughputFooter(9786, 48000, 48000, at), "203.9 t/s\u00a0\u00a0\u00a03:44 PM · 48s");
  assert.equal(throughputFooter(10, 0, 72400, new Date(2026, 0, 1, 0, 5)), "0 t/s\u00a0\u00a0\u00a012:05 AM · 1m 12s");
  assert.equal(throughputFooter(1, 1000, 59600, new Date(2026, 0, 1, 12, 0)), "1 t/s\u00a0\u00a0\u00a012:00 PM · 1m 0s");
  assert.ok(wantsThroughputFooter({ "user-agent": "GitHubCopilotChat/0.67.0" }) && wantsThroughputFooter({ "x-vscode-user-agent-library-version": "node-http" }) && !wantsThroughputFooter({ "user-agent": "curl/8" }));

  // History strip: both footer formats, assistant only, string or parts content.
  const oldFooter = "\n\n---\n⚡ **30.0 tok/s** · 300 output tokens · 10.0s";
  const newFooter = `\n\n${throughputFooter(300, 10000, 72000, at)}`;
  const history = [
    { role: "assistant", content: `A.${oldFooter}` },
    { role: "assistant", content: "P.\n\n203.9 t/s · 3:44 PM · 48s" },
    { role: "assistant", content: [{ type: "text", text: `B.${newFooter}` }] },
    { role: "user", content: `Quote:${newFooter}` }
  ];
  stripFooters(history);
  assert.deepEqual(history.map((m) => typeof m.content === "string" ? m.content : m.content[0].text), ["A.", "P.", "B.", `Quote:${newFooter}`]);

  // SSE: footer is the last content delta, before the finish chunk and the usage chunk.
  const sse = (...chunks) => chunks.map((c) => typeof c === "string" ? `${c}\n\n` : `data: ${JSON.stringify(c)}\n\n`).join("");
  const base = { id: "gen-1", object: "chat.completion.chunk", created: 1, model: "deepseek/deepseek-v4.1-flash" };
  const chunk = (delta, finish_reason = null, extra = {}) => ({ ...base, choices: [{ index: 0, delta, finish_reason }], ...extra });
  const run = (stream, footer = true) => {
    let out = "", t = 1000;
    const relay = createSseRelay((s) => { out += s; }, { footer, startedAt: 0, now: () => (t += 1000), clock: () => at });
    for (let i = 0; i < stream.length; i += 7) relay.push(stream.slice(i, i + 7)); // split mid-event on purpose
    relay.end();
    return out.split("\n\n").filter(Boolean).map((e) => e.startsWith("data: {") ? JSON.parse(e.slice(6)) : e);
  };
  const answer = sse(": OPENROUTER PROCESSING", chunk({ role: "assistant", content: "" }), chunk({ reasoning: "hmm" }), chunk({ content: "Hi" }), chunk({ content: "." }),
    chunk({}, "stop"), { ...base, choices: [], usage: { completion_tokens: 40 } }, "data: [DONE]");
  const events = run(answer);
  const content = events.filter((e) => typeof e === "object").map((e) => e.choices[0]?.delta?.content || "").join("");
  assert.match(content, /^Hi\.\n\n[\d.]+ t\/s\u00a0{3}3:44 PM · \d+s$/);
  const footerAt = events.findIndex((e) => /t\/s/.test(e.choices?.[0]?.delta?.content || ""));
  assert.equal(events[footerAt + 1].choices[0].finish_reason, "stop");
  assert.deepEqual(events.slice(-2).map((e) => e.usage?.completion_tokens ?? e), [40, "data: [DONE]"]);
  assert.equal(events[0], ": OPENROUTER PROCESSING");
  assert.equal(run(answer, false).length, events.length - 1, "non-VS Code clients get no footer");

  // Tool-call turns (with or without preamble text) never get a footer.
  const calls = sse(chunk({ content: "Checking." }), chunk({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "read_file", arguments: "{}" } }] }),
    chunk({}, "tool_calls"), { ...base, choices: [], usage: { completion_tokens: 12 } }, "data: [DONE]");
  const callEvents = run(calls);
  assert.equal(callEvents.length, 5);
  assert.ok(!callEvents.some((e) => /t\/s/.test(e.choices?.[0]?.delta?.content || "")));
  assert.equal(callEvents.at(-1), "data: [DONE]");

  // A stream cut before [DONE] still flushes everything it held.
  const cut = run(sse(chunk({ content: "Hi" }), chunk({}, "stop")));
  assert.equal(cut.at(-1).choices[0].finish_reason, "stop");
  // Routing: DeepSeek goes direct with the proxy's key and no OpenRouter-only fields.
  const client = { authorization: "Bearer client-openrouter", "content-type": "application/json", "x-title": "VS Code" };
  const ds = { model: "deepseek/deepseek-v4.1-flash", stream: true, stream_options: { include_usage: true }, max_completion_tokens: 8, reasoning: { effort: "low" }, provider: { sort: "throughput" }, usage: { include: true }, messages: [] };
  const toDs = route(ds, client, () => "ds-key");
  assert.deepEqual([toDs.base, toDs.name, toDs.headers], [DEEPSEEK, "deepseek", { authorization: "Bearer ds-key", "content-type": "application/json" }]);
  assert.deepEqual(ds, { model: "deepseek-flash", stream: true, stream_options: { include_usage: true }, max_completion_tokens: 8, reasoning_effort: "low", messages: [] });
  const ds2 = { model: "deepseek/deepseek-v4-pro", reasoning_effort: "high" };
  route(ds2, client, () => "k");
  assert.deepEqual(ds2, { model: "deepseek-v4-pro", reasoning_effort: "high" });
  const glm = { model: "z-ai/glm-5.3-flash", reasoning: { effort: "low" }, usage: { include: true } };
  const toGlm = route(glm, client, () => assert.fail("OpenRouter requests must not read the DeepSeek key"));
  assert.deepEqual([toGlm.base, toGlm.headers, glm], [UPSTREAM, client, { model: "z-ai/glm-5.3-flash", reasoning: { effort: "low" }, usage: { include: true }, provider: { sort: "throughput" } }]);
  const glmOwn = { model: "z-ai/glm-5.3-flash", provider: { order: ["z-ai"], allow_fallbacks: false } };
  route(glmOwn, client);
  assert.deepEqual(glmOwn.provider, { order: ["z-ai"], allow_fallbacks: false }, "client provider choice is never overridden");
  const other = { model: "openai/gpt-5" };
  route(other, client);
  assert.equal(other.provider, undefined, "only GLM gets the throughput sort");
  process.stdout.write("Speed proxy self-test passed.\n");
} else {
  createServer((request, response) => {
    if (request.method === "GET" && (request.url === "/health" || request.url === "/v1/health")) {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ status: "ok", upstream: { "deepseek/*": DEEPSEEK, "*": UPSTREAM }, active, served }));
    }
    active++;
    proxy(request, response).catch((error) => {
      process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), error: error.name === "AbortError" ? "client aborted" : error.message })}\n`);
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: `Speed proxy: ${error.message}`, type: "upstream_error" } }));
      } else response.end();
    }).finally(() => { active--; served++; });
  }).listen(PORT, HOST, () => process.stdout.write(`Speed proxy on http://${HOST}:${PORT}/v1 -> deepseek/* ${DEEPSEEK}/v1, others ${UPSTREAM}/v1\n`));
}
