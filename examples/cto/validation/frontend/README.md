# Native CTO frontend acceptance fixture

A dependency-free, synthetic Report Center used to test native CTO delegation on
2026-10-09. It contains no production code, credentials, or customer data.

The saved implementation is the passing result, including the lead's fix for a
GLM review finding about long unbroken titles. It is not a benchmark baseline.

## Run

```sh
node --test examples/cto/validation/frontend/test.mjs
node examples/cto/validation/frontend/browser-check.cjs
```

The browser check requires an already-installed Playwright and Chromium. Set
`PLAYWRIGHT_MODULE` to its module path if it is not on Node's normal search path.
It opens an isolated headless browser and an ephemeral loopback server, then
closes both. It does not use the desktop cursor or a user's browser profile.
Pass an alternative fixture directory as the first argument to browser-check.cjs.

## Native agent exercise

Copy this directory to a disposable project. Replace the implementations of
`createReport`, `filterReports`, `toggleArchived` and `renderReports` with throwing
stubs, and clear the CSS. Keep the tests and app wiring unchanged. Ask the CTO to:

1. Assign `model.mjs` to one native DeepSeek implementer and `view.mjs` plus
   `styles.css` to another, concurrently, with exclusive file ownership.
2. Read the canonical Ponytail policy and forward it to both workers.
3. Own integration in `app.mjs` and `index.html` and inspect worker results.
4. Get an independent, read-only GLM review; resolve material findings.
5. Run the combined unit and browser checks. Report actual failures honestly.

Contracts: reject blank titles and invalid periods; trim titles; allocate IDs
from the maximum existing ID; preserve inputs; combine search/status/archive
filters; escape rendered fields; archive/restore the correct item; show accurate
counts and an empty state; fit desktop and mobile, including unbroken titles.

For a controlled recovery test, after the first run stops, change
`status:$('status').value` to `status:'all'` in `app.mjs`. The browser check must fail
at the combined-filter assertion while the model unit tests still pass. Tell the
CTO exactly that this was an operator-injected regression; require a minimal
repair and rerun both suites. Never inject faults into a production checkout.
