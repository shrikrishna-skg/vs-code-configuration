# Local Claude CLI bridge

## Purpose

The bridge exposes four complete-task profiles from an authenticated local Claude CLI to Kilo Code through MCP: Fable High, Fable Max, Opus Fast, and Opus High.

In this setup, the visible Fable Engineering Lead uses Fable High through this bridge for every request. Astra uses the bridge only for justified Opus escalation, and the remaining profile agents provide optional standalone routes.

```mermaid
sequenceDiagram
    participant K as Kilo lead/profile
    participant M as Local MCP bridge
    participant C as Claude CLI
    participant W as Workspace
    K->>M: tool call(prompt, working_directory)
    M->>M: validate profile and directory
    M->>C: launch non-interactive CLI process
    C->>W: inspect/edit with allowed tools
    C-->>M: structured JSON result
    M-->>K: text result + model usage
    K->>W: inspect diff and verify
```

## Configuration

The sample `kilo.jsonc` starts Node with two arguments: the bridge file and the absolute Claude executable path. Absolute paths are intentional because GUI applications often receive a reduced `PATH`.

The bridge:

- Accepts only declared profile names.
- Requires a non-empty prompt.
- Resolves and validates the working directory.
- Uses non-interactive JSON output.
- Stops active child processes when the MCP server shuts down.
- Returns bridge errors instead of silently changing models.

## Tool-mode overhead

A tool-mode step (Kilo owns the tools, the CLI only picks the next decision) replaces the full Claude Code harness prompt with the compact lead prompt in `examples/bridges/fable-lead-system.md`, copied live to `~/.config/kilo/bridges/fable-lead-system.md`, and describes the Kilo tool catalog only once per CLI session: later steps on the same session send a catalog marker. An invalid decision (for example `tool_call` with no calls) gets one corrective retry in the same CLI session (`decision_retry` event), which resends the full schemas if that step only sent the marker; a second invalid decision fails as before. Those runs also carry `CLAUDE_BRIDGE_TOOL_MODE=1` so workspace Stop hooks skip them. Conversation mode (Opus escalation, where the CLI runs tools itself) keeps the default harness prompt.

A resumed step sends only the messages the CLI has not seen plus any earlier message Kilo rewrote in place (compacted tool outputs, regrown system `<env>` block), instead of replaying the transcript whenever one old message stops matching. Sessions are matched on the conversation's second message hash and the longest common prefix, and persist to `~/.local/state/kilo/claude-cli-provider-state.json` across bridge restarts.

Final answers use `--output-format stream-json --verbose --include-partial-messages` so text arrives as deltas; tool-call steps keep plain JSON output and stay atomic. The live bridge is mirrored at `examples/bridges/claude-cli-provider.mjs`; `node claude-cli-provider.mjs --self-test` covers the prompt, catalog, session-delta and streaming-argument rules, plus the Codex arguments, event parsing, limits and environment against a stub CLI.

## Codex backend

Model ids starting with `codex-` (`codex-gpt-6-astra-high`, `-xhigh`, `codex-gpt-6-sol-high`, `codex-gpt-6-luna-medium`, `codex-gpt-5.6-sol-high`, `-terra-high`, `-luna-medium`) run through the Codex CLI from the ChatGPT VS Code extension instead of the Claude CLI. The binary is resolved per request under `~/.vscode/extensions/openai.chatgpt-*/bin/*/codex` (override: `CODEX_BRIDGE_BINARY`) and must report `Logged in using ChatGPT`; otherwise the request fails with `codex_unavailable` and `/v1/models` hides the Codex ids. The bridge never reads `~/.codex/auth.json`, and strips every `OPENAI_*` and `CODEX_*` variable so only the ChatGPT plan is used.

- **Invocation:** `codex exec --json --ignore-user-config` with a read-only sandbox, the profile's model and reasoning effort, and images passed with `--image`. Sessions resume by Codex thread id.
- **Tool mode:** Codex's own tools (shell, exec, multi-agent, apps, plugins, browser, computer use, image tools, web search) are disabled; decisions come back through `--output-schema` with `arguments_json` strings, since OpenAI strict schemas forbid free-form objects. Output arrives whole, not as deltas.
- **Slots and sessions:** a separate pool of `CODEX_BRIDGE_CONCURRENCY` slots (default 3, max 8) beside `CLAUDE_BRIDGE_CONCURRENCY`, and 128 kept sessions per backend, so neither backend starves or evicts the other.
- **Limits:** ChatGPT plan messages (`usage limit`, `out of credits`, `spend cap`, `try again at 3:04 PM`) become a readable 429 until the reset time Codex printed. Unlike the Claude limit, this is kept in memory only. `/health` reports Codex slots and `limitedUntil` under `codex`.

`CLAUDE_BRIDGE_PORT` (default `32123`) and `CLAUDE_BRIDGE_STATE_FILE` override the listen port and session state file for either backend, for example to run a second bridge for testing.

## Operational boundary

The local CLI process does not join Kilo's native shared-agent board. The Kilo-side engineering lead/controller therefore remains responsible for inspecting the workspace diff and running a focused independent check before accepting it.

## Updating after an extension change

If the Claude executable comes from a versioned VS Code extension directory, an extension update can change its path. Update the final command argument in `kilo.jsonc`, restart VS Code, and repeat the bridge smoke check.
