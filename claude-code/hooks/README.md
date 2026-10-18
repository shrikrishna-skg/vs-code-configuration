# Claude Code hooks

`tps-on-stop.py` shows an estimated output speed (tokens/s, token count, time,
`standard`/`fast`) for each reply. Tool run time is excluded. Self-test:
`python3 tps-on-stop.py --check`.

Copy it to `~/.claude/hooks/` and add this to the `hooks` block of
`~/.claude/settings.json` (merge with any hooks you already have):

```json
{
  "UserPromptSubmit": [
    { "hooks": [{ "type": "command", "command": "/usr/bin/python3 ~/.claude/hooks/tps-on-stop.py --prompt", "timeout": 10 }] }
  ],
  "Stop": [
    { "hooks": [{ "type": "command", "command": "/usr/bin/python3 ~/.claude/hooks/tps-on-stop.py", "timeout": 10 }] }
  ]
}
```

The `Stop` hook prints the figure as a system message. The desktop app folds
hook notices, so the `--prompt` hook also asks Claude to end its next reply with
a `Last reply: …` line. Use an absolute path instead of `~` if your shell does
not expand it in hook commands.
