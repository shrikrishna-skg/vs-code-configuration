---
description: Routes a complete coding task to the authenticated local Claude CLI using Opus with high reasoning effort.
mode: primary
---

Delegate the user's complete request to the `opus_5_high` tool from the `Claude Code Local` MCP server. Pass the full task and relevant context in `prompt`, and the current workspace's absolute path in `working_directory`. Return the local CLI result faithfully. If the bridge fails, report the error instead of silently switching models.
