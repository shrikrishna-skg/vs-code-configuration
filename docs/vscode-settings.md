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

## To-do list in both locations

The native header checklist starts expanded, while `todowrite` entries remain
in the conversation. Both the editor chat and Agent Manager use live to-do
state when available. After reopening a chat before a live update arrives,
they recover the latest completed `todowrite` list from that session's loaded
messages using Kilo's existing history helper. Explicitly cleared live lists
stay empty, and reverted updates are excluded. No checklist is invented for
a conversation without one. Older conversation entries remain historical snapshots.

The header arrow still collapses the list. This changes the header's initial
display and shared to-do lookup, without submitting prompts or modifying tasks.
`examples/patches/todos-both-locations.mjs` supports `--check` and surgical
`--restore` on both JavaScript bundles. The patch reapply hook includes it.
Reopen the Kilo view to load the change.

## Expanded subagent activity

The local Kilo 7.8.2 task cards open by default in both the editor chat and
Agent Manager, including background and completed subagents. Manual collapse
and reopen still use Kilo's existing per-card state; untouched cards remain
open through status changes. That state is local to the loaded view, so
recreating the view returns cards to the expanded default. Individual tool
details and the separate open-in-tab action are unchanged.

`examples/patches/subagent-default-open.mjs` changes only the native task-card
default policy. It does not submit model requests or start workers; expanded
cards do subscribe to their existing activity streams. The existing scrollable
height limit remains. The reapply script covers both bundles and fails closed
on unknown anchors. Apply to `dist/webview.js` and `dist/agent-manager.js`;
use `--check` to verify or `--restore` to undo just this change. Reload the
Kilo view when running work can safely be left alone.

## Orange send and stop controls

Sample 1 keeps the current composer layout and focus border, with a coral
rounded button for the native upward Send arrow and white Stop square.
It applies to editor chat and Agent Manager. Continue, recording, goal start,
tooltips, keyboard activation and disabled-state decisions still use native
Kilo handlers. Goal-start text remains visible. Clarify goal is unchanged.

`examples/patches/composer-orange-actions.mjs` patches both `.js` and `.css`
bundles in the custom Kilo 7.8.2 installation. It supports `--check` and
`--restore`, creates backups and rejects unknown anchors. The reapply hook
retains the patch. Reopen the view or reload VS Code when idle to activate it.
Run `node scripts/test-composer-orange-actions.mjs` for the regression check;
add `--ui` on this machine to test both installed bundle styles and icons in
headless Chrome. Those browser fixtures are not full native Kilo task runs.

## Ask / Auto / Full access

The shield in both Kilo chat composers opens a permission menu. It shows the
backend-confirmed mode and displays errors instead of pretending a change
succeeded. The choice is shared by Kilo chats in the same VS Code window.

- **Ask:** disables Kilo's automatic replies to permission requests. Actions
  already allowed by native rules still run without asking.
- **Auto:** approves ordinary pending and new permission requests. Sandbox
  escalation requests still require a manual answer.
- **Full access:** also approves sandbox escalation requests. This mode lasts
  only until this VS Code window reloads or another mode is chosen; with the
  native enabled flag retained, a reload returns it to Auto.

Explicit denied tools, role restrictions, missing tools, account access and OS
permissions remain enforced. This menu neither rewrites agent policies nor
disables the sandbox; Full access uses Kilo's existing one-request approval API
for requests the backend actually issues. It adds no model calls.

Installing the selector preserves the existing `kilo-code.new.autoApprove.enabled`
setting. The legacy toggle command switches between Ask and Auto. External
changes to that setting clear the window's Full access state. Selecting Ask
also invalidates queued automatic-reply retries; an action already accepted
by the backend cannot be recalled by changing this setting.

`examples/patches/permission-modes.mjs` installs the backend adapter, shared
menu helper and styles. It has `--check` and surgical `--restore` modes, and
creates backups. The reapply script includes all five bundles. The backend
helper is `permission-modes.cjs`; `permission-mode-ui.js` supplies the menu.
Run `node scripts/test-permission-modes.mjs`, or add `--ui` for the installed
bundle CSS checks in headless Chrome. Reopen/reload Kilo to load an update.

## Model settings versus the default agent

The VS Code settings retain a direct Sol model selection, while `kilo.jsonc` selects `astra-engineering-lead` as the default agent. The agent selection is the important control for the multi-agent workflow. The direct model setting is a UI fallback and should not be mistaken for the active lead when an agent is selected.
