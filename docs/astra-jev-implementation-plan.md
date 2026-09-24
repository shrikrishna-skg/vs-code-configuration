# Astra + Jev Engineering Lead — implementation checklist

Status: installed and integration-tested. See [implementation and verification](astra-jev.md).
The detailed checkboxes below preserve the original planning checklist, not an
automatically maintained completion ledger. The verification report records what
was actually tested; broader comparative benchmarking remains future work.

## Goal and scope

Add **Astra + Jev Engineering Lead** to the Kilo Code agent picker directly below
**Fable Engineering Lead**. Keep existing Astra and Fable profiles available for
comparison. Astra remains the lead; Jev provides optional structured advice.
Optimize time to a verified result, total model cost, and correctness together.

Initial scope is Kilo Code in VS Code. Changes to the Codex model picker, the
Fable execution route, or unrelated extension patches are separate work.

## 1. Establish the exact installation targets

- [x] Inspect the repository's Astra, Fable and DeepSeek definitions.
- [x] Confirm installed agent files exist under `/Users/shri/.config/kilo/agent/`.
- [x] Identify the existing local MCP pattern in `examples/kilo.jsonc` and
  `examples/bridges/claude-cli-mcp.mjs`.
- [x] Inspect working-tree status; existing edits belong to other work and must
  be preserved.
- [ ] Compare the installed Astra profile with its repository example and choose
  the active definition as the behavioral baseline.
- [ ] Inspect only relevant live Kilo settings; keep credentials out of output.
- [ ] Identify the installed extension version and supported picker ordering
  mechanism. Do not assume filename or JSON insertion order controls the UI.
- [ ] Record the current default and selected agent, MCP configuration and picker
  order. Back up the exact files that will be changed, outside Git.

Done when: paths, current behavior, rollback copies and ordering mechanism are known.

## 2. Define the experimental lead

- [ ] Add one canonical agent definition with display name
  `Astra + Jev Engineering Lead`; use a stable internal identifier where supported.
- [ ] Reuse Astra's verified model ID, task budget and existing supervision rules.
- [ ] Keep tiny edits, explanations and straightforward verification with Astra.
  Skip Jev and worker dispatch on this fast path.
- [ ] Prefer one DeepSeek implementer for substantial, bounded implementation
  when assignment and review overhead are justified.
- [ ] Require exclusive worker file ownership and focused verification evidence.
- [ ] Keep GLM as the read-only investigator for unresolved causes and justified
  independent review. Jev does not replace investigation or tool access.
- [ ] Preserve the existing criteria for workstream leads and difficult/high-risk
  escalation. Do not invoke every model on every task.
- [ ] Add Jev use only for ambiguous next-step decisions or material worker
  handoffs whose evidence coverage would benefit from semantic screening.
- [ ] State that Astra owns all decisions, integration and completion. A Jev
  assessment is advice, not permission or proof.

Done when: the new profile is independently selectable and existing profiles retain
their current defaults and behavior.

## 3. Implement one small Jev tool

- [ ] Inspect the existing MCP bridge implementation and reuse its protocol
  conventions. Avoid adding a general framework or modifying Claude execution.
- [ ] Add a focused Node bridge, proposed path:
  `examples/bridges/typesafe-mcp.mjs`.
- [ ] Expose one tool, `evaluate_work`, with purpose
  `next_step` or `evidence_check`.
- [ ] Use built-in HTTP support if sufficient; avoid an SDK dependency unless it
  solves a demonstrated requirement.
- [ ] Recheck the live API contract and pin the evaluated model version initially
  (`jev-1.13.0`, subject to continued availability).
- [ ] Accept compact task context, identified acceptance requirements, observed
  evidence, separately labeled worker claims, and relevant trusted constraints.
- [ ] For next-step assessment, return a bounded choice such as investigate,
  implement, verify, coordinate or report, with probabilities and confidence.
- [ ] For evidence checks, return supported, contradicted or insufficient for
  each requirement, preserving the requirement ID and confidence.
- [ ] Keep each question focused. Batch independent questions sharing the same
  state. Do not make one question depend on another answer in the same request.
- [ ] Validate input size, purpose and required fields before sending a request.
- [ ] Validate returned question IDs, types, permitted choices, numeric ranges and
  required fields. Treat malformed/partial responses as unavailable advice.
- [ ] Enforce trusted no-delegation, ownership and permission constraints in the
  surrounding workflow; never allow model confidence to override them.

Done when: the bridge returns validated structured advice and cannot execute
worker assignments or alter project files itself.

## 4. Keep overhead bounded

- [ ] Start with a configurable one-second API deadline; measure whether cold
  connections and ordinary network variability require adjustment.
- [ ] On timeout, authentication failure, rate limit, service error or invalid
  output, return an explicit unavailable result and continue with lead judgment.
- [ ] Do not retry automatically on the interactive critical path.
- [ ] Use at most two consultations per task by default. Additional calls require
  materially new evidence. Initially enforce this in lead instructions and report
  actual usage; a bridge cannot enforce a task budget reliably without task IDs.
- [ ] Reuse prior advice within the task only when relevant evidence, question
  definitions and model version are unchanged. Do not build a persistent cache
  for the first version.
- [ ] Start with a provisional 0.9 relevant-confidence threshold for routing
  advice; defer uncertainty to Astra, not automatically to the user.
- [ ] Surface low-confidence evidence warnings as advisory findings, not mandatory
  extra work or completion approval. Calibrate thresholds by purpose.
