# Configuration inventory

This inventory records what was active on the audited machine on 2026-09-19 and how it is represented here.

## Observed versions

| Component | Observed version | Reproduction note |
|---|---:|---|
| VS Code | 1.138.0 | Merge only the documented settings keys |
| Kilo Code | 7.7.2, Apple Silicon | The selected-agent patch is bundle/version-sensitive |
| Claude Code extension | 2.1.280+ (required for `claude-opus-5-5`), Apple Silicon | Its bundled CLI path changes with extension updates |
| Node.js | Local executable | Configure an absolute path for GUI reliability |

## Active and reproduced

| Local component | Repository representation | Status |
|---|---|---|
| `kilo.jsonc` | `examples/kilo.jsonc` | Sanitized; absolute paths replaced |
| Chat response style | `examples/instructions/chat-response-style.md` | Exact active contract |
| Ponytail coding policy | `examples/instructions/AGENTS.md` | Upstream text preserved with attribution |
| Astra lead | `examples/agent/astra-engineering-lead.md` | Exact active definition |
| Fable lead | `examples/agent/Fable Engineering Lead.md` | Exact active definition; routed through local Fable CLI |
| DeepSeek workstream and implementation agents | `examples/agent/` | Exact active definitions |
| GLM read-only investigator | `examples/agent/glm-investigator.md` | Exact active definition |
| Luna utility | `examples/agent/luna-utility.md` | Exact active definition |
| Four local CLI profiles | `examples/agent/` and MCP bridge | Fable High/Max and Opus Fast/High |
| Local Claude MCP bridge | `examples/bridges/claude-cli-mcp.mjs` | Machine paths converted to arguments |
| VS Code behavior settings | `examples/vscode/settings.jsonc` | Relevant subset only |
| Kilo bundle patches and auto re-apply | `examples/patches/{jev-agent-order,per-agent-model,global-last-agent}.mjs`, `scripts/reapply-kilo-patches.sh` | Verified on Kilo 7.7.7; LaunchAgent `ai.kilo.reapply-patches` |

## Intentionally not reproduced

| Item | Reason |
|---|---|
| Provider auth database/keychain data | Contains credentials and account tokens |
| Kilo logs, tool output, and chat history | Private runtime data, not configuration |
| Copilot network diagnostic report | Contains account and environment diagnostics; unrelated to this workflow |
| Experimental HTTP Claude provider bridge | Not referenced by the active Kilo configuration |
| Backup configuration files | Can contain stale machine-specific paths and settings |

## Naming detail

The visible **Fable Engineering Lead** uses the authenticated local CLI. A lowercase compatibility alias existed locally, but duplicating both in a clean installation would add confusion, so this repository keeps only the visible canonical mode.
