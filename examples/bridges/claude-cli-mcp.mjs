#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const EXTENSIONS = path.join(os.homedir(), ".vscode/extensions");
// Newest installed Claude Code extension CLI; claude-opus-5-5 needs 2.1.280 or newer.
const CLAUDE = process.env.KILO_CLAUDE_BIN || path.join(EXTENSIONS, readdirSync(EXTENSIONS)
  .filter((name) => name.startsWith("anthropic.claude-code-"))
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] || "", "resources/native-binary/claude");
const ALLOWED_TOOLS = "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Agent,Skill";

const profiles = {
  opus_5_5_fast: {
    title: "Opus 5.5 Fast",
    model: "claude-opus-5-5",
    effort: "low",
    description: "Run a complete coding task through the authenticated local Claude CLI using Opus 5.5 with low-latency reasoning."
  },
  opus_5_5_high: {
    title: "Opus 5.5 High",
    model: "claude-opus-5-5",
    effort: "high",
    description: "Run a complete coding task through the authenticated local Claude CLI using Opus 5.5 with high reasoning effort."
  },
  fable_5_1_high: {
    title: "Fable 5.1 High",
    model: "fable",
    effort: "high",
    description: "Run a complete coding task through the authenticated local Claude CLI using Fable 5.1 with high reasoning effort."
  },
  fable_5_1_max: {
    title: "Fable 5.1 Max",
    model: "fable",
    effort: "max",
    description: "Run a complete coding task through the authenticated local Claude CLI using Fable 5.1 with maximum reasoning effort."
  }
};

const activeCalls = new Map();
let input = "";

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function fail(id, code, message, data) {
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) }
  })}\n`);
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
      `--allowedTools=${ALLOWED_TOOLS}`
    ];
    const child = spawn(CLAUDE, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    activeCalls.set(requestId, child);
    let stdout = "";
    let stderr = "";

    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") reject(error);
    });
    child.stdin.end(prompt);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      activeCalls.delete(requestId);
      if (signal) {
        reject(new Error(`Claude CLI was stopped by ${signal}`));
        return;
      }
      let payload;
      try {
        payload = JSON.parse(stdout);
      } catch {
        reject(new Error(stderr.trim() || stdout.trim() || `Claude CLI exited with code ${code}`));
        return;
      }
      if (code !== 0 || payload.is_error) {
        reject(new Error(payload.result || stderr.trim() || `Claude CLI exited with code ${code}`));
        return;
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
        prompt: {
          type: "string",
          description: "The complete task, including relevant context, requirements, and verification expectations."
        },
        working_directory: {
          type: "string",
          description: "Absolute workspace directory in which Claude should perform the task. Defaults to the MCP server's current directory."
        }
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
  if (message.method === "ping") {
    reply(message.id, {});
    return;
  }
  if (message.method === "tools/list") {
    reply(message.id, { tools: toolDefinitions() });
    return;
  }
  if (message.method === "tools/call") {
    const profile = profiles[message.params?.name];
    const prompt = message.params?.arguments?.prompt;
    if (!profile) {
      fail(message.id, -32602, `Unknown tool: ${message.params?.name || "(missing)"}`);
      return;
    }
    if (typeof prompt !== "string" || !prompt.trim()) {
      fail(message.id, -32602, "A non-empty prompt is required.");
      return;
    }
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
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    void handle(message);
  }
});

function shutdown() {
  for (const child of activeCalls.values()) child.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
