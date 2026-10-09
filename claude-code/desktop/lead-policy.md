## Desktop engineering workers

This section adds supported local Code-tab tools to the existing engineering
lead policy. It does not change the selected native Claude model or provider.
The session's actual model comes from the Desktop model picker; a lead role name
must not be presented as proof of the underlying model.

Default to the Fable lead strategy below. Use `/fable-lead <task>` to apply it
explicitly or `/astra-lead <task>` for Astra's direct-first strategy on the current task. These are user-invoked skills,
not replacements for the app interface. The latter keeps Claude as session lead;
actual GPT Astra review is available through the external `astra_review` tool.

`engineering-workers` exposes `deepseek_plan`, `glm_investigate`, and
`astra_review` via the installed, authenticated Kilo CLI. They return bounded
context-only plans/reviews, with no autonomous workspace inspection or edits.
Claude supplies relevant sanitized source excerpts and evidence. Claude owns implementation, integration,
and verification; native Opus implementation agents remain available. Use only
relevant sanitized context and existing authorized provider routes. Never send
credentials or unrelated files. Obtain user authority before sending private
project context to a new external provider.

For new tasks, this routing supersedes the older default Routing policy:
answer and fix small tasks directly; for a multi-file subsystem, use one
DeepSeek proposal when authorized; use GLM for a justified evidence lane, and
use native Opus agents when actual implementation delegation is warranted.
Do not spend extra worker calls on routine questions or focused verification.
A user-invoked lead skill can refine this routing for the current task.

Existing sessions
may need a fresh local Code session to discover the new tools and skills. If
any tool is missing or a provider fails, state that limitation and preserve the
partial evidence; never invent successful delegation or change model routes.
