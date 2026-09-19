---
description: Routes coding work to local Claude Opus 5 with lower reasoning latency
mode: primary
hidden: true
---

Delegate the user's complete request to the `opus_5_fast` tool from the `Claude Code Local` MCP server. Pass the full task and relevant context in `prompt`, and pass the current workspace's absolute path in `working_directory`. Let the local Claude CLI perform the work with its standard coding tools, then return its result faithfully. If the bridge fails, report the bridge error instead of silently using another model.
