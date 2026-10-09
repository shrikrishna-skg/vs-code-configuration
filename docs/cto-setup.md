# CTO setup

The shared [goal-continuity policy and validation](goal-continuity.md) apply to both profiles and any selected Kilo model. Follow-ups preserve the current goal; Ponytail is forwarded to isolated workers.

Two Kilo profiles share the policy in `examples/cto/policy.md`:

- **CTO (Recommended)**: local Claude Opus 5.5 High; direct execution for small tasks; bounded parallel workers for useful independent work.
- **CTO + JEV**: identical execution policy with selective TypeSafe/JEV advice. Advice is never proof of completion.

The menu keeps **CTO (Recommended)** as the discoverable name. Its selected button displays **CTO**; **CTO + JEV** keeps its full name in both places. This is a display-only patch: stored agent names, prompts, permissions and model routing are unchanged.

The worker service reads model routes from the installed specialist profiles. It does not replace working provider credentials or silently fall back to another model. At implementation time the live implementer and investigator used LithosAI DeepSeek V4.1 Flash Ultra and GLM 5.3 Flash Ultra, while the utility used GPT-5.6 Luna Fast.

## Install and recovery

```sh
node scripts/test-cto.mjs
node scripts/install-cto.mjs          # inspect changes
node scripts/install-cto.mjs --apply  # back up, then install
```

The installer merges the live configuration, installs the two profiles and the `cto` MCP server, hides only the six retired custom profiles, and updates the default and remembered selection. Built-in modes, providers, credentials and unrelated settings are retained. Old definitions remain recoverable.

Use **Kilo Code: Reload Config and Skills** in an idle Kilo window. Existing sessions can retain their previously selected agent; select the new CTO profile or start a new session. A whole VS Code reload is not required by the installer.

The selected-label patch is separate from the profile installer and targets the known custom Kilo bundle. Apply it to both surfaces:

```sh
node examples/patches/cto-selected-label.mjs /absolute/path/to/extension/dist/webview.js
node examples/patches/cto-selected-label.mjs /absolute/path/to/extension/dist/agent-manager.js
```

Reopen the idle Kilo editor to load the updated bundle. The live update hook in `~/.config/kilo/patches/reapply-kilo-patches.sh` reapplies this patch; unsupported bundle shapes fail without modification. Each bundle has a `.pre-cto-selected-label` backup. To undo just this display change, remove its two `ensure cto-selected-label.mjs` lines from the update hook, run those patch commands with `--restore`, and reopen the idle editor. Restoration changes only the label expression, preserving other bundle patches.

The installer prints a private backup directory. To restore:

```sh
node scripts/install-cto.mjs --restore /absolute/path/to/printed/backup
```

Restoration refuses to overwrite a file changed since installation. It retains task records and worker worktrees. Cancel active workers before restoring/removing their service.

## Execution architecture

```text
You / VS Code
└── One CTO — Claude Opus 5.5 High through the existing local CLI bridge
    ├── Direct work: small tasks, planning, decisions, integration
    ├── Optional JEV advice: enabled only in CTO + JEV
    └── Shared worker scheduler — at most 14 active workers, 6 writers
        ├── Implementers  0–6 — DeepSeek V4.1 Flash Ultra
        ├── Investigators 0–6 — GLM 5.3 Flash Ultra, read-only
        ├── Test authors  0–4 — DeepSeek V4.1 Flash Ultra
        ├── Reviewers     0–3 — GLM 5.3 Flash Ultra, read-only
        └── Utilities     0–2 — GPT-5.6 Luna Fast
            ↓ isolated results and recorded checks
        CTO reviews → accepts scoped patches → tests combined result
```

These are role ceilings within one pool; they do not add up to twenty-one available slots. For example, six implementers, five investigators and three reviewers fill all fourteen worker slots. Test authors or utilities that write must share the six-writer ceiling with implementers. The four configured model routes can each serve multiple agent instances; fifteen agents does not mean fifteen distinct models. JEV is an advisory tool, not another independently scheduled writer.

The scheduler starts dependency-ready work when capacity becomes available. It does not promise a fixed dispatch latency or completion time: provider queues, inference, repository size and checks affect elapsed time. Begin with the smallest useful team and measure accepted results before expanding it.

