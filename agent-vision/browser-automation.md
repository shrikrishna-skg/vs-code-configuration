# Browser automation MCP

The assistants drive a real browser through the [`@playwright/mcp`](https://www.npmjs.com/package/@playwright/mcp)
stdio server, which exposes 25 `browser_*` tools (navigate, click, type, fill
form, snapshot, screenshot, console and network inspection). The package is
fetched on demand by `npx`; nothing is installed globally.

The server is registered for the assistants actually present on this machine —
Claude Code at user scope and Codex — and not for GitHub Copilot, which is not
installed here. Claude Code registration is done with the bundled CLI rather
than by hand-editing live configuration:

```sh
claude mcp add --scope user playwright \
  --env PATH=/absolute/node/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  --env HOME=/absolute/home \
  -- /absolute/node/bin/npx -y @playwright/mcp@latest
```

Codex uses the same command in an `[mcp_servers.playwright]` block in
`~/.codex/config.toml`, with a matching `[mcp_servers.playwright.env]` table.

## Why the absolute path and the explicit PATH both matter

Node is installed under a user-local prefix and is added to `PATH` by
`~/.zshrc`. GUI-launched applications do not source `~/.zshrc`, so a VS Code
window started from the Dock sees only the system `PATH`. A bare `npx` in an MCP
configuration therefore fails to launch with `command not found`.

Using the absolute `npx` path is necessary but **not sufficient**. On this
platform `npx` is a JavaScript file whose shebang is `#!/usr/bin/env node`, and
the package binary it execs has the same shebang, so both still resolve `node`
through `PATH`. Without the node directory on `PATH` the server dies with:

```text
env: node: No such file or directory
```

The fix is to supply both: call `npx` by absolute path *and* set `PATH` in the
server's `env` block so the node directory is present for the whole process
tree. The bundled Codex servers in the same file use the same explicit-`PATH`
technique. Verify a registration with `claude mcp list`, `codex mcp list`, or a
raw `initialize` + `tools/list` handshake piped into the command on stdin.
