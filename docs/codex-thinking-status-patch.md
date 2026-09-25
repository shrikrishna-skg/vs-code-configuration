# Codex working-status patch

Codex's generic **Thinking** shimmer is rendered inside the signed desktop app. This optional local patch turns that transient placeholder into a compact status pill:

- **AI is starting / working** while the route is still waiting for the local CLI.
- **AI is writing** once Codex changes its own state to typing.
- **Reconnecting** when Codex announces a reconnect.
- **Connection lost** with frozen elapsed time when the stream fails.

It only decorates Codex's existing Thinking/Typing element. It does not invent tool names, task steps, or progress percentages that the local CLI did not send. It honors reduced-motion preferences.

## Apply

Close Codex when convenient, then run:

```bash
node examples/patches/codex-thinking-status.mjs /Applications/ChatGPT.app/Contents/Resources/app.asar
```

The script makes a versioned backup beside the app bundle (for example, `/Applications/.ChatGPT.app.asar.pre-codex-thinking-status-*`), repacks the archive, ad-hoc signs the enclosing app bundle, and verifies its signature. It deliberately does not quit or restart Codex; restart it after the command finishes.

## Check

```bash
node examples/patches/codex-thinking-status.mjs /Applications/ChatGPT.app/Contents/Resources/app.asar --check
```

The check verifies both the patch marker and the enclosing app signature. The installer keeps its temporary unpacked copy outside the app bundle, and a normal re-run repairs the app signature if an older install was interrupted after re-signing. App updates replace `app.asar`, so rerun the check after every Codex update and never force a patch that fails its guard.

## Scope and recovery

This is a local, unsupported presentation patch. It is intentionally separate from the router fix: the router now sends a failure event with the same response ID that Codex marked in progress, so a failed local CLI run reaches a terminal state instead of leaving the prior request spinning.

If you want to undo the UI change, restore the versioned `.ChatGPT.app.asar.pre-codex-thinking-status-*` backup that matches the installed app, then ad-hoc sign and verify the enclosing app bundle again. Reinstalling Codex also restores the original bundle.
