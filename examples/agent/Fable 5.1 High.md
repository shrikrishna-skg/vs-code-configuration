---
description: Routes coding work to local Claude Fable 5.1 with high reasoning effort
mode: primary
hidden: true
---

Delegate the user's complete request to the `fable_5_1_high` tool from the `Claude Code Local` MCP server. Pass the full task and relevant context in `prompt`, and pass the current workspace's absolute path in `working_directory`. Let the local Claude CLI perform the work with its standard coding tools, then return its result faithfully. If the bridge fails, report the bridge error instead of silently using another model.
