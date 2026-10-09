# Native CTO acceptance validation — 2026-10-09

## Scope

A real native Kilo session in the existing disposable VS Code project exercised
two concurrent DeepSeek implementers, a read-only GLM reviewer, lead integration,
and browser verification. The selected lead was also DeepSeek. This validates
native orchestration with these routes; it is not a premium-lead comparison or a
maximum-concurrency benchmark.

The synthetic Report Center required title validation, search and status filters,
archive/restore, safe HTML rendering, and responsive layout. No production app
was edited. The [saved fixture and instructions](../examples/cto/validation/frontend/README.md)
include runnable unit and isolated headless-browser checks.

## Evidence boundaries

The initial fixture had 13 failing and 3 passing assertions. The lead dispatched
separate implementation scopes, then ran the combined suite. Worker A accurately
reported that its model tests passed while the concurrently unfinished view still
failed; it did not claim the full application passed. Worker B later reported all
16 assertions passing.

GLM identified an unbroken-title overflow risk. The lead added an overflow-wrap
rule, and the independent browser oracle covers that case at desktop and mobile
widths in addition to the original 12 interaction checks. Removing that rule
in a separate copy reproduces horizontal overflow at 1280px, confirming that
the review finding was substantive.

The grey Kilo pane recurred during the live run even though backend work continued.
The earlier child-viewer startup fix therefore must not be described as a complete
fix for this separate symptom. A replay of the actual three-child session retained
rendered content and native cards across pending/running/completed states, history,
resize, permission failure, usage expansion and reopening, without a JavaScript
page error. Live rendering investigation continues separately.

Raw session histories, authentication, screenshots of private work, and provider
logs are excluded from Git. Reported tokens are cumulative request accounting;
cached input is not a single context-window size. Provider-reported cost of zero
is not evidence that the run was free.

## Parallelism and recovery

The two DeepSeek implementers' recorded assistant activity lasted approximately
7.48 and 11.01 seconds. Their first assistant messages were 1.14 seconds apart,
and their activity overlapped for 6.34 seconds. These are observed backend
message intervals, not repeatable latency guarantees or end-to-end task time.

After the lead's first acceptance checks, the operator deliberately hard-coded
`status: 'all'` in the application wiring. The browser oracle failed at the
combined status/search check (one card, expected zero), while the unchanged
16 model/view tests still passed. The native CTO repaired only that application
wiring, returning `app.mjs` to its exact pre-injection bytes. The independent
13-check browser suite passed again. This demonstrates recovery from this
specific integration fault, not arbitrary bug-free behavior.

The comprehensive run also showed overhead: many individual browser snapshots,
screenshot reads, repeated final checks, and a 45-second operator-wait induced
by the test prompt. Do not use its total elapsed time as a normal small-edit
benchmark. For repeatable verification, the saved browser oracle checks all
13 cases in one headless run; native visual inspection remains useful when
appearance, layout, or uncertain findings require it.

## Recorded usage and limits

| Measurement | Observed value |
| --- | ---: |
| Lead assistant activity, including injected-fault phase | 308.77 seconds |
| Lead tool calls | 101 |
| Worker A / worker B tool calls | 4 / 12 |
| GLM reviewer tool calls | 10 |
| All-session non-cached input tokens | 253,692 |
| All-session cached-input tokens | 6,352,768 |
| All-session output tokens | 19,419 |

These figures come from the native backend's per-message usage. They are one
run, with no serial baseline, so no speedup or price-saving percentage can be
inferred. The backend also reports 13,973 reasoning tokens separately; do not
blindly add overlapping token categories into a billing estimate. Provider cost
metadata was zero and was not used as an actual cost estimate.

The lead made 19 browser snapshots and 25 file/image reads. Two stale-snapshot
browser actions were rejected and recovered after new snapshots. The full test
passed, but this is **not an efficiency success**: repeated browser round trips
and cumulative context dominate the cheap parallel implementation. A future
optimization should compare the same acceptance suite using one executable
browser check plus targeted visual inspection, retaining the independent review
and fault-recovery gate. No unmeasured speed or cost reduction is claimed here.
