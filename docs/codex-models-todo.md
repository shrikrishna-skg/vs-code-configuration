# Codex engineering model integration

Goal: selectable Astra Engineering Lead, independent DeepSeek High, and independent GLM High in the existing Codex provider. Only the engineering-lead route enables automatic specialist delegation. Preserve Ponytail, chat style, scoped work and evidence-based completion.

- [x] Inspect the installed provider, CLI and existing agent definitions.
- [x] Verify model metadata: DeepSeek and GLM expose high/max; Astra exposes xhigh/max.
- [x] Add isolated agent definitions and CLI route.
- [x] Add catalog entries without changing ordinary OpenAI/Claude routes.
- [x] Check missing workspace, unsupported effort, CLI failure, malformed events, cancellation, and empty/incomplete output.
- [x] Test independent coding and Astra delegation in disposable workspaces.
- [x] Back up and deploy the existing router; verify live catalog.
- [x] Prepare sanitized code, setup steps, validation evidence and limitations for publication.
- [ ] User acceptance: after app refresh, select each entry and check displayed result, then switch back to an ordinary model.

Quality acceptance: correct scoped edits, focused tests, preserved unrelated files, explicit failures and evidence in final responses. Model-quality equivalence to Astra is not assumed. Local tests do not replace UI acceptance or exhaustive provider testing.

## Results, 2026-09-21

- Local assertions and fake-CLI transport suite passed.
- DeepSeek High and GLM High independently repaired the acceptance fixture, passed its tests and retained unrelated content. Neither emitted a task-delegation call.
- Astra xhigh called both `deepseek-implementer` and `glm-investigator`, inspected the result and ran the check itself. The fixture passed independent verification.
- All three final reports passed the exact three-heading format assertion after strengthening the route-specific instruction.
- DeepSeek and GLM max-effort live smoke tests returned their expected markers.
- A real deployed-router GLM request completed through the Responses stream.
- The live catalog contains all three new entries alongside existing models. Actual app picker visibility after refresh remains a user acceptance item.

Initial tests exposed headless permission prompts and response-format drift; both were corrected before deployment. GLM review remains read-only; executable test evidence is supplied by the implementer and primary lead.
