# Installation and recovery

## Prerequisites

- VS Code
- Kilo Code extension
- Accounts or API access for the models you enable
- Node.js for the optional local MCP bridge
- An authenticated Claude CLI only if the local route is enabled

The observed working combination is documented in [Configuration inventory](configuration-inventory.md). Newer versions may work, but version-sensitive paths and patches must be rechecked.

## Install the instruction files

```bash
mkdir -p ~/.config/ponytail ~/.config/kilo
cp examples/instructions/AGENTS.md ~/.config/ponytail/AGENTS.md
cp examples/instructions/chat-response-style.md ~/.config/kilo/chat-response-style.md
```

These two files provide different controls: `AGENTS.md` governs coding decisions, while `chat-response-style.md` governs every user-facing response.

## Install the Kilo configuration

Back up the current Kilo configuration before replacing anything:

```bash
cp -R ~/.config/kilo ~/.config/kilo.backup
```

Then install the sanitized examples manually:

```bash
mkdir -p ~/.config/kilo/agent ~/.config/kilo/bridges
cp examples/kilo.jsonc ~/.config/kilo/kilo.jsonc
cp examples/agent/*.md ~/.config/kilo/agent/
cp examples/bridges/claude-cli-mcp.mjs ~/.config/kilo/bridges/
```

Open `~/.config/kilo/kilo.jsonc` and replace all placeholder paths. Model availability can differ by account, so confirm every model ID in Kilo before restarting VS Code.

## Merge the VS Code settings

Open VS Code user settings as JSON and merge the keys from `examples/vscode/settings.jsonc`. Do not replace unrelated user settings. Review auto-approval before enabling it on another machine; see [VS Code settings](vscode-settings.md).

## Optional selected-agent persistence

If you want new and cleared sessions to retain the selected agent, follow [Remember-last-agent patch](remember-last-agent-patch.md). This modifies the installed Kilo extension bundle and must be rechecked after every Kilo update.

## Authentication

Authenticate through Kilo's provider UI or the provider's official CLI. Do not add keys to `kilo.jsonc`, agent Markdown, shell scripts, or this repository.

## Smoke checks

Run one check per route you enabled:

1. Ask Astra a simple repository question. It should answer directly.
2. Give Astra a bounded medium implementation and explicitly allow one DeepSeek implementer. Confirm the task timeline identifies the DeepSeek agent.
3. Ask for a read-only diagnosis and confirm GLM does not modify files.
4. If the bridge is enabled, select the local Opus profile and ask it to inspect a small test file without changing it.
5. Select Fable Engineering Lead and confirm the request routes through `fable_5_1_high`.
6. Confirm a reply uses the exact `Answer`, `My opinion`, and `Next step` headings.
7. Inspect `git status` after every check.
8. Complete the broader [Scenario checklist](scenario-checklist.md).

## Recovery

If Kilo fails to load after a change:

1. Restore the backup configuration.
2. Restart VS Code.
3. Reapply one file at a time.
4. Check paths and model IDs first; they are the most machine-specific values.
5. If only agent persistence broke after an extension upgrade, leave Kilo unpatched until the exact-match check is reviewed.

Never restore auth databases from this repository. Reauthenticate through the official provider flow instead.
