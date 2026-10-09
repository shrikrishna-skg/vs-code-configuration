# CTO small-change workflow — experiment, not activated

**Decision, 2026-10-09: do not roll out this version.** The user requested cross-testing before implementation. Clear edits worked, but an ambiguous screenshot caused an unrequested font change twice, including after a policy correction. The current VS Code model selection, reasoning settings, command and live instruction files have been left unchanged.

The candidate policy, compatibility instructions and command are preserved under [`examples/cto/experimental-small-changes/`](../examples/cto/experimental-small-changes/). They are not installed by `install-goal-policy.mjs` and are not referenced by the live configuration.

## What was tested

The real LithosAI DeepSeek V4.1 Flash Ultra route ran against generated disposable workspaces, with the canonical Ponytail policy supplied. Independent checks inspected file changes, actual rendered CSS, preserved controls and semantic title cases. No product repository was used as the editing target.

| Case | Observed outcome |
|---|---|
| Reduce a report title using the existing scale | Correct 14px → 13px change; content and selectors preserved |
| Remove an appended date from a report name | Correct change; legitimate em-dash names and other dashes preserved |
| Explain a change without editing | No files changed; the smaller existing token was identified |
| Requested verification service unavailable | The change was made and the failed verification was reported, not claimed as passed |
| Wrong path is a file; real folder has trailing whitespace | Collision identified without renaming/deleting either target |
| Ambiguous image: “Between them…keep the space” | **Failed:** model inferred a font change from an unrelated test, edited `style.css`, and reported it as the intended target |
| Same ambiguous image after stronger goal/evidence instructions | **Failed again at high effort:** the unrelated font was changed |
| Command-level `variant: low`, incoming selection high | Runtime recorded low effort for the command, while retaining the requested model |

An earlier low-effort ambiguity run did request a choice and left files unchanged, but performed ten unnecessary tool calls first. The initial test oracle incorrectly demanded a literal question mark; that was corrected to accept a semantic request for a choice. This oracle issue does not explain the later genuine wrong-edit failures.

## Speed findings

Pilot style runs completed in 15.6 seconds at high effort and 10.2 seconds at low effort. Title runs were approximately 12.0 and 11.6 seconds respectively. All four produced correct results. These are individual synthetic runs, not medians or a production benchmark. Added instructions alone did not consistently reduce work; low effort was not a universal speed advantage.

These fixtures have much smaller context than the original long VS Code chat. Their timings must not be presented as a measured reduction from the original 2–4 minute jobs. Initial harness runs with incorrect file-permission patterns were excluded from these timing observations. Candidate instructions were refined during the experiment, so the records are diagnostic iterations, not a fixed-policy statistical evaluation.

## Why rollout was withheld

The model treated a repository check expecting 13px as evidence of what the user wanted, even though the request concerned spacing and did not select that change. A passing test therefore accompanied an incorrect task. Stronger wording and high reasoning did not reliably prevent it.

A 4–8-call target is useful as a checkpoint, but cannot enforce correct intent. Neither more instructions, more reasoning nor a more powerful model supplies a 100% accuracy or latency guarantee. The proposed low-effort command is not an adequate safety boundary by itself.

The next design should require a resolved target before granting write access for ambiguous requests. The existing editable Clarify goal preview can help the user confirm intent; a prompt telling the agent to ask is not an enforced gate. Clear, explicit small tasks can retain the direct path. Any automatic ambiguity detector would itself need evaluation and cannot be called infallible.

## Reproduce

```sh
# Deterministic path classifier, including parent-folder collisions:
python3 scripts/check-workspace-path.py --self-test
# Opt-in real provider usage; never edits a product checkout:
node scripts/test-small-change-live.mjs low-style
node scripts/test-small-change-live.mjs low-title
node scripts/test-small-change-live.mjs readonly
node scripts/test-small-change-live.mjs failed-check
node scripts/test-small-change-live.mjs path-collision
node scripts/test-small-change-live.mjs ambiguous-image
```

The ambiguous-image command is expected to catch incorrect edits; it is deliberately not included in the default passing repository checks. Each run stores private evidence under `~/.local/state/kilo/validation/small-change/`. Baseline cases read the live policy at execution time; they are not a frozen historical baseline. The runner has file/shell tools in its disposable fixture and is not an operating-system security sandbox.

The corrected path classifier passes ten built-in cases, including a whitespace-bearing parent colliding with a file or directory. It has not replaced the live guard as part of this withheld rollout. The candidate command likewise requests low effort but has not replaced `/kilo-tweak`; fixed-effort local CLI aliases would need separate validation before claiming the requested effort reaches their underlying model.
