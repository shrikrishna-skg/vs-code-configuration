# Skim mode for Claude Code

A Claude Code mod that keeps the first sentence of each paragraph and list item
bright and dims the rest of an assistant reply. `/skim` toggles it. The sentence
rules are the same as Kilo's skim mode (`examples/patches/skim-mode-ui.js`).

Files: `.claude-plugin/plugin.json` (manifest), `hooks/hooks.json` and
`hooks/register.tsx` (the mod), `tests/skim.test.ts` (its test).

## Load it

```sh
claude --plugin-dir /path/to/vs-code-configuration/claude-code/mods/skim-mode
# or, for every session:
export CLAUDE_CODE_PLUGIN_DIRS=/path/to/vs-code-configuration/claude-code/mods/skim-mode
```

The type definitions (`.claude-plugin/types/`) and `tsconfig.json` are generated
by Claude Code for the local copy and are not saved here.
