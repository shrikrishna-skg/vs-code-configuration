# Remember-last-agent patch

Kilo Code 7.7.2 resets or loses the selected agent in some new-session and clear-session paths. The optional patch stores the selected agent in webview `localStorage`, restores it on startup, and carries it into newly created sessions.

It also normalizes price suffixes in displayed model names so selection matching remains stable.

## Safety design

The patch is version-sensitive because it edits a bundled, minified `webview.js` file. It therefore:

- Requires every expected source fragment to match exactly once.
- Refuses to patch if Kilo's bundle changed unexpectedly.
- Detects an already installed patch.
- Creates a `.pre-remember-last-agent` backup before the first write.
- Supports a read-only `--check` mode.

## Apply

Find the installed Kilo extension's `dist/webview.js`, then run:

```bash
node examples/patches/remember-last-agent.mjs /absolute/path/to/kilo-extension/dist/webview.js
```

Restart VS Code after applying it.

## Check

```bash
node examples/patches/remember-last-agent.mjs /absolute/path/to/kilo-extension/dist/webview.js --check
```

## Extension updates

VS Code extension updates install a new version directory, so the patch must be reviewed and reapplied. Never force it past a failed exact-match check. Update the replacement signatures only after inspecting the new bundle and confirming the same behavior still exists.

To recover the original bundle, stop VS Code and restore the `.pre-remember-last-agent` backup, or reinstall the Kilo extension.
