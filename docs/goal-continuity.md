# Goal continuity, efficiency and Ponytail

## Completed work

- [x] Add one model-independent Kilo policy: follow-ups update the existing goal, preserve earlier requirements and interpret short approvals in context.
- [x] Require useful evidence, changes or verification from additional calls; use targeted reads, proportional checks and a changed approach after repeated failures. There is no hard call limit that forces incomplete delivery.
- [x] Reuse Kilo's conversation and compaction mechanisms, preserving working state at natural boundaries. No new memory service or forced compaction on every message.
- [x] Load the policy globally for both CTO profiles and whichever Kilo model is selected.
- [x] Embed canonical Ponytail and goal instructions in isolated CTO workers without granting external-file access.
- [x] Embed Ponytail in Claude's context-only proposal workers without granting execution tools.
- [x] Restore Ponytail in Codex while preserving response style; add an automatically applicable Copilot Chat instruction. Audit existing Claude Code, Copilot CLI and Hermes coverage.
- [x] Confirm that the local upstream rules exactly match GitHub blob `bc3595d1a07cff2b135139cadfa4c17ec412667b` at commit `b6c04480c03e8db2f035751d7c46289779ec3362`.
- [x] Test preservation, idempotence, missing-policy failure, restricted worker permissions and guarded rollback; run the repository verification suite.
- [x] Run a real four-message DeepSeek test in one Kilo session, independently verify its output and open the tested conversation in Kilo's UI.

## Installation

Preview with `node scripts/install-goal-policy.mjs`, then add `--apply`. Changes are backed up; model/provider/permission settings are preserved. This installs the global Kilo policy, updates the worker adapters and repairs missing Ponytail coverage without reloading VS Code or interrupting conversations. New instances read the installed policy; existing instances may need **Kilo Code: Reload Config and Skills**.

Restore with `node scripts/install-goal-policy.mjs --restore BACKUP_DIRECTORY`. It refuses to overwrite files edited since installation. The regular CTO installer also installs the goal policy and global reference so reinstallation retains it.

Source: [Ponytail on GitHub](https://github.com/DietrichGebert/ponytail/tree/b6c04480c03e8db2f035751d7c46289779ec3362). This is an instruction policy, not an executable mode or enforcement engine. Explicit user instructions and applicable project rules retain precedence.

## Live results — 2026-10-09

Primary model: `lithosai/deepseek-ai/DeepSeek-V4.1-Flash-ultra`, High, **CTO (Recommended)**. Kilo's SQLite records independently confirm four user messages and thirty assistant steps in one session, all thirty using that DeepSeek model. No workers were needed.

| Message | Model steps | Tool calls | Seconds | Fresh input | Cached input | Output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Build accessible comparison tabs | 23 | 25 | 72.9 | 56,280 | 966,912 | 5,024 |
| Diagnose 12px label spacing; do not edit | 2 | 1 | 8.1 | 15,309 | 82,688 | 322 |
| “Sure.” | 4 | 3 | 26.9 | 17,904 | 184,320 | 1,245 |
| “Is it working now?” | 1 | 0 | 5.8 | 480 | 51,200 | 110 |

These are observed provider-reported counters, not prices or guaranteed budgets. Multiple tools may share a model step. The first CLI launch stopped at its default permission rejection. The successful run used `--auto` for the disposable test, matching the UI's existing auto-approve setting, retaining explicit denies and changing no persistent permissions.

Independent browser assertions verified default Current selection, keyboard and click switching, both selectors and retained values, unchanged review totals, a 12px margin in both panels, no mobile overflow and no browser runtime errors. File snapshots confirmed that diagnosis and status requests made no edits. The short approval applied the proposed fix. Desktop/mobile screenshots were visually inspected.

Session: `ses_ee03953b5ffeNFMBALo587pJqi`, title **CTO goal continuity — DeepSeek validation**. Evidence is saved at `~/.local/state/kilo/validation/goal-policy-2026-10-09/verified.json`, `desktop.png`, and `mobile.png`. The disposable implementation and raw event paths are recorded there. The live test changed no product code.

Run `node scripts/test-goal-policy-live.mjs` for another opt-in paid-model test. It creates a temporary fixture and uses existing Kilo credentials. Browser assertions reuse the installed shared-computer Playwright dependency. An optional first argument selects a prepared `cto-goal-validation-*` fixture; the second selects another model. This test is excluded from unattended `verify.sh`.

## Limits

Follow-up behavior passed; the initial tab implementation still needed 23 model steps, including verification setup and rework. This is not a matched before/after benchmark and does not establish a percentage saving. Other models and larger tasks need their own evaluation. Existing history is not erased, cache remains enabled, and prompts cannot guarantee zero redundant work. Completion and correctness remain more important than token targets.
