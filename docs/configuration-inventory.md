# Configuration inventory

This inventory records what was active on the audited machine and how it is represented here. It is a custom configuration, not a stock VS Code or Kilo Code feature.

## Version evidence

| Snapshot / date | Component | Observed version | Evidence and scope |
|---|---|---|---|
| 2026-10-18 (current) | Kilo Code | 7.8.12 | [Dated update](updates/2026-10-18.md); patches were re-anchored for this build |
| 2026-10-09 | Kilo Code | 7.8.2 | [CTO rollout](cto-implementation-todo.md); historical |
| 2026-09-19 | Kilo Code | 7.7.2, Apple Silicon | Initial inventory; patches from this date target that build |
| 2026-09-23 | VS Code | 1.139.0 | Merge only the documented settings keys |
| 2026-09-23 | Bundled Copilot Chat | 0.67.0 | Agent frontmatter keys and model vendors checked against this build |
| 2026-09-23 | Codex CLI (VS Code extension) | 0.155.0-alpha.16.3 | Supports `disabled_tools` per MCP server |
| 2026-09-19 | Claude Code extension | 2.1.280+ (required for `claude-opus-5-5`), Apple Silicon | Historical local route; its bundled CLI path changes with extension updates |
| 2026-09-19 | Node.js | Local executable | Required for installers and checks; configure an absolute path for GUI reliability |

These rows record observations, not a compatibility matrix. Patches match the exact anchors named in their own files. An unlisted build may work or may be refused; run the patch's `--check` or the safe gate rather than assuming support.

## Active and reproduced

| Local component | Repository representation | Status |
|---|---|---|
| `kilo.jsonc` | `examples/kilo.jsonc` | Sanitized; absolute paths replaced |
| PrimalLabs Kilo provider | `examples/kilo.jsonc` | OpenAI-compatible MiMo V2.6 Pro RL and DeepSeek V4 Flash 0731 model entries; credentials remain local |
| Chat response style | `examples/instructions/chat-response-style.md` | Exact active contract |
| Ponytail coding policy | `examples/instructions/AGENTS.md` | Upstream text preserved with attribution |
| CTO (Recommended) and CTO + JEV | `examples/agent/CTO (Recommended).md`, installer-generated CTO + JEV | Current profiles; installer writes both from `examples/cto/native-policy.md` |
| DeepSeek implementer | `examples/agent/deepseek-implementer.md` | Exact leaf-worker definition |
| GLM read-only investigator | `examples/agent/glm-investigator.md` | Exact read-only definition |
| Luna utility | `examples/agent/luna-utility.md` | Exact leaf-worker definition |
| Astra / Fable / Opus leads | `examples/agent/` | Historical definitions; hidden by the current installer but retained for dated restoration |
| Four local CLI profiles | `examples/agent/` and MCP bridge | Historical local Claude routes; optional, not required by the CTO profiles |
| Local Claude MCP bridge | `examples/bridges/claude-cli-mcp.mjs` | Identical to the live copy; finds the Claude CLI under `~/.vscode/extensions` |
| Local Claude CLI provider bridge | `examples/bridges/claude-cli-provider.mjs`, `fable-lead-system.md` | Identical to the live copy, including the Codex (`codex-*` models) backend. Serves Kilo and VS Code Custom Endpoint |
| VS Code behavior settings | `examples/vscode/settings.jsonc` | Relevant subset only; Copilot Chat keys are in `copilot-chat/config/settings.jsonc` |
| VS Code Chat MCP servers | `copilot-chat/config/mcp.json` | Sanitized placeholders; live `~/Library/Application Support/Code/User/mcp.json` |
| VS Code Chat custom models | `copilot-chat/config/chatLanguageModels.json` | Matches the live "Claude Local CLI" group; no key. The live OpenRouter group (secret-storage reference) is left out |
| VS Code Chat custom agents | `copilot-chat/config/prompts/*.agent.md` (17) | Identical to the live `User/prompts/` files |
| VS Code Chat reply-style instructions | `copilot-chat/config/prompts/reply-style.instructions.md` | Copy of the chat response style plus the UI-verification rule |
| VS Code Chat settings and sound-off keys | `copilot-chat/config/settings.jsonc` | Same values as the live `settings.json`; merged by `copilot-chat/scripts/install.sh` |
| Codex Peekaboo MCP entry | `copilot-chat/config/config.peekaboo.toml` | Sanitized snippet for `~/.codex/config.toml` |
| Claude Code Peekaboo browser deny | `claude-code/config/settings.json` | `permissions.deny` includes `mcp__peekaboo__browser` |
| Peekaboo guard for all tabs | `examples/patches/check-peekaboo-mcp.mjs` | Identical to the live copy; covers Kilo, VS Code, Claude Code and Codex |
| Kilo bundle patches and reapply script | `examples/patches/{jev-agent-order,per-agent-model,global-last-agent,active-tab-blue,model-favorites}.mjs`, `scripts/reapply-kilo-patches.sh` | Custom, version-sensitive patches. Current anchors target 7.8.12; older notes record 7.7.x/7.8.1. The repo includes the reapply script, not a LaunchAgent plist |
| Chat reading and composer patches | `examples/patches/{skim-mode,chat-font,predict-next,provider-save-message}.mjs` with their helpers and tests | Custom patches; current snapshot targets 7.8.12 (earlier notes used 7.8.2); applied through the safe gate or `scripts/reapply-kilo-patches.sh`. See [Chat UI patches](chat-ui-patches.md) |
| Warm-process live check | `examples/bridges/check-claude-warm-process.mjs` | Identical to the live copy; needs a running bridge |
| Mockup instructions | `examples/instructions/mockup-preview.md`, `mockup-standard.md` | Preview is the exact active text; the standard has its two absolute paths replaced by a placeholder |

## Intentionally not reproduced

| Item | Reason |
|---|---|
| Provider auth database/keychain data | Contains credentials and account tokens |
| Kilo logs, tool output, and chat history | Private runtime data, not configuration |
| Copilot network diagnostic report | Contains account and environment diagnostics; unrelated to this workflow |
| Backup configuration files | Can contain stale machine-specific paths and settings |

## Naming detail

The visible **Fable Engineering Lead** uses the authenticated local CLI. A lowercase compatibility alias existed locally, but duplicating both in a clean installation would add confusion, so this repository keeps only the visible canonical mode. The VS Code Chat port in `copilot-chat/config/prompts/` leaves the alias out as well, so it has 17 agents for the 18 live Kilo agent files.
