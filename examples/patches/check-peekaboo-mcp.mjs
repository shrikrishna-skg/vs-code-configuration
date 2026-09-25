#!/usr/bin/env node
// Guards the Peekaboo MCP entries the Kilo leads and the VS Code chat tabs use to
// screenshot and drive VS Code.
// Usage: node check-peekaboo-mcp.mjs [kilo.jsonc] [--live]
//          [--vscode mcp.json] [--claude .claude.json] [--claude-settings settings.json] [--codex config.toml]
//   default kilo file: ~/.config/kilo/kilo.jsonc (required)
//   other files default to the live paths under $HOME; a missing default is skipped with a
//   log line, a missing file passed explicitly fails.
//   --live also starts the Kilo server and asserts tools/list has see, image, click, and
//   asserts the Claude bridge at 127.0.0.1:32123 lists the four Fable/Opus models and the five
//   Codex Local CLI models (listed only while a signed-in Codex CLI is installed), and the
//   OpenRouter speed proxy at 127.0.0.1:32126 is healthy.
// Why --no-remote: without it every session in a second VS Code window fails to start
// Peekaboo ("ScreenCaptureKit owner PID ... does not serve selected socket").
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"

const home = homedir()
const args = process.argv.slice(2)
const live = args.includes("--live")
const flags = {}
const positional = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--live") continue
  if (args[i].startsWith("--")) flags[args[i].slice(2)] = args[++i]
  else positional.push(args[i])
}
const file = positional[0] ?? `${home}/.config/kilo/kilo.jsonc`

// Drop // and /* */ comments outside JSON strings (URLs contain "//").
function stripComments(text) {
  let out = "", string = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (string) {
      out += c
      if (c === "\\") out += text[++i]
      else if (c === "\"") string = false
    } else if (c === "\"") { string = true; out += c }
    else if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n" }
    else if (c === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i + 2) + 1; if (i === 0) break }
    else out += c
  }
  return out
}
const readJson = (path) => JSON.parse(stripComments(readFileSync(path, "utf8")))

// command = [executable, ...args] as the client will spawn it.
function checkCommand(where, command) {
  assert.ok(Array.isArray(command), `${where}: Peekaboo command must be an array`)
  const serve = command.indexOf("serve")
  assert.ok(serve > 0 && command[serve - 1] === "mcp", `${where}: Peekaboo must run "mcp serve"`)
  assert.ok(command.indexOf("--no-remote") > serve, `${where}: Peekaboo needs --no-remote after "mcp serve" (runtime flags follow the leaf command)`)
  assert.equal(command[command.indexOf("--transport") + 1], "stdio", `${where}: Peekaboo must use --transport stdio`)
}