The service provides `cto_submit`, `cto_status`, `cto_cancel`, and `cto_accept`. CTO native `task` delegation is denied so its normal delegation route uses the service. Fourteen simultaneous workers and six simultaneous worker writers are enforced in a shared on-disk registry across MCP processes. Role ceilings share this pool: six implementers, six investigators, four testers, three reviewers and two utility workers.

`cto_status` accepts an optional `waitMs` from 0 to 20000. With an active task ID, it returns on a state change or the deadline; it releases the registry lock between observations. This keeps the CTO in its working turn without rapid polling. The CTO profiles deny `schedule_wakeup` and require current-turn review and integration instead of handing unfinished workers to a later scheduled turn.

The service records assignments under `~/.local/state/kilo/cto`. A detached supervisor owns each worker process, and MCP disconnects do not discard active work. Use `cto_cancel` to stop work. Status reconciles an interrupted supervisor only after it observes that both the supervisor and recorded child are gone; it does not accept their partial work.

Assignments require a Git repository root, objective, acceptance criteria, explicit owned paths for writers, optional dependencies, and executable/argument arrays for checks. Dependencies refer to earlier assignments and wait for acceptance. Directory/child path overlaps are conflicts. Ready patches retain ownership until accepted or cancelled.

For each job, an alternate Git index creates a local snapshot of tracked and non-ignored uncommitted work without changing the user's branch or index. The worker receives a detached worktree based on that snapshot. No push or commit to the user's branch occurs. Local snapshot objects and worktrees are retained for diagnosis.

Workers use Kilo file tools. Shell execution, nested delegation and external MCP tools are denied to workers. The supervisor runs the declared verification commands after the model finishes. Writer output outside the owned scope is quarantined; it is not integrated. These controls are not an OS sandbox: checks are trusted local commands selected by the CTO and must remain within the user's authorization.

`ready` means a reviewable result, not completed delivery. `cto_accept` requires passing writer checks, verifies that the destination's owned files have not changed, and applies the scoped patch without committing. The CTO must then verify the combined destination revision. This final integration check is a policy requirement, not something a passing individual worker check establishes.

## Example assignment

```json
{
  "workspace": "/absolute/path/to/repository",
  "role": "implementer",
  "title": "Handle empty input in parser",
  "task": "Return the established empty result for empty input. Preserve all other parser behavior.",
  "acceptance": "Empty input returns the documented value and existing cases still pass.",
  "scopes": ["src/parser.js", "test/parser.test.js"],
  "dependsOn": [],
  "checks": [["node", "--test", "test/parser.test.js"]]
}
```

Reviewers can inspect a ready writer's worktree as their input repository to examine its unaccepted patch. Give them the intended behavior and precise risks, without the implementer's lengthy justification.

## Deliberate limits

- The cap covers service workers. Direct CTO editing is outside the process counter; the policy requires the CTO to reserve a writer slot and avoid worker-owned scopes. Shell-launched agents outside the service are not covered.
- Native Kilo task children share their checkout. The CTO service therefore uses separate CLI sessions; worker activity is available through its status tool and private artifacts, not Kilo's native subagent tree.
- Git repositories need an initial commit. Submodules are not supported by this first version.
- Ignored dependencies, `.env` files and build artifacts are not copied. Worktree dependency setup is not automatic. Use self-contained checks or direct execution in the established environment when setup is required; never report a missing dependency as a passing check.
- Worker shell denial deliberately constrains complex build/debug workflows. Supervisor checks can execute code, so they must be reviewed as commands, not treated as untrusted text.
- Scope protection combines file-tool permissions, assignment ownership and post-run diff checks. It is not a security boundary for arbitrary executables or a guarantee against malicious repository code.
- A source working tree changing during snapshot creation is not transactionally frozen. Avoid assigning a snapshot while another process is rewriting its source; final integration checks remain necessary.
- Worktrees, local snapshot objects and private logs are retained. No automatic destructive cleanup is performed.
- Concurrency and routing have not been established as optimal. Compare accepted outcomes, time, retries and defects on representative work before tuning the limits.

See `cto-implementation-todo.md` for rollout evidence and remaining evaluation work.
