# Shared computer control

`computer` is a model-independent stdio MCP server. Kilo, Claude Code and Codex can launch separate server processes, but all processes coordinate through one private lease in `~/.config/shared-computer/state`. Compatible models receive the same tools; no CTO model change is needed.

```text
Kilo / Claude Code / Codex → selected tool-capable model
  └─ computer MCP → acquire one operator lease
       ├─ desktop_* → installed Peekaboo → native Mac apps
       │    └─ exact target → screenshot / accessibility → act → verify
       └─ browser_* → pinned Playwright MCP → separate Chrome profile
            └─ navigate → snapshot → act → snapshot → verify
     release → close backends and release ownership

CTO coding workers → isolated code work while the operator owns the UI
```

## What is implemented

- Shared ownership across client processes, automatically renewed during tool use; inactive leases expire after 120 seconds by default (10–300 seconds configurable per acquisition).
- A transaction mutex remains held during each backend operation, including timeout cleanup. A second agent cannot take over mid-action because the lease clock expired.
- Native action tools require a fresh snapshot from the same client. Mutations invalidate prior snapshots. Underlying engine errors and verification results are preserved.
- Screenshot images are forwarded as MCP image blocks with accessibility text. ScreenCaptureKit ownership refusals receive one read-only retry through Peekaboo's classic capture engine.
- Browser actions require a new browser snapshot after each mutation. Browser automation runs in its own persistent profile, outside the user's ordinary Chrome profile.
- A bounded tool allowlist excludes nested autonomous agents, arbitrary JavaScript evaluation, browser code execution and clipboard harvesting. It does not sandbox the computer or override the user's authorization.
- Audit records contain tool name, time, duration and error flag, not typed values, tokens, screenshots or page text. The underlying tools and client transcripts can retain screenshots and page contents; the service directory is private.

The installed backend versions used for validation are Peekaboo 4.6.0 and Playwright MCP 0.0.83. The tool list is discovered from the actual backends instead of copied from an older schema. Each client must support stdio MCP; screenshot reasoning also requires image support. Text-only models can use accessibility/browser text where sufficient. Equal access does not imply equal reliability.

## Install and restore

From this repository:

```sh
node scripts/install-computer-control.mjs          # review file list; no writes
node scripts/install-computer-control.mjs --apply  # private backups before writes
```

The installer pins Playwright locally, installs the service and workflow skill, registers Kilo and Codex, and disables Kilo's older direct Peekaboo route. It preserves the selected model and other MCP registrations. Codex's existing native computer tools are unchanged. Reload Kilo configuration and skills when idle; newly started Codex sessions discover the registration.

Claude Code registration uses its supported CLI to avoid racing live writes to `~/.claude.json`:

```sh
claude mcp add --scope user computer -- /absolute/path/to/node /absolute/home/.config/shared-computer/server.mjs
```

After preserving old registration details, remove the superseded direct `peekaboo` and `playwright` routes with `claude mcp remove --scope user NAME`. This was done on this machine. Restart or reconnect the affected client's MCP session when idle.

Restore installer-managed files with the backup path printed by the install:

```sh
node scripts/install-computer-control.mjs --restore /absolute/backup/path
```

Restore refuses to overwrite files edited after installation. Claude registration is separate: remove `computer` via its CLI and re-add the prior routes recorded in the private `claude-before-computer.json` backup. Do not overwrite the whole live Claude settings file while sessions are active.

## Operational limits

The lease coordinates clients using this service. It cannot lock out the human user, Codex's native computer tools, an unrelated automation program or another MCP route. Avoid operating the same UI concurrently. The browser profile is separate; existing logins and tabs do not transfer automatically. Website/app restrictions, macOS permissions and model mistakes still apply. This is a local implementation of comparable tool access, not an export of Codex's private computer-use system.

Only the CTO/operator needs computer access for a UI task. Keep isolated implementation workers without desktop access; their higher code concurrency does not increase safe shared-desktop concurrency. When a native or web UI action may already have partially succeeded, inspect before retrying. Use underlying verification tools or visible state rather than a successful dispatch as proof.

## Tests

`node --test scripts/test-computer-control.mjs` exercises ownership, stale references, screenshot forwarding, error preservation, timeout cleanup, expiry, process death and orphan lock recovery. `node scripts/test-computer-install.mjs` checks dry runs, preservation, repeated installs and guarded rollback. Both run in `scripts/verify.sh` without touching the real desktop.

The opt-in live test uses an actual Kilo model and the installed service:

```sh
node scripts/test-computer-live.mjs openai/gpt-6.1-sol-ultrafast --native
```

It starts a disposable local invoice form, requires rejection of invalid input, saves exactly one corrected invoice, and independently verifies persisted values after reload. With `--native`, it also verifies Calculator's actual displayed result. The model is denied shell, file and direct network tools during the exercise. Private evidence paths and elapsed time are printed at completion.
