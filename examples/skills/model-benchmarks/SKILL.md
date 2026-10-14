---
name: model-benchmarks
description: Measure Kilo models on matched real tasks using acceptance, quality, whole-task time, retries and optional cost/TPS. Use when comparing models or tuning task routing; never treat output TPS alone as task performance.
---

# Measure model routing on actual work

Preserve the current Astra/DeepSeek/GLM/Claude role assignments until evidence supports a change. Available models/provider access may differ; inspect the installed model selector rather than inventing identifiers or changing credentials. A benchmark measures behavior; it does not grant permission to launch paid tasks, expose project data, or alter model configuration.

Use `~/.config/kilo/upgrades/delivery-v1/tools-benchmark/benchmark.py` with Python 3 to record outcome-only metrics. Its default log is `~/.config/kilo/upgrades/delivery-v1/benchmarks/runs.jsonl`. The dataset starts with no real runs. No synthetic test results belong in that log.

## Compare like with like

Choose representative UI, API, debug, and review tasks with observable acceptance criteria and relevant checks. For a comparison, use the same task ID and context ID only when starting revision, task text, allowed tools, constraints, acceptance checks, and runtime conditions match. Keep full task text and private source outside the benchmark log. A context ID is a non-sensitive experiment label, not an arbitrary prompt, URL, path or credential.

Run alternate implementations in isolated worktrees when comparing writers. Do not let a later candidate reuse an earlier candidate's solution. Include tool time, retries, and waits in completion seconds from task start until verified completion or the recorded failed/blocked stop. Record quality against the same rubric after reviewing the result; blind the reviewer to model identity when practical.

The completion timer covers the **whole task**, not one LLM response or an average of per-message TPS. If output TPS cannot be measured consistently, leave it absent. If actual billed cost is unavailable, leave it absent; never infer zero cost from subscription/login access. A task can have zero required automated checks when manual acceptance is genuinely sufficient; state that in the task evidence outside the metrics log.

## Record and inspect

Use `python3 ~/.config/kilo/upgrades/delivery-v1/tools-benchmark/benchmark.py add --help` for supported fields. Supply a provider/model identifier from the actual selection and its variant. Record failed and blocked attempts, not just successful ones. `passed` requires acceptance met and every recorded check passing.

Use `python3 ~/.config/kilo/upgrades/delivery-v1/tools-benchmark/benchmark.py report` for descriptive tables. Compare the matched task/context cohorts before using aggregate class statistics. The report does not select a winner or change configuration. Different model task mixes, small sample sizes, provider load, human interruptions, and changing requirements can invalidate apparent speed/cost advantages.

Quality rubric: **0** no usable result; **1** major incorrect behavior; **2** substantial missing acceptance; **3** useful but requires material corrections; **4** meets acceptance with minor issues; **5** meets acceptance with clear evidence and no identified material issues. Acceptance and check counts remain separate objective fields; scores are reviewer judgments.

Prefer reliable acceptance and correctness first, then successful whole-task completion time and retries, then actual cost. Use TPS to explain generation behavior. Propose routing changes only for task classes with repeatable matched evidence; preserve current routes for inconclusive classes. Do not claim a guaranteed speedup or cost reduction.
