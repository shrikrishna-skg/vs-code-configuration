# VS Code settings

The VS Code layer contributes several behaviors that are separate from `kilo.jsonc`:

- Kilo's agent terminal commands bypass normal shell handling.
- Kilo uses autonomous work style.
- Auto-approval is enabled.
- In-app attention notifications are enabled while OS notifications are disabled.
- Claude Code opens in the panel and skips onboarding.
- Accessibility support is explicitly enabled.
- The active editor tab is a faint blue pill (`workbench.experimental.modernUIEditorTabStyle: pill` plus `modernEditorTab.*` and dim `tab.activeBorder` colors), because VS Code 1.139's default connected tabs ignore the classic `tab.*` colors.

The sanitized settings are in `examples/vscode/settings.jsonc`. Merge those keys into the existing VS Code user settings instead of replacing the entire file.

The VS Code Chat (Copilot) keys and the accessibility sound-off keys are in `copilot-chat/config/settings.jsonc`; `copilot-chat/scripts/install.sh` merges them. See [`copilot-chat/README.md`](../copilot-chat/README.md).

## Agent Manager opening automatically

The local Kilo 7.8.1 build opens Agent Manager on Integrated Browser `starting`
and `loading` events and can restore the panel after a VS Code restart. The
`examples/patches/agent-manager-manual-open.mjs` patch disables those two paths
while preserving browser state delivery, explicit Agent Manager commands, and
worktree actions. It does not cancel sessions or disable browser automation.

Apply it to the installed local extension's `dist/extension.js`, then reload VS
Code when current tasks can be interrupted. `--check` verifies the patch;
`--restore` reverses only these edits. A `.pre-agent-manager-manual-open` backup
is saved next to the bundle. The existing live `reapply-kilo-patches.sh` hook
also applies this patch to custom local Kilo builds. Unknown bundle layouts
fail without modification and need a reviewed patch update.

## Auto-approval boundary

`kilo-code.new.autoApprove.enabled` is intentionally preserved because it is part of the observed setup. It increases autonomy and also increases risk. Pair it with:

- Tight agent role permissions.
- Read-only investigator definitions.
- One writer per file or subsystem.
- Explicit approval requirements for unknown task agents.
- Version control and frequent diff inspection.
- No credentials inside the workspace.

Disable auto-approval on unfamiliar repositories, security-sensitive environments, or machines where shell and filesystem access are not sufficiently isolated.

## Model settings versus the default agent

The VS Code settings retain a direct Sol model selection, while `kilo.jsonc` selects `astra-engineering-lead` as the default agent. The agent selection is the important control for the multi-agent workflow. The direct model setting is a UI fallback and should not be mistaken for the active lead when an agent is selected.
