# CTO implementation checklist

> **Historical record.** This page records the 2026-10-09 CTO rollout and later evaluation notes. Version-sensitive details describe the builds used then; see [Configuration inventory](configuration-inventory.md) for the current 7.8.12 snapshot.

Requested outcome: replace the six custom Kilo picker entries with **CTO (Recommended)** and **CTO + JEV**, sharing one operating policy. Support up to fourteen concurrent specialist workers, including up to six writers, with explicit ownership, resumable assignments and evidence-based completion. Built-in modes remain available.

## 1. Inventory and recovery
- [x] Inspect repository changes without overwriting existing work.
- [x] Identify the installed custom Kilo extension and live model routes.
- [x] Inspect existing delivery, evidence and worktree tooling for reuse.
- [x] Locate the actual runtime's task, concurrency and isolation implementation.
- [x] Back up every live file changed; provide a bounded restoration command.

## 2. Profiles and picker
- [x] Create a shared CTO policy covering planning, direct work, delegation, recovery and verification.
- [x] Create CTO (Recommended) and CTO + JEV; keep JEV advisory and selective.
- [x] Reuse live model routes; make route changes explicit.
- [x] Supply bounded implementation, investigation, test, review and utility roles.
- [x] Retire the six old picker entries without losing their recoverable definitions.
- [x] Update default and persisted selection; verify picker ordering.

## 3. Execution controls
- [x] Implement or configure a shared fourteen-worker limit and six-writer limit.
- [x] Prevent nested delegation from bypassing limits.
- [x] Record task dependencies, exclusive scope, status, model, session and verification requirements in private task records.
- [x] Dispatch only ready tasks; protect overlapping paths. Shared external resources remain a CTO planning responsibility.
- [x] Use isolated Git worktrees for concurrent code changes where supported.
- [x] Handle cancellation, failures and restarts without falsely releasing live worker ownership.
- [x] Preserve original user changes and constrain integration to assigned work.

## 4. Completion and context
- [x] Define project-brief and decision-record policy; persist assignment evidence and source snapshots.
- [x] Separate worker completion from CTO acceptance and integration.
- [x] Enable independent review with fresh context and specific acceptance criteria.
- [x] Recheck the combined revision; never equate an agent summary with successful verification.
- [x] Document remaining native/runtime limits accurately.

## 5. Validation and rollout
- [x] Test dependency ordering, capacity rules, ownership conflicts, failed checks, quarantine and cancellation.
- [x] Resolve both profiles against the installed runtime; exercise Opus, DeepSeek, GLM, Luna, JEV and CTO tool access.
- [x] Install the tested files in the live configuration.
- [x] Verify a direct CTO tool call and concurrent bounded work in a disposable repository.
- [x] Verify the two custom picker entries in VS Code without interrupting unrelated active work.
- [x] Run relevant repository checks and record results.
- [x] Record rollback instructions, limitations and outstanding benchmark work.

## Follow-up evaluation (after functional rollout)
- [x] Exercise the Luna utility route and an actual JEV advisory call.
- [x] Test abrupt supervisor termination and recovery across MCP restarts.
- [ ] Compare representative tasks at one, four, seven and fifteen total-agent ceilings.
- [ ] Measure accepted outcomes, elapsed time, rework, conflicts and model usage.
- [ ] Evaluate JEV separately from model routing and concurrency.

## Findings

At rollout time the installed extension was `shrikrishna-skg.kilo-code-local` 7.8.2. The current 2026-10-18 snapshot used 7.8.12; this section remains a historical rollout record. Live worker profiles use LithosAI routes, unlike older repository examples. Existing delivery tools explicitly note that native task children share their checkout. The new service uses isolated CLI sessions instead. Live parallel writing and guarded integration were verified in a disposable repository.

## Rollout evidence — 2026-10-09

