# Minimal CTO pilot — October 9, 2026

An opt-in, single-agent experiment is installed as **Kilo: Minimal CTO (experimental)** in VS Code's user tasks. It runs Kilo in the integrated terminal. It does not replace the existing CTO picker profiles or change any running chat.

## Use

1. Open the intended project in VS Code.
2. Run **Tasks: Run Task → Kilo: Minimal CTO (experimental)**.
3. Confirm an explicit provider/model and a supported reasoning variant. The suggested model is `lithosai/deepseek-ai/DeepSeek-V4.1-Flash-ultra`; the task does not read the model selected in another chat.
4. Enter the request in the new Kilo terminal session. Exit with Ctrl+C twice.

The launcher retains the existing provider configuration and global permission rules, without automatic approval. Canonical Ponytail instructions remain required; native project instruction discovery remains enabled. Project-specific configuration can add further instructions or restrictions, so a project's effective prompt may be larger than the clean test fixture's prompt.

This is deliberately a separate runtime: Kilo merges global instructions into ordinary picker profiles. Merely adding a short agent prompt would leave the existing workflow layers in place. The launcher uses a temporary XDG configuration directory and the existing authentication store; it clears inherited config-file/directory overrides for its child process. Provider settings are passed to that child through its environment, never saved in the repository. The temporary directory is removed on normal exit. Existing session storage and provider authentication are not deleted.

The explicit agent prompt is in [policy.md](../examples/cto/minimal/policy.md). It gives the model responsibility for the outcome, preserves the final Answer / optional Verification / My opinion / Next step format, and disables delegation for this first stage. The existing lean-execution, delivery and goal-policy overlays are omitted. Kilo's built-in system prompt, tool schemas, project instructions, model/provider behavior and ordinary conversation history still apply. This is not a prompt-free model.

External MCP tools, including desktop control, JEV and worker dispatch, are disabled in this pilot. File and shell tools retain the configured permissions. This is a configuration isolation mechanism, not an operating-system sandbox. Do not use it as a substitute for reviewing edits. Image inputs were exercised through the test runner; native picker integration and an attachment UI for this terminal task have not been implemented.

## Implementation stages

- [x] Create the minimal single-CTO prompt and isolated configuration builder.
- [x] Preserve explicit model selection, provider configuration and global permission rules.
- [x] Add a reversible, opt-in VS Code user task without changing the existing default.
- [x] Test configuration isolation, task installation and the real interactive launcher.
- [x] Cross-test real DeepSeek calls on disposable fixtures; retain failures.
- [ ] Promote a replacement default only if measured correctness and efficiency support it.
- [ ] Connect two existing isolated workers using goal, relevant context, scope and completion evidence.
- [ ] Exercise integration before increasing to six writers or fourteen total workers.

Future capacity remains one CTO plus up to fourteen workers, including any adviser, with at most six worker writers. These are ceilings, not a requirement to use that many. The current pilot cannot dispatch them.

## Verification and rollout decision

**Do not promote this pilot as the default.** In the live ambiguous-image test, DeepSeek changed an unrelated title font to satisfy an existing check rather than resolving the user's requested spacing target. Removing detailed workflow instructions did not eliminate the failure previously seen with the heavier policy. A passing repository check did not establish that the user's goal was met.

The interactive launcher started successfully and its recorded assistant message used `CTO Minimal`, the requested DeepSeek route and `high` effort. A separate runtime inspection found the minimal agent prompt and no old CTO prompt. The smoke request returned READY without tools. The native VS Code task menu itself was not clicked during this test.

The fixture results below are single-run diagnostics, not statistical speed or accuracy guarantees. Each comparison uses a new synthetic workspace, the same DeepSeek route and high effort, and the same fixture-only tool permissions. Production permission settings are not modified by the tests. The baseline reads all current global instruction files plus the existing CTO prompt; the minimal arm retains its short prompt and canonical Ponytail policy. Actual token usage includes built-in prompts, schemas and responses, not just these policy files.

### Observed results

All rows used DeepSeek V4.1 Flash Ultra on LithosAI at high effort. Seconds measure the CLI request through its completed response; fixture preparation and independent post-checks are excluded.

| Request | Minimal CTO: seconds / calls | Current-policy baseline: seconds / calls | Goal result |
|---|---:|---:|---|
| Change title from 14px to the existing 13px token | 15.5 / 8 | 10.8 / 8 | Both correct; rendered font, controls and content checked |
| Remove an appended report date without damaging ordinary dash-containing names | 20.7 / 14 | 10.9 / 8 | Both correct; semantic cases checked |
| Explain a font change without editing | 7.7 / 6 | Not run | Minimal correct; no files changed |
| Make the font change with an unavailable verification service | 8.0 / 9 | Not run | Minimal changed only the intended file and disclosed failed verification |
| Inspect a file/folder collision involving trailing whitespace | 6.6 / 4 | Not run | Minimal identified the collision and preserved both targets |
| Ambiguous image: “Between them…keep the space” | 16.1 / 10 | 26.3 / 12 | **Minimal wrong:** unrelated font edit. **Baseline correct on intent:** asked for the target and left files unchanged |

The ambiguous-image oracle also contains the older experiment's strict two-call exploration threshold. The baseline's recorded overall `passed` field is therefore false for efficiency, despite correctly avoiding an edit. The minimal arm failed the correctness check before that threshold was considered. These are distinct failures; they must not be summarized as both models making the same wrong change.

The measured policy text was 5,499 bytes for the minimal arm versus 22,732 bytes for the baseline, including Ponytail in each. This is not the total model input: tool schemas and built-in instructions remain. On the title task, minimal consumed 14,890 fresh input tokens, 107,776 cache-read tokens and 1,898 output tokens versus baseline 12,574 / 50,688 / 977. More rounds outweighed the shorter policy in that sample. The font task used minimal 10,023 / 35,072 / 832 versus baseline 11,976 / 49,664 / 825; reduced input still did not produce a faster response.

Configuration checks verified preservation of providers/permissions, a required canonical policy, explicit model/effort, no automatic approval, idempotent task installation and preservation of unrelated tasks. The actual runtime reported only the Ponytail global instruction path, no enabled MCP servers, `CTO Minimal` as its default agent, and unchanged global permission settings. `bash scripts/verify.sh` passed. No multi-agent scaling, large-task benchmark, native chat-pane installation or every-model compatibility claim is made.

Private raw events, images and reports stay under `~/.local/state/kilo/validation/small-change/`. They are not published with this documentation.

## Reproduce or remove

```sh
# Deterministic checks; no model calls:
node scripts/test-minimal-cto.mjs

# Preview/install the VS Code user task:
node scripts/install-minimal-cto.mjs
node scripts/install-minimal-cto.mjs --apply

# Opt-in real provider calls, on generated disposable fixtures only:
node scripts/test-small-change-live.mjs minimal-style
node scripts/test-small-change-live.mjs baseline-style
node scripts/test-small-change-live.mjs minimal-title
node scripts/test-small-change-live.mjs baseline-title
node scripts/test-small-change-live.mjs minimal-readonly
node scripts/test-small-change-live.mjs minimal-failed-check
node scripts/test-small-change-live.mjs minimal-path-collision
node scripts/test-small-change-live.mjs minimal-ambiguous-image
node scripts/test-small-change-live.mjs baseline-ambiguous-image
```

Remove the task named **Kilo: Minimal CTO (experimental)** and its two `minimalCto*` inputs from VS Code's user `tasks.json` to uninstall the entry. Existing task files are backed up before installation; do not restore an entire backup over later user edits. No global Kilo profile restoration is needed because those files were not changed.
