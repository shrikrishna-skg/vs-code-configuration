# Native CTO delegation — 2026-10-09

The CTO picker now delegates through Kilo's own `task` tool. Earlier it denied that tool and used separate MCP/CLI sessions; those real workers could not appear as child cards in the parent chat. Renaming todo items did not change that.

The later [approved permission/instruction cleanup](cto-permission-cleanup.md) removes unnecessary global shell denials and conflicting workflow instructions while retaining native role permissions and finite budgets.

```text
Selected CTO model (keeps the chat's model choice)
├─ Simple change → direct edit + focused verification
├─ Native background task children (visible in this chat)
│  ├─ DeepSeek implementers → exclusive, independent file scopes
│  ├─ GLM investigators/reviewers → read-only evidence
│  └─ Luna utilities → tiny mechanical work
├─ Native Agent Manager worktree sessions (separate visible sessions)
│  └─ Changes needing filesystem isolation and reviewed integration
└─ CTO → inspect diffs, check combined behavior, deliver evidence
```

`task` children share the parent's checkout. Exclusive file assignments are instructions, not a filesystem sandbox. Agent Manager worktrees isolate files, but use the normal default agent: its API has no per-task agent/permission field. The CTO supplies explicit leaf instructions, model, scope and checks there. Worktrees also need their own relevant inputs and dependencies; uncommitted source changes are not assumed to transfer.

Use 2–4 workers initially; expand only for independent work. The **14 active workers / 6 writers** ceiling is a scheduling instruction in native mode, not a native runtime limit. Native `subagent_depth` limits nesting, not worker count. The installed specialist profiles deny further delegation, Agent Manager, external CLI bridges and computer control. The separate [MCP scheduler](cto-setup.md#separate-mcp-scheduler-architecture-terminal-workflow) remains available via the [coordinated terminal task](cto-adaptive.md), with its enforced limits and guarded publication.

## Installation and use

```sh
node scripts/test-cto.mjs
node scripts/install-cto.mjs --profiles-only       # review targets
node scripts/install-cto.mjs --profiles-only --apply
```

This preserves installed model routes and unrelated configuration, enables `shared_agent_board`, installs native CTO/specialist prompts and permissions, and backs up changed files. It does not replace the running MCP scheduler. Full `install-cto.mjs --apply` also installs the scheduler for separate terminal workflows.

In an idle window run **Kilo Code: Reload Config and Skills**, then start a fresh CTO chat. Do not interrupt an active task to reload. Existing chats may retain old system instructions. A new VS Code window loads the new configuration without reloading other windows. The compact selected label remains **CTO**.

An explicit request for multiple agents should start useful independent native children promptly. Their task cards and background strip should show actual agents; click a card to inspect the child. Background completion/error is delivered automatically to the parent. The shared board communicates ownership and findings; it does not launch or schedule agents.

## Verification

Automated installer checks cover native role permissions, canonical Ponytail forwarding, model/variant preservation, unrelated permissions/instructions, idempotent configuration, restoration and leaving a running scheduler untouched. Existing scheduler checks still cover its separate capacity, scope and acceptance behavior.

### Live validation in the disposable project

The fixture was created outside production repositories and contained two independent implementation files plus an unchanged eight-assertion test. The DeepSeek CTO launched two native DeepSeek children 652 ms apart, then an independent GLM reviewer. Child IDs and background job metadata confirmed genuine overlap; the native cards and background strip were visible. Both writers stayed within their own file. The combined test passed all eight assertions, independently rerun after the agent finished.

The review exposed a permissions mismatch: the read-only GLM was asked for executable checks, then tried a background process after shell denial. The specialist prompt now explicitly forbids this retry route, denies background processes, and assigns executable verification to the CTO. Permission denials were preserved.

A second read-only native run launched two GLM children 427 ms apart, automatically resumed after both completed, and honestly reported missing evidence. It used no edits, shell, recursive tasks or external workers. These are observations from small fixtures, not latency guarantees.

**Viewer startup fix:** a separate native VS Code integration run reproduced a real race: the child viewer requested history before its backend connection was ready. Its original callback logged `Not connected — call connect() first` and never loaded history. The [readiness patch](../examples/patches/native-subagent-ready.mjs) awaits the existing connection initialization and ignores a panel closed or replaced during that wait. The [runnable regression check](../scripts/test-native-subagent-ready.mjs) covers cold/warm startup, closed/replaced panels, failure, duplicate readiness and safe patch restoration. The patch is included in the local reapply hook; existing windows must reload to load changed extension code.

**Remaining uncertainty:** the original mid-run grey pane is not yet conclusively explained by this startup race. A headless replay of the installed webview handled pending/running/completed tasks, permission errors, narrow/wide layouts, full parent history and reopening without a JavaScript error. The live background-job and model-usage responses had the expected shapes. A successful code test or cold-start recovery does not prove that the original grey-pane defect is eliminated.

**Final live regression:** only the affected disposable VS Code window was closed and reopened to load the installed patch. Its saved parent conversation restored. The DeepSeek CTO then launched two actual read-only GLM children 375 ms apart; both returned correct findings, the parent resumed automatically, and the native worker strip remained visible during and after execution. Opening a completed worker card loaded its conversation, and returning to the parent retained the completed result. The grey pane did not recur in this run. Background automation and the test window's own API were used without moving the user's cursor or reloading other windows. The separate native cold-start integration check also passed; it logged two nonfatal ResizeObserver notifications while content remained rendered.

A third native test deliberately denied the GLM child access to `test.mjs`. Exactly one read failed with an explicit permission denial. There were no retries, substitute tools or edits; the parent resumed and reported that verification was unavailable. This tested denial handling, not a crashed worker process. Native file-read permission patterns are relative to the worktree; use `test.mjs` for a root-level file rather than an absolute path.

No 100% accuracy, exhaustive scenario coverage, or maximum-concurrency stress result is implied.

## References

Checked against the installed Kilo executable and official [task tool documentation](https://kilo.ai/docs/automate/tools), [custom subagents](https://kilo.ai/docs/customize/custom-subagents), and [Agent Manager workflows](https://kilo.ai/docs/automate/agent-manager-workflows). The native background scheduler starts jobs without the separate service's admission lock. Agent Manager's per-call batch maximum is not a concurrent-worker cap.
