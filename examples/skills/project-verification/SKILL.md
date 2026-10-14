---
name: project-verification
description: Choose and run focused verification for Reputation Systems frontend or backend changes, reporting actual behavior evidence and separating existing failures from regressions.
---

# Project verification

Use the existing repository tests before adding another harness. Read the task, changed code, callers, and applicable project instructions. Forward `~/.config/ponytail/AGENTS.md` when delegating coding work. Select the smallest checks that could fail if the requested behavior breaks; broaden only for new failures or unresolved risk.

## Actual repository layout

The project parent is `~/Downloads/Code/Reputation Systems App`. Its `frontend` and `backend` are separate Git repositories. Pass the active frontend or backend worktree itself as `--project` when implementing elsewhere; the runner accepts an umbrella directory or a single component repository. Never silently test the main checkout instead.

- Frontend: React/Vite; Vitest `npm run test:unit -- <relative-test-path>`; TypeScript check `npm run typecheck`; focused ESLint `node_modules/.bin/eslint -- <changed-file>`; `npm run build` includes the existing chat-contract prebuild check and bundle budget.
- Backend: Java 21, Spring Boot 3.5.3, Maven wrapper `./mvnw`. Use selected fully qualified non-context unit test classes. `src/test/resources/application-test.yml` defines H2 test settings; `test-db` explicitly uses **existing saved PostgreSQL data** and is outside the runner. A test profile is not proof that all external integrations are mocked.
- Do not use frontend `dev:api`: it currently refers to a stale sibling directory. Do not run migration, seeding, cleanup, deploy, or production checks as ordinary verification.

## Scoped runner

Installed tool: `~/.config/kilo/upgrades/delivery-v1/tools/verify-project.py`. It uses Python stdlib and plans by default; it neither installs dependencies nor starts application services except for an explicitly selected browser scope.

```sh
python3 ~/.config/kilo/upgrades/delivery-v1/tools/verify-project.py \
  --project '~/Downloads/Code/Reputation Systems App' \
  --scope frontend-unit --test src/path/changed.test.jsx \
  --scope frontend-lint --file src/path/changed.jsx
```

Replace example paths with existing relevant files. Add `--execute` to run the reviewed scope. `--scope frontend-typecheck` and `--scope frontend-build` are available when relevant. Build writes `dist`; Sentry upload credentials are removed/disabled by the runner. Backend selection:

```sh
python3 ~/.config/kilo/upgrades/delivery-v1/tools/verify-project.py \
  --project '~/Downloads/Code/Reputation Systems App' \
  --scope backend-unit \
  --backend-test com.java_hotel.common.OperationalCategoryNormalizerTest
```

The runner rejects database/context/container test patterns as a conservative preflight; it is **not a sandbox** for arbitrary test code, transitive helpers, Maven plugins, or project config. Review the selected code and environment. Context/integration tests require a separately reviewed disposable environment, not a workaround bypassing this preflight.

Execution continues through independent checks and returns nonzero for any failure, timeout, missing runtime, or incomplete browser result. Existing credential-supplied responsive checks remain incomplete even when layout passes, because they do not assert successful login or protected-page content; use `browser-verification` for that independent acceptance evidence. Optional `--report <path>` saves metadata only: scope, status, exit code, timing and test counts. Raw test output is suppressed so the runner does not write credentials to reports. Diagnose a failure with the smallest direct check in a trusted local terminal; keep secrets out of chat and reports.

## Completion evidence

After relevant checks pass, report behavior tested, actual command/scope, result, and any unchecked acceptance criteria. If existing lint/typecheck failures predate the change, distinguish them from the change using a focused check or baseline comparison. Never call skipped tests, planning output, generated screenshots, or a running dev server a passing behavior test. For visible UI changes, also use `browser-verification`.
