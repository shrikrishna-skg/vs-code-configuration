---
name: browser-verification
description: Verify Reputation Systems UI changes with isolated browser feedback, relevant existing Playwright checks, responsive inspection, and explicit authenticated versus mocked coverage.
---

# Browser verification

Inspect the requested page, implement the smallest relevant change, then verify the actual interaction, layout, console/page errors, and relevant failed network requests. Use the active worktree and its project instructions. Coding delegates must also read `~/.config/ponytail/AGENTS.md`.

## Environment matters

The project parent `~/Downloads/Code/Reputation Systems App`. Frontend lives in `frontend`; its existing `playwright.config.js` defaults to `http://localhost:5173`, normally starts Vite, and supports Chromium plus optional browser/responsive matrices.

**Vite's API proxy defaults to the production API** unless explicitly overridden. A localhost frontend alone is not a safe test environment. Use a disposable local/test API and explicit `VITE_API_PROXY_TARGET` and `VITE_BASE44_BACKEND_URL`. Do not reuse a user's existing dev server unless its effective upstream is verified; changing the test process environment does not reconfigure an already running server. Do not launch `dev:api` (stale path), seed data, or submit production mutations to obtain screenshots.

For manual product inspection, preserve Astra's existing workflow: prefer Peekaboo with the signed-in VS Code integrated browser first, using its available documented tools. Inspect the relevant page without reloading VS Code or interrupting ongoing work. Automated verification uses a separate dedicated test browser/server; do not attach the user's Chrome profile to those tests. Reuse existing Playwright specs for their established contracts, and distinguish those contracts from acceptance criteria they never assert.

## Existing coverage and limits

- `e2e/console-clean.spec.js` checks public route console/page errors with account/backend/third-party stubs. `e2e/a11y.spec.js` gates critical accessibility violations and surfaces serious issues. These are useful **mocked/public coverage**, not proof of authenticated dashboard behavior or full accessibility compliance.
- `e2e/authenticated-responsive.spec.js` visits product route paths and checks horizontal overflow and mobile input sizes; it does **not** assert successful authentication or protected content. A stale supplied token may redirect to a login page whose layout still passes. These results alone cannot establish authenticated acceptance. It needs `E2E_ACCESS_TOKEN` or `E2E_EMAIL` + `E2E_PASSWORD`; optional `E2E_PROPERTY_ID` selects a test property. Without credentials it skips. `global-setup.js` logs in through `/api/auth/login` when a token is absent. Supply test credentials via environment or a local secure mechanism; never put keys/passwords in CLI arguments, chat, screenshots, or committed files.
- Other specs, especially integration/setup flows, need separate review of their data/service effects. Do not run the entire browser suite by default.

## Scoped runner

`~/.config/kilo/upgrades/delivery-v1/tools/verify-project.py` plans browser checks without launching a browser:

```sh
python3 ~/.config/kilo/upgrades/delivery-v1/tools/verify-project.py \
  --project '~/Downloads/Code/Reputation Systems App' \
  --scope browser-public \
  --base-url http://127.0.0.1:5299 --api-url http://127.0.0.1:8099
```

The ports are examples: select an unused frontend port and the actual disposable API origin. Add `--execute --allow-browser-tests` to execute the reviewed checks. It reuses the repository Playwright configuration through a temporary local override, starts a dedicated Vite server with `--strictPort`, refuses server reuse, and overrides both proxy variables. It does not start/seed the API. It explicitly runs representative Chromium viewports at 1440×900 and 390×844. For credential-supplied layout checks select `--scope browser-authenticated` with test auth environment already available. The runner refuses missing credentials, treats skipped/empty results as incomplete, and records even successful credential-supplied layout runs as **incomplete** with `authenticationAcceptance: not-established`. Independently verify successful login and actual protected-page content through the signed-in browser before claiming authenticated acceptance; the runner does not infer those facts from a token or viewport assertions. Raw output is suppressed. Traces, screenshots and video are disabled in this runner to avoid accidentally persisting test credentials; collect deliberate, sanitized visual evidence through the browser integration instead.

## Feedback loop

Check the changed interaction at the user's target size and one materially different width. Inspect loading, empty, success and error states only where the change affects them. Check keyboard/focus and overflow for changed controls. Capture a real screenshot only when it helps assess the result; identify mock data explicitly.

Fix failures caused by the change and rerun the affected check. Stop broadening after relevant checks pass. Report the exact route/state, viewport, whether data/auth was mocked or real test data, console/network findings, and remaining limitations. A screenshot cannot prove a backend transaction; a skipped auth suite cannot prove an authenticated UI.