- [ ] Do not repeat trustworthy focused tests just because Jev was consulted.

Done when: Jev outages do not block the task and small tasks incur no Jev overhead.

## 5. Configure credentials and tool access

- [ ] Use a fresh Typesafe key for ongoing installation; do not embed the trial
  key from chat in source, agent prompts, configuration examples or reports.
- [ ] Choose a supported secure credential source for the GUI-launched MCP
  process. Verify availability there; shell environment inheritance is not assured.
- [ ] Keep the bridge endpoint fixed to the official Typesafe API.
- [ ] Pass only necessary sanitized context. Do not automatically upload files,
  entire transcripts, credentials, unrelated logs or environment dumps.
- [ ] Add a sanitized MCP entry to the repository example and merge the live entry
  without replacing unrelated configuration.
- [ ] Verify Kilo's supported per-agent tool restrictions. Enable Jev for the new
  profile and prevent unintended use by existing profiles or workers.
- [ ] Log only essential timing, model, token usage, status and decision metadata
  by default. Do not retain raw prompts, source code, or secrets in routine logs.

Done when: the new lead can authenticate without credentials appearing in Git or
tool results, and other agents have no unintended new tool access.

## 6. Place the profile below Fable

- [ ] Use supported agent ordering/pinning configuration if available.
- [ ] Check for the existing uppercase/lowercase Fable compatibility files; do not
  introduce another visible alias or delete an existing alias as a side effect.
- [ ] If exact ordering is unsupported, document the smallest alternative before
  introducing a version-sensitive extension patch. Do not silently promise order.
- [ ] Reload only what is needed, avoiding interruption of active user work.
- [ ] Visually verify the picker shows Fable followed immediately by the new
  profile, with no duplicates and the intended display name.
- [ ] Confirm existing default-agent and remembered-selection behavior.

Done when: observed picker order satisfies the request; file existence alone is
not sufficient verification.

## 7. Leave a focused runnable check

- [ ] Add one small test script using built-in facilities and a mocked API
  boundary; no new testing framework.
- [ ] Check MCP initialization, tool discovery and tool-call results.
- [ ] Check valid responses, malformed/partial responses, invalid choices,
  oversized input, missing credentials, timeout and API errors.
- [ ] Check requirement-ID mapping and separation of claims from evidence.
- [ ] Check that absent advice never becomes a successful evidence assessment.
- [ ] Ensure transport diagnostics do not corrupt protocol stdout or reveal keys.
- [ ] Add the focused check to repository verification without overwriting the
  existing edits in `scripts/verify.sh`.
- [ ] Run the relevant checks and inspect the final diff for unrelated changes.

Done when: protocol and failure-path behavior are reproducible without spending
API credits or depending on network availability.

## 8. Verify the complete Kilo workflow

- [ ] Tiny edit: lead handles directly, zero Jev calls, no unnecessary delegation.
- [ ] Bounded material implementation: one DeepSeek worker, exclusive ownership,
  lead review and focused evidence.
- [ ] Unknown bridge bug: GLM investigates; Jev does not invent a root cause.
- [ ] Image-support change tested only with text: evidence check flags the gap.
- [ ] Working indicator tested only on success: cancellation gap is surfaced.
- [ ] Worker claim conflicts with an observed diff: claim does not override evidence.
- [ ] Explicit no-delegation request remains with the lead.
- [ ] Concurrent writer overlap is resolved before dispatch.
- [ ] Missing/invalid key and timeout: ordinary lead workflow still completes.
- [ ] Low-confidence answer: Astra decides or investigates without an unnecessary
  user interruption.
- [ ] Confirm actual model/worker/tool activity in Kilo, rather than trusting the
  agent's narrative about what it used.

Done when: one small task and one delegated task succeed end to end in the new
profile, and the important failure paths are covered.

## 9. Evaluate before broader adoption

- [ ] Start in observation mode: advice is visible to the lead but does not
  automatically dispatch workers or approve completion.
- [ ] Compare baseline Astra and Astra + Jev on representative real tasks in
  separate checkouts with equivalent starting state and acceptance tests.
- [ ] Alternate execution order to reduce warm-start and ordering effects.
- [ ] Measure accepted output quality, caught omissions, false alarms, rework,
  user corrections, total elapsed time and total token/cost usage across models.
- [ ] Include prompt preparation, MCP overhead and downstream review time; API
  latency alone is not an end-to-end speed result.
- [ ] Keep the integration only where results show useful tradeoffs. Synthetic
  agreement rates do not establish production reliability.
- [ ] Consider a Fable + Jev variant only after evidence supports the Astra pilot.

## 10. Documentation, handoff and rollback

- [ ] Document setup, secure credential provisioning, tool limits, measured
  behavior and recovery. Distinguish planned behavior from verified behavior.
- [ ] Update the relevant architecture and agent inventory documentation with a
  focused diff that preserves ongoing user edits.
- [ ] Record the installed paths and extension version if ordering is sensitive
  to the extension implementation.
- [ ] Verify rollback: disable the new profile/MCP entry and restore only changed
  configuration fields. Existing Astra/Fable and worker routes must still work.
- [ ] Deliver a concise implementation report with tests, actual picker position,
  remaining limitations and measured comparison results when available.

Final acceptance: the new profile appears directly below Fable, uses DeepSeek and
GLM appropriately, invokes Jev selectively, survives Jev failures, keeps credentials
out of Git, and leaves existing profiles working. Any unmet criterion remains
explicitly open rather than being reported complete.
