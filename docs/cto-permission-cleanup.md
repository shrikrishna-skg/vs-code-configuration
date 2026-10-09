# Approved CTO cleanup — October 9, 2026

This update implements the approved C1–C12 audit items in the existing Kilo setup. It removes unnecessary command blocks and conflicting instructions while retaining the K controls and leaving R1–R5 permission-boundary reviews unchanged.

| Item | Result |
|---|---|
| C1–C2 | Remove global `echo *`, `true`, and `:` entries only when their value is `deny`. Keep other shell rules and loop protection. |
| C3 | Reserve Answer / My opinion / Next step for final replies; keep progress updates brief. Preserve English by default and allow requested languages. |
| C4 | Remove the per-task numerical tool-call target from active lean instructions. |
| C5 | Ask only about material ambiguity; do not require exact current/target values or a separate contract for every change. |
| C6 | Choose source inspection, rendered measurements or both according to evidence. |
| C7 | Match verification to risk, including rendered checks for CSS-only changes where appropriate. |
| C8 | Default to one useful mockup preview; use multiple browsers/artifacts when requested or justified. |
| C9 | Summarize the top five findings but report every critical issue. |
| C10 | Preserve finite budgets: CTO 100, DeepSeek 45, GLM 14, Luna 8. Add explicit incomplete-work handoffs before exhaustion. |
| C11 | Reassess a repeated failed approach after two unsuccessful attempts; keep working through supported alternatives when available. |
| C12 | Route all six installed delivery commands through `CTO (Recommended)` with no command-level model override; align active delivery/worktree skills. |

The C10 row records the original cleanup. A subsequent approved update raised the native iteration budgets to **300/150/60/20**; see [current native budgets](cto-native.md#iteration-budgets). Other protections and handoff instructions remain in place.

The step-limit handoff is a model instruction, not a new runtime checkpoint or guarantee that a model reports before the platform forces its final response. The CTO must inspect partial results before resuming or reassigning. Command-level model overrides are removed; whether an agent switch retains the selected model still depends on the Kilo surface. Existing model settings are not changed.

## Install and restore

This is a migration for the existing installed CTO setup, not a standalone bootstrap installer. Review the target list first:

```sh
node scripts/install-cto-cleanup.mjs
node scripts/test-cto-cleanup.mjs
node scripts/install-cto-cleanup.mjs --apply
node scripts/install-cto-cleanup.mjs --check
```

The installer updates active instructions, native roles, delivery commands, the installed delivery/worktree skills and existing Copilot response/review copies. It preserves role frontmatter (models, variants, step limits and permissions), other global settings, providers, credentials and MCP configuration. Canonical Ponytail is not edited. Copies stored under the delivery upgrade directory are updated too, so they do not restore obsolete routing accidentally.

Changed files are backed up privately under `~/.config/kilo/backups/cto-cleanup-*`. Restore using the exact reported directory:

```sh
node scripts/install-cto-cleanup.mjs --restore /absolute/path/to/backup
```

Restoration refuses to overwrite files changed after installation. No VS Code window is automatically reloaded. When work is idle, use **Kilo Code: Reload Config and Skills**, then start a fresh CTO conversation; existing chats may retain old instructions. Use **Developer: Reload Window** if configuration/skill reload is insufficient.

## Verification and boundaries

The runnable cleanup check covers dry-run behavior, selective removal of the three denials, preservation of unrelated permissions/model settings, finite budgets, active skill and command updates, idempotence, and guarded rollback. It also verifies that an explicit `echo` value of `ask` is preserved. The cleanup check is part of `scripts/verify.sh`.

Live installation is checked by comparing the configuration and role frontmatter before/after and by asking the installed Kilo executable to load its resolved configuration. Prompt wording changes are not evidence of measured model speed, better accuracy or guaranteed adherence. The earlier native multi-agent tests remain recorded in [native CTO validation](cto-native.md).

October 9 results: the full repository verification suite passed. The installed Kilo executable loaded all six updated commands without command-level model overrides and all five native roles with their unchanged step budgets and new handoff instructions. The before/after comparison confirmed only the three approved global permission entries were removed. No live provider benchmark or model-behaviour experiment was run for this instruction cleanup.

Deferred R items remain unchanged: the GLM shell allowlist, native worker/writer ceilings, the three worker types, the JEV tool-family permission and external-directory exceptions. Native scheduling ceilings remain policy, not runtime-enforced caps. Ownership, verification, leaf-worker restrictions, one desktop operator and no hidden scheduler fallback remain in place.
