# UI entrypoints and verification

Snapshot verified from source on 2026-10-08; paths are relative to the frontend repo.

## Implementation map

- `src/main.jsx` loads design tokens before `index.css`, then base/motion/responsive CSS. Preserve this ordering when editing global styles.
- `src/App.jsx` owns providers, authentication and route composition; `src/pages.config.js` supplies lazy page registrations. Its header says the file is generated and only `mainPage` is editable: inspect the actual generation/registration process before changing routes rather than assuming this comment proves a generator exists.
- `src/Layout.jsx` and `Layout.css` own the shell; `src/components/shell/GlobalHeader.jsx`, `CommandPalette.jsx`, `GlobalSearchInline.jsx`, and `ReputationLogo.jsx` implement shared pieces.
- Pages live in `src/pages/`; tests are usually colocated (`*.test.js`, `*.test.jsx`). Examples include `OverviewPageView.test.jsx`, `ltr-page.test.jsx`, and `review-reply-generator.test.jsx`.
- `src/components/common/PageHeader.jsx` is the established title/description control. `SelectDropdown.jsx` delegates to `IssueFilterDropdown`; date filters, error boundaries, dialogs, skeletons, and drawers already have shared implementations in `src/components/common/`.
- `src/components/ui/` contains Radix-based primitives. Prefer the component already used by the adjacent screen.
- `src/api/base44Client.js` is a compatibility facade for the local auth2 adapter, **not the removed Base44 SDK**. Protected Reputation API calls belong through `backendAuth2Client.js` (`base44` or `request()`), which attaches authorization and centralizes error/refresh handling.
- `src/hooks/useCurrentProperty.js` keys queries by both property and user and binds fetches to that property's ID. Reuse this pattern to avoid cross-property cache contamination during switching.
- `src/lib/query-client.js` fails fast on most 4xx/429 responses, retries transient errors, and disables automatic mutation retries. Do not add local retry loops that bypass those semantics without a task-specific reason.
- Existing HTML injection is constrained by the `react/no-danger` ESLint rule; inspect `src/lib/safeHtml.js` rather than adding raw untrusted HTML.

## Choosing checks

Run from the frontend repo:

| Change | Relevant existing command |
| --- | --- |
| One component/page/hook | `npm run test:unit -- src/pages/OverviewPageView.test.jsx` (replace with actual affected test) |
| Source lint | `npm run lint` |
| Manifest-configured typecheck | `npm run typecheck` |
| Production bundle and budget | `npm run build` |
| Focused browser navigation | `npm run test:e2e -- e2e/navigation.spec.js --project=chromium` |
| Responsive authenticated layout | `npm run test:e2e:responsive` |

Vitest runs under jsdom with `src/test/setup.js`; files included are `src/**/*.{test,spec}.{js,jsx}`. `tests/chat-contract.test.mjs` is a separate Node test invoked by `prebuild`. Typecheck is scoped and `checkJs` is false; use behavior tests for logic correctness.

Playwright defaults to Chromium and `http://localhost:5173`, with `PLAYWRIGHT_BASE_URL` and `PLAYWRIGHT_SKIP_WEBSERVER` overrides. The responsive matrix includes 320, 360, 390, 412, 768 and 1440 widths plus landscape. `e2e/global-setup.js` uses an existing `E2E_ACCESS_TOKEN` or `E2E_EMAIL`/`E2E_PASSWORD`; do not invent credentials or claim authenticated coverage when those tests skip. `e2e/auth-helpers.js` contains external accounts/API stubs. Use the relevant spec's fixture setup rather than assuming every test is fully mocked.

Vite honors `PORT` and may choose another port because `strictPort` is false. Use the URL actually reported by the dev server. The proxy may still point at the production API; resolve the test target before performing mutations.