- Installed the two CTO profiles and service in `~/.config/kilo`; retired profiles remain recoverable but hidden. Configuration validation reported **No config warnings**.
- In the running VS Code window, reloaded Kilo configuration without reloading VS Code. Confirmed the picker contains the two CTO profiles and built-in modes. A new empty Kilo session selected **CTO (Recommended)** and **Claude Opus 5.5 High (Local CLI)**.
- A real Opus CTO call to `cto_status` succeeded and returned limits of **14 workers / 6 writers**, with no active jobs.
- A DeepSeek writer and GLM investigator ran against isolated snapshots. The investigator saw the original value; the writer changed only its assigned file and passed its check. The original checkout remained unchanged until acceptance.
- Two DeepSeek writers produced separate modules concurrently. Both individual checks passed, both patches were accepted, and the combined import/assertion check passed in the destination.
- `node scripts/test-cto.mjs` passed: capacity rules, accepted dependencies, dirty snapshots without index changes, scope quarantine, destination edit protection, failed checks, cancellation, read-only acceptance and installer rollback. These use a deterministic fake worker, not fourteen paid live model sessions.
- JavaScript syntax checks and `git diff --check` passed. The full `scripts/verify.sh` run stopped at the existing `scripts/test-typesafe.mjs:17` parser: it passes commented `examples/kilo.jsonc` directly to `JSON.parse`. Full repository verification is therefore **not passing**.
- Live backup: `~/.config/kilo/backups/cto-2026-10-09T07-09-19-584Z`. Restoration command:

  ```sh
  node scripts/install-cto.mjs --restore ~/.config/kilo/backups/cto-2026-10-09T07-09-19-584Z
  ```

The functional rollout is complete. Maximum provider-load reliability, model routing quality and speed/defect comparisons are still unmeasured; the ceiling is capacity, not a recommendation to use fifteen agents on every task.

## Expanded validation and selected label — 2026-10-09

- [x] Keep **CTO (Recommended)** in the dropdown but display **CTO** in its selected button. Verified both states in the running VS Code editor; **CTO + JEV** retains its own label. No agent identity/model changes.
- [x] Test display-patch idempotence, surgical restoration and refusal on ambiguous/unknown bundles; verify both installed bundles. Preserve the live update hook's existing prompt-suggestions patch.
- [x] Exercise 21 concurrent submitter processes with deterministic worker subprocesses. Observed fourteen active workers and six writers, checked role limits, then drained the queue. This tests actual scheduler/process concurrency, not fourteen concurrent provider calls.
- [x] Restart the MCP service while jobs remain active. Kill one supervisor, confirm its surviving child retains capacity, then kill the child and confirm failure reconciliation releases a slot to queued work. Twenty remaining jobs reached ready; the deliberately interrupted job remained failed.
- [x] Run a real Luna utility worker: only the assigned JSON field changed, its assertion passed, and the patch was accepted.
- [x] Call real JEV with synthetic evidence. The first request timed out at the existing one-second budget and correctly returned unavailable; a bounded retry with a five-second allowance returned advice in approximately 253 ms. It supported the observed unit check and rejected the claim that unrun integration checks were verified. No production data was sent; the live timeout policy was not changed.
- [x] Repair the repository check's handling of whole-line JSONC comments and refresh stale global-agent/favorites test anchors. The full `bash scripts/verify.sh` now reports **Configuration verification passed**; it includes the new CTO concurrency and label checks. The earlier rollout failure above is historical.

Remaining quality evaluation is about representative engineering outcomes and provider performance, not whether the configured scheduler ceiling exists. The maximum is still an optional ceiling, not a default team size.

### End-to-end finding and correction

The first live orchestrated test correctly dispatched two isolated DeepSeek workers, but the CTO then scheduled a wakeup and ended its turn before review/acceptance. This was not accepted as successful completion. The fix adds bounded `cto_status` waits (maximum 20 seconds), denies `schedule_wakeup` in both CTO profiles, and explicitly requires current-turn review, acceptance and integration checks. Automated checks exercise wait deadlines, invalid limits and early return on state changes.

The updated live configuration has backup `~/.config/kilo/backups/cto-2026-10-09T07-13-21-631Z`; restore this first to undo the workflow follow-up, before using the original rollout backup if fully rolling back.


- [x] **Final live end-to-end rerun passed:** one Opus CTO submitted two DeepSeek implementers before waiting; used `cto_status` with `waitMs: 20000`; inspected worker diffs; accepted both patches; and ran the original repository's three tests with **3 passed / 0 failed**. The entire cycle finished in the same turn, with no scheduled wakeup. An independent check confirmed two accepted jobs, passing worker checks, and changes only to `normalize.mjs` and `unique.mjs`; acceptance fixtures remained unchanged.
- [x] Reran full repository verification after the bounded-wait fix: **Configuration verification passed**. Live configuration reports no warnings, and installed service/policy files match repository sources.

Private live-test artifacts are retained under `/private/var/folders/_c/glmm06ws2q546h8fvqf6mq200000gn/T/cto-live-validation-Q3nR2r` for this session. The first incomplete run's unaccepted jobs were cancelled; the final run's jobs are accepted and no test workers remain active. These scratch artifacts are temporary, not a durable audit store.
