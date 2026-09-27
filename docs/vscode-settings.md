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
