# Guardrail hooks

> **Status: staged, not installed.** The three hooks below are written and
> tested, but none of them has ever fired in a live session. Writes to
> `/Users/shri/.claude/` are blocked by the permission system for every agent,
> including the main session, so the last step — copying the files into place —
> has to be done by hand. Everything in this document describes verified
> behaviour against synthetic payloads, not observed behaviour in production.

Hooks are shell commands the Claude Code harness runs at fixed points in the
tool loop. The distinction that matters: **the harness runs them, not the
model**. A rule written into `CLAUDE.md` is an instruction the model may follow;
a rule written into a hook is a command that executes on every matching tool
call whether or not the model remembers it exists, and whether or not the model
would have agreed.

That is the whole reason to use one. "Never read `.env`" as a prompt is a
preference. As a `PreToolUse` hook it is a deny.

Staged in `/Users/shri/Documents/Codex/.hooks-staging/`:

```text
guard-secrets.sh        PreToolUse   blocks reads and writes of secret files
verify-on-stop.sh       Stop         warns when a dirty repo's tests fail
selfcheck.sh            —            the runnable check for both of the above
settings.merged.json    —            existing settings.json + the hooks block
```

The formatter hook is a one-line inline command and lives only in
`settings.merged.json`.

## 1. PreToolUse — deny secret-bearing files

Matcher `Read|Edit|Write`, running `/bin/bash ~/.claude/hooks/guard-secrets.sh`.

The script reads `.tool_input.file_path` from the JSON payload on stdin and, on
a match, prints a deny decision:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}
```

It always exits 0 and prints nothing at all on allow — a hook that errors or
chatters on the common path is worse than no hook.

Denied by basename: `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`,
`id_ed25519*`, `.npmrc`, `.netrc`. Explicitly allowed first, because they are
the files you actually want the agent to read: `.env.example`, `.env.sample`,
`.env.template`.

Denied by path segment: anything containing `/credentials/` or `/.ssh/`. The
match is written against `"/$f/"` rather than `"$f"` so that a segment at the
very start or very end of the path still matches.

### The over-breadth is deliberate

`*.key` denies `license.key`, which holds no secret. `id_ed25519*` denies
`id_ed25519.pub`, which is a public key and safe by construction. Both are false
denies, and both were left in.

The reasoning is asymmetric cost. A false deny is loud, immediate, and
recoverable — the user sees the reason, and can override it at the permission
prompt. A false allow is silent and permanent: the key is in the transcript and
there is no taking it back. Tightening the glob to catch `license.key` means
reasoning about file contents rather than names, which is exactly the kind of
cleverness that fails open.

If a particular false deny becomes routine, add the basename to the allow arm at
the top of the `case`, next to `.env.example`. Do not loosen the deny arm.

## 2. PostToolUse — format what was just written

Matcher `Write|Edit`, running inline:

```sh
f=$(/usr/bin/jq -r '.tool_input.file_path // empty'); [ -n "$f" ] || exit 0; \
cd "$(dirname "$f")" || exit 0; \
PATH=/Users/shri/.local/node/bin:$PATH npx --no-install prettier --write --ignore-unknown "$f" >/dev/null 2>&1 || true
```

Three details in that line are load-bearing and none of them are obvious.

**`--no-install` is what keeps this free.** It tells `npx` to use a prettier that
is already resolvable from the project and to fail rather than fetch one. In a
project with prettier as a dev dependency, the project's own version and
config are used. In a project without one, the command fails, `|| true`
swallows it, and the hook is a no-op. No global prettier was installed for this;
this machine has none, and the only global npm packages are `npm`, `corepack`
and `@steipete/peekaboo`.

**`cd "$(dirname "$f")"` is required, not tidiness.** `npx` resolves binaries by
walking up `node_modules` from the *current working directory*, which for a hook
is the session's cwd — not the edited file's project. Without the `cd`, a
project's own prettier is never found and the hook silently no-ops on every
file, including the ones it was installed to format. The failure is invisible,
which is what makes it worth a paragraph.

**The `PATH` prefix is the same GUI-launch problem** already described in
[browser-automation.md](browser-automation.md): a VS Code window started from
the Dock never sourced `~/.zshrc`, so the user-local node directory is absent
from `PATH`. Same cause, same fix.

### What was actually proved

Real prettier formatting has never been observed here, because no prettier
exists on this machine to observe. The wiring was proved instead by planting an
executable stand-in at `node_modules/.bin/prettier` in a scratch directory:
`npx --no-install` resolved it, invoked it with the expected file path, and the
file came back rewritten.

That demonstrates resolution, argument passing and write-back — the three things
the hook is responsible for. It demonstrates nothing about prettier's own
output. The first project that has prettier installed will be the first real
test.

## 3. Stop — run the project's tests, warn only

No matcher, `timeout: 120`, running `/bin/bash ~/.claude/hooks/verify-on-stop.sh`.

This hook **warns and never blocks**. It exits 0 silently unless every one of
these is true:

- the cwd is inside a git repository;
- `git status --porcelain --untracked-files=no` is non-empty, i.e. tracked files
  were actually modified;
- `./package.json` exists;
- `.scripts.test` in that `package.json` is non-empty.

Only then does it run `npm test --silent`. On failure it emits a
`systemMessage` naming the exit code and the last 400 characters of output. On
success, nothing.

Each condition removes a class of false alarm: no repo means no baseline, no
changes means nothing to break, no test script means nothing to run. A Stop hook
that fires on every conversation gets disabled within a day.

### macOS has no `timeout(1)`

The script cannot use `timeout 110 npm test`, because that command does not
exist on macOS — it is GNU coreutils, not BSD. The substitute is perl's `alarm`,
which is in the base install:

```sh
out=$(/usr/bin/perl -e 'alarm shift; exec @ARGV' 110 npm test --silent 2>&1)
```

`alarm` fires `SIGALRM` after the given number of seconds, killing the exec'd
process. Verified: the wrapper returns **142** on timeout (128 + SIGALRM's 14),
which the script maps to a `timed out after 110s` message.

This is flagged because it looks like something to "fix" back to `timeout 110`,
and that change would break the hook on this machine with a `command not found`
that `2>&1` capture would quietly fold into the test output. The 110-second
alarm sits deliberately inside the harness's own 120-second hook timeout, so the
script always gets to report its own timeout rather than being killed mid-write.

## Install

Nothing below can be done by an agent; the permission system blocks writes to
`~/.claude/` for every session, which is why these are staged rather than live.

```sh
# 1. Back up the current settings first. This is the step not to skip.
cp ~/.claude/settings.json ~/.claude/settings.json.bak

