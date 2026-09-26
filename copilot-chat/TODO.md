# VS Code Chat (Copilot) parity with the Kilo setup

Goal: give VS Code's built-in Chat view (Chat, Claude Code and Codex tabs) the same capabilities as the Kilo Code setup: screen automation, the lead/worker agent hierarchy, the Fable and Opus local-CLI models, the shared coding policy and reply style, and guards that keep it working after updates. Do not change the working Kilo setup while doing this.

The files were later gathered into this `copilot-chat/` folder; paths below use the new locations.

Baseline (2026-09-23): VS Code 1.138.0 with bundled Copilot Chat. No user `mcp.json`, no custom models (`chatLanguageModels.json` is `[]`), no custom agents or instruction files. The Claude Code tab's Peekaboo entry in `~/.claude.json` lacks `--no-remote`. The Codex tab has no Peekaboo.

## Confirmed field names (Phase 0, 2026-09-23)

Checked against the installed VS Code 1.139.0 (`out/vs/workbench/workbench.desktop.main.js`) and bundled Copilot Chat 0.67.0 (`extensions/copilot/dist/extension.js`, `package.json`). The baseline below said 1.138.0; VS Code had updated by implementation time.

- **mcp.json:** `~/Library/Application Support/Code/User/mcp.json`. Top-level keys are `servers`, `inputs` and `sandbox`. A stdio server allows `type`, `command`, `args`, `env`, `envFile`, `cwd`, `dev` and `sandboxEnabled`. **There is no per-tool filter.**
- **Custom agents:** `*.agent.md` in `User/prompts/` (`promptsHome`). VS Code also loads, by default, `~/.copilot/agents`, `~/.claude/agents`, and the workspace `.github/agents` and `.claude/agents`. `chat.agentFilesLocations` is deprecated but still turns a default off with `false`.
- **Agent frontmatter keys:** `name`, `description`, `model`, `reasoning-effort` (low, medium, high, xhigh, max), `tools`, `advancedOptions`, `handoffs`, `argument-hint`, `target`, `infer` (deprecated), `agents` (the subagent allow-list), `hooks`, `user-invocable` (shown in the picker), `disable-model-invocation` (blocks use as a subagent) and `github`.
- **`model`:** a string or a list, where the first available model wins. The format is `Name (vendor)`; a bare name matches only Copilot's own (`copilot`) models. Vendor IDs are `customendpoint`, `openrouter`, `openai`, `anthropic` and `copilot`.
- **Tools:** references use `toolset/tool`. Built-in sets are `read`, `search`, `edit`, `execute`, `web`, `todo`, `agent` and `vscode`. The subagent tool is `agent/runSubagent`. MCP tools are `<server>/<tool>`, for example `peekaboo/see`.
- **Instructions:**
  - `*.instructions.md` with `applyTo: "**"` is always attached.
  - `chat.instructionsFilesLocations` is deprecated and rejects absolute paths.
  - `chat.useAgentsMdFile` reads `AGENTS.md` in workspace roots only.
  - `github.copilot.chat.codeGeneration.useInstructionFiles` (default on) reads `~/.copilot/copilot-instructions.md`.
  - `chat.useClaudeMdFile` (default on) reads `~/.claude/CLAUDE.md`.
- **Subagents:** `chat.subagents.allowInvocationsFromSubagents` defaults to off, and nesting is capped at depth 5. There is no per-agent step limit, only the global `chat.agent.maxRequests`.
- **Approvals:**
  - `chat.tools.global.autoApprove`.
  - `chat.tools.edits.autoApprove`, a glob map whose default approves most files.
  - `chat.tools.terminal.autoApprove`, where a command or `/regex/` maps to `true` or `false`.
  - **No settings key** approves one MCP tool (only the UI "Always allow" does) or disables one MCP tool globally.
