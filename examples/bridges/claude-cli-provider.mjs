#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.CLAUDE_BRIDGE_PORT, 10) || 32123;
// Also the whole built-in tool list in conversation mode: other tools would
// only be denied, yet their schemas cost ~24K prompt tokens per step. Skill is
// absent because skills are disabled; Kilo supplies its own.
const ALLOWED_TOOLS = "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Agent";
const DEFAULT_DIRECTORY = "/Users/shri/Documents/Codex";
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_SCHEMA_DESCRIPTION_CHARS = 320;
// Per backend, so Codex churn never evicts Claude sessions (and vice versa).
const MAX_SESSIONS_PER_BACKEND = 128;
const REQUEST_CACHE_MS = 30 * 1000;
const STATUS_DELAY_MS = 1500;
// The self-test drives the real request handler, so it must never overwrite the live state.
const SESSION_STATE_FILE = process.env.CLAUDE_BRIDGE_STATE_FILE || (process.argv.includes("--self-test")
  ? join(tmpdir(), `claude-cli-provider-self-test-${process.pid}.json`)
  : resolve(homedir(), ".local/state/kilo/claude-cli-provider-state.json"));
const TOOL_SYSTEM_PROMPT_FILE = resolve(homedir(), ".config/kilo/bridges/fable-lead-system.md");
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i;
const EMBEDDED_DATA_URL = /data:([^;,]+);base64,[A-Za-z0-9+/=\r\n]+/g;
// "You've hit your session limit · resets 9:30pm", "hit your 5-hour limit", "5-hour limit reached ∙ resets 3pm",
// "usage limit reached". Not "Output token limit reached" or "rate limit reached".
const SUBSCRIPTION_LIMIT = /hit your (?:[\w-]+ ){0,3}limit|\b(?:usage|session|weekly|daily|\d+-hour|opus|sonnet|fable) limit reached/i;
// "resets 9:30pm", "resets Sep 29 at 3pm", "resets Oct 3, 9pm"
const RESET_TIME = /resets\s+(?:at\s+)?(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;
// Codex CLI: "You've hit your usage limit. ... or try again at 3:04 PM.", "Usage limit reached.",
// "You're out of credits.", "You hit your spend cap". Not "Output token limit reached".
const CODEX_LIMIT = /hit your (?:[\w-]+ ){0,3}limit|usage limit|out of credits|spend cap|rate limit reached for plan|try again at \d/i;
// "try again at 3:04 PM", "try again at Sep 25th, 2026 3:04 PM" (Codex prints its local time, no zone).
const CODEX_RESET_TIME = /try again at\s+(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(?:\d{4}\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// ponytail: a fixed cap on parallel CLI runs across all chats, not an adaptive
// one; parallel runs share one subscription's rate limit. Upgrade path is
// backing off the cap when the CLI reports rate limiting.
const CLAUDE_CONCURRENCY = Math.min(8, Math.max(1, Number.parseInt(process.env.CLAUDE_BRIDGE_CONCURRENCY, 10) || 3));
// A separate pool, so Codex load never starves Claude.
const CODEX_CONCURRENCY = Math.min(8, Math.max(1, Number.parseInt(process.env.CODEX_BRIDGE_CONCURRENCY, 10) || 3));
// Codex tools a tool-mode step turns off: VS Code or Kilo runs every action.
// apply_patch has no switch; the read-only sandbox blocks its writes.
const CODEX_DISABLED_FEATURES = ["shell_tool", "unified_exec", "multi_agent", "apps", "plugins", "browser_use", "computer_use", "image_generation", "view_image"];
const conversationLocks = new Map();
// Optional warm mode: one long-lived `claude` process per CLI session, reused
// across the tool-mode steps of a chat instead of one process per step.
// CLAUDE_BRIDGE_WARM=0 disables it. The switch is a module-level `let` so the
// self-test can toggle it.
let warmEnabled = process.env.CLAUDE_BRIDGE_WARM !== "0";
// ponytail: a fixed cap of warm processes keyed by CLI session id; an idle one
// is evicted LRU and a busy-only table falls back to a one-shot run. Upgrade
// path is sizing the cap from measured memory (about 277MB per live process).
let warmIdleMs = Number.parseInt(process.env.CLAUDE_BRIDGE_WARM_IDLE_MS, 10);
if (!Number.isFinite(warmIdleMs) || warmIdleMs < 1) warmIdleMs = 600000;
let warmMax = Number.parseInt(process.env.CLAUDE_BRIDGE_WARM_MAX, 10);
if (!Number.isFinite(warmMax) || warmMax < 1) warmMax = 4;
// key = CLI session id; value = { key, child, signature, cwd, alive, busy, lastUsed, idleTimer, step, pending, stderr }
const warmProcesses = new Map();
// Set by shutdown: from then on no process is started or kept warm.
let shuttingDown = false;
let stateWrite = Promise.resolve();
// Codex's limit is kept in memory only: the bridge cannot tell ChatGPT accounts apart without
// reading ~/.codex/auth.json, and a fresh Codex run re-detects a limit within seconds.
const subscriptionLimits = { claude: null, codex: null };
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
  "codex-astra-engineering-lead": { name: "Astra Engineering Lead (ZCode)", model: "gpt-6-astra", effort: "xhigh", zcodeLead: "astra-engineering-lead" },
  "fable-engineering-lead": { name: "Fable Engineering Lead (ZCode)", model: "fable", effort: "high", zcodeLead: "fable-engineering-lead" },
  "opus-5-5-fast": { name: "Claude Opus 5.5 Fast (Local CLI)", model: "claude-opus-5-5", effort: "low" },
  "opus-5-5-medium": { name: "Claude Opus 5.5 Medium (Local CLI)", model: "claude-opus-5-5", effort: "medium" },
  "opus-5-5-high": { name: "Claude Opus 5.5 High (Local CLI)", model: "claude-opus-5-5", effort: "high" },
  "sonnet-5-5-medium": { name: "Claude Sonnet 5.5 Medium (Local CLI)", model: "claude-sonnet-5-5", effort: "medium" },
  "sonnet-5-5-high": { name: "Claude Sonnet 5.5 High (Local CLI)", model: "claude-sonnet-5-5", effort: "high" },
  "fable-5-1-high": { name: "Claude Fable 5.1 High (Local CLI)", model: "fable", effort: "high" },
  "fable-5-1-medium": { name: "Claude Fable 5.1 Medium (Local CLI)", model: "fable", effort: "medium" },
  "fable-5-1-max": { name: "Claude Fable 5.1 Max (Local CLI)", model: "fable", effort: "max" },
  // Model ids starting with "codex-" run through the signed-in Codex CLI (ChatGPT plan).
  "codex-gpt-6-astra-high": { name: "GPT-6 Astra High (Codex Local CLI)", model: "gpt-6-astra", effort: "high" },
  "codex-gpt-6-astra-xhigh": { name: "GPT-6 Astra Extra High (Codex Local CLI)", model: "gpt-6-astra", effort: "xhigh" },
  "codex-gpt-6-sol-high": { name: "GPT-6 Sol High (Codex Local CLI)", model: "gpt-6-sol", effort: "high" },
  "codex-gpt-6-luna-medium": { name: "GPT-6 Luna Medium (Codex Local CLI)", model: "gpt-6-luna", effort: "medium" },
  "codex-gpt-5.6-sol-high": { name: "GPT-5.6 Sol High (Codex Local CLI)", model: "gpt-5.6-sol", effort: "high" },
  "codex-gpt-5.6-terra-high": { name: "GPT-5.6 Terra High (Codex Local CLI)", model: "gpt-5.6-terra", effort: "high" },
  "codex-gpt-5.6-luna-medium": { name: "GPT-5.6 Luna Medium (Codex Local CLI)", model: "gpt-5.6-luna", effort: "medium" }
};

function backendOf(model) {
  return typeof model === "string" && model.startsWith("codex-") ? "codex" : "claude";
}

function cleanCodexEnvironment() {
  const environment = { ...process.env };
  // Always use the signed-in ChatGPT plan: no API keys, gateways or another Codex home.
  for (const key of Object.keys(environment)) {
    if (/^(?:OPENAI_|CODEX_)/.test(key)) delete environment[key];
  }
  return environment;
}

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

// Resolved per Codex request, not once: the path changes on every ChatGPT
// extension update, and the old folder is deleted.
async function resolveCodexBinary() {
  const candidates = [process.env.CODEX_BRIDGE_BINARY].filter(Boolean);
  const extensionsDirectory = resolve(homedir(), ".vscode/extensions");
  try {
    const extensions = (await readdir(extensionsDirectory))
      .filter((name) => name.startsWith("openai.chatgpt-"))
      .sort(compareVersions);
    for (const extension of extensions) {
      const bin = join(extensionsDirectory, extension, "bin");
      for (const platform of await readdir(bin).catch(() => [])) candidates.push(join(bin, platform, "codex"));
    }
  } catch {}
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

function codexUnavailable(message) {
  const error = new Error(message);
  error.status = 400;
  error.type = "codex_unavailable";
  return error;
}

// The Codex binary, once it is known to be signed in with ChatGPT. Only the
// CLI itself reads ~/.codex/auth.json; the bridge sees just the status line.
async function codexCli() {
  const binary = await resolveCodexBinary();
  if (!binary) throw codexUnavailable("Codex models need the signed-in Codex CLI from the ChatGPT VS Code extension (~/.vscode/extensions/openai.chatgpt-*/bin/*/codex); none was found. Set CODEX_BRIDGE_BINARY to override.");
  const status = await new Promise((resolveStatus) => {
    const child = spawn(binary, ["login", "status"], { stdio: ["ignore", "pipe", "pipe"], env: cleanCodexEnvironment() });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.on("error", () => resolveStatus(""));
    child.on("close", (code) => resolveStatus(code === 0 ? output : ""));
  });
  if (!/Logged in using ChatGPT/i.test(status)) throw codexUnavailable("Codex CLI must be signed in with ChatGPT (run `codex login`), not an API key.");
  return binary;
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

function nextLocalReset(message, now = new Date(), pattern = RESET_TIME) {
  const match = message.match(pattern);
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
function subscriptionLimitError(limit, backend = "claude") {
  const resetsAt = limit.until.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const error = new Error(backend === "codex"
    ? `ChatGPT plan usage limit reached for Codex; resets at ${resetsAt}. Codex CLI said: ${limit.message}`
    : `Claude subscription usage limit reached; resets at ${resetsAt}. Claude CLI said: ${limit.message}`);
  error.status = 400;
  error.type = "subscription_limit_error";
  return error;
}

function cachedSubscriptionError(backend = "claude") {
  const limit = subscriptionLimits[backend];
  if (!limit) return null;
  if (limit.until <= new Date()) {
    subscriptionLimits[backend] = null;
    return null;
  }
  return limit;
}

// A limit belongs to the account that hit it; after a CLI account switch a
// persisted one no longer applies.
function persistedLimit(saved, account, now = new Date()) {
  const until = new Date(saved?.until);
  return saved?.message && account && saved.account === account && until > now ? { message: saved.message, until, account } : null;
}

function rememberSubscriptionLimit(message, backend = "claude") {
  if (backend === "codex") {
    subscriptionLimits.codex = { message, until: nextLocalReset(message, new Date(), CODEX_RESET_TIME), account: null };
    process.stdout.write(`${JSON.stringify({ event: "subscription_limit", backend, until: subscriptionLimits.codex.until.toISOString() })}\n`);
    return subscriptionLimits.codex;
  }
  subscriptionLimits.claude = { message, until: nextLocalReset(message), account: claudeAuth?.email || null };
  process.stdout.write(`${JSON.stringify({ event: "subscription_limit", until: subscriptionLimits.claude.until.toISOString() })}\n`);
  saveProviderState();
  return subscriptionLimits.claude;
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

// Different conversations share a backend's CLI slots, first come first served.
function createSlotPool(limit) {
  return {
    limit,
    active: 0,
    waiters: [],
    async run(task) {
      if (this.active < this.limit) this.active += 1;
      else await new Promise((resolveSlot) => this.waiters.push(resolveSlot));
      try {
        return await task();
      } finally {
        // Hand the slot straight to the next waiter so a newcomer cannot jump the line.
        const next = this.waiters.shift();
        if (next) next();
        else this.active -= 1;
      }
    }
  };
}

const claudePool = createSlotPool(CLAUDE_CONCURRENCY);
const codexPool = createSlotPool(CODEX_CONCURRENCY);

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
  trimSessions();
  saveProviderState();
}

// Keeps each backend's MAX_SESSIONS_PER_BACKEND most recent sessions (the list is newest first).
function trimSessions() {
  const counts = { claude: 0, codex: 0 };
  const kept = claudeSessions.filter((session) => ++counts[backendOf(session.model)] <= MAX_SESSIONS_PER_BACKEND);
  claudeSessions.splice(0, claudeSessions.length, ...kept);
}

function saveProviderState() {
  const state = {
    subscriptionLimit: subscriptionLimits.claude ? { message: subscriptionLimits.claude.message, until: subscriptionLimits.claude.until.toISOString(), account: subscriptionLimits.claude.account } : null,
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
    for (const session of loaded) {
      if (typeof session?.id !== "string" || typeof session?.model !== "string" || typeof session?.cwd !== "string" || !Array.isArray(session?.hashes)) continue;
      claudeSessions.push({ ...session, anchor: typeof session.anchor === "string" ? session.anchor : undefined, toolsHash: typeof session.toolsHash === "string" ? session.toolsHash : "", result: null, resultAt: 0 });
    }
    trimSessions();
    subscriptionLimits.claude = persistedLimit(state.subscriptionLimit, claudeAuth?.email);
    process.stdout.write(`${JSON.stringify({ event: "state_loaded", sessions: claudeSessions.length, limitedUntil: subscriptionLimits.claude?.until?.toISOString() || null })}\n`);
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

// Codex gets the images themselves (--image), not paths to Read.
function codexImagePrompt(files) {
  return files.length ? `IMAGE ATTACHMENTS\nThe ${files.length} embedded image(s) from the messages below are attached to this message, in order.` : "";
}

const CLAUDE_IMAGE_NOTE = "[Embedded image attachment is available to the Claude Read tool.]";

function codexTranscript(messages) {
  return conversationTranscript(messages).replaceAll(CLAUDE_IMAGE_NOTE, "[Embedded image attachment: attached to this message.]");
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
      return CLAUDE_IMAGE_NOTE;
    }
    return jsonForPrompt(part);
  }).join("\n");
}

// VS Code's Copilot Chat fetcher always sends X-VSCode-User-Agent-Library-Version
// and, unless overridden, a GitHubCopilotChat/<version> user agent. Kilo sends
// neither and shows tok/s itself, so it gets no footer. ZCode shows no rate, so
// its chat turns get one; those stream, while its title and memory side requests
// do not and must come back as bare text.
function wantsThroughputFooter(headers, stream = false) {
  const agent = headers["user-agent"] || "";
  return Boolean(headers["x-vscode-user-agent-library-version"]) || /^GitHubCopilotChat\//.test(agent) || (Boolean(stream) && /^ZCode\//.test(agent));
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

function conversationPrompt(messages, imageFiles = [], codex = false) {
  if (codex) {
    return [
      "Answer the coding-agent request below (from Kilo Code or VS Code) through the authenticated local Codex CLI.",
      "The workspace is read-only for you: inspect files if needed, but do not modify anything. Return a concise final answer.",
      codexImagePrompt(imageFiles),
      "",
      codexTranscript(messages)
    ].join("\n");
  }
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

function kiloToolPrompt(messages, tools, imageFiles = [], knownCatalog = "", codex = false) {
  // ponytail: a resumed step trusts the CLI to still remember the catalog it
  // was sent earlier in this session. After autocompact the schemas may be
  // summarized away. Ceiling accepted because --json-schema still pins the
  // legal tool names, and an invalid decision gets one decisionRetryPrompt resend.
  const catalog = knownCatalog
    ? `AVAILABLE CLIENT TOOLS: unchanged since earlier in this session (catalog #${knownCatalog.slice(0, 8)})`
    : `AVAILABLE CLIENT TOOLS\n${JSON.stringify(compactTools(tools))}`;

  return [
    `You are the model driving a coding agent (Kilo Code or VS Code) through the authenticated local ${codex ? "Codex" : "Claude"} CLI.`,
    "Follow the complete conversation and its system instructions. The agent client, not this CLI process, owns all file, terminal, web, and subagent execution.",
    "Return one decision: a final answer, or one or more client tool calls. Batch independent calls (several reads or searches, edits to different files) into one decision; a call that needs another call's result waits for a later turn. Never claim a tool ran until its result appears in a later TOOL message.",
    "For a final answer, set kind to final, put the answer in content, and set tool_calls to an empty array.",
    codex
      ? "For tool calls, set kind to tool_call, content to an empty string, and tool_calls to a list of { tool_name, arguments_json } where tool_name is an available tool and arguments_json is a JSON-encoded object matching its parameters."
      : "For tool calls, set kind to tool_call, content to an empty string, and tool_calls to a list of { tool_name, arguments } where tool_name is an available tool and arguments is a valid object matching its parameters.",
    codex
      ? "Never run shell commands, patches, searches or any tool of your own: every action is a client tool call in this decision. Your own sandbox applies only to your disabled built-in tools; the listed client tools have full write and execute access granted by the user, so make edits and run commands through them. Use the client's own subagent tool (Kilo's task tool) when the engineering-lead policy calls for delegation."
      : "Use the client's own subagent tool (Kilo's task tool) when the engineering-lead policy calls for delegation; do not substitute Claude CLI background agents.",
    codex ? codexImagePrompt(imageFiles) : imageAttachmentPrompt(imageFiles),
    "",
    catalog,
    "",
    codex ? codexTranscript(messages) : conversationTranscript(messages)
  ].join("\n");
}

// Sent into the same CLI session after it returned an invalid decision (e.g.
// kind tool_call with no calls). The catalog is resent if the step only named it.
function decisionRetryPrompt(error, tools, resendCatalog) {
  return [
    `Your last decision was rejected: ${error.message}.`,
    "Return kind final with your answer in content, or kind tool_call with at least one call using only the listed client tool names. If the tool you wanted is not listed, say so in a final answer.",
    resendCatalog
      ? `AVAILABLE CLIENT TOOLS\n${JSON.stringify(compactTools(tools))}`
      : `Listed client tool names: ${tools.map((tool) => tool?.function?.name).filter(Boolean).join(", ")}`
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

// Codex: "thread/resume failed: no rollout found for thread id ...".
function missingClaudeSession(error) {
  return /(?:session|conversation).*(?:not found|does not exist|missing)|could not find.*(?:session|conversation)|no rollout found/i.test(error?.message || "");
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
function parseDecision(payload, tools, cli = "Claude CLI") {
  let decision = payload.structured_output;
  if (!decision && payload.result) {
    try { decision = JSON.parse(payload.result); } catch {}
  }
  const calls = decision?.kind === "tool_call" && Array.isArray(decision.tool_calls) ? decision.tool_calls : [];
  if (!decision || !["final", "tool_call"].includes(decision.kind) || (decision.kind === "tool_call" && !calls.length)) {
    throw new Error(`${cli} did not return a valid Kilo decision`);
  }
  const unavailable = calls.find((call) => !tools.some((tool) => tool?.function?.name === call?.tool_name));
  if (unavailable) throw new Error(`${cli} requested an unavailable Kilo tool: ${unavailable?.tool_name}`);
  return decision;
}

// Codex forwards --output-schema to OpenAI's strict structured outputs: every
// object closed and fully required, so a free-form arguments object is illegal.
// Arguments travel as a JSON-encoded string instead.
function codexDecisionSchema(tools) {
  const schema = toolDecisionSchema(tools);
  schema.properties.tool_calls.items = {
    type: "object",
    properties: {
      tool_name: schema.properties.tool_calls.items.properties.tool_name,
      arguments_json: { type: "string", description: "JSON-encoded object of the tool's arguments" }
    },
    required: ["tool_name", "arguments_json"],
    additionalProperties: false
  };
  return schema;
}

// A Codex decision (arguments_json strings) as the shared { tool_name, arguments } decision.
function codexDecision(text, tools) {
  let decision = null;
  try {
    const raw = JSON.parse(text);
    decision = {
      ...raw,
      tool_calls: (Array.isArray(raw.tool_calls) ? raw.tool_calls : []).map((call) => {
        const args = JSON.parse(call?.arguments_json || "{}");
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments_json is not an object");
        return { tool_name: call.tool_name, arguments: args };
      })
    };
  } catch {
    decision = null;
  }
  return parseDecision({ structured_output: decision }, tools, "Codex CLI");
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

// The prompt goes in on stdin ("-") and comes before --image, whose value list is greedy.
// resume takes no -C or --sandbox and does not inherit the model or effort, so
// both are passed on every call and the sandbox goes in as config.
function codexArgs(profile, tools, session, cwd, schemaFile = null, imageFiles = []) {
  const args = [
    "exec",
    ...(session.resume ? ["resume", session.id] : []),
    "-",
    "--json",
    // Skips config.toml: its model provider, MCP servers and profiles. Auth still loads.
    "--ignore-user-config",
    "--skip-git-repo-check",
    ...(session.resume ? [] : ["-C", cwd]),
    "-c", 'sandbox_mode="read-only"',
    "-m", profile.model,
    "-c", `model_reasoning_effort="${profile.effort}"`
  ];
  if (tools.length) {
    // Drops the read-only sandbox notice, which made Codex refuse client-tool edits.
    args.push(...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]), "-c", 'web_search="disabled"', "-c", "include_permissions_instructions=false", "--output-schema", schemaFile);
  }
  for (const file of imageFiles) args.push("--image", file);
  return args;
}

// Codex exec --json events: thread.started (thread id), item.completed items
// (agent_message is whole text, no deltas), turn.completed (usage), and error
// followed by turn.failed on failure.
function parseCodexEvents(stdout) {
  const run = { threadId: null, text: null, usage: null, error: null, failed: false, ownItems: [] };
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "thread.started") run.threadId = event.thread_id || run.threadId;
    else if (event.type === "item.completed" && event.item?.type === "agent_message") run.text = event.item.text;
    // "error" items are warnings (model mismatch on resume); anything else is Codex's own tool.
    else if (event.type === "item.completed" && !["reasoning", "error"].includes(event.item?.type)) run.ownItems.push(event.item?.type);
    else if (event.type === "turn.completed") run.usage = event.usage;
    else if (event.type === "error") run.error = event.message;
    else if (event.type === "turn.failed") {
      run.failed = true;
      run.error = event.error?.message || run.error;
    }
  }
  return run;
}

// Codex wraps API errors as pretty-printed {"error":{"message"}} JSON.
function readableCodexError(message) {
  if (typeof message !== "string") return "";
  try { return JSON.parse(message)?.error?.message || message; } catch { return message; }
}

function codexResult(code, stdout, stderr, tools) {
  const run = parseCodexEvents(stdout);
  if (run.ownItems.length) process.stdout.write(`${JSON.stringify({ event: "codex_own_tools", thread: run.threadId, items: run.ownItems })}\n`);
  if (code !== 0 || run.failed || typeof run.text !== "string") {
    const message = readableCodexError(run.error) || stderr.replace(/^Reading additional input from stdin\.\.\.\s*/m, "").trim() || `Codex CLI exited with code ${code}`;
    const error = new Error(message);
    error.status = CODEX_LIMIT.test(message) ? 429 : 500;
    throw error;
  }
  // OpenAI input_tokens already include cached_input_tokens, output_tokens the reasoning tokens.
  const usage = normalizeUsage(run.usage);
  if (tools.length) return { decision: codexDecision(run.text, tools), usage, sessionId: run.threadId };
  return { text: run.text || "Codex completed the task without a text response.", usage, sessionId: run.threadId };
}

// No text deltas exist, so a streamed request gets the status line, then the whole answer.
async function runCodex(profile, prompt, cwd, signal, tools = [], session, imageFiles = []) {
  if (signal.aborted) throw cancellationError();
  const binary = await codexCli();
  const schemaDirectory = tools.length ? await mkdtemp(join(tmpdir(), "kilo-codex-schema-")) : null;
  try {
    const schemaFile = schemaDirectory && join(schemaDirectory, "decision.json");
    if (schemaFile) await writeFile(schemaFile, JSON.stringify(codexDecisionSchema(tools)), { mode: 0o600 });
    if (signal.aborted) throw cancellationError();
    const { code, stdout, stderr } = await new Promise((resolveRun, reject) => {
      const child = spawn(binary, codexArgs(profile, tools, session, cwd, schemaFile, imageFiles), {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: cleanCodexEnvironment()
      });
      const out = [];
      const err = [];
      child.stdin.on("error", (error) => {
        if (error.code !== "EPIPE") reject(error);
      });
      child.stdin.end(prompt);
      child.stdout.on("data", (chunk) => out.push(chunk));
      child.stderr.on("data", (chunk) => err.push(chunk));
      child.on("error", reject);
      const cancel = () => child.kill("SIGTERM");
      signal.addEventListener("abort", cancel, { once: true });
      child.on("close", (exitCode, stoppedBy) => {
        signal.removeEventListener("abort", cancel);
        if (stoppedBy || signal.aborted) return reject(cancellationError());
        resolveRun({ code: exitCode, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
      });
    });
    return codexResult(code, stdout, stderr, tools);
  } finally {
    if (schemaDirectory) await rm(schemaDirectory, { recursive: true, force: true });
  }
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

// The extension deletes its old version folder on auto-update, so a cached
// path can vanish while the bridge runs; re-resolve instead of failing forever.
async function liveClaudeBinary(resolver = resolveClaudeBinary) {
  if (claudeBinary) {
    try {
      await access(claudeBinary, fsConstants.X_OK);
      return claudeBinary;
    } catch {}
  }
  claudeBinary = await resolver();
  return claudeBinary;
}

async function runClaude(...args) {
  // Invariant: never two live processes on one CLI session. A one-shot spawn
  // retires this session's warm process first and waits for it to exit.
  if (args[5]?.id) await retireWarm(args[5].id);
  if (args[3].aborted) throw cancellationError();
  await liveClaudeBinary();
  try {
    return await spawnClaude(...args);
  } catch (error) {
    // Deleted between the check and the spawn: nothing ran yet, so retry once.
    if (error.code !== "ENOENT") throw error;
    claudeBinary = null;
    await liveClaudeBinary();
    return spawnClaude(...args);
  }
}

// Shared by the one-shot and warm step paths so their error/decision/usage
// handling cannot drift: throws the error the step should reject with, else
// returns the output the caller resolves with.
function settlePayloadResult(payload, code, tools, stderr) {
  if (code !== 0 || payload.is_error) {
    const error = new Error(payload.result || stderr.trim() || `Claude CLI exited with code ${code}`);
    error.status = payload.api_error_status || (SUBSCRIPTION_LIMIT.test(error.message) ? 429 : 500);
    throw error;
  }
  if (tools.length) return { decision: parseDecision(payload, tools), usage: normalizeUsage(payload.usage) };
  return { text: payload.result || "Claude completed the task without a text response.", usage: normalizeUsage(payload.usage) };
}

function warmSignature(profile, cwd, tools) {
  return JSON.stringify([profile.model, profile.effort, cwd, toolsCatalogHash(tools)]);
}

function warmEligible(tools, imageDirectory, onText, onReasoning) {
  return warmEnabled && !shuttingDown && tools.length > 0 && Boolean(onText || onReasoning) && !imageDirectory;
}

function warmFallbackError(cause, child) {
  const error = new Error(`Claude warm process unavailable: ${cause?.message || cause}`);
  error.warmFallback = true;
  error.child = child;
  return error;
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => child.once("close", resolveExit));
}

function clearWarmTimer(entry) {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
}

function scheduleWarmIdle(entry) {
  clearWarmTimer(entry);
  if (warmProcesses.get(entry.key) !== entry) return;
  if (shuttingDown) return void retireWarm(entry.key);
  entry.idleTimer = setTimeout(() => {
    if (entry.busy || warmProcesses.get(entry.key) !== entry) return;
    retireWarm(entry.key);
  }, warmIdleMs);
  entry.idleTimer.unref?.();
}

// A session's previous process can still be exiting after it left the table
// (retire, abort, failed write). A new spawn for that session waits for it, so
// two processes never share one CLI session. SIGKILL bounds the wait.
const warmExits = new Map();
function trackWarmExit(entry) {
  const hardKill = setTimeout(() => { try { entry.child.kill("SIGKILL"); } catch {} }, 8000);
  hardKill.unref?.();
  const exit = waitForExit(entry.child).then(() => {
    clearTimeout(hardKill);
    if (warmExits.get(entry.key) === exit) warmExits.delete(entry.key);
  });
  warmExits.set(entry.key, exit);
  return exit;
}

// Resolves once the session has no live process: retires the one in the table,
// or waits for one that is already on its way out.
async function retireWarm(id) {
  const entry = warmProcesses.get(id);
  if (!entry) return warmExits.get(id);
  warmProcesses.delete(id);
  clearWarmTimer(entry);
  entry.alive = false;
  const step = entry.step;
  entry.step = null;
  entry.busy = false;
  if (step) {
    if (step.forwarded()) step.reject(new Error("Claude warm process retired"));
    else step.reject(warmFallbackError(new Error("Claude warm process retired"), entry.child));
  }
  const exited = trackWarmExit(entry);
  try { entry.child.stdin.end(); } catch {}
  const killTimer = setTimeout(() => { try { entry.child.kill("SIGTERM"); } catch {} }, 5000);
  killTimer.unref?.();
  await exited;
  clearTimeout(killTimer);
}

function failWarmStep(entry, error) {
  const step = entry.step;
  if (!step) return;
  entry.step = null;
  entry.busy = false;
  if (step.forwarded()) step.reject(error);
  else step.reject(warmFallbackError(error, entry.child));
}

function ingestWarm(entry, text) {
  entry.pending += text;
  let newline;
  while ((newline = entry.pending.indexOf("\n")) >= 0) {
    const line = entry.pending.slice(0, newline).trim();
    entry.pending = entry.pending.slice(newline + 1);
    if (!line.startsWith("{")) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const step = entry.step;
    if (!step) continue;
    if (event.type === "result") {
      step.payload = event;
      step.settle(event);
      continue;
    }
    const delta = event.type === "stream_event" && event.event?.type === "content_block_delta" ? event.event.delta : null;
    if (delta?.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking && step.onReasoning) {
      step.onReasoning(delta.thinking);
      continue;
    }
    if (!step.decisionStream || delta?.type !== "input_json_delta" || typeof delta.partial_json !== "string") continue;
    const piece = step.decisionStream.push(delta.partial_json);
    if (piece) step.onText(piece);
  }
}

function spawnWarm(profile, tools, session, signature, cwd) {
  const args = [...claudeArgs(profile, tools, session, null, true), "--input-format", "stream-json"];
  const child = spawn(claudeBinary, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: cleanClaudeEnvironment(tools.length > 0)
  });
  const entry = {
    key: session.id,
    child,
    signature,
    cwd,
    alive: true,
    busy: false,
    lastUsed: Date.now(),
    idleTimer: null,
    step: null,
    pending: "",
    stderr: ""
  };
  child.stdout.on("data", (chunk) => ingestWarm(entry, chunk.toString("utf8")));
  // Kept short: the process is long-lived and stderr only labels a failure.
  child.stderr.on("data", (chunk) => { entry.stderr = (entry.stderr + chunk.toString("utf8")).slice(-4000); });
  // A write to a dying process reports through the write callback; without a
  // listener the stream's own EPIPE event would crash the whole bridge.
  child.stdin.on("error", () => {});
  child.on("error", (error) => {
    entry.alive = false;
    clearWarmTimer(entry);
    if (warmProcesses.get(entry.key) === entry) warmProcesses.delete(entry.key);
    failWarmStep(entry, error);
  });
  child.on("close", (code) => {
    entry.alive = false;
    clearWarmTimer(entry);
    if (warmProcesses.get(entry.key) === entry) warmProcesses.delete(entry.key);
    // Retire and abort clear the step first, so one still set here means the
    // process died on its own or was killed from outside: fail it, never hang.
    if (entry.step) failWarmStep(entry, new Error(entry.stderr.trim() || `Claude CLI exited with code ${code}`));
  });
  warmProcesses.set(session.id, entry);
  return entry;
}

// Make room for one more warm process: evict the least recently used idle one.
// False means every warm process is busy, so the caller runs one-shot instead.
async function makeWarmRoom() {
  while (warmProcesses.size >= warmMax) {
    const idle = [...warmProcesses.entries()].filter(([, entry]) => !entry.busy).sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
    if (!idle) return false;
    await retireWarm(idle[0]);
  }
  return true;
}

function warmRequest(entry, prompt, tools, signal, onText, onReasoning, mode) {
  return new Promise((resolveResult, reject) => {
    if (signal.aborted) return reject(cancellationError());
    let forwarded = false;
    entry.busy = true;
    entry.lastUsed = Date.now();
    clearWarmTimer(entry);
    const step = {
      decisionStream: onText ? createDecisionStream() : null,
      payload: null,
      loaded: false,
      forwarded: () => forwarded,
      onText: onText ? (piece) => { forwarded = true; onText(piece); } : null,
      onReasoning: onReasoning ? (thinking) => { forwarded = true; onReasoning(thinking); } : null,
      reject: null,
      settle: null
    };
    const finish = (fn) => {
      if (step.loaded) return;
      step.loaded = true;
      signal.removeEventListener("abort", cancel);
      entry.step = null;
      entry.busy = false;
      entry.lastUsed = Date.now();
      scheduleWarmIdle(entry);
      fn();
    };
    step.reject = (error) => finish(() => reject(error));
    step.settle = (payload) => finish(() => {
      let value;
      try {
        value = settlePayloadResult(payload, 0, tools, entry.stderr);
      } catch (error) {
        // An error result retires the process. An invalid decision does not:
        // the bridge's one corrective resend goes into this same process.
        if (payload.is_error) retireWarm(entry.key);
        return reject(error);
      }
      resolveResult({ output: value, mode });
    });
    const cancel = () => {
      entry.alive = false;
      warmProcesses.delete(entry.key);
      clearWarmTimer(entry);
      entry.step = null;
      entry.busy = false;
      try { entry.child.kill("SIGTERM"); } catch {}
      trackWarmExit(entry);
      finish(() => reject(cancellationError()));
    };
    entry.step = step;
    signal.addEventListener("abort", cancel, { once: true });
    const line = `${JSON.stringify({ type: "user", message: { role: "user", content: prompt } })}\n`;
    entry.child.stdin.write(line, (error) => {
      if (!error) return;
      if (step.forwarded()) finish(() => reject(new Error(`Claude warm stdin write failed: ${error.message}`)));
      else {
        entry.alive = false;
        warmProcesses.delete(entry.key);
        try { entry.child.kill("SIGTERM"); } catch {}
        trackWarmExit(entry);
        finish(() => reject(warmFallbackError(error, entry.child)));
      }
    });
  });
}

async function runWarmStep(profile, prompt, cwd, signal, tools, session, signature, onText, onReasoning) {
  const id = session.id;
  let entry = warmProcesses.get(id);
  if (entry && (!entry.alive || entry.busy || entry.signature !== signature)) entry = null;
  // Retires a stale process, or waits for one that is still exiting.
  if (!entry) await retireWarm(id);
  let mode;
  if (entry) {
    mode = "reused";
  } else {
    if (!(await makeWarmRoom())) return null;
    // Aborted while waiting: do not start a process for a dead request.
    if (signal.aborted) throw cancellationError();
    entry = spawnWarm(profile, tools, session, signature, cwd);
    mode = "spawned";
  }
  return warmRequest(entry, prompt, tools, signal, onText, onReasoning, mode);
}

// The request handler's Claude step: warm when eligible, else today's one-shot.
// Returns { output, mode } where mode is "reused" | "spawned" | "off".
async function runClaudeStep(profile, prompt, cwd, signal, tools, session, imageDirectory, onText, onReasoning) {
  if (signal.aborted) throw cancellationError();
  if (!warmEligible(tools, imageDirectory, onText, onReasoning)) {
    return { output: await runClaude(profile, prompt, cwd, signal, tools, session, imageDirectory, onText, onReasoning), mode: "off" };
  }
  await liveClaudeBinary();
  const signature = warmSignature(profile, cwd, tools);
  try {
    const warm = await runWarmStep(profile, prompt, cwd, signal, tools, session, signature, onText, onReasoning);
    if (warm) return warm;
  } catch (error) {
    if (!error?.warmFallback) throw error;
    await waitForExit(error.child);
    // Process died before any output: fall through to today's one-shot path.
  }
  return { output: await runClaude(profile, prompt, cwd, signal, tools, session, imageDirectory, onText, onReasoning), mode: "off" };
}

function spawnClaude(profile, prompt, cwd, signal, tools = [], session, imageDirectory = null, onText = null, onReasoning = null) {
  return new Promise((resolveResult, reject) => {
    if (signal.aborted) return reject(cancellationError());
    const args = claudeArgs(profile, tools, session, imageDirectory, Boolean(onText || onReasoning));
    const child = spawn(claudeBinary, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: cleanClaudeEnvironment(tools.length > 0)
    });

    let stdout = "";
    let stderr = "";
    let pending = "";
    let streamedPayload = null;
    let settled = false;
    let exitTimer = null;
    const decisionStream = onText ? createDecisionStream() : null;
    const cancel = () => child.kill("SIGTERM");
    signal.addEventListener("abort", cancel, { once: true });
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", cancel);
      fn();
    };
    const settlePayload = (payload, code = 0) => {
      let value;
      try {
        value = settlePayloadResult(payload, code, tools, stderr);
      } catch (error) {
        return finish(() => reject(error));
      }
      finish(() => resolveResult(value));
    };
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") finish(() => reject(error));
    });
    child.stdin.end(prompt);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
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
          if (!event.is_error || event.result) {
            exitTimer = setTimeout(() => child.kill("SIGTERM"), 5000);
            exitTimer.unref?.();
            settlePayload(event, 0);
          }
          continue;
        }
        const delta = event.type === "stream_event" && event.event?.type === "content_block_delta" ? event.event.delta : null;
        if (delta?.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking && onReasoning) {
          onReasoning(delta.thinking);
          continue;
        }
        if (!decisionStream || delta?.type !== "input_json_delta" || typeof delta.partial_json !== "string") continue;
        const piece = decisionStream.push(delta.partial_json);
        if (piece) onText(piece);
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code, stoppedBy) => {
      clearTimeout(exitTimer);
      if (settled) return;
      if (stoppedBy || signal.aborted) return finish(() => reject(cancellationError()));
      let payload = streamedPayload;
      if (!payload) {
        try {
          payload = JSON.parse(stdout);
        } catch {
          return finish(() => reject(new Error(stderr.trim() || stdout.trim() || `Claude CLI exited with code ${code}`)));
        }
      }
      settlePayload(payload, code);
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
      concurrency: { limit: CLAUDE_CONCURRENCY, active: claudePool.active, queued: claudePool.waiters.length, conversations: conversationLocks.size },
      sessionReuse: true,
      sessions: claudeSessions.length,
      limitedUntil: cachedSubscriptionError()?.until?.toISOString() || null,
      warm: {
        enabled: warmEnabled,
        limit: warmMax,
        idleMs: warmIdleMs,
        processes: [...warmProcesses.values()].map((entry) => ({
          pid: entry.child.pid,
          cwd: entry.cwd,
          busy: entry.busy,
          idleForMs: Date.now() - entry.lastUsed
        }))
      },
      codex: {
        concurrency: { limit: CODEX_CONCURRENCY, active: codexPool.active, queued: codexPool.waiters.length },
        limitedUntil: cachedSubscriptionError("codex")?.until?.toISOString() || null
      }
    });
  }
  if (request.method === "GET" && url.pathname === "/v1/models") {
    // Codex models are listed only while a signed-in Codex CLI is installed.
    const codexReady = await codexCli().then(() => true, () => false);
    return sendJson(response, 200, {
      object: "list",
      data: Object.entries(profiles)
        .filter(([id]) => codexReady || backendOf(id) !== "codex")
        .map(([id, profile]) => ({ id, name: profile.name, object: "model", owned_by: backendOf(id) === "codex" ? "local-codex-cli" : "local-claude-cli" }))
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
    const profile = zcodeEffort(profiles[body.model], body.reasoning_effort);
    if (!profile) return sendJson(response, 400, { error: { message: `Unknown local Claude profile: ${body.model}` } });
    body.messages = await zcodeLeadMessages(body.messages, profile);
    const backend = backendOf(body.model);
    const codex = backend === "codex";
    const tools = Array.isArray(body.tools) ? body.tools.filter((tool) => tool?.type === "function") : [];
    const fullPrompt = tools.length ? kiloToolPrompt(body.messages, tools, [], "", codex) : conversationPrompt(body.messages, [], codex);
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
      return (codex ? codexPool : claudePool).run(() => runConversationStep(matched));
    });
    async function runConversationStep(matched) {
      if (controller.signal.aborted) throw cancellationError();
      const limited = cachedSubscriptionError(backend);
      if (limited) throw subscriptionLimitError(limited, backend);
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
      let firstReasoningAt = 0;
      let statusSent = false;
      const onText = writer ? (text) => {
        firstOutputAt ||= Date.now();
        clearTimeout(status);
        writer.content(text);
      } : null;
      const onReasoning = writer ? (thinking) => {
        firstReasoningAt ||= Date.now();
        clearTimeout(status);
        writer.chunk({ reasoning_content: statusSent ? `\n\n${thinking}` : thinking });
        statusSent = false;
      } : null;
      // One reasoning delta so a long step is not a silent spinner. Delayed so
      // quick failures (subscription limit) still get a plain HTTP error; Kilo
      // keeps it as reasoning_content, which the transcript never forwards.
      const status = writer && setTimeout(() => {
        if (!firstOutputAt && !firstReasoningAt) {
          statusSent = true;
          firstReasoningAt = Date.now();
          writer.chunk({ reasoning_content: `${profile.name.replace(/ \(.*/, "")} is working...` });
        }
      }, STATUS_DELAY_MS);
      const catalogHash = toolsCatalogHash(tools);
      let resumed = Boolean(matched);
      // The catalog only has to be described once per CLI session.
      let knownCatalog = resumed && catalogHash && session.toolsHash === catalogHash ? catalogHash : "";
      // A new Codex thread gets its id from Codex; session.id is replaced once it runs.
      // warmField reports how the step that produced the output ran: a reused
      // warm process, a freshly spawned one, or the one-shot path.
      let warmField = "off";
      const run = async (text, target) => {
        if (codex) return runCodex(profile, text, cwd, controller.signal, tools, target, attachments.files);
        const step = await runClaudeStep(profile, text, cwd, controller.signal, tools, target, attachments.directory, onText, onReasoning);
        warmField = step.mode;
        return step.output;
      };
      try {
        attachments = await materializeImageAttachments(deltaMessages);
        prompt = tools.length ? kiloToolPrompt(deltaMessages, tools, attachments.files, knownCatalog, codex) : conversationPrompt(deltaMessages, attachments.files, codex);
        let recoveredSession = false;
        let output;
        try {
          output = await run(prompt, { id: session.id, resume: resumed });
        } catch (error) {
          // One corrective resend into the same CLI session, which already holds
          // this step. Not once text has streamed (SSE deltas cannot be retracted),
          // nor for a new Codex thread, whose id is only known after a success.
          if (tools.length && !firstOutputAt && !controller.signal.aborted && (!codex || resumed) && /Kilo decision|unavailable Kilo tool/i.test(error.message)) {
            process.stdout.write(`${JSON.stringify({ event: "decision_retry", session: session.id, error: error.message, catalogResent: Boolean(knownCatalog) })}\n`);
            output = await run(decisionRetryPrompt(error, tools, Boolean(knownCatalog)), { id: session.id, resume: true });
          } else if (!resumed || !missingClaudeSession(error) || controller.signal.aborted) {
            throw error;
          } else {
            const missingSession = session.id;
            session.id = randomUUID();
            session.hashes = [];
            deltaMessages = body.messages;
            await removeImageAttachments(attachments);
            attachments = await materializeImageAttachments(deltaMessages);
            prompt = tools.length ? kiloToolPrompt(deltaMessages, tools, attachments.files, "", codex) : conversationPrompt(deltaMessages, attachments.files, codex);
            resumed = false;
            recoveredSession = true;
            process.stdout.write(`${JSON.stringify({ event: "session_missing", session: missingSession, replacement: session.id })}\n`);
            output = await run(prompt, { id: session.id, resume: false });
          }
        }
        if (output.sessionId) session.id = output.sessionId;
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
          ttftMs: (firstOutputAt || Date.now()) - startedAt,
          warm: warmField
        })}\n`);
        return output;
      } catch (error) {
        if (error.status === 429 && (codex ? CODEX_LIMIT : SUBSCRIPTION_LIMIT).test(error.message)) {
          throw subscriptionLimitError(rememberSubscriptionLimit(error.message, backend), backend);
        }
        throw error;
      } finally {
        clearTimeout(status);
        await removeImageAttachments(attachments);
      }
    }
    const elapsedMs = result.elapsedMs ?? Date.now() - startedAt;
    const footer = wantsThroughputFooter(request.headers, body.stream) ? `\n\n${throughputFooter(result.usage?.completion_tokens ?? 0, elapsedMs, elapsedMs)}` : "";
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
  // Idle warm processes end now. A busy one finishes its step first, as
  // one-shot runs always have, and scheduleWarmIdle then retires it.
  shuttingDown = true;
  for (const entry of [...warmProcesses.values()]) if (!entry.busy) retireWarm(entry.key);
  server.close(() => process.exit(0));
}

if (process.argv.includes("--self-test")) {
  // The existing stub CLIs read stdin to EOF (`cat`), which would hang under
  // warm mode. Keep every existing assertion byte-for-byte by running them with
  // warm mode off; the warm tests below re-enable it.
  warmEnabled = false;
  const leadInput = [{role:"user",content:"test"}];
  if (await zcodeLeadMessages(leadInput, profiles["fable-5-1-high"]) !== leadInput) throw Error("Standalone profile was changed");
  for (const id of ["codex-astra-engineering-lead","fable-engineering-lead"]) {
    const messages = await zcodeLeadMessages(leadInput, profiles[id], async () => "---\nname: test\n---\nLead policy");
    if (messages.length !== 2 || messages[0].role !== "system" || !messages[0].content.includes("Lead policy") || messages[1] !== leadInput[0]) throw Error("Lead policy binding failed");
  }
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

  claudeBinary = join(tmpdir(), "claude-deleted-by-extension-update", "claude");
  if (await liveClaudeBinary(async () => "/resolved/claude") !== "/resolved/claude" || claudeBinary !== "/resolved/claude") {
    throw new Error("A deleted cached Claude CLI path is not re-resolved");
  }
  claudeBinary = null;

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
    || wantsThroughputFooter({ "user-agent": "ai-sdk/openai-compatible/1.0.0 runtime/bun/1.3.0" }) || wantsThroughputFooter({ "user-agent": "Kilo-Code/7.7.7" }) || wantsThroughputFooter({ "user-agent": "Kilo-Code/7.8.1 ai-sdk/provider-utils/4.0.27 runtime/bun/1.3.14" }, true) || wantsThroughputFooter({})
    || !wantsThroughputFooter({ "user-agent": "ZCode/3.14.4 ai-sdk/provider-utils/4.0.39 runtime/node.js/24" }, true) || wantsThroughputFooter({ "user-agent": "ZCode/3.14.4 ai/6.0.193 ai-sdk/provider-utils/4.0.39 runtime/node.js/24" }, false)) {
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
  const fakeJob = (key, label, fail = false) => withConversationLock(key, () => claudePool.run(async () => {
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
  if (claudePool.active !== 0 || claudePool.waiters.length || conversationLocks.size) {
    throw new Error("CLI slots or conversation locks leaked after the jobs finished");
  }

  // Codex backend: routing, argv, strict schema, JSONL parsing, limits, pools.
  const codexIds = Object.keys(profiles).filter((id) => backendOf(id) === "codex");
  if (backendOf("fable-engineering-lead") !== "claude" || codexIds.join() !== "codex-astra-engineering-lead,codex-gpt-6-astra-high,codex-gpt-6-astra-xhigh,codex-gpt-6-sol-high,codex-gpt-6-luna-medium,codex-gpt-5.6-sol-high,codex-gpt-5.6-terra-high,codex-gpt-5.6-luna-medium"
    || backendOf("fable-5-1-high") !== "claude" || backendOf("opus-5-5-fast") !== "claude" || backendOf(undefined) !== "claude") {
    throw new Error("Model ids are not routed to Codex by the codex- prefix");
  }
  const luna = profiles["codex-gpt-5.6-luna-medium"];
  const newCodex = codexArgs(luna, decisionTools, { id: "ignored", resume: false }, "/tmp", "/s/decision.json", ["/i/a.png", "/i/b.png"]);
  const at = (args, flag) => args[args.indexOf(flag) + 1];
  if (newCodex.slice(0, 2).join() !== "exec,-" || at(newCodex, "-C") !== "/tmp" || at(newCodex, "-m") !== "gpt-5.6-luna" || !newCodex.includes('model_reasoning_effort="medium"')
    || !newCodex.includes("--ignore-user-config") || !newCodex.includes("--skip-git-repo-check") || !newCodex.includes('sandbox_mode="read-only"') || !newCodex.includes("--json")
    || at(newCodex, "--output-schema") !== "/s/decision.json" || !newCodex.join(" ").includes("--disable shell_tool") || newCodex.includes("--ephemeral") || !newCodex.includes("include_permissions_instructions=false")
    || newCodex.slice(-4).join() !== "--image,/i/a.png,--image,/i/b.png") {
    throw new Error(`A new Codex tool-mode run has the wrong argv: ${newCodex.join(" ")}`);
  }
  const resumeCodex = codexArgs(profiles["codex-gpt-6-astra-xhigh"], decisionTools, { id: "thread-1", resume: true }, "/tmp", "/s/decision.json");
  if (resumeCodex.slice(0, 4).join() !== "exec,resume,thread-1,-" || resumeCodex.includes("-C") || at(resumeCodex, "-m") !== "gpt-6-astra" || !resumeCodex.includes('model_reasoning_effort="xhigh"') || resumeCodex.includes("--image")) {
    throw new Error(`A resumed Codex run does not re-pass its model and effort: ${resumeCodex.join(" ")}`);
  }
  const chatCodex = codexArgs(luna, [], { id: "x", resume: false }, "/tmp");
  if (chatCodex.includes("--output-schema") || chatCodex.includes("--disable") || !chatCodex.includes('sandbox_mode="read-only"') || chatCodex.includes("include_permissions_instructions=false")) {
    throw new Error("A Codex conversation-mode run has tool-mode flags or a writable sandbox");
  }
  const strict = (node) => !node || typeof node !== "object" || (Array.isArray(node) ? node.every(strict)
    : (node.type !== "object" || (node.additionalProperties === false && Object.keys(node.properties || {}).sort().join() === [...(node.required || [])].sort().join()))
      && Object.values(node).every(strict));
  const codexSchema = codexDecisionSchema(multiTools);
  if (!strict(codexSchema) || codexSchema.properties.tool_calls.items.properties.tool_name.enum.join() !== "read,grep" || codexSchema.properties.tool_calls.items.properties.arguments_json.type !== "string"
    || toolDecisionSchema(multiTools).properties.tool_calls.items.properties.arguments.type !== "object") {
    throw new Error("The Codex decision schema is not strict, or the Claude schema changed");
  }
  const jsonl = (...events) => events.map((event) => JSON.stringify(event)).join("\n");
  const usageEvent = { type: "turn.completed", usage: { input_tokens: 12854, cached_input_tokens: 9984, cache_write_input_tokens: 0, output_tokens: 1019, reasoning_output_tokens: 947 } };
  const finalRun = codexResult(0, jsonl({ type: "thread.started", thread_id: "t-1" }, { type: "turn.started" },
    { type: "item.completed", item: { id: "item_0", type: "error", message: "This session was recorded with model x" } },
    { type: "item.completed", item: { id: "item_1", type: "agent_message", text: JSON.stringify({ kind: "final", content: "done", tool_calls: [] }) } }, usageEvent), "", multiTools);
  if (finalRun.decision.content !== "done" || finalRun.sessionId !== "t-1" || finalRun.usage.prompt_tokens !== 12854 || finalRun.usage.completion_tokens !== 1019) {
    throw new Error(`A Codex final answer, thread id or usage was not parsed: ${JSON.stringify(finalRun)}`);
  }
  const callRun = codexResult(0, jsonl({ type: "thread.started", thread_id: "t-2" },
    { type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ kind: "tool_call", content: "", tool_calls: [{ tool_name: "read", arguments_json: "{\"filePath\":\"a.js\"}" }, { tool_name: "grep", arguments_json: "{\"pattern\":\"x\"}" }] }) } }, usageEvent), "", multiTools);
  const codexCalls = openAiToolCalls(callRun.decision);
  if (codexCalls.map((call) => `${call.function.name}:${call.function.arguments}`).join() !== `read:{"filePath":"a.js"},grep:{"pattern":"x"}`) {
    throw new Error("A Codex tool_call decision's arguments_json was not parsed into OpenAI tool_calls");
  }
  const codexFailure = (stdout, stderr = "", code = 1, tools = multiTools) => { try { codexResult(code, stdout, stderr, tools); } catch (error) { return error; } return null; };
  const failed = codexFailure(jsonl({ type: "thread.started", thread_id: "t-3" }, { type: "error", message: "{\n \"error\": {\n \"message\": \"Invalid schema\", \"code\": \"invalid_json_schema\"\n }\n}" }, { type: "turn.failed", error: { message: "{\"error\":{\"message\":\"Invalid schema\"}}" } }));
  const badArguments = codexFailure(jsonl({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ kind: "tool_call", content: "", tool_calls: [{ tool_name: "read", arguments_json: "{not json" }] }) } }), "", 0);
  const noRollout = codexFailure("", "Reading additional input from stdin...\nError: thread/resume: thread/resume failed: no rollout found for thread id x (code -32600)");
  const limitHit = codexFailure(jsonl({ type: "error", message: "You've hit your usage limit. Upgrade to Pro or try again at 3:04 PM." }, { type: "turn.failed", error: { message: "You've hit your usage limit. Upgrade to Pro or try again at 3:04 PM." } }));
  if (failed?.message !== "Invalid schema" || failed.status !== 500 || !/valid Kilo decision/.test(badArguments?.message || "") || !missingClaudeSession(noRollout) || noRollout.message.includes("Reading additional") || limitHit?.status !== 429) {
    throw new Error(`Codex failures are not classified: ${[failed, badArguments, noRollout, limitHit].map((error) => error?.message).join(" | ")}`);
  }
  for (const [text, expected] of [
    ["You've hit your usage limit. Upgrade to Plus to continue using Codex, or try again at 3:04 PM.", true],
    ["Usage limit reached. You've reached your usage limit.", true],
    ["Your workspace is out of credits. Add credits to continue.", true],
    ["Rate limit reached for plan", true],
    ["Invalid schema for response_format 'codex_output_schema'", false],
    ["stream disconnected before completion", false]
  ]) {
    if (CODEX_LIMIT.test(text) !== expected) throw new Error(`Codex limit misclassified: ${text}`);
  }
  const codexNow = new Date(2026, 8, 23, 10, 0);
  const sameDay = nextLocalReset("try again at 3:04 PM.", codexNow, CODEX_RESET_TIME);
  const laterDay = nextLocalReset("or try again at Sep 25th, 2026 3:04 PM.", codexNow, CODEX_RESET_TIME);
  if (sameDay.getTime() !== new Date(2026, 8, 23, 15, 4).getTime() || laterDay.getTime() !== new Date(2026, 8, 25, 15, 4).getTime()) {
    throw new Error(`A Codex reset time was not parsed: ${sameDay.toISOString()} ${laterDay.toISOString()}`);
  }
  const codexLimitError = subscriptionLimitError({ message: "You've hit your usage limit.", until: sameDay }, "codex");
  if (codexLimitError.status !== 400 || codexLimitError.type !== "subscription_limit_error" || !/^ChatGPT plan usage limit reached for Codex; resets at .*Codex CLI said: You've hit/.test(codexLimitError.message)) {
    throw new Error("A Codex usage limit is not surfaced like the Claude one");
  }
  rememberSubscriptionLimit("You've hit your usage limit. try again at 3:04 PM.", "codex");
  if (cachedSubscriptionError() || !cachedSubscriptionError("codex")) throw new Error("The Codex limit is not kept apart from Claude's");
  subscriptionLimits.codex = null;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.CODEX_HOME = "/elsewhere";
  const codexEnvironment = cleanCodexEnvironment();
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_HOME;
  if (codexEnvironment.OPENAI_API_KEY || codexEnvironment.CODEX_HOME || !codexEnvironment.PATH) throw new Error("API keys or another Codex home reach the Codex CLI");
  const codexPrompt = kiloToolPrompt(vscodeChat, vscodeTools, ["/i/a.png"], "", true);
  if (!codexPrompt.includes("arguments_json") || !codexPrompt.includes("Codex CLI") || codexPrompt.includes("Claude") || !codexPrompt.includes("attached to this message")) {
    throw new Error("The Codex tool prompt still describes the Claude CLI");
  }
  // A stub Codex replays JSONL and records its argv and stdin, so the spawn path runs without network.
  const codexStub = await mkdtemp(join(tmpdir(), "codex-stub-"));
  try {
    const decisionLine = jsonl({ type: "thread.started", thread_id: "stub-thread" }, { type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ kind: "final", content: "stubbed", tool_calls: [] }) } }, usageEvent);
    await writeFile(join(codexStub, "codex"), `#!/bin/sh\nif [ "$1" = login ]; then echo "Logged in using ChatGPT"; exit 0; fi\nprintf '%s\\n' "$@" > "${codexStub}/args"\ncat > "${codexStub}/stdin"\ncat <<'EOF'\n${decisionLine}\nEOF\n`, { mode: 0o755 });
    process.env.CODEX_BRIDGE_BINARY = join(codexStub, "codex");
    const stubbed = await runCodex(luna, "prompt via stdin", "/tmp", new AbortController().signal, decisionTools, { id: "x", resume: false });
    const stubArgs = (await readFile(join(codexStub, "args"), "utf8")).split("\n");
    if (stubbed.decision.content !== "stubbed" || stubbed.sessionId !== "stub-thread" || await readFile(join(codexStub, "stdin"), "utf8") !== "prompt via stdin" || stubArgs[1] !== "-") {
      throw new Error("The Codex runner did not pass the prompt on stdin or parse the stub's result");
    }
    if ((await readdir(tmpdir())).some((name) => name.startsWith("kilo-codex-schema-") && stubArgs.includes(join(tmpdir(), name, "decision.json")))) {
      throw new Error("The Codex decision schema file was not removed");
    }
  } finally {
    delete process.env.CODEX_BRIDGE_BINARY;
    await rm(codexStub, { recursive: true, force: true });
  }
  // Codex sessions and CLI slots never crowd out Claude's.
  const lru = [...Array.from({ length: MAX_SESSIONS_PER_BACKEND + 5 }, (unused, index) => ({ id: `c${index}`, model: "codex-gpt-5.6-luna-medium" })), { id: "claude-old", model: "fable-5-1-high" }];
  claudeSessions.push(...lru);
  trimSessions();
  const keptClaude = claudeSessions.some((session) => session.id === "claude-old");
  const keptCodex = claudeSessions.filter((session) => backendOf(session.model) === "codex").length;
  claudeSessions.length = 0;
  if (!keptClaude || keptCodex !== MAX_SESSIONS_PER_BACKEND) throw new Error("Codex sessions evicted Claude sessions from the LRU");
  const releaseCodex = [];
  const busyCodex = Array.from({ length: CODEX_CONCURRENCY }, () => codexPool.run(() => new Promise((resolveJob) => releaseCodex.push(resolveJob))));
  const claudeRan = await Promise.race([claudePool.run(async () => true), new Promise((resolveJob) => setTimeout(() => resolveJob(false), 200))]);
  releaseCodex.forEach((release) => release());
  await Promise.all(busyCodex);
  if (!claudeRan || claudePool.active !== 0 || codexPool.active !== 0) throw new Error("A full Codex pool blocked a Claude run");

  // An invalid decision (tool_call with no calls) is resent once into the same
  // CLI session; a second invalid one fails as before. A stub CLI plays
  // numbered result lines through the real request handler.
  const retryStub = await mkdtemp(join(tmpdir(), "claude-retry-stub-"));
  try {
    const resultLine = (decision) => `${JSON.stringify({ type: "result", structured_output: decision, usage: { output_tokens: 1 } })}\n`;
    const invalidLine = resultLine({ kind: "tool_call", content: "", tool_calls: [] });
    await writeFile(join(retryStub, "claude"), `#!/bin/sh\nn=$(( $(cat "${retryStub}/count" 2>/dev/null || echo 0) + 1 ))\necho $n > "${retryStub}/count"\nprintf '%s\\n' "$@" > "${retryStub}/args$n"\ncat > "${retryStub}/stdin$n"\ncat "${retryStub}/out$n"\n`, { mode: 0o755 });
    claudeBinary = join(retryStub, "claude");
    await new Promise((ready) => server.listen(0, HOST, ready));
    const ask = (task) => fetch(`http://${HOST}:${server.address().port}/v1/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model: "opus-5-5-fast", stream: true, tools: decisionTools, messages: [{ role: "system", content: `<cwd>${retryStub}</cwd>` }, { role: "user", content: task }] })
    }).then((reply) => reply.text());
    const stubFile = (name) => readFile(join(retryStub, name), "utf8").catch(() => "");
    await writeFile(join(retryStub, "out1"), invalidLine);
    await writeFile(join(retryStub, "out2"), resultLine({ kind: "final", content: "recovered", tool_calls: [] }));
    const recovered = (await ask("first task")).split("\n\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)).choices[0].delta.content || "").join("");
    const [runArgs, retryArgs] = [(await stubFile("args1")).split("\n"), (await stubFile("args2")).split("\n")];
    if (recovered !== "recovered" || (await stubFile("count")).trim() !== "2" || retryArgs[retryArgs.indexOf("--resume") + 1] !== runArgs[runArgs.indexOf("--session-id") + 1]
      || !/rejected: Claude CLI did not return a valid Kilo decision/.test(await stubFile("stdin2"))) {
      throw new Error(`An invalid Kilo decision was not retried once in the same CLI session: ${JSON.stringify(recovered)}`);
    }
    await rm(join(retryStub, "count"));
    await writeFile(join(retryStub, "out2"), invalidLine);
    const failure = JSON.parse(await ask("second task")).error?.message;
    if (failure !== "Claude CLI did not return a valid Kilo decision" || (await stubFile("count")).trim() !== "2") {
      throw new Error(`A second invalid Kilo decision did not fail with the original error after one retry: ${failure}`);
    }
    await writeFile(join(retryStub, "claude"), `#!/bin/sh\ncat >/dev/null\ncat "${retryStub}/stream"\nsleep 0.4\n`, { mode: 0o755 });
    const thinkingStream = [
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "plan " } } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "" } } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "now" } } },
      { type: "result", structured_output: { kind: "final", content: "fast", tool_calls: [] }, usage: { output_tokens: 2 } }
    ].map((event) => JSON.stringify(event)).join("\n") + "\n";
    await writeFile(join(retryStub, "stream"), thinkingStream);
    const tFast = performance.now();
    const fastChunks = (await ask("third task")).split("\n\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)).choices[0].delta);
    const fastElapsed = performance.now() - tFast;
    const reasoningText = fastChunks.map((delta) => delta.reasoning_content || "").join("");
    const answerText = fastChunks.map((delta) => delta.content || "").join("");
    if (reasoningText !== "plan now" || answerText !== "fast" || fastElapsed >= 350) {
      throw new Error(`Streaming thinking_delta or early result resolution failed: reasoning=${JSON.stringify(reasoningText)} answer=${JSON.stringify(answerText)} elapsedMs=${Math.round(fastElapsed)}`);
    }
  } finally {
    if (server.listening) {
      server.closeAllConnections();
      server.close();
    }
    claudeBinary = null;
    claudeSessions.length = 0;
    await stateWrite;
    await rm(SESSION_STATE_FILE, { force: true });
    await rm(retryStub, { recursive: true, force: true });
  }
  // Warm mode: one long-lived `claude` process reused across a conversation's
  // tool-mode steps. The stub loops over stdin lines (one result per line)
  // rather than reading to EOF, and records one line per spawn.
  warmEnabled = true;
  warmIdleMs = 600000;
  warmMax = 4;
  const warmStubDir = await mkdtemp(join(tmpdir(), "claude-warm-stub-"));
  const warmStubSource = [
    `#!${process.execPath}`,
    `const fs = require("node:fs");`,
    `const readline = require("node:readline");`,
    `const dir = process.env.WARM_STUB_DIR;`,
    `const mode = process.env.WARM_STUB_MODE || "";`,
    `fs.appendFileSync(dir + "/spawns", process.pid + " " + process.argv.slice(2).join(" ").replace(/\\n/g, " ") + "\\n");`,
    `const rl = readline.createInterface({ input: process.stdin });`,
    `let n = 0;`,
    `rl.on("line", () => {`,
    `  n += 1;`,
    `  if (mode === "hang" || (mode === "exitAfterFirst" && n > 1)) return;`,
    `  const file = dir + "/replies";`,
    `  const seq = Number(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "0") + 1;`,
    `  fs.writeFileSync(file, String(seq));`,
    `  process.stdout.write(JSON.stringify({ type: "result", structured_output: { kind: "final", content: "reply-" + seq, tool_calls: [] }, usage: { output_tokens: 1 } }) + "\\n");`,
    `  if (mode === "exitAfterFirst") setTimeout(() => process.exit(0), 150);`,
    `});`
  ].join("\n") + "\n";
  process.env.WARM_STUB_DIR = warmStubDir;
  delete process.env.WARM_STUB_MODE;
  claudeBinary = join(warmStubDir, "claude");
  const warmSession = () => ({ id: randomUUID(), resume: false });
  const warmAnswer = (session, tools, text, resume = false) => {
    session.resume = resume;
    return runClaudeStep(profiles["fable-5-1-high"], text, warmStubDir, new AbortController().signal, tools, session, null, () => {}, null);
  };
  const warmSpawns = async () => (await readFile(join(warmStubDir, "spawns"), "utf8").catch(() => "")).split("\n").filter((line) => line.trim());
  const resetWarmStub = async () => {
    await rm(join(warmStubDir, "spawns"), { force: true });
    await rm(join(warmStubDir, "replies"), { force: true });
  };
  try {
    await writeFile(claudeBinary, warmStubSource, { mode: 0o755 });

    // (a) Two consecutive steps of one conversation use ONE spawn and both answers are right.
    await resetWarmStub();
    delete process.env.WARM_STUB_MODE;
    const sessionA = warmSession();
    const firstA = await warmAnswer(sessionA, decisionTools, "step one");
    const secondA = await warmAnswer(sessionA, decisionTools, "step two", true);
    if (firstA.output.decision.content !== "reply-1" || secondA.output.decision.content !== "reply-2"
      || firstA.mode !== "spawned" || secondA.mode !== "reused" || (await warmSpawns()).length !== 1) {
      throw new Error(`Two warm steps of one conversation did not reuse one process: ${firstA.mode}/${secondA.mode} spawns=${(await warmSpawns()).length}`);
    }
    await retireWarm(sessionA.id);

    // (b) A stub that exits after its first reply makes the next step fall back
    // to a one-shot `--resume` and still succeed.
    await resetWarmStub();
    process.env.WARM_STUB_MODE = "exitAfterFirst";
    const sessionB = warmSession();
    const firstB = await warmAnswer(sessionB, decisionTools, "b one");
    const secondB = await warmAnswer(sessionB, decisionTools, "b two", true);
    const spawnLinesB = await warmSpawns();
    const fallbackLine = spawnLinesB[1] || "";
    delete process.env.WARM_STUB_MODE;
    if (firstB.output.decision.content !== "reply-1" || secondB.output.decision.content !== "reply-2" || secondB.mode !== "off"
      || spawnLinesB.length !== 2 || !spawnLinesB[0].includes("--input-format") || !fallbackLine.includes("--resume") || !fallbackLine.includes(sessionB.id)) {
      throw new Error(`A dead warm process did not fall back to a one-shot --resume: ${JSON.stringify({ firstB: firstB.output.decision.content, secondB: secondB.output.decision.content, mode: secondB.mode, spawns: spawnLinesB.length, fallbackLine })}`);
    }

    // (c) A changed tool catalog causes a respawn and the old process ends.
    await resetWarmStub();
    const sessionC = warmSession();
    await warmAnswer(sessionC, decisionTools, "c one");
    const firstChildC = warmProcesses.get(sessionC.id)?.child;
    const otherTools = [...decisionTools, { type: "function", function: { name: "write", parameters: { type: "object" } } }];
    const secondC = await warmAnswer(sessionC, otherTools, "c two", true);
    const spawnLinesC = await warmSpawns();
    if (secondC.mode !== "spawned" || spawnLinesC.length !== 2 || !firstChildC || firstChildC.exitCode === null) {
      throw new Error(`A changed tool catalog did not respawn and end the old process: mode=${secondC.mode} spawns=${spawnLinesC.length} oldExit=${firstChildC?.exitCode}`);
    }
    await retireWarm(sessionC.id);

    // (d) A short idle timeout ends the process.
    await resetWarmStub();
    const savedIdle = warmIdleMs;
    warmIdleMs = 40;
    const sessionD = warmSession();
    await warmAnswer(sessionD, decisionTools, "d one");
    const idleChild = warmProcesses.get(sessionD.id)?.child;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    const idleExited = idleChild && await Promise.race([waitForExit(idleChild).then(() => true), new Promise((resolveWait) => setTimeout(() => resolveWait(false), 3000).unref())]);
    const gone = warmProcesses.get(sessionD.id) === undefined && idleExited;
    warmIdleMs = savedIdle;
    if (!gone) throw new Error("A warm process outlived its idle timeout");

    // (g) A warm process killed from outside mid-step must not hang the step:
    // nothing was forwarded yet, so it falls back to a one-shot run.
    await resetWarmStub();
    process.env.WARM_STUB_MODE = "hang";
    const sessionG = warmSession();
    const hung = warmAnswer(sessionG, decisionTools, "g one").then((step) => step.mode, (error) => `error: ${error.message}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    delete process.env.WARM_STUB_MODE;
    warmProcesses.get(sessionG.id)?.child.kill("SIGTERM");
    let hangTimer;
    const outcome = await Promise.race([hung, new Promise((resolveWait) => { hangTimer = setTimeout(() => resolveWait("hung"), 3000); })]);
    clearTimeout(hangTimer);
    if (outcome !== "off") throw new Error(`A warm process killed mid-step did not fall back to a one-shot run: ${outcome}`);

    // (e) With warm mode off the one-shot path is used, one process per step.
    await resetWarmStub();
    warmEnabled = false;
    const sessionE = warmSession();
    const firstE = await warmAnswer(sessionE, decisionTools, "e one");
    const secondE = await warmAnswer(sessionE, decisionTools, "e two", true);
    const spawnLinesE = await warmSpawns();
    warmEnabled = true;
    if (firstE.mode !== "off" || secondE.mode !== "off" || spawnLinesE.length !== 2 || spawnLinesE.some((line) => line.includes("--input-format"))) {
      throw new Error(`Warm mode off did not use one-shot per step: ${firstE.mode}/${secondE.mode} spawns=${spawnLinesE.length}`);
    }

    // (f) /health reports the warm shape above.
    await resetWarmStub();
    await new Promise((ready) => server.listen(0, HOST, ready));
    try {
      const healthUrl = `http://${HOST}:${server.address().port}/health`;
      const emptyWarm = (await fetch(healthUrl).then((reply) => reply.json())).warm;
      const sessionF = warmSession();
      await warmAnswer(sessionF, decisionTools, "f one");
      const liveWarm = (await fetch(healthUrl).then((reply) => reply.json())).warm;
      const process = liveWarm?.processes?.find((entry) => typeof entry.pid === "number" && typeof entry.cwd === "string" && typeof entry.busy === "boolean" && typeof entry.idleForMs === "number");
      if (!emptyWarm || typeof emptyWarm.enabled !== "boolean" || typeof emptyWarm.limit !== "number" || typeof emptyWarm.idleMs !== "number" || !Array.isArray(emptyWarm.processes)
        || emptyWarm.limit !== warmMax || emptyWarm.idleMs !== warmIdleMs || !process || process.cwd !== warmStubDir || process.busy !== false) {
        throw new Error(`/health does not report the warm shape: ${JSON.stringify(liveWarm)}`);
      }
      await retireWarm(sessionF.id);
    } finally {
      if (server.listening) {
        server.closeAllConnections();
        server.close();
      }
    }
  } finally {
    delete process.env.WARM_STUB_DIR;
    delete process.env.WARM_STUB_MODE;
    for (const id of [...warmProcesses.keys()]) await retireWarm(id);
    warmEnabled = false;
    warmIdleMs = 600000;
    warmMax = 4;
    claudeBinary = null;
    await rm(warmStubDir, { recursive: true, force: true });
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

/* zcode-engineering-leads-v2 */
async function zcodeLeadMessages(messages, profile, read = readFile) {
  if (!profile.zcodeLead) return messages;
  if (!Array.isArray(messages)) throw Error("Lead requests require a messages array");
  const [lead, policy, style] = await Promise.all([
    read(resolve(homedir(), ".zcode/agents", profile.zcodeLead + ".md"), "utf8"),
    read(resolve(homedir(), ".config/ponytail/AGENTS.md"), "utf8"),
    read(resolve(homedir(), ".config/kilo/chat-response-style.md"), "utf8")
  ]);
  const content = lead.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "") + "\n\n" + policy + "\n\n" + style +
    "\nYou are the selected primary engineering lead and own this chat end to end. Work directly on ordinary questions and small fixes. When independent workstreams justify delegation, use only the available ZCode client subagent tool with deepseek-implementer or glm-investigator. Forward the complete coding policy, English response requirement, task scope, and verification requirements to each worker. Never call another primary lead. The local CLI process must not execute its own tools or background agents. Preserve the user's permissions and review worker evidence before reporting success.";
  return [{role:"system",content},...messages];
}

function zcodeEffort(profile, effort) {
  if (!profile || effort === undefined) return profile;
  const levels = profile.model === 'fable' ? ['medium', 'high', 'max'] : profile.model === 'gpt-6-astra' ? ['high', 'xhigh'] : [];
  if (!levels.length) return profile;
  if (!levels.includes(effort)) throw Error('Unsupported reasoning effort');
  return { ...profile, effort };
}
