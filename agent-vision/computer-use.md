# Computer use MCP

[Peekaboo](https://www.npmjs.com/package/@steipete/peekaboo) `4.4.0` is a macOS
computer-use server. It exposes 26 MCP tools that act on the real desktop:
`see`, `click`, `type`, `press`, `scroll`, `drag`, `move`, `set_value`, `paste`
and `clipboard` for input, plus `app`, `window`, `space`, `menu`, `dock` and
`dialog` for application control, and `capture`, `image`, `analyze`,
`inspect_ui` and `verify_state` for reading the screen back.

Playwright covers anything that happens inside a browser. Peekaboo covers
everything else — a native app, a preferences window, an installer, a system
dialog the browser cannot reach.

## Why it is installed globally instead of run through npx

Playwright is fetched on demand by `npx` because it needs no special privilege.
Peekaboo does, and that changes the calculation.

macOS binds a TCC privacy grant to a specific executable path. `npx` resolves a
package into a versioned path under the npm cache, so the executable moves every
time the package is updated — and each move means a grant that no longer
applies and a permission dialog that has to be answered again. A global install
gives the binary one stable path:

```sh
npm install -g @steipete/peekaboo
```

which lands as `/Users/shri/.local/node/bin/peekaboo`, a symlink to the compiled
binary inside `lib/node_modules/@steipete/peekaboo/`. That path is what the MCP
registrations reference.

Note that the published package ships a Mach-O universal binary, not a
JavaScript entry point. The `#!/usr/bin/env node` shebang problem described in
[browser-automation.md](browser-automation.md) therefore does not apply to
Peekaboo: it does not need the node directory on `PATH` in order to start. The
Claude Code registration still sets `PATH` and `HOME` explicitly, for
consistency with the other servers in the same file; the Kilo registration sets
no environment at all and works.

## Registration

Claude Code, at user scope:

```sh
claude mcp add --scope user peekaboo \
  --env PATH=/Users/shri/.local/node/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  --env HOME=/Users/shri \
  -- /Users/shri/.local/node/bin/peekaboo mcp serve --transport stdio --allow-foreground
```

This is done through the CLI rather than by hand-editing `~/.claude.json`. That
file is flagged as sensitive, and a live Claude session rewrites it while it
runs, so a hand edit races the session and can be silently reverted.

Kilo reads a static config file and is edited directly, as an entry in the `mcp`
object of `~/.config/kilo/kilo.jsonc`:

```jsonc
"Peekaboo": {
  "type": "local",
  "command": [
    "/Users/shri/.local/node/bin/peekaboo",
    "mcp", "serve", "--transport", "stdio", "--allow-foreground"
  ],
  "enabled": true,
  "timeout": 600000
}
```

`--allow-foreground` permits the server to bring a target application forward
before acting on it. Without it, clicks aimed at a background window are not
reliable.

## Permissions, and the grant that lands on the wrong name

Peekaboo needs three macOS privacy grants:

| Grant | Status | Used for |
|---|---|---|
| Screen Recording | required | `see`, `capture`, reading the screen at all |
| Accessibility | required | reading the UI element tree, `inspect_ui` |
| Event Synthesizing | optional | synthetic clicks, keystrokes, drags |

The non-obvious part is *what* you grant them to. macOS does not attribute a TCC
request to the process that makes it; it attributes it to that process's
**responsible process** — the ancestor the user is considered to have launched.
Peekaboo is started as a child of an MCP client that is itself a Node process,
so the responsible process is the node binary at
`/Users/shri/.local/node/bin/node`.

The practical consequence: **System Settings → Privacy & Security → Accessibility
will never show an entry named "peekaboo"**. It shows one named `node`, and that
is the toggle that has to be switched on. Looking for the tool's own name and
not finding it is the expected failure mode, and it reads exactly like the
install being broken.

There is no command that fixes this. `tccutil` can only *reset* grants; macOS
deliberately provides no way to grant one from a script. A human has to open the
pane and click the toggle for `node` once. After that, every MCP client running
under that same node binary inherits the grant.

Because the grant belongs to `node` and not to Peekaboo, it also survives
Peekaboo upgrades — and, less comfortably, it applies to anything else that node
binary decides to drive.

## Check the current state

```sh
/Users/shri/.local/node/bin/peekaboo permissions
```

```text
Source: Peekaboo Bridge
Screen Recording (Required): Granted
Accessibility (Required): Granted
Event Synthesizing (Optional): Granted
```

To confirm the MCP surface rather than the CLI, pipe an `initialize` +
`tools/list` handshake into the registered command on stdin and count the tools;
a healthy server answers with 26. `claude mcp list` shows the registration
status from the client side.

## The see → act → see pattern

Every Peekaboo action invalidates the UI snapshot it was planned against. A
click can open a sheet, move focus, or re-lay-out the window, and element
identifiers from the previous snapshot no longer point where they did. Acting
twice from one `see` is the most common way to drive the wrong control.

The working pattern is therefore always:

```text
see  →  act (click / type / press)  →  see again  →  act  → ...
```

Verify it end to end with something that gives an unambiguous answer. Open
Calculator, `see` it, click `6`, `×`, `9`, `=`, then `see` again and read the
result off the accessibility tree. If the tree reports `54`, then screen
reading, element resolution, and synthetic event delivery are all working —
which is the whole chain, confirmed with real clicks rather than an API call
that bypasses the parts that break.