- **Custom Endpoint models:** stored in `User/chatLanguageModels.json` as groups `{name, vendor, models[]}`. Each model needs `id`, `name`, `url`, `toolCalling`, `vision` and `maxOutputTokens`; optional fields include `apiType` (chat-completions, responses or messages), `thinking`, `editTools` and `contextWindow`. An API key is optional; secrets are stored as `${input:...}` references in secret storage.
- **Codex:** `[mcp_servers.<name>]` supports `enabled_tools` and `disabled_tools`.

## Kilo to VS Code Chat mapping

| Kilo piece | VS Code Chat equivalent | Phase |
|---|---|---|
| `mcp.Peekaboo` with `--no-remote` | User `mcp.json` server `peekaboo` | 1 |
| `permission`: `Peekaboo_*` allow, `Peekaboo_browser` deny | Per-agent `tools:` lists that omit `browser`; tool picker | 1, 4 |
| `mcp["Claude Code Local"]` (Opus escalation bridge) | User `mcp.json` server `claude-code-local` | 1 |
| `instructions`: Ponytail `AGENTS.md`, `chat-response-style.md` | Instruction files and `chat.instructionsFilesLocations` | 2 |
| `claude-local-cli` provider (bridge on `127.0.0.1:32123/v1`) | "Custom Endpoint" model provider | 3 |
| `openai/*` (Astra, Sol, Luna), `deepseek/*`, `openrouter/z-ai/*` | Copilot-provided models, OpenAI / OpenRouter BYOK, or the Codex router | 3 |
| Agent Markdown in `~/.config/kilo/agent/` | `.agent.md` custom agents in the user `prompts/` folder | 4 |
| `task` permissions (which lead may call which worker) | Subagent allow-list in agent frontmatter | 4 |
| Kilo patches (per-agent model, last agent, Jev order) | Native `model:` in agent frontmatter; picker memory | 4 (verify only) |
| `kilo-code.new.autoApprove.enabled` | `chat.tools.*.autoApprove` and terminal auto-approve rules | 5 |
| `check-peekaboo-mcp.mjs` + `ai.kilo.reapply-patches` LaunchAgent | Same guard extended to VS Code, Claude Code and Codex configs | 6 |

## Phase 0: confirm what VS Code 1.138 supports

- [ ] Check that the Copilot plan allows bring-your-own-key models. Open Chat > model picker > Manage Models and confirm "Custom Endpoint", "OpenAI" and "OpenRouter" are offered. An org policy can hide them. **User step:** the providers exist in the bundled `package.json`, but the plan or org policy can only be checked in the UI.
- [x] Confirm the user-level MCP file location: Command Palette > "MCP: Open User Configuration". Expected: `~/Library/Application Support/Code/User/mcp.json`.
- [x] Confirm the custom agent format: Command Palette > "Chat: New Custom Agent" and inspect the generated `.agent.md` frontmatter (`description`, `tools`, `model`, `handoffs`, and the subagent allow-list field name).
- [x] Confirm the subagent tool name and how an agent restricts which subagents it may call.
- [x] Confirm the instruction settings: `chat.instructionsFilesLocations`, `chat.useAgentsMdFile`, and whether user-level instruction files load in every workspace.
- [x] Record every confirmed field name at the top of this file before Phase 1. Stop and revise the plan if a capability is missing.

Acceptance: each capability in the mapping table is confirmed or marked as unavailable with a fallback.

## Phase 1: screen automation and MCP servers (all three tabs)