const config = readJson(file)
const mcp = config.mcp ?? {}
// Kilo applies the last matching permission rule; a final "deny" removes the tool.
const rule = (tool) => Object.entries(config.permission ?? {})
  .findLast(([key]) => new RegExp(`^${key.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(tool))?.[1]
assert.notEqual(rule("Peekaboo_see"), "deny", `${file}: Peekaboo tools are denied`)
assert.equal(rule("Peekaboo_browser"), "deny", `${file}: Peekaboo_browser (Chrome DevTools) must stay denied`)
const entry = mcp.Peekaboo
assert.ok(entry, `${file}: no mcp.Peekaboo entry`)
assert.notEqual(entry.enabled, false, `${file}: mcp.Peekaboo is disabled`)
const command = entry.command
checkCommand(`${file}: mcp.Peekaboo`, command)
console.log(`Peekaboo MCP config OK: ${file}`)

// Optional configs: run check(path) when the file exists or was passed explicitly.
function optional(flag, fallback, check) {
  const path = flags[flag] ?? fallback
  if (!flags[flag] && !existsSync(path)) return console.log(`skip ${flag}: ${path} not found`)
  check(path)
  console.log(`Peekaboo MCP config OK: ${path}`)
}

// VS Code Chat. mcp.json has no per-server tool filter; browser is left out in agent tools lists.
optional("vscode", `${home}/Library/Application Support/Code/User/mcp.json`, (path) => {
  const servers = readJson(path).servers ?? {}
  const peekaboo = servers.peekaboo
  assert.ok(peekaboo, `${path}: no servers.peekaboo entry`)
  assert.equal(peekaboo.type ?? "stdio", "stdio", `${path}: servers.peekaboo must be stdio`)
  checkCommand(`${path}: servers.peekaboo`, [peekaboo.command, ...(peekaboo.args ?? [])])
  const bridge = servers["claude-code-local"]
  assert.ok(bridge?.command && bridge.args?.some((arg) => arg.endsWith("claude-cli-mcp.mjs")), `${path}: servers["claude-code-local"] must run claude-cli-mcp.mjs`)
})

// Claude Code tab.
optional("claude", `${home}/.claude.json`, (path) => {
  const peekaboo = readJson(path).mcpServers?.peekaboo
  assert.ok(peekaboo, `${path}: no mcpServers.peekaboo entry`)
  checkCommand(`${path}: mcpServers.peekaboo`, [peekaboo.command, ...(peekaboo.args ?? [])])
})
optional("claude-settings", `${home}/.claude/settings.json`, (path) => {
  assert.ok(readJson(path).permissions?.deny?.includes("mcp__peekaboo__browser"), `${path}: permissions.deny must include mcp__peekaboo__browser`)
})

// Codex tab.
// ponytail: line-based TOML read of one table with single-line arrays of plain strings;
// switch to a real TOML parser if the entry ever uses multi-line arrays or literal strings.
optional("codex", `${home}/.codex/config.toml`, (path) => {
  const text = readFileSync(path, "utf8")
  const table = text.split(/^\[mcp_servers\.peekaboo\][ \t]*$/m)[1]?.split(/^\[/m)[0]
  assert.ok(table, `${path}: no [mcp_servers.peekaboo] table`)
  const value = (key) => table.match(new RegExp(`^${key}\\s*=\\s*(.+?)\\s*$`, "m"))?.[1]
  assert.notEqual(value("enabled"), "false", `${path}: mcp_servers.peekaboo is disabled`)
  checkCommand(`${path}: mcp_servers.peekaboo`, [JSON.parse(value("command") ?? "null"), ...JSON.parse(value("args") ?? "[]")])
  assert.ok(JSON.parse(value("disabled_tools") ?? "[]").includes("browser"), `${path}: mcp_servers.peekaboo.disabled_tools must include "browser"`)
})

if (live) {
  const names = await new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "inherit"] })
    const timer = setTimeout(() => { child.kill(); console.error("Peekaboo MCP did not answer tools/list within 30s"); process.exit(1) }, 30000)
    let buffer = ""
    child.stdout.on("data", (chunk) => {
      buffer += chunk
      for (const line of buffer.split("\n").slice(0, -1)) {
        const reply = JSON.parse(line)
        if (reply.id !== 2) continue
        clearTimeout(timer)
        child.kill()
        resolve((reply.result?.tools ?? []).map((tool) => tool.name))
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n") + 1)
    })
    child.on("error", (error) => { console.error(`Could not start Peekaboo: ${error.message}`); process.exit(1) })
    child.stdin.write([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check-peekaboo-mcp", version: "1" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ].map((message) => JSON.stringify(message)).join("\n") + "\n")
  })
  for (const name of ["see", "image", "click"]) assert.ok(names.includes(name), `Peekaboo MCP is missing the ${name} tool: ${names.join(", ")}`)
  console.log(`Peekaboo MCP live check passed: ${names.length} tools`)

  const url = "http://127.0.0.1:32123/v1/models"
  const models = await fetch(url, { signal: AbortSignal.timeout(10000) }).then((res) => res.json())
    .catch((error) => assert.fail(`Claude bridge ${url} is not answering: ${error.message}`))
  const ids = (models.data ?? []).map((model) => model.id)
  for (const id of ["fable-5-1-high", "fable-5-1-max", "opus-5-5-fast", "opus-5-5-high",
    "codex-gpt-6-astra-high", "codex-gpt-6-astra-xhigh", "codex-gpt-6-sol-high", "codex-gpt-6-luna-medium", "codex-gpt-5.6-sol-high", "codex-gpt-5.6-terra-high", "codex-gpt-5.6-luna-medium"])
    assert.ok(ids.includes(id), `Claude bridge ${url} is missing ${id}: ${ids.join(", ")}`)
  console.log(`Claude bridge live check passed: ${ids.length} models`)

  const proxy = "http://127.0.0.1:32126/health"
  const health = await fetch(proxy, { signal: AbortSignal.timeout(10000) }).then((res) => res.json())
    .catch((error) => assert.fail(`OpenRouter speed proxy ${proxy} is not answering: ${error.message}`))
  assert.equal(health.status, "ok", `OpenRouter speed proxy ${proxy}: ${JSON.stringify(health)}`)
  console.log("OpenRouter speed proxy live check passed")
}
