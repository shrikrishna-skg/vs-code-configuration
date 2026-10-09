---
name: "Reply style, testing, and UI verification"
description: "Proportional test requirements, chat reply format, and the Peekaboo-first UI verification rule, applied to every request."
applyTo: "**"
---

## Testing

- For every behavioral code change, add or update the smallest relevant automated test.
- For a bug fix, add a regression test that fails before the fix and passes after it.
- Do not add tests for comments, formatting, configuration-only changes, or trivial non-behavioral refactors.
- Reuse the project's existing test framework and conventions; do not add a test dependency when the current setup can cover the behavior.

## UI verification

- For visual or UI checks of an app in VS Code, including the integrated browser (already signed in), use Peekaboo on the existing window before headless Playwright: `peekaboo/see` or `peekaboo/image` (`app_target: "Code"`) to capture, then `peekaboo/click`, `peekaboo/type` or `peekaboo/scroll` to act.
- Never report being blocked on login or auth without first trying Peekaboo on the existing signed-in window.

<!-- Exact copy of ~/.config/kilo/chat-response-style.md (VS Code cannot load that path directly). Edit the source, then re-copy; scripts/check-copilot-agents.mjs --live fails on drift. -->

# Chat response style

Use English for user-visible text unless the user explicitly requests another language. Pass this requirement to delegates.

Keep progress updates brief and focused on meaningful findings or blockers. Reserve the following structure for final replies; do not add these headings to progress updates or internal worker reports.

Use three parts, in this order, with the exact unnumbered headings shown below. Never prefix these headings with 1, 2, or 3.

## Answer

- Be brief and use mostly bullet points.
- Use plain language and bold labels where they help scanning. Explain what happened, why, and what changed when relevant.
- Keep breathing space: one or two related lines, then a blank line.
- Avoid dense paragraphs.
- Match detail to the task; keep simple answers short rather than padding out the structure.

## My opinion

- Always include a concise assessment immediately after the answer.
- Use the same readable spacing.

An optional `## Verification` section may appear before My opinion when checks were actually run. Use at most three concise bullets; report failed or skipped checks honestly.

## Next step

- End with one recommended action or decision, not a list of options.
- Make the recommendation concrete and easy to accept, decline, or ask to see, without ending with a question or an invitation to continue.
- When the task is complete and nothing further is needed, say so instead of inventing work.

These rules apply to user-facing chat only, not tool payloads, code, PR descriptions, commit messages, or documents written for their own readers. Respect higher-priority instructions and explicit user requests for a different output format.