VS Code Chat tab:
- [x] Create the user `mcp.json` with a `peekaboo` stdio server: `~/.local/node/bin/peekaboo mcp serve --no-remote --transport stdio`. Keep `--no-remote` right after `serve`.
- [x] Add `claude-code-local`: `node ~/.config/kilo/bridges/claude-cli-mcp.mjs` with the same absolute paths as `kilo.jsonc`.
- [ ] Start both from the MCP view. Confirm they are Running and that Peekaboo lists 26 tools. **User step.** Scripted stdio `tools/list` with the exact configured commands returned 26 Peekaboo tools and 4 claude-code-local tools.
- [ ] Turn off Peekaboo's `browser` tool in the Chat tool picker. It needs a Chrome DevTools HTTP endpoint that `chrome://inspect` debugging does not provide. **Custom agents:** `browser` is already left out of their `tools:` lists. **User step:** untick it in the default Agent mode picker.
- [ ] Ask Chat to screenshot the VS Code window with Peekaboo `see` (`app_target: "Code"`) and describe the page. Then click one element and type into one field. **User step:** the lead's shell has no Screen Recording permission.

Claude Code tab:
- [x] Back up `~/.claude.json`, then add `--no-remote` after `serve` in `mcpServers.peekaboo.args`.
- [x] Deny the browser tool: add `mcp__peekaboo__browser` to `permissions.deny` in `~/.claude/settings.json`.
- [ ] Start a new Claude Code session. Confirm `peekaboo` connects (no `CONNECTION_CLOSED`) and one `see` capture works. **User step.**

Codex tab:
- [x] Back up `~/.codex/config.toml`, then add `[mcp_servers.peekaboo]` with the same command and args.
- [x] Exclude the browser tool if Codex supports per-tool filtering; otherwise add a line to `~/.codex/AGENTS.md` telling it not to use `browser`.
- [ ] Start a new Codex session and run one `see` capture. **User step.**

Acceptance: a screenshot plus one click and one typed field succeed from each of the three tabs. Two VS Code windows can each start Peekaboo at once.

## Phase 2: shared rules (coding policy and reply style)

- [x] Decide whether the Ponytail policy loads from `~/.config/ponytail/AGENTS.md` directly (preferred: one source of truth) or through a user instruction file that points to it.
- [x] Add `~/.config/ponytail/AGENTS.md` and `~/.config/kilo/chat-response-style.md` to `chat.instructionsFilesLocations`, or create one user `.instructions.md` with `applyTo: "**"` that includes both.
- [x] Check `~/.copilot/copilot-instructions.md`: confirm whether VS Code Chat reads it or only the Copilot CLI does. Avoid loading the policy twice.
- [x] Add the UI verification rule from the Kilo leads: use Peekaboo on the existing signed-in window before headless Playwright, and never report a login blocker without trying it.
- [ ] Test: in a fresh chat, ask a small coding question. Confirm the reply uses the Answer / My opinion / Next step format and follows Ponytail. **User step.**

Acceptance: both rule sets apply in every workspace, loaded once.

## Phase 3: models

Fable and Opus through the local bridge:
- [x] Confirm `ai.kilo.claude-local-cli-provider` is running: `curl http://127.0.0.1:32123/v1/models`.
- [ ] Add a Custom Endpoint provider in Manage Models: base URL `http://127.0.0.1:32123/v1`, models `fable-5-1-high`, `fable-5-1-max`, `opus-5-5-fast`, `opus-5-5-high`. Enable tool calling, image input and reasoning where the form allows. Enter an API key only if the form requires one; the bridge ignores it. **Done in files:** `chatLanguageModels.json` now holds the four models, with no key. User step: reload and enable them.
- [x] Bridge compatibility review (`examples/bridges/claude-cli-provider.mjs`):
  - [x] Tool-mode prompt text says "Kilo Code request"; make it client-neutral or detect the client.
  - [x] Kilo-specific assumptions (`family: gpt-apply-patch`, the Kilo tool catalog wording, session anchoring) must not break VS Code's tool names such as `read_file`, `replace_string_in_file` and `run_in_terminal`.
  - [x] Check that VS Code tool-result images (Peekaboo screenshots) reach Claude the way Kilo's do, and extend `--self-test` for that shape.
  - [x] Keep one bridge process for both clients; confirm concurrent Kilo and VS Code requests don't share a CLI session.
