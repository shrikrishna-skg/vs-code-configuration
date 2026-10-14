# Prompt: add skim mode to another app

Paste the prompt below into a coding agent working on the target app. Replace `<APP NAME>` with the app and `<ABSOLUTE_PATH_TO_REPO>` with where this repository is checked out.

```text
Implement "Skim mode" for assistant chat replies in <APP NAME>.

GOAL
In every assistant reply, the first sentence of each paragraph and list item keeps the
normal text colour. The rest of that paragraph or item is shown at 55% of the text colour.
The reply text itself must never change.

REFERENCE (a working version in Kilo Code; reuse its logic, change only the selectors)
<ABSOLUTE_PATH_TO_REPO>/examples/patches/skim-mode-ui.js

RULES
1. Painting: use the CSS Custom Highlight API (CSS.highlights plus ::highlight(skim-detail))
   with color: color-mix(in srgb, <current text colour> 55%, transparent).
   Do not wrap text in spans or edit the DOM or markdown, so copy, search, selection and
   screen readers keep working.
2. Scope: only the assistant reply markdown container (in Kilo:
   [data-component="text-part"] [data-component="markdown"]). Dim only <p> and <li>.
   Skip anything inside <pre> or <table>. In a list item, dim only text before a nested list,
   and skip list items that contain their own <p>.
3. Sentence end: . ! or ? (plus closing quotes or brackets), then a space, then a capital
   letter, a digit or a code span. Ignore e.g., i.e., etc., vs., approx., fig., inc., ltd.,
   dotted initials and list numbers like "1.". Never split inside code, kbd, links or math.
   The first sentence must be at least 25 characters and the rest at least 20, otherwise
   the block stays fully bright. Text in scripts without capital letters stays bright.
4. Streaming: the last block of a reply that is still being written stays bright. A reply
   counts as finished 1.2 s after its last change. Watch with a MutationObserver and batch
   work in requestAnimationFrame.
5. Toggle: Ctrl+Alt+S (Ctrl+Option+S on Mac) turns it on and off. Save the choice in
   localStorage key "<app>.skimMode" as "on" or "off". Default is on.
6. Turn it off automatically in high-contrast and forced-colours modes. Recompute the
   colour when the theme changes. If the Highlight API is missing, do nothing.
7. Delivery: if this is our own source code, add it at the chat rendering layer. If it is
   an installed third-party app, ship it as a reversible patch with --apply, --check and
   --restore, keep a backup, and add it to the update reapply process. Change nothing else.

DONE WHEN
- One small test of the sentence-split function passes, covering a normal two-sentence
  point, "e.g.", a decimal like 1.2, and a remainder that is too short.
- In the running app, a reply with three bullet points shows each first sentence bright and
  the rest dimmed. Code blocks and tables are untouched. The toggle works and is remembered
  after a reload. A streaming reply does not flicker.
```

## Where it fits

- **Works directly:** apps whose chat is a web page you can add code to, such as VS Code extensions, Electron apps and our own web apps.
- **Needs a wrapper:** hosted sites you cannot change need a browser extension or a user script that runs the same helper.
