#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";

const bridgeFiles = [
  `${process.env.HOME}/.config/kilo/bridges/claude-cli-provider.mjs`,
  `${process.env.HOME}/.config/kilo/bridges/claude-cli-mcp.mjs`
];

for (const bridgeFile of bridgeFiles) {
  const source = fs.readFileSync(bridgeFile, "utf8");
  assert.doesNotMatch(source, /args\.push\(prompt\)|allowedTools=.*\n\s*prompt\s*\]/);
  assert.match(source, /stdio:\s*\["pipe",\s*"pipe",\s*"pipe"\]/);
  assert.match(source, /child\.stdin\.end\(prompt\)/);
}

const largePrompt = "x".repeat(2 * 1024 * 1024);
const receivedBytes = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["-e", "let n=0;process.stdin.on('data',c=>n+=c.length);process.stdin.on('end',()=>console.log(n))"], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolve(Number(stdout.trim())) : reject(new Error(stderr)));
  child.stdin.end(largePrompt);
});

assert.equal(receivedBytes, Buffer.byteLength(largePrompt));

console.log("Claude CLI prompts are transported over stdin in both bridges.");