- [ ] Test each model: a plain question, one file read, one edit and one Peekaboo screenshot. **Partial:** the scripted bridge requests to opus-5-5-fast returned `read_file` tool calls, both streaming and non-streaming. In-VS Code tests are a user step.

Other models:
- [x] Astra, Sol and Luna (Kilo `openai/*`): decide between Copilot-provided OpenAI models, OpenAI BYOK, or the Codex router (`127.0.0.1:43128`, Responses API with ChatGPT sign-in). Check whether Custom Endpoint accepts a Responses API endpoint.
- [ ] DeepSeek Flash and GLM 5.3 Flash: add through the OpenRouter provider. You enter the API key in the VS Code form yourself; never paste keys into chat or files. **User step:** the key goes in the VS Code form. The agents expect `DeepSeek: DeepSeek V4.1 Flash (openrouter)` and `Z.ai: GLM 5.3 Flash (openrouter)`.
- [x] Set reasoning effort per model where VS Code exposes it (Kilo uses `high` for DeepSeek subagents and the Fable leads).

Acceptance: every model the Kilo agents use appears in the picker and completes a tool-calling request.

## Phase 4: custom agents

Create one `.agent.md` per Kilo agent in the user `prompts/` folder. Port the body text, replace Kilo tool and agent names with VS Code equivalents, and give each agent an explicit `tools:` list without Peekaboo's `browser`.

Primary leads:
- [x] Astra Engineering Lead (Astra model).
- [x] Astra + Jev Engineering Lead.
- [x] Fable Engineering Lead (Fable 5.1 High via Custom Endpoint).
- [x] Fable + Jev Engineering Lead.
- [x] Opus + Jev Engineering Lead (Opus 5.5 High via Custom Endpoint; no Opus escalation tool).

Workers (subagent-only; hide them from the picker if VS Code allows):
- [x] DeepSeek Implementer: edit and terminal tools; no subagents.
- [x] DeepSeek Workstream Lead: may call only DeepSeek Implementer, GLM Investigator and Luna Utility.
- [x] GLM Investigator: read-only. Search/read tools only; terminal limited to `git status/diff/log/show`, `rg`, `grep`, `find`, `ls`, `sed`, `head`, `tail`; no edit tools.
- [x] Luna Utility: small edit set; no subagents.

Standalone profiles (optional, one agent each):
- [x] Fable 5.1 High, Fable 5.1 Max, Opus 5.5 Fast, Opus 5.5 High, Killer Code (Sol Fast), Low Effort (Luna Fast), Secondary (DeepSeek Flash), Tertiary (GLM Flash).

Delegation rules:
- [x] Map each lead's Kilo `task` allow-list to its subagent allow-list. Leads may call the four workers; nothing may call another lead.
- [x] Keep the Opus escalation tool (`claude-code-local`) available to the leads only (not Opus + Jev).
- [x] Carry over step limits where VS Code supports them (leads 50, DeepSeek 45, GLM 14, Luna 8); otherwise note them in the agent body.
- [x] Jev: TypeSafe re-enabled in Kilo and added to VS Code `mcp.json` for the two Jev leads only (2026-09-23).
- [ ] Test: ask the Fable lead for a two-file change and confirm it delegates to DeepSeek Implementer, inspects the diff and runs a check. **User step.**

Acceptance: all four leads appear in the agent picker on their own models, workers are callable only as subagents, and GLM cannot edit files.

## Phase 5: approvals and safety

- [x] Decide whether Chat should auto-approve tools the way Kilo does (`autoApprove.enabled: true`). Recommended: auto-approve read-only tools and Peekaboo capture; keep edits and terminal on approval, or allow-list only the terminal commands the workers need.
- [x] Configure terminal auto-approve rules to match the GLM read-only command list.
- [x] Confirm no API keys or tokens end up in `mcp.json`, agent files or this repository.

## Phase 6: guards so it keeps working

