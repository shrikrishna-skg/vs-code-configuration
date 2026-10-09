# Adaptive CTO — October 9, 2026

This adds three **VS Code user tasks**, each opening an isolated Kilo terminal session. It does not replace the native Kilo chat picker or change its default. The earlier minimal pilot remains available separately.

## Routes and models

```text
You choose the work mode once for the session
│
├─ CTO — coordinated work
│  └─ Selected premium CTO
│     ├─ Understand goal, investigate material uncertainty, divide independent work
│     ├─ DeepSeek implementers: 0–6
│     ├─ GLM investigators: 0–6
│     ├─ DeepSeek test authors: 0–4
│     ├─ GLM reviewers: 0–3
│     ├─ Luna mechanical workers: 0–2
│     └─ Inspect patches, accept them, verify the integrated result
│
├─ CTO — routine edits
│  └─ One DeepSeek session for successive scoped requests
│     ├─ Clear request → edit snapshot → run agreed check → publish patch
│     ├─ Missing user intent → ask one focused question before editing
│     └─ Technical uncertainty → read-only premium CTO consultation on demand
│
└─ CTO — mechanical work
   └─ One Luna session with the same scope, check and publication controls
```

Role ceilings share a **14-worker total and six concurrent worker-writer limit**. They do not add together. Test authors and Luna workers consume writer slots. One managing CTO plus fourteen workers means at most fifteen agents for a coordinated task; use fewer when dependencies or task size make parallelism unhelpful. The manager's own direct edits are not scheduler workers, so it must avoid worker-owned paths and leave room within the intended writing budget.

At installation on this machine, the routes are:

| Responsibility | Model route |
|---|---|
| Premium CTO; optional routine adviser | `openai/gpt-6-astra-ultrafast`, editable at task launch |
| Implementation and test authorship | `lithosai/deepseek-ai/DeepSeek-V4.1-Flash-ultra` |
| Investigation and independent review | `lithosai/zai-org/GLM-5.3-Flash-ultra` |
| Mechanical work | `openai/gpt-5.6-luna-fast` |

Worker models are read from the existing installed specialist files, not duplicated in a second model registry. The installer uses the global configured model as the initial CTO choice; it does not read a particular native chat's dropdown. No silent model fallback is added.

## Install and use

Prerequisites: existing Kilo authentication/custom providers, canonical `~/.config/ponytail/AGENTS.md`, and the installed DeepSeek/GLM/Luna specialist profiles. The repository checkout must remain at its installed path because the tasks reference its scripts. No new package dependency is installed.

```sh
node scripts/install-adaptive-cto.mjs          # preview
node scripts/install-adaptive-cto.mjs --apply  # back up and merge user tasks
```

In VS Code, open the **Git repository root**, select **Terminal → Run Task**, then:

- **Kilo: CTO — coordinated work** for a feature, investigation, risky change or several independent components. Select the CTO model and supported reasoning variant; type the goal in the terminal session.
- **Kilo: CTO — routine edits** for a series of clear changes within one agreed scope. Supply the scope, check and task family once; send successive requests in that same session.
- **Kilo: CTO — mechanical work** for precisely specified repetitive transformations, using the same publication controls.

For routine work, an example scope is `src/components/ReportTitle.tsx,src/components/report.css`; an example check is `["npm","run","test:report"]`; a task family is “Report title and spacing edits only; preserve filtering and account selection.” The check must exist and meaningfully validate that work. Empty scope/check/intent and shell-wrapped checks are rejected. A parent folder containing several separate Git repositories is not a repository root.

The launcher is also available directly:

```sh
node scripts/run-adaptive-cto.mjs --mode routine --dir /absolute/repo \
  --scope 'src/components/report.css' \
  --check '["npm","run","test:report"]' \
  --intent 'Report typography only; preserve layout and controls'
```

This is explicit session routing. It avoids calling an expensive model merely to classify every small message, and avoids a fragile keyword classifier making scope decisions. A routine consultation gives advice; it does not automatically transfer the conversation or expand scope. Start coordinated work when the goal outgrows the agreed scope.

The installed Kilo terminal's footer may say **BUILD**; that is its interface mode label. The response footer identifies the actual agent and model. The interactive launcher was checked against the stored session metadata and used **CTO Coordinated / GPT-6 Astra Ultrafast / high**, as requested.

## Publication and ownership

1. The routine launcher reserves a slot and file scopes in the existing shared scheduler. Conflicting writers cannot start. A session keeps its slot until it closes; close idle sessions when other work needs those paths.
2. It snapshots non-ignored project files, including local uncommitted work, in a private Git worktree. It does not change the user's branch or index.
3. The specialist can read the snapshot and edit its approved paths. Shell execution, arbitrary external-directory access, delegation and unrelated services are disabled in this mode. The supervisor runs the predetermined check.
4. `routine_publish` rejects out-of-scope patches, failed checks and source changes since the snapshot. The full-source comparison catches dependency changes outside owned paths too.
5. A passing patch is applied to the original working tree, and the private worktree gets a checkpoint for the next request. These checkpoints do not create commits on the user's branch.
6. `routine_status` reports publication count and check evidence. A failed patch remains isolated for inspection; it is not described as delivered. Close and reopen from current source after a freshness conflict.

