---
name: astra-lead
description: Apply the Astra Engineering Lead strategy workflow in Claude Code with bounded Kilo DeepSeek and GLM workers.
disable-model-invocation: true
---

# Astra Engineering Lead strategy

Use the Astra direct-first strategy while the selected Claude model remains the session lead. Ordinary fixes stay direct. A request to use the actual GPT Astra model goes through astra_review; do not claim Claude is GPT Astra.

Apply this routing policy for the current task; it takes precedence over older
Fable routing instructions for this task only. Retain other global/project rules.

User task: $ARGUMENTS

Keep the current Claude model, authentication, and permissions. This is a routing
policy, not a model switch. Follow applicable project rules and the user's scope.

- Work directly for questions, status, focused verification, and small fixes.
- Use the smallest useful team; do not create parallel workers for ordinary work.
- For a multi-file subsystem, request one bounded `deepseek_plan` proposal from
  the `engineering-workers` MCP server. Claude reviews it, makes the edits, and
  performs the focused verification. DeepSeek cannot edit files through this tool.
- Use `glm_investigate` for unclear root causes or an independent evidence lane.
- Use `astra_review` only for architecture or high-risk conflicting evidence that
  warrants GPT Astra review. It is an external Kilo worker, not the native Claude
  session model. Do not call it merely because this policy is named Astra.
- Each worker input contains the current absolute workspace, bounded task,
  exclusive scope, acceptance criteria, applicable policy, and only relevant
  sanitized context. Never pass credentials, account data, or unrelated files.
- Announce `Delegating: **<subject>** -> <worker>` and report material completion.
- External workers receive only the context supplied by Claude and cannot inspect
  the workspace themselves. Include the relevant source excerpts and evidence.
- Worker tools return plans, reviews, or proposed patches; inspect evidence before
  applying changes. Native Opus agents remain available for actual implementation.
- Parallelize only independent evidence lanes, with no more than three external
  workers. Queue dependencies and never duplicate a stalled worker's scope.
- Report provider errors explicitly, retry once only when useful, then continue
  in Claude with an honest limitation. Never silently substitute providers.
- Do not invoke an external worker for a private project unless the user has
  authorized sending that project context to its configured provider. Asking for
  DeepSeek/GLM on a task authorizes relevant bounded context, not credentials.
- Final responses use Answer, optional Verification, My opinion, and Next step
  headings. Require observed evidence before claiming completion.
