# VS Code Chat (Copilot) setup

This folder is the portable source of truth for VS Code's built-in Chat view. The view has three tabs: Chat (bundled Copilot Chat), Claude Code, and Codex. This setup gives them the same screen automation, models, agent hierarchy, rules and guards as the Kilo Code setup. Kilo keeps working unchanged.

Pull the repository on another Mac, run `copilot-chat/scripts/install.sh`, then finish the [user steps](#user-steps) in the VS Code UI.

Observed on 2026-09-23: VS Code 1.139.0, bundled Copilot Chat 0.67.0, Codex CLI 0.155.0-alpha.16.3. The plan and its results are in [TODO.md](TODO.md).

## Files

| Folder file | Live file | Purpose |
|---|---|---|
| `config/prompts/*.agent.md` | `~/Library/Application Support/Code/User/prompts/` | The Kilo agents as 16 custom agents |
| `config/prompts/reply-style.instructions.md` | same `prompts/` folder | Reply style and UI-verification rule |
| `config/mcp.json` | `~/Library/Application Support/Code/User/mcp.json` | `peekaboo` and `claude-code-local` MCP servers for the Chat tab (placeholders) |
| `config/chatLanguageModels.json` | `~/Library/Application Support/Code/User/chatLanguageModels.json` | Custom Endpoint group "Claude Local CLI" (four bridge models, no key) |
| `config/settings.jsonc` | `~/Library/Application Support/Code/User/settings.json` | Chat instruction, subagent, approval and sound-off keys only |
| `config/config.peekaboo.toml` | `~/.codex/config.toml` | Codex tab Peekaboo with `disabled_tools = ["browser"]` (placeholders) |
| `scripts/install.sh` | | Installs or merges the files above |
| `scripts/check-copilot-agents.mjs` | | Validates the agents; `--live` also compares the live `prompts/` folder |
| `scripts/test-install.sh` | | Checks `install.sh` in a scratch folder |

Two Claude Code tab items live outside this folder: `mcpServers.peekaboo` in `~/.claude.json` (account state, so no repository copy) and the `mcp__peekaboo__browser` deny in [`../claude-code/config/settings.json`](../claude-code/config/settings.json).

## Install

Prerequisites: Node.js, Peekaboo (`npm i -g @steipete/peekaboo`), and for Fable and Opus the local Claude CLI bridge from [`../docs/installation.md`](../docs/installation.md) (`~/.config/kilo/bridges/claude-cli-mcp.mjs` and `ai.kilo.claude-local-cli-provider`).

```bash
bash copilot-chat/scripts/install.sh --dry-run   # lists every change with a diff; writes nothing
bash copilot-chat/scripts/install.sh             # applies it
bash copilot-chat/scripts/install.sh --codex-snippet   # prints the Codex snippet with local paths
```

- **Idempotent:** a file is written only when its content changes, and the old file is first copied to `<file>.bak-<timestamp>`. A second run changes nothing.
- **Merges, never replaces:** `settings.json` gets only the keys in `config/settings.jsonc`; `mcp.json` gets only the two servers; `chatLanguageModels.json` gets only the "Claude Local CLI" group. Other settings, servers and model groups (such as your OpenRouter group) stay as they are.
- **Paths:** `<ABSOLUTE_PATH_TO_PEEKABOO>` and `<ABSOLUTE_PATH_TO_NODE>` come from `command -v`, the Kilo folder is `~/.config/kilo`, and `<HOME>` is `$HOME`. Override with `PEEKABOO_BIN`, `NODE_BIN`, `KILO_CONFIG_DIR` or `VSCODE_USER_DIR`.
- **Plain JSON only:** if the live `settings.json` has comments or trailing commas, the script stops and asks you to merge by hand.
- **Not touched:** Kilo, `~/.claude.json`, `~/.claude` and `~/.codex`. Append the `--codex-snippet` output to `~/.codex/config.toml` yourself, after a backup.
- **No secrets:** API keys are never written. The OpenRouter key is a UI step.

## Verify

```bash
node copilot-chat/scripts/check-copilot-agents.mjs          # repository agents
node copilot-chat/scripts/check-copilot-agents.mjs --live   # plus: live prompts/ identical, reply style matches ~/.config/kilo/chat-response-style.md
bash copilot-chat/scripts/install.sh --dry-run              # "0 file(s) would change" when the live setup matches
bash scripts/verify.sh                                      # whole repository, sanitized files only
```

## Screen automation (Peekaboo)

Every tab runs the same command:

```text
~/.local/node/bin/peekaboo mcp serve --no-remote --transport stdio --allow-foreground
```

- **`--no-remote`** must follow `serve`. Without it, a second window's server fails with "ScreenCaptureKit owner PID ... does not serve selected socket".
- **`browser` is off everywhere.** It needs a Chrome DevTools HTTP endpoint that `chrome://inspect` debugging does not provide.
  - Chat tab: `mcp.json` has no per-tool filter, so the custom agents' `tools:` lists name Peekaboo tools one by one and leave `browser` out. In the default Agent mode, untick `peekaboo > browser` in the tool picker.
  - Claude Code: `permissions.deny` includes `mcp__peekaboo__browser`.
  - Codex: `disabled_tools = ["browser"]`.
- Captures run under VS Code's own Screen Recording and Accessibility grants.

## Models

The Chat tab reaches Fable and Opus through the local Claude CLI bridge (`ai.kilo.claude-local-cli-provider`, `http://127.0.0.1:32123/v1`). One bridge process serves Kilo and VS Code.

- **Claude models:** `chatLanguageModels.json` defines one Custom Endpoint group with `fable-5-1-high`, `fable-5-1-max`, `opus-5-5-fast` and `opus-5-5-high`. Tool calling, vision and thinking are on. Custom Endpoint needs no API key; the bridge ignores the empty `Authorization` header.
- **Astra, Sol, Luna:** Copilot's own models ("GPT-6 Astra", "GPT-5.6 Sol", "GPT-5.6 Luna"). Custom Endpoint also accepts `apiType: "responses"`, so the Codex router (`http://127.0.0.1:43128/v1`) is a possible alternative. It is untested.
- **DeepSeek and GLM through OpenRouter:** both are confirmed on OpenRouter as "DeepSeek: DeepSeek V4.1 Flash" (`deepseek/deepseek-v4.1-flash`) and "Z.ai: GLM 5.3 Flash" (`z-ai/glm-5.3-flash`). Add them under Manage Models > Add Models > OpenRouter and pin both.
  - You enter your own key in the VS Code form. VS Code keeps it in secret storage; `chatLanguageModels.json` then holds only an `${input:...}` reference in an "OpenRouter" group, which this folder leaves out and `install.sh` preserves.
  - The agents expect the picker names `DeepSeek: DeepSeek V4.1 Flash (openrouter)` and `Z.ai: GLM 5.3 Flash (openrouter)`, falling back to `GPT-5.6 Sol` and `GPT-5.6 Luna`.
  - Kilo runs DeepSeek at `high` reasoning effort; set the same in the model's settings.

Bridge behaviour for VS Code ([`../examples/bridges/claude-cli-provider.mjs`](../examples/bridges/claude-cli-provider.mjs)):

- **Neutral wording:** prompt text says "coding agent (Kilo Code or VS Code)" rather than naming Kilo alone.
- **Tool names:** VS Code's snake_case tools (`read_file`, `replace_string_in_file`, `run_in_terminal`, `mcp_peekaboo_see`) pass through the decision schema unchanged.
- **Screenshots:** a screenshot inside a `tool` message (`image_url` data URL) becomes a file that Claude reads, the same way Kilo's images do.
- **Workspace folder:** the working directory comes from VS Code's `<workspace_info>` when Kilo's own markers are absent.
- **Sessions:** every VS Code chat in a workspace opens with the same context message. The session key therefore joins that message with the request only when the first user message contains `<environment_info>` or `<workspace_info>`. Kilo's key is unchanged.
- **`--self-test`** covers each of these points.

## Rules and agents

**Rules load once.**

- **Ponytail:** VS Code Chat already reads `~/.copilot/copilot-instructions.md` (`github.copilot.chat.codeGeneration.useInstructionFiles`, on by default), which embeds the Ponytail policy. Nothing else loads it again.
- **`CLAUDE.md` is off (`chat.useClaudeMdFile: false`):** `~/.claude/CLAUDE.md` is Claude Code's own routing file, so Copilot Chat must not read it. As a side effect, workspace `CLAUDE.md` files no longer load in Copilot Chat either.
- **Reply style:** `prompts/reply-style.instructions.md` (`applyTo: "**"`) carries the UI-verification rule and an exact copy of `~/.config/kilo/chat-response-style.md`. The location settings reject absolute paths, so VS Code cannot load the source file directly. `node copilot-chat/scripts/check-copilot-agents.mjs --live` fails if the copy drifts.
- **Claude Code agents hidden:** `chat.agentFilesLocations: {"~/.claude/agents": false}` keeps Claude Code's own delegation agents (a folder VS Code loads by default) out of the Copilot picker.

**Agents.** The Kilo agents are 16 `.agent.md` files in the user `prompts/` folder (Kilo's hidden lowercase Fable alias is left out as unreachable). Only frontmatter keys found in the VS Code 1.139 prompt validator are used: `name`, `description`, `model`, `reasoning-effort`, `tools`, `agents`, `user-invocable` and `disable-model-invocation`.

| Agent | Model | Picker | Subagents it may call |
|---|---|---|---|
| Astra Engineering Lead, Astra + Jev | `GPT-6 Astra` (Copilot) | yes | the four workers |
| Fable Engineering Lead, Fable + Jev | `Claude Fable 5.1 High (Local CLI) (customendpoint)` | yes | the four workers |
| Opus 5.5 High | `Claude Opus 5.5 High (Local CLI) (customendpoint)` | yes | none |
| deepseek-workstream-lead | OpenRouter DeepSeek, then `GPT-5.6 Sol` | no (subagent only) | implementer, GLM, Luna |
| deepseek-implementer, luna-utility | DeepSeek / `GPT-5.6 Luna` | no (subagent only) | none |
| glm-investigator | OpenRouter GLM, then `GPT-5.6 Luna` | no (subagent only) | none; read-only tools only |
| Fable 5.1 High/Max, Opus 5.5 Fast, Sol, Luna, DeepSeek and GLM profiles | own model | hidden, as in Kilo | none (Sol: implementer) |

- **Leads cannot be called as subagents:** they set `disable-model-invocation: true`.
- **Nested delegation:** `chat.subagents.allowInvocationsFromSubagents: true` lets the workstream lead call its workers. VS Code caps nesting at depth 5 and has no setting for Kilo's depth of 2; the `agents:` lists still limit who can call whom.
- **No `browser` tool:** `tools:` lists name each Peekaboo tool individually and leave `browser` out. Only the leads get `claude-code-local/opus_5_5_high`.
- **Step limits:** VS Code has no per-agent field, only the global `chat.agent.maxRequests`. Each agent body states its Kilo limit (leads 50, DeepSeek 45, GLM 14, Luna 8).
- **Jev:** TypeSafe tools are left out (they are disabled in Kilo); the Jev agent names and bodies are kept.

## Approvals

- **No global auto-approve:** `chat.tools.global.autoApprove` stays `false`.
- **Edits always ask:** `chat.tools.edits.autoApprove: {"**/*": false}`. VS Code's default would approve most edits.
- **Terminal:** `chat.tools.terminal.autoApprove` approves only the GLM read-only commands: `git status`, `diff`, `log` and `show`; `rg`; `grep`; `find`; `ls`; `head`; `tail`; and `sed -n 'N,Mp' file`.
  - Their mutating forms are denied: `sed -i`, `find -delete` or `-exec`, `rg --pre`, and `git ... --output` or `--ext-diff`.
- **Read-only Peekaboo tools:** VS Code has no settings key for per-MCP-tool approval. Click **Always allow** once in Chat for `see`, `image`, `capture`, `inspect_ui`, `analyze`, `permissions`, `verify_state` and `sleep`.
- **No secrets:** there are no API keys in `mcp.json`, `chatLanguageModels.json`, the agent files or this repository. The OpenRouter key lives only in VS Code secret storage.

## Sound off

`editor.accessibilitySupport: "on"` (from [`../examples/vscode/settings.jsonc`](../examples/vscode/settings.jsonc)) makes every "auto" accessibility signal audible, so agents working in Chat, Claude Code, Codex or Kilo chime constantly. `config/settings.jsonc` sets `sound: "off"` for the eight signals they trigger: `chatRequestSent`, `chatResponsePending`, `chatResponseReceived`, `chatUserActionRequired`, `chatEditModifiedFile`, `progress`, `terminalCommandSucceeded` and `terminalCommandFailed`. Screen-reader announcements are unaffected.

## Guards

[`../examples/patches/check-peekaboo-mcp.mjs`](../examples/patches/check-peekaboo-mcp.mjs) (live copy `~/.config/kilo/patches/`) checks the Kilo config and, when present, VS Code `mcp.json`, `~/.claude.json`, `~/.claude/settings.json` and `~/.codex/config.toml`. With `--live` it also starts Peekaboo and confirms that the bridge's `/v1/models` lists the four Claude models.

```bash
node ~/.config/kilo/patches/check-peekaboo-mcp.mjs          # all live configs
node ~/.config/kilo/patches/check-peekaboo-mcp.mjs --live   # plus Peekaboo tools/list and bridge models
```

`scripts/reapply-kilo-patches.sh` (repository root) runs the check and notifies on failure. LaunchAgent `ai.kilo.reapply-patches` runs that script when an extension under `~/.vscode/extensions` changes (for example Claude Code or Codex). It does not run when VS Code itself updates, so run the check by hand after a VS Code update.

## User steps

`install.sh` prints a short version of these at the end.

1. Run **Developer: Reload Window** in every VS Code window.
2. **MCP view:** start `peekaboo` and `claude-code-local` and confirm both show Running, with Peekaboo listing 26 tools. In the default Agent mode's tool picker, untick `peekaboo > browser`.
3. **Manage Models:**
   - Confirm "Custom Endpoint" is offered (a Copilot plan or org policy can hide it) and the four "Claude ... (Local CLI)" models are enabled. Leave the API key empty; if the form insists on one, enter any placeholder.
   - **Add Models > OpenRouter:** enter your own key, then add and pin "DeepSeek: DeepSeek V4.1 Flash" and "Z.ai: GLM 5.3 Flash". Set DeepSeek's reasoning effort to High.
   - Check that the names match the agent `model:` values: `DeepSeek: DeepSeek V4.1 Flash (openrouter)` and `Z.ai: GLM 5.3 Flash (openrouter)`. If they differ, tell the lead the exact names.
4. **Agent picker:** confirm it shows Astra Engineering Lead, Astra + Jev, Fable Engineering Lead, Fable + Jev and Opus 5.5 High, and no workers or Claude Code agents.
5. **Chat tab:** have Peekaboo `see` capture the VS Code window (`app_target: "Code"`), then click one element and type in one field. Click **Always allow** on the read-only Peekaboo tools.
6. **Claude Code tab:** add `--no-remote` after `serve` in `mcpServers.peekaboo.args` of `~/.claude.json`, merge the browser deny from `../claude-code/config/settings.json`, start a new session, and confirm `peekaboo` connects (no `CONNECTION_CLOSED`) and one `see` capture works.
7. **Codex tab:** append `install.sh --codex-snippet` output to `~/.codex/config.toml`, start a new session and run one `see` capture.
8. **Two windows:** open a second VS Code window and confirm Peekaboo starts in both.
9. **Fable lead:** ask for a small two-file change and confirm it runs on Fable, delegates to deepseek-implementer, inspects the diff, runs a check and replies in the Answer / My opinion / Next step format.
10. **Kilo:** confirm Kilo still works unchanged.
