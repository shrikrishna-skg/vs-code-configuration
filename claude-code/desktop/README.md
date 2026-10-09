# Claude Desktop engineering leads

Claude remains the main model in Desktop Code. The `fable-lead` and
`astra-lead` skills apply the user's lead strategies; they do not change the
actual Claude model into an OpenAI model. Optional external tools provide
DeepSeek implementation proposals, GLM evidence analysis, and an optional Astra
review route through Kilo (currently unavailable; see verification below).

The bridge discovers the installed Kilo extension, including the user's local
fork, and reads model identifiers from existing Kilo agent definitions. It
does not copy keys or replace provider settings. Models use their existing
provider billing and availability. Provider errors are returned explicitly.

## Context-only boundary

`deepseek_plan`, `glm_investigate`, and `astra_review` analyze only the bounded
task and sanitized context Claude supplies. Every worker tool is disabled,
including repository reads, searches, shell, edits, external MCP, and nested
delegation. The CLI runs with `--pure` in a fresh temporary directory, never
in the selected workspace. Workspace is scope metadata only. Claude owns
repository inspection, writes, tests, and final acceptance.

These are harness restrictions, not an operating-system security sandbox.
Never send secrets. The bridge's recognizable-secret check is defense in
depth, not comprehensive filtering. Context is sent to the selected external
provider and Kilo can retain normal local session history. The bridge itself
does not write prompts, credentials, or raw errors to logs.

## Installed locations

- Bridge: `~/.config/claude-engineering-lead/kilo-workers-mcp.mjs`.
- User-scoped MCP entry: `~/.claude.json`, server `engineering-workers`.
- Skills: `~/.claude/skills/fable-lead` and `~/.claude/skills/astra-lead`.
- Main lead policy: managed block in `~/.claude/CLAUDE.md`.

MCP backups are stored outside the repository in
`~/.config/claude-engineering-lead/backups/`; lead-policy backups are under
`~/.claude/backups/desktop-lead-*`. Existing MCP entries and unrelated
settings are preserved. Start a fresh local Desktop Code session after
configuration so it loads the new skills and MCP entry.

Run `node claude-code/desktop/validate.mjs` for no-provider-cost checks. A public
connectivity smoke check may be performed with `runWorker` and a prompt asking
for `READY`, without reading any repository content. A successful model call
verifies the external route; MCP connection in Desktop must be checked
separately.

## Observed verification on 2026-10-05

- Static protocol and context-only permission validation passed.
- Genuine public connectivity checks returned `READY` from DeepSeek
  `lithosai/deepseek-ai/DeepSeek-V4.1-Flash-ultra` and GLM
  `lithosai/zai-org/GLM-5.3-Flash-ultra`, using the corrected isolated route.
- Real Astra `openai/gpt-6-astra-ultrafast` failed with an invalid-provider
  diagnostic (`UnknownError`, exit 1) in the isolated `--pure` route. The
  bridge reports the failure; no provider or model is silently substituted.
  Exact provider remediation remains unverified. `/astra-lead` still applies
  the Astra operating strategy while Claude remains the actual main model.
- Native Claude MCP inspection reported `engineering-workers` connected.
  A fresh Desktop Code session discovered all three external tool schemas.
  Desktop slash menus visibly listed `fable-lead` and `astra-lead` user skills;
  the smoke session's input was cleared after checking the menus.

Tool discovery verifies loading, not a full coding workload. External workers
produce context-only advice; no autonomous repository read/write workflow is
claimed.
