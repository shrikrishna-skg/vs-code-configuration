---
name: reputation-ui
description: Implement and verify Reputation Systems React screens, shell navigation, responsive layout, and browser interactions using the existing design system and API adapter. Use for frontend UI changes, not backend-only work or redesigning unrelated products.
---

Locate the current frontend checkout by `package.json` and `src/App.jsx`. Work inside that repo, including when it is an isolated worktree. Read [ui-map.md](references/ui-map.md) for the relevant entrypoints and checks.

Before changing a screen, identify its route, page component, shared components, styles, and existing tests. Distinguish the user's screenshot/reference from code instructions. Preserve the requested behavior and existing loading, empty, error, and selected-property states. Reuse the existing design tokens and matching controls before adding alternatives.

For data-backed UI, use the existing authenticated adapter and property-scoped query patterns. Check the configured backend target before browser writes; the dev proxy can point to production by default.

Verify the affected interaction at a desktop width and the narrowest relevant layout using available browser tools or existing Playwright specs. Inspect overflow, keyboard access, focus, console errors, and failed requests relevant to the change. Use mocked/local test data where appropriate. Choose focused tests first; expand to lint/build or wider coverage when shared behavior changes. Report screenshot evidence as visual evidence, not proof that an untested backend operation succeeded.
