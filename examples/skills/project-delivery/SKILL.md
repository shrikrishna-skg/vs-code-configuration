---
name: project-delivery
description: Plan and carry substantial Kilo implementation through scoped work, review and verified delivery. Use for a requested feature or multi-step fix, especially Reputation Systems; preserve the existing direct-first path for questions and small changes.
---

# Deliver a concrete result

Inspect the current request, relevant code, repository status and applicable rules. Ordinary requests keep the user's selected primary agent/model. The `/kilo-*` delivery commands select `CTO (Recommended)` without a command-level model override; follow the current native CTO policy and preserve the selected chat model where the runtime retains it. Define observable acceptance criteria, affected repos, dependencies and the smallest useful verification. Do not turn a simple question or focused fix into a full delivery process.

For substantial work, create a short task list with inspect, implement, verify and integrate steps. Use `reputation-project` for this product, then `reputation-ui` or `reputation-api` only for the affected boundary. Existing unrelated projects keep their own conventions.

Choose direct execution for a small change, one bounded worker for a medium subsystem when useful, and isolated worktree streams for genuinely independent parallel writers. Load `parallel-worktrees` before launching write-heavy Agent Manager work. Native task children share the checkout. Give coding delegates the canonical policy `/Users/shri/.config/ponytail/AGENTS.md`, local rules, file ownership, acceptance criteria and verification requirements. Existing agent limits/escalation conditions remain in force.

Use `project-verification` for scoped checks and `browser-verification` for visual/interactive acceptance. Inspect changed files and worker evidence; summaries alone do not prove correctness. Recheck combined behavior when integration changes the tested result. Address meaningful failures within the task; distinguish pre-existing failures and unavailable checks from passes.

Use `project-evidence` when current PR/CI/repo facts affect the decision. Load `model-benchmarks` only when comparing models or changing routing. Preserve existing defaults until real matched evidence supports another choice.

Complete the authorized work without stopping at a plan. Report the concrete result, actual verification and material limits, with one next action when needed. Do not commit, push, publish or deploy unless the actual task authorizes it. Do not reload VS Code or interrupt an active job for configuration activation.