Coordinated workers retain the existing review/accept process and ownership rules. Provider configuration is now forwarded into isolated worker config homes, preventing custom model routes from disappearing while removing accidental inheritance of unrelated global prompt layers. Canonical Ponytail instructions remain in the CTO and worker contexts, along with applicable project rules. User-facing replies follow **Answer → My opinion → Next step**, optionally including Verification after Answer.

The CTO mode retains the existing computer-control service. Routine modes intentionally concentrate on scoped file changes; they do not enable desktop control. These are tool permissions and Git checks, not an operating-system sandbox. A preapproved test executes local code with normal user permissions. External editors do not participate in the scheduler's lock.

Ignored dependencies such as `node_modules` are not copied into snapshots. A check that needs unavailable dependencies fails visibly; prepare the isolated environment or use coordinated work to handle that setup. Do not treat this as permission to install or alter the original project's dependencies implicitly.

## Verification and speed

Reproducible checks:

```sh
node scripts/test-adaptive-cto.mjs
node scripts/test-cto-concurrency.mjs
bash scripts/verify.sh
# Opt-in real-provider calls, only against generated disposable repositories:
node scripts/test-adaptive-cto-live.mjs routine
node scripts/test-adaptive-cto-live.mjs image
node scripts/test-adaptive-cto-live.mjs utility
node scripts/test-adaptive-cto-live.mjs coordinated
node scripts/test-adaptive-cto-live.mjs five
```

Deterministic checks cover routing, task installation/idempotency, provider preservation, shared ownership, repeated publication, failed verification, out-of-scope changes, local deletions, file modes, broken symlinks, source/dependency conflicts, consultation and slot release. The existing concurrency test exercises 21 submitting processes against the fourteen-worker/six-writer limits and recovery paths.

Observed real-provider results on October 9:

| Scenario | Result |
|---|---|
| Two successive DeepSeek edits in the same session | Both verified and applied, approximately **9.3 s and 7.9 s**; neither called a premium model |
| Installed interactive routine launcher, without `--auto` | DeepSeek published one checked replacement; the CLI reported **21.1 s**, and closing the session released its reservation |
| Vague follow-up | Asked for a target and left files unchanged, approximately **4.7 s**, no premium call |
| Explicit premium advice request | Consulted the configured CTO read-only, approximately **11.1 s**, no file changes |
| CTO + DeepSeek implementation + GLM review | Accepted the patch and passed the destination check, approximately **76.5 s** |
| Ambiguous image with two marked regions | Asked for the exact target; no snapshot or project edits, approximately **20.6 s** |
| Luna mechanical edit | Verified and applied the requested replacement, approximately **11.5 s** |
| CTO plus four workers | Two concurrent DeepSeek implementers, then a test author and independent GLM reviewer; all accepted and integrated checks passed, approximately **91.5 s** |

These are small synthetic end-to-end observations, not representative medians or a universal speed guarantee. The first two edits include model/tool/startup/check overhead. Provider latency, context, repository size, tests and dependencies change the result. Full-source fingerprinting reads non-ignored source bytes for every routine publication and may be costly for large repositories.

Earlier attempts at the routine test needed a broader assertion for legitimate clarification wording; their actual behavior left the ambiguous request unchanged. The earlier minimal-pilot ambiguous-image failure remains documented separately. New test results should not erase that history.

The first five-agent attempt overlapped an edit to the runtime's fingerprint format. Old and new processes correctly refused incompatible acceptance evidence; that mixed-version run was stopped and repeated with stable source. Do not update this runtime in the middle of active assignments. The passing five-agent run used five participants in total, with at most two workers active concurrently; it was not a live fifteen-model load test. An initial image run was blocked from accessing a fixture outside its permitted directory; the completed regression attached the same image from inside the snapshot.

For the first two routine edits, provider-reported totals were respectively **7,727 / 1,586 uncached input tokens**, **28,672 / 39,424 cache-read tokens**, and **443 / 441 output tokens**. These are accumulated across each turn's tool calls, not simultaneous context size. The explicit premium-consultation turn's reported totals exclude the adviser subprocess, so they should not be used as total consultation cost. No cost or speed comparison with the user's earlier chat is claimed.

## Quality limits

The controls reduce accidental changes and make completion reviewable; they cannot establish the intended meaning of every message or guarantee 100% accuracy. A passing check can miss a semantic mistake. Keep checks proportional and relevant, inspect important diffs, and use independent review/integration tests for higher-risk changes. Split work by independent behavior and dependency boundaries, not by an arbitrary file count. More agents help only when enough work can proceed independently.

Private snapshots, provider logs and raw model responses remain under `~/.local/state/kilo/`; they are not committed. Closing the routine task retains the worktree for recovery and releases its reservation. Reopening begins a new snapshot and context. Remove these three task entries and their `adaptiveCto*` inputs, or restore the installer's exact backup, to remove this launcher setup.
