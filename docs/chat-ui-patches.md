# Chat reading and composer patches (2026-10-13, updated 2026-10-14)

Five patches change how Kilo chat replies read and how the composer behaves, plus one small selector tweak. They target the local Kilo build `kilo-code-local-7.8.2` and are version-sensitive: each one matches exact text in the installed bundle and makes no change when that text is not found.

| Patch | What it does | Bundles it touches |
|---|---|---|
| Skim mode | Keeps the first sentence of each point bright and dims the detail | `dist/webview.js`, `dist/agent-manager.js` |
| Chat font | Sets Hanken Grotesk for chat and Agent Manager; code and terminal text stay monospace | `dist/webview.css`, `dist/agent-manager.css` |
| Predicted next message | Suggests the user's likely next message as the composer placeholder | `dist/extension.js`, `dist/webview.js` |
| Provider save fix | Lets a custom provider form save through the native webview bridge | `dist/webview.js` |
| Composer chevrons | Puts Continue 6px from Prompts and gives every composer dropdown one centred chevron | `dist/webview.css`, `dist/agent-manager.css`, `dist/webview.js` |
| Permission selector icon | Shows the shield only beside Full access; the trigger shows text only | `examples/patches/permission-mode-ui.js` (part of the existing permission-modes patch) |

## Skim mode

- **Files:** `examples/patches/skim-mode.mjs` (installer), `skim-mode-ui.js` (the injected helper, marker `skim-mode-ui:v1`), `skim-mode.test.mjs`, `skim-mode.fixture.html`.
- **How it paints:** with the CSS Custom Highlight API, so it needs no anchor inside the minified chat code.
- **Sentence rule:** a sentence end is only trusted before a capital letter, a digit or a code span. Text in other scripts stays fully bright.
- **While a reply is streaming:** the last block stays bright until it settles.
- **Order:** its block sits before the predicted-next-message block when that patch is present.

## Chat font

- **Files:** `examples/patches/chat-font.mjs`, `chat-font.test.mjs`, `hanken-grotesk-variable.woff2`, `hanken-grotesk-OFL.txt`.
- **How it works:** appends one marked CSS block (`kilo-chat-font:v3`) that sets `--font-family-sans` and `--vscode-font-family`, and copies the font file beside the CSS.
- **Modes:** `--apply` (default), `--check` (block present and font file identical) and `--restore`. The first apply keeps a `.pre-chat-font` backup.
- **License:** SIL Open Font License 1.1, see [Third-party notices](../THIRD_PARTY_NOTICES.md).

## Predicted next message

- **Files:** `examples/patches/predict-next.mjs` (installer), `predict-next.cjs` (the prediction), `predict-next-ui.js` (marker `predict-next-ui:v2`), `predict-next.test.mjs`, `predict-next.test.cjs`, `predict-next.live.mjs`.
- **Behaviour:** when the composer is empty, the suggestion appears as its placeholder. Tab accepts it and Escape dismisses it. The user's typed input is never modified.
- **Model:** one bounded, tool-free request on LithosAI at low effort, using `zai-org/GLM-5.3-Flash-ultra` when available and `deepseek-ai/DeepSeek-V4.1-Flash-ultra` otherwise, with a 15 s deadline. Requests use the agent name `next-message-predictor`.
- **Scope of context:** a window of the most recent chat messages. Older decisions can be missing, so a prediction is a suggestion and never a commitment.
- **One per session:** the latest prediction wins; other sessions keep theirs.

Known limits, as marked in the code:

- **Sidebar chat only.** The Agent Manager composer is not covered.
- **Temporary session.** Each prediction runs in a short-lived session titled `Next message (temporary)` that can briefly appear in session history. Cleanup has its own 10 s deadline.
- **Local log.** Suggestions are written to an unrotated local log for judging quality. The log is not part of this repository.

## Provider save fix

- **Files:** `examples/patches/provider-save-message.mjs`, `provider-save-message.test.mjs`.
- **Problem:** provider forms hold Solid store proxies, and the native webview bridge only accepts plain JSON.
- **Fix:** the request helper sends a plain JSON copy of the message and reports a failure to the caller. The first apply keeps a `.pre-provider-save-message` backup.

## Composer chevrons

Added 2026-10-14 (Variant A of `examples/mockups/chatbox-controls/index.html`).