- [x] Extend `examples/patches/check-peekaboo-mcp.mjs` to also check: VS Code `mcp.json` (`--no-remote` present), `~/.claude.json` (`--no-remote` present), `~/.claude/settings.json` (browser tool denied), `~/.codex/config.toml` (server present).
- [x] Run that check from `scripts/reapply-kilo-patches.sh`, or a VS Code-focused LaunchAgent, when the VS Code, Claude Code or Codex extensions update. Notify on failure.
- [x] Add a live check that `http://127.0.0.1:32123/v1/models` lists the four Claude models.
- [x] Add the new checks to `scripts/verify.sh` using sanitized examples.
- [x] Package everything into `copilot-chat/` with `scripts/install.sh` (idempotent, `--dry-run`, backups) and its check `scripts/test-install.sh`.

## Phase 7: repository and docs

- [x] Add sanitized examples: `copilot-chat/config/mcp.json`, `copilot-chat/config/prompts/*.agent.md`, and the instruction file.
- [x] Add `copilot-chat/README.md` (setup steps, model setup, permissions) and link it from the root `README.md`.
- [x] Update `docs/configuration-inventory.md` with the new files and the observed VS Code and Copilot versions.
- [x] Run `bash scripts/verify.sh`.
- [ ] Commit on a branch; open a PR only when you ask for one. **Not done:** the brief said not to commit.

## Results (2026-09-23)

Implemented by the Opus delivery lead with three workers: MCP and guards; agents, instructions and approvals; bridge and models. Nothing is committed. Every live file was backed up with the suffix `.bak-20260923-copilot`. The setup guide is [README.md](README.md).

Verified:

- **Repository checks:** `bash scripts/verify.sh` passes. It now also runs the extended Peekaboo guard on the sanitized examples, parses `chatLanguageModels.json`, and runs `copilot-chat/scripts/check-copilot-agents.mjs`.
- **Live configs and Kilo:** `node ~/.config/kilo/patches/check-peekaboo-mcp.mjs --live` passes for Kilo, VS Code `mcp.json`, `~/.claude.json`, `~/.claude/settings.json` and `~/.codex/config.toml`. It saw 26 Peekaboo tools and 4 bridge models.
- **Bridge:** `--self-test` passes on the repo and live copies. The bridge was restarted once while idle. `/v1/models` lists the four models. VS Code-style requests to `opus-5-5-fast` returned `read_file` tool calls, both streaming and non-streaming.
- **MCP servers:** stdio `tools/list` with each configured command returned the expected tools:
  - VS Code peekaboo: 26, and 26 again with two instances running at once.
  - claude-code-local: 4.
  - `~/.claude.json` peekaboo: 26.
  - Codex peekaboo: 26, and `codex mcp get` shows `disabled_tools: ["browser"]`.
- **Live and repo copies:** the bridges, guard, reapply script, `chatLanguageModels.json`, and all 16 agents are identical (the hidden alias was later removed as unreachable) in both places. Since then the live `chatLanguageModels.json` also holds the OpenRouter group added in the UI; the "Claude Local CLI" group still matches.

Remaining open items are the user steps in [README.md](README.md#user-steps) and the Final acceptance list below.

## Final acceptance (you)

- [ ] Reload every VS Code window.
- [ ] In each tab (Chat, Claude Code, Codex), capture and operate the signed-in Campaign page in VS Code's browser.
- [ ] In Chat, run the Fable lead on a small real task and confirm the model, delegation, reply format and verification evidence.
- [ ] Confirm Kilo still works unchanged.

## Risks

- BYOK or Custom Endpoint may be disabled by the Copilot plan or org policy. That blocks Phase 3 Fable/Opus in the Chat tab; the Claude Code tab still gives Fable and Opus.
- The bridge was built for Kilo's request shape. VS Code may send different tool schemas or image placement; Phase 3 tests must pass before the Fable agents are relied on.
- VS Code agent frontmatter fields change between releases; re-run the Phase 0 checks after major VS Code updates.
