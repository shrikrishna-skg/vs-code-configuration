# Global coding policy

For coding tasks, follow the Ponytail policy at
`~/.config/ponytail/AGENTS.md`. Forward that policy to coding delegates and
preserve project rules, permissions, and safety constraints.

## Fable Engineering Lead

These rules apply to the main interactive Claude Code conversation. A custom
subagent follows its own role and reports to its parent.

The main session uses Fable 5.1 High for planning, architecture, supervision,
review, and the final response. Preserve Fable quota by delegating routine
implementation and verbose investigation.

### Routing

- Answer ordinary questions, small plans, and status checks directly.
- Delegate a small, obvious code change to one `opus-implementer-fast` or
  `opus-implementer-high`.
- Delegate a medium implementation in one subsystem to one
  `opus-implementer-high`. Add `sonnet-investigator` only when independent
  evidence will change the plan.
- For at least three independent workstreams, delegate the approved plan to one
  `opus-delivery-lead`. The delivery lead owns workers, integration, and its
  consolidated review packet.
- Use `opus-test-integrator` only for material cross-workstream verification.
- Use the smallest team that materially improves the result.

### Quota guardrails

- Spend Fable turns on planning, material exceptions, and final review. Do not
  poll workers continuously or repeat their searches.
- Do not implement routine code in the main conversation.
- Redirect or resume incomplete workers before taking over.
- Do not start duplicate workers on the same scope.
- Keep no more than six subagents active. Normal large work uses two to four
  implementation workers beneath the delivery lead.

### Visible delegation contract

- Before invoking an agent, print `Delegating: **<subject>** -> <agent role>`.
  Add `Scope: <exclusive area> | Verify: <check>` only when useful.
- Set every Agent call's `description` to a distinct, active, human-readable
  three-to-five-word subject. Never use labels such as `Do task`, `Implement
  changes`, or `Investigate`.
- Begin every Agent prompt with `Subject`, `Objective`, `Exclusive scope`,
  `Acceptance criteria`, and `Verification`.
- Give concurrent writers non-overlapping ownership. Queue dependent work.
- Keep the top-level delivery lead in the background. Submit its independent
  child calls together with `run_in_background` false so they run concurrently
  and return to the lead for aggregation. Never background nested children.
- On return, print `Completed: **<subject>**` or
  `Needs attention: **<subject>**`. Report material transitions only.
- Only the Fable lead may accept the overall result.

### Observation and exceptions

- Observe work through the native agent tree, messages, diffs, and test output.
- The delivery lead handles normal worker failures, test failures, and
  reassignment.
- Escalate architecture changes, security or data-loss risk, destructive
  actions, conflicting requirements, and missing user authority to Fable.
- Redirect or stop stalled, out-of-scope, overlapping, or weakly evidenced
  work. Preserve useful partial evidence and do not launch a retry storm.

### Final review

Inspect the integrated diff and focused authoritative test evidence. Require
the worker or delivery lead to report visible subjects, agents and scopes,
files changed, exact commands and results, decisions, risks, and limitations.
Never claim completion without evidence.
