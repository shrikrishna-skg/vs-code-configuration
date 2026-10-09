# Clarify goal

The existing Kilo wand is labeled **Clarify goal**. It always sends the draft, supported attachments and a bounded slice of recent conversation to **DeepSeek V4.1 Flash Ultra on LithosAI**, independently of the main chat's selected model. It then shows an editable **Review your goal** panel. **Use this prompt** applies the text without sending it. Cancel dismisses that preview and keeps the draft. Attachments remain in the composer.

The clarification model must preserve scope, inspection-only requests, constraints and file references. It should leave a clear request nearly unchanged and ask one question when a materially ambiguous request cannot be resolved. A short approval needs a preceding assistant proposal; it must not create authorization from unrelated history. These are model instructions, not a guarantee of perfect interpretation, so the preview remains editable.

While the request runs, the button displays **Clarifying goal…** beside the existing loading animation. A visible panel identifies the DeepSeek/LithosAI model and offers **Stop**. Stopping aborts the request and cleans up its temporary session; the panel shows **Stopping clarification…**, then **Clarification stopped** after acknowledgement. Late replies cannot replace the draft or open a result preview. The main chat is not stopped. The wand remains disabled until completion, failure or cancellation to prevent duplicate requests.

Loading text uses the theme's input foreground rather than the generic disabled icon color. Light, dark, high-contrast and forced-color themes are supported; reduced-motion settings keep the status visible without animation.

## Implementation

- `examples/patches/clarify-goal.cjs` uses the existing Kilo SDK and fixed route `lithosai/deepseek-ai/DeepSeek-V4.1-Flash-ultra`. One normal model response, no worker fan-out, no repository exploration. If the route is unavailable, clarification fails visibly without changing models. A temporary session and hidden `goal-clarifier` agent both deny every tool. Cleanup aborts and deletes only the temporary session.
- Cancellation uses an AbortController scoped to the requesting Kilo provider and request ID. It can interrupt provider lookup, context loading or model generation. A late session-creation response is cleaned up before cancellation is acknowledged. Another composer cannot cancel that request; restarting after cancellation is supported.
- The hidden agent allows two steps because setting one causes Kilo to inject its maximum-step closing instruction into the first response. Normal successful clarification still uses one model call.
- Recent context is limited to twelve fetched messages and eight retained text excerpts of up to 850 characters. Tool results and synthetic text are omitted. This may omit older decisions; ambiguous requests must ask rather than invent context.
- Up to eight explicitly attached files are accepted. Supported inline images/PDFs require declared model support; text references must be regular files under 128 KB and each excerpt is limited to 6,000 characters. Unsupported attachments fail visibly. No silent model switch or image omission.
- The canonical Ponytail policy at `~/.config/ponytail/AGENTS.md` is included. Existing execution models, provider credentials, permissions and other agents are preserved.
- `clarify-goal-ui.js` supplies the inline panel and label. The request snapshots the draft, attachments, chat, model, variant and agent; applying a response after those change is refused. The original undo mechanism is retained.
- `clarify-goal.mjs` patches the installed local Kilo 7.8.2 bundles at exact known anchors and refuses unsupported bundles. The existing reapply watcher includes the new patch. New Kilo builds may require refreshed anchors.

## Installation and rollback

```sh
node scripts/install-clarify-goal.mjs          # preview
node scripts/install-clarify-goal.mjs --apply
node scripts/install-clarify-goal.mjs --restore /absolute/path/to/backup
```

The installer saves a manifest and the original files beneath `~/.config/kilo/backups/clarify-goal-*`. Restoration refuses to overwrite files changed after installation. If there are multiple install backups, restore the newest first. Existing VS Code windows need **Developer: Reload Window** when their running work is finished; a newly opened window loads the installed bundles.

## Verification

```sh
node scripts/test-clarify-goal.mjs
node scripts/test-clarify-goal.mjs --ui  # installed local Playwright/Chrome
bash scripts/verify.sh
```

Checks cover denied tools, fixed routing despite a different main model, missing-route refusal, context limits, unsupported media, failed-provider cleanup, patch idempotence, installer preservation/rollback, editable preview, cancel, stale-draft protection, attachment retention, Escape, text injection and a narrow viewport. Stop checks cover early cancellation, generation cancellation, cross-composer isolation, late session creation, restart, keyboard activation, late-result suppression and validation after stopping.

Loading-state checks use the installed Kilo stylesheet and cover reactive button redraws, four light/dark/high-contrast color pairs, 320px and 900px viewports, at least 4.5:1 text contrast in those pairs, animation, reduced motion, forced colors, keyboard focus and return to the idle label. These checks do not guarantee contrast for every custom theme palette.

Real DeepSeek V4.1 Flash Ultra tests on 2026-10-09 preserved an inspection-only request, retained an explicit 12px requirement, and asked for clarification on an ambiguous “Sure.” Each corrected text case returned in about 3.1–3.3 seconds with zero tool calls. An image test correctly identified the screenshot's **Use this prompt** label, which was absent from the written request. This is a small functionality sample, not a general latency or accuracy guarantee. The installed button was also observed in a new Kilo window. Evidence is stored locally under `~/.local/state/kilo/validation/clarify-goal/`.

The later fixed-route test deliberately supplied a different main model. Actual text and image responses both identified the LithosAI DeepSeek route; they returned in 3.60 and 3.42 seconds. The image response correctly identified a **Continue** button that was not named in the written request. A live cancellation test executed the installed extension's message handler against the running Kilo backend: it emitted only the cancellation acknowledgement, aborted and deleted the temporary session, and confirmed deletion. A second check confirmed an assistant response was still in progress before issuing Stop; cancellation and cleanup completed in 0.98 seconds. This small sample is not a cancellation latency guarantee. Stop-panel rendering was tested in a headless browser with the installed Kilo stylesheet; the new controls have not been clicked in an existing native VS Code window.
