# Installation and recovery

## Prerequisites

- VS Code
- Kilo Code extension
- Accounts or API access for the models you enable
- Node.js for the optional local MCP bridge
- An authenticated Claude CLI only if the local route is enabled

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

## Authentication

Authenticate through Kilo's provider UI or the provider's official CLI. Do not add keys to `kilo.jsonc`, agent Markdown, shell scripts, or this repository.

## Smoke checks

Run one check per route you enabled:

1. Ask Astra a simple repository question. It should answer directly.
2. Give Astra a bounded medium implementation and explicitly allow one DeepSeek implementer. Confirm the task timeline identifies the DeepSeek agent.
3. Ask for a read-only diagnosis and confirm GLM does not modify files.
4. If the bridge is enabled, select the local Opus profile and ask it to inspect a small test file without changing it.
5. Inspect `git status` after every check.

## Recovery

If Kilo fails to load after a change:

1. Restore the backup configuration.
2. Restart VS Code.
3. Reapply one file at a time.
4. Check paths and model IDs first; they are the most machine-specific values.

Never restore auth databases from this repository. Reauthenticate through the official provider flow instead.
