# Operating Notes

## Known-good behavior

- A fresh VS Code Claude session selects Fable 5.1 High.
- A trivial request remains with Fable and spawns no worker.
- A bounded read-only investigation can route to Sonnet.
- A large task can route through one Opus delivery lead to parallel Opus or
  Sonnet children at depth two.
- Nested child results return to the delivery lead for aggregation.
- Agent rows use concise subjects and expose their live activity in Claude's
  native expandable task tree.

## Failure handling

- Workers have finite turn budgets and preserve partial evidence.
- The delivery lead handles normal implementation and test failures.
- Fable handles material architecture, security, destructive-action,
  conflicting-requirement, and authorization decisions.
- Duplicate writers and retry storms are prohibited.
- Sonnet has explicit write-tool denials.

## Session behavior

Existing chats preserve their earlier model and instruction snapshot. Open a
new chat after configuration changes. The model picker shows `Fable 5.1 High`;
Claude Code does not support a custom `Fable Engineering Lead` entry in that
picker. Engineering-lead behavior comes from `CLAUDE.md`.

## Rollback

Before installation, copy the existing `~/.claude/CLAUDE.md`, `settings.json`,
and any same-named agent definitions to a dated local directory. Restore those
files and open a fresh session to roll back. Do not commit the backup.
