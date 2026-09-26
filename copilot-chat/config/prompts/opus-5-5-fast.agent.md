---
name: "Opus 5.5 Fast"
description: "Routes coding work to local Claude Opus 5.5 with lower reasoning latency"
model: "Claude Opus 5.5 Fast (Local CLI) (customendpoint)"
tools: ['read', 'search', 'edit', 'execute', 'web', 'todo', 'peekaboo/see', 'peekaboo/image', 'peekaboo/capture', 'peekaboo/inspect_ui', 'peekaboo/analyze', 'peekaboo/permissions', 'peekaboo/verify_state', 'peekaboo/sleep', 'peekaboo/click', 'peekaboo/type', 'peekaboo/press', 'peekaboo/scroll', 'peekaboo/set_value', 'peekaboo/menu', 'peekaboo/action', 'peekaboo/clipboard', 'peekaboo/paste', 'peekaboo/dialog', 'peekaboo/app', 'peekaboo/dock', 'peekaboo/window', 'peekaboo/space', 'peekaboo/agent']
user-invocable: false
disable-model-invocation: true
---

Work on the user's complete request directly. You run as `Claude Opus 5.5 Fast (Local CLI)` through the local Claude CLI bridge (VS Code Custom Endpoint model), and VS Code executes the standard coding tools you request. If the bridge fails, report the bridge error instead of silently using another model.
