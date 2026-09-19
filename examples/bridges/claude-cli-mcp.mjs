#!/usr/bin/env node

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

const CLAUDE = process.argv[2];
const ALLOWED_TOOLS = "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Agent,Skill";

if (!CLAUDE) {
  process.stderr.write("Usage: node claude-cli-mcp.mjs /absolute/path/to/claude\n");
  process.exit(2);
}

const profiles = {
  opus_5_fast: {
    title: "Opus 5 Fast",
    model: "opus",
    effort: "low",
    description: "Run a complete coding task through the local Claude CLI using Opus with low-latency reasoning."
  },
  opus_5_high: {
    title: "Opus 5 High",
    model: "opus",
    effort: "high",
    description: "Run a complete coding task through the local Claude CLI using Opus with high reasoning effort."
  },
  fable_5_1_high: {
    title: "Fable 5.1 High",
    model: "fable",
    effort: "high",
    description: "Run a complete coding task through the local Claude CLI using Fable with high reasoning effort."
  },
  fable_5_1_max: {
    title: "Fable 5.1 Max",
    model: "fable",
    effort: "max",
    description: "Run a complete coding task through the local Claude CLI using Fable with maximum reasoning effort."
  }
};

const activeCalls = new Map();
let input = "";

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function fail(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

async function validDirectory(requested) {
  const candidate = path.resolve(requested || process.cwd());
  const info = await stat(candidate);
  if (!info.isDirectory()) throw new Error(`Not a directory: ${candidate}`);
  return candidate;
}

function runClaude(requestId, profile, prompt, cwd) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--model", profile.model,
      "--effort", profile.effort,
      "--name", `Kilo - ${profile.title}`,
      "--output-format", "json",
      "--no-session-persistence",
      "--permission-mode", "acceptEdits",
      `--allowedTools=${ALLOWED_TOOLS}`,
      prompt
    ];
    const child = spawn(CLAUDE, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    activeCalls.set(requestId, child);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      activeCalls.delete(requestId);
      if (signal) return reject(new Error(`Claude CLI was stopped by ${signal}`));
      let payload;
      try {
        payload = JSON.parse(stdout);
      } catch {
        return reject(new Error(stderr.trim() || stdout.trim() || `Claude CLI exited with code ${code}`));
      }
      if (code !== 0 || payload.is_error) {
        return reject(new Error(payload.result || stderr.trim() || `Claude CLI exited with code ${code}`));
      }
      resolve({
        text: payload.result || "Claude completed the task without a text response.",
        sessionId: payload.session_id,
        modelUsage: payload.modelUsage
      });
    });
  });
}

function toolDefinitions() {
  return Object.entries(profiles).map(([name, profile]) => ({
    name,
    title: profile.title,
    description: profile.description,
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Complete task, context, constraints, and verification expectations." },
        working_directory: { type: "string", description: "Absolute workspace directory for the task." }
      },
      required: ["prompt"],
      additionalProperties: false
    }
  }));
}

async function handle(message) {
  if (message.method === "notifications/cancelled") {
    activeCalls.get(message.params?.requestId)?.kill("SIGTERM");
    return;
  }
  if (message.id === undefined) return;

  if (message.method === "initialize") {
    reply(message.id, {
      protocolVersion: message.params?.protocolVersion || "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "kilo-claude-cli-bridge", version: "1.0.0" }
    });
    return;
  }
  if (message.method === "ping") return reply(message.id, {});
  if (message.method === "tools/list") return reply(message.id, { tools: toolDefinitions() });

  if (message.method === "tools/call") {
    const profile = profiles[message.params?.name];
    const prompt = message.params?.arguments?.prompt;
    if (!profile) return fail(message.id, -32602, `Unknown tool: ${message.params?.name || "(missing)"}`);
    if (typeof prompt !== "string" || !prompt.trim()) return fail(message.id, -32602, "A non-empty prompt is required.");
    try {
      const cwd = await validDirectory(message.params.arguments.working_directory);
      const result = await runClaude(message.id, profile, prompt, cwd);
      reply(message.id, {
        content: [{ type: "text", text: result.text }],
        structuredContent: result,
        isError: false
      });
    } catch (error) {
      reply(message.id, {
        content: [{ type: "text", text: `Claude CLI bridge error: ${error.message}` }],
        isError: true
      });
    }
    return;
  }

  fail(message.id, -32601, `Method not found: ${message.method}`);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const line = input.slice(0, index).trim();
    input = input.slice(index + 1);
    if (!line) continue;
    try {
      void handle(JSON.parse(line));
    } catch {
      // Ignore malformed transport lines; valid MCP clients send JSON-RPC.
    }
  }
});

function shutdown() {
  for (const child of activeCalls.values()) child.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