- **Files:** `examples/patches/composer-chevrons.mjs`, `composer-chevrons.test.mjs`.
- **Spacing:** Continue sits 6px to the left of Prompts. The Continue launcher is placed with CSS anchor positioning against the Prompts button (`anchor-name: --kilo-prompts`, scoped to each composer). Without anchor support it keeps the old 96px offset.
- **Chevron:** the agent, model and reasoning pickers keep their own 10px svg, redrawn by CSS (`d: path(...)`) as a 12px stroked chevron. Continue and the permission picker get the same shape as a `::after` mask, and the permission picker's text arrow is hidden. Every chevron is centred on its label, 4px from it, dimmed until hover, and turned over while its menu is open.
- **Bundle change:** in `dist/webview.js` the Continue button text loses its `▾` character (one exact match). The marked CSS block (`kilo-composer-chevrons:v1`) goes into both CSS files.
- **Modes:** `--apply` (default), `--check` and `--restore`. The first apply keeps a `.pre-composer-chevrons` backup of each file.
- **Scope:** the Continue and Prompts buttons exist only in the sidebar chat, so Agent Manager gets the chevrons but not the spacing change.

## Saved chat settings and update recovery

- Permission choices are stored per chat in VS Code workspace state under `kilo.chatPermissionModes.v1`. Explicit Full access choices survive restart and include Kilo configuration edits, including requests marked `configProtected`. Auto still asks for these edits. Explicitly denied tools, sandbox escalation and skill-shell consent retain their checks.
- Opening a saved chat processes its eligible pending permission requests again, so a request that arrived before the extension reconnected does not remain waiting for a new event. Responses remain limited to that chat and its inherited worker permissions.
- **Outside-folder prompts are intentional in Auto.** A shell command that changes from the project into its parent directory can trigger `external_directory` before the command runs, even when `ls` or `grep` itself is allowed. For a chat that needs to work across repositories or edit Kilo configuration, select **Full access** in that chat. Changing the mode processes its existing eligible permission request; do not resend the task. This does not change other chats or bypass denied tools, sandbox escalation, or skill-shell consent.
- Effort choices are stored under session-specific keys in the extension's `variantSelections` global state. Loading a chat restores its saved value instead of changing a shared agent preference.
- To-do expansion starts closed and is saved per chat in localStorage (`kilo.todo.expanded.v2:`). VS Code persists this extension's webview origin across restarts; both open and closed choices are retained.
- The local `ai.kilo.reapply-patches` LaunchAgent runs at login and watches the extensions directory. Patch scripts and helper sources live outside the extension under `~/.config/kilo/patches`.
- Scroll recovery can recreate its helper from the supported build's original native code, so it does not depend on a previous patched bundle. Custom patches run independently: an incompatible patch is reported without preventing the remaining patches from running.
- These patches still target known bundle anchors. A future incompatible Kilo build is reported as a failure and needs adaptation; the reapply job does not claim success or rewrite unknown code.

`node scripts/test-chat-restart.mjs` checks permission and native effort persistence across fresh Node processes, and to-do choices across a full restart of an isolated headless Chromium profile. `node scripts/test-chat-ui-state.mjs` checks chat isolation and rebuilding the scroll patch from the locally preserved native bundle. Neither restarts the user's VS Code window or sends model requests.

## Installing and checking

`scripts/reapply-kilo-patches.sh` applies every patch to the local build in a fixed order and re-checks each one with `--check`. Run **Developer: Reload Window** afterwards, when running work can safely be interrupted.

```bash
node examples/patches/skim-mode.test.mjs
node examples/patches/chat-font.test.mjs
node examples/patches/composer-chevrons.test.mjs
node examples/patches/predict-next.test.mjs
node examples/patches/predict-next.test.cjs
node scripts/test-reapply-kilo-patches.mjs
```

- These six run inside `bash scripts/verify.sh` and need no installed extension.
- `node examples/patches/provider-save-message.test.mjs <path to dist/webview.js>` needs the installed bundle, so `verify.sh` only checks that patch's syntax.
- `node examples/patches/predict-next.live.mjs` calls the real model with canned chat endings. It needs the local build's `kilo` binary (override with `KILO_BIN`) and spends provider usage.

## Related instructions and mockups

- `examples/instructions/mockup-standard.md` is the design standard applied to every mockup. Its two absolute paths are replaced by `<ABSOLUTE_PATH_TO_COMPOSER_MOCKUPS>`.
- `examples/instructions/mockup-preview.md` now requires the copyable `file://` link in the final reply.
- `examples/mockups/chat-fonts/index.html` compares chat fonts. It loads Atkinson Hyperlegible and Inter from Google Fonts, so it needs a network connection.
- `skim-mode/mockup/index.html` compares fast-reading treatments of a chat reply. The [skim mode folder](../skim-mode/README.md) explains the choice and has a prompt for other apps.
- `examples/mockups/chatbox-controls/index.html` compares three chat box layouts; Variant A is the one implemented by `composer-chevrons.mjs`.