# 2. Put the scripts in place (the directory does not exist yet).
mkdir -p ~/.claude/hooks
cp /Users/shri/Documents/Codex/.hooks-staging/guard-secrets.sh   ~/.claude/hooks/
cp /Users/shri/Documents/Codex/.hooks-staging/verify-on-stop.sh  ~/.claude/hooks/
cp /Users/shri/Documents/Codex/.hooks-staging/selfcheck.sh       ~/.claude/hooks/
chmod +x ~/.claude/hooks/*.sh

# 3. Install the merged settings.
cp /Users/shri/Documents/Codex/.hooks-staging/settings.merged.json ~/.claude/settings.json

# 4. Restart VS Code.
```

The restart is not optional. The settings watcher reads hook configuration at
session start only, so an edited `settings.json` has no effect on a session
already running — and a hook that appears not to work is almost always a hook
that was never loaded.

`jq` is used by all three hooks and is expected at `/usr/bin/jq`. macOS 15 and
later ship it; on an older system, install it before installing the hooks.

### The merge is additive

`settings.merged.json` is the existing `settings.json` with a `hooks` block
added and nothing else touched. Confirmed mechanically rather than by eye:

```sh
jq 'del(.hooks)' settings.merged.json | jq -S . | diff - <(jq -S . ~/.claude/settings.json)
```

produces no output. `model`, `effortLevel`, `disableAgentView`,
`remoteControlAtStartup`, `agentPushNotifEnabled` and all four `CLAUDE_CODE_*`
environment variables survive the merge unchanged.

## Verify

```sh
bash ~/.claude/hooks/selfcheck.sh
```

Six assertions, currently all passing:

```text
PASS deny  /tmp/x/.env
PASS deny  /tmp/x/id_rsa
PASS deny  /tmp/x/deploy.pem
PASS allow /tmp/x/.env.example
PASS allow /tmp/x/src/index.ts
PASS stop-hook silent in non-git dir
ALL PASS
```

It exits non-zero on any failure, and resolves the scripts relative to its own
location, so it runs identically from the staging directory or from
`~/.claude/hooks/` after install. Run it from staging before installing
anything, and again afterwards to confirm the copy landed.

The last assertion is the one that matters most for daily use: it proves the
Stop hook stays silent where it has no business speaking.

## What is still unverified

Stated plainly, because a hook that is assumed to work is worse than no hook:

- **No hook has been observed firing in a live session.** All testing is
  synthetic payloads piped into the scripts on stdin. The payload shape and the
  deny-decision schema are taken from the documented hook contract; if that
  contract differs in practice, the guard fails *open* and the first sign will
  be a `.env` read that succeeds.
- **Prettier has never actually formatted a file here.** Only the resolution
  path was proved, with a stand-in binary.
- **`npm test` has never been triggered by the Stop hook.** The four guard
  conditions were exercised; the `npm test` branch beyond them was not reached
  in a real repository.

After installing, the honest first check is to try reading a real `.env` and
confirm the deny appears.
