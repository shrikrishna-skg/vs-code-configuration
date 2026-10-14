# Configuration history

Each dated configuration has a Git tag named `config-YYYY-MM-DD`. Check out a tag to see, or reinstall, the setup exactly as it was on that day. Newest first.

| Date | Tag | Commit | Headline |
|---|---|---|---|
| 2026-10-13 | `config-2026-10-13` | resolve the dated tag | [Faster local CLI bridge, skim mode, chat font and predicted next message](updates/2026-10-13.md) |
| 2026-10-09 | `config-2026-10-09` | resolve the dated tag | [CTO, shared computer control, goal continuity and Clarify goal](updates/2026-10-09.md) |
| 2026-09-26 | `config-2026-09-26` | `fae6ae5` | Opus + Jev Engineering Lead (recommended), Peekaboo runner |
| 2026-09-23 | `config-2026-09-23` | `70a37a0` | VS Code Copilot Chat mirror, speed proxy, Astra + Jev |
| 2026-09-22 | `config-2026-09-22` | `1063d67` | Fast Fable bridge, Kilo patches, Fable + Jev |
| 2026-09-21 | `config-2026-09-21` | `2e12452` | Codex router, agent-vision docs |
| 2026-09-19 | `config-2026-09-19` | `8c850f7` | First Kilo and Claude Code setup |

## How to restore a dated configuration

```bash
git fetch --tags
git checkout config-2026-09-22                        # read-only view (detached HEAD)
git switch -c restore-2026-09-22 config-2026-09-22    # or: a branch you can edit
```

Then follow the install documents **as they exist at that tag**, because paths, agents and patches changed over time:

- **Kilo:** [`docs/installation.md`](installation.md). Back up `~/.config/kilo` first.
- **VS Code Copilot Chat** (2026-09-23 and later only): `bash copilot-chat/scripts/install.sh --dry-run` to preview every change, then run it without `--dry-run`, then the UI steps in [`copilot-chat/README.md`](../copilot-chat/README.md). It backs up each file it changes as `<file>.bak-<timestamp>`.
- **Claude Code extension:** [`claude-code/README.md`](../claude-code/README.md).
- **Check:** `bash scripts/verify.sh` at that tag.

Return to the current setup with `git checkout main`, then reinstall the same way. Compare two dates with, for example, `git diff config-2026-09-23 config-2026-09-26 -- examples/ copilot-chat/`.

**Version-sensitive patches:** the Kilo bundle patches under `examples/patches/` match specific Kilo builds (7.7.x on 2026-09-22, 7.8.1 on 2026-09-26). An older tag's patches may not apply to a newer Kilo; leave Kilo unpatched if the check fails. Never restore auth files from any tag; sign in again through each provider.

## 2026-10-09

Tag `config-2026-10-09`. See the [complete dated change index](updates/2026-10-09.md) for source files, installation guides, verification and remaining limits.

- **CTO and CTO + JEV:** isolated workers, fourteen-worker/six-writer limits, guarded integration and compact selected label.
- **Shared computer control:** coordinated native desktop and browser tools, with automated and live model checks.
- **Goal continuity and Ponytail:** bounded follow-ups, retained acceptance criteria and shared coding policy.
- **Clarify goal:** the existing wand always uses DeepSeek on LithosAI with supported attachments and recent chat, shows a Stop control, then opens an editable preview.
- **Supporting work:** manual Agent Manager opening, test repairs, the long-run plan validator and earlier Claude Desktop lead integration captured in this snapshot.
- **Native CTO delegation, October 9:** [Visible Kilo children and worktree routing](cto-native.md) replace invisible MCP delegation in the CTO chat profiles; installed routes are preserved. Native limits are scheduling policy, while the separate MCP scheduler retains enforced limits.
- **Approved restriction cleanup, October 9:** [C1–C12 changes](cto-permission-cleanup.md) remove unnecessary shell denials and conflicting instructions, align delivery commands with the CTO, and preserve role permissions and model settings.
- **Later October 9:** [adaptive CTO task routes](cto-adaptive.md) add scoped DeepSeek/Luna sessions and coordinated premium delegation, tracked in a subsequent commit without moving the dated tag.
- **Repository protection:** disabled and removed a pre-existing workflow that sent credential matches and history to an external endpoint; no raw credentials, session history or unrelated screenshots are included.

## 2026-09-26

Tag `config-2026-09-26` → `fae6ae5`.

- **Opus + Jev Engineering Lead** added for Kilo and Copilot Chat: Claude Opus 5.5 High through the local Claude CLI, the same workers and Jev rules as Fable + Jev, and background-first screen control. Picker order: Fable, Fable + Jev, Opus + Jev, Astra + Jev. This is the recommended lead.
- **`peekaboo-runner.mjs`** runs a whole JSON UI plan through the Peekaboo CLI with a check after each step and a confirm gate for destructive buttons. It always passes `--no-remote`.
- **No-cursor rule** in every lead: Peekaboo background delivery for native apps, a separate automated browser for websites, and ask before taking the real cursor.
- **GLM 5.3 Flash** routed to the fastest OpenRouter providers (`provider.sort = throughput`) in `kilo.jsonc` and in the speed proxy; measured median went from about 28 to about 176 tok/s.
- **Hermes Agent** (Nous Research) installed for VS Code through ACP. `hermes acp --check` passes; the absolute-path VS Code registration and live `~/.hermes/SOUL.md` are in place. The lead uses OpenRouter Opus 5.5, with DeepSeek V4.1 Flash workers and a three-worker cap. The OpenRouter key is still commented out in `~/.hermes/.env`, so a live chat awaits the user’s key entry; see [`hermes/README.md`](../hermes/README.md).
- **Kilo pinned** (`autoupdate: false`); `reapply-kilo-patches.sh` applies each patch independently and names failures. Copilot Chat gained the "Codex Local CLI" model group; Peekaboo `move` and `drag` were removed (not in Peekaboo 4.4.0).
- **Docs:** README navigation, [architecture diagram](../assets/architecture.svg) and this history.

Later the same day (after the tag):

- **Claude Code Local MCP timeout** raised from 10 to 30 minutes (`1800000`) in `kilo.jsonc`; Opus High delegates were hitting Kilo's `-32001` timeout.
- **GLM routing** stays on `throughput`: a benchmark measured about 205 tok/s median against about 167 for `latency`, which was only about 0.1 s faster to first token.
- **Claude bridge** retries once in the same CLI session when a decision is invalid (for example `tool_call` with no calls), replacing the catalog-only resend; the self-test no longer touches the live state file.
- **`active-tab-blue.mjs`** Kilo patch: the selected session tab gets a blue underline and faint blue tint (`--vscode-focusBorder`); `reapply-kilo-patches.sh` applies it to `webview.css` and `agent-manager.css`.
- **VS Code editor tabs:** `modernUIEditorTabStyle: pill` with blue `modernEditorTab.*` colors and a dim `tab.activeBorder`, since 1.139's connected tabs ignore classic `tab.*` colors.
- **Claude bridge mirror** now matches the live copy, including the Codex backend (live since 2026-09-23): `codex-*` models through the signed-in Codex CLI with their own slot pool and ChatGPT limit handling, plus `CLAUDE_BRIDGE_PORT` and `CLAUDE_BRIDGE_STATE_FILE` overrides.
- **PrimalLabs provider:** Kilo now exposes MiMo V2.6 Pro RL and DeepSeek V4 Flash 0731 through PrimalLabs' OpenAI-compatible API. The authenticated catalog and streamed tool calls succeeded; a short live Kilo response on the DeepSeek route displayed 354.3 tok/s. That is an observed interactive rate, not a benchmark.

Restore: all install steps above, including `copilot-chat/scripts/install.sh`. Copy `examples/bridges/peekaboo-runner.mjs` to `~/.config/kilo/bridges/` for the runner.

## 2026-09-23

Tag `config-2026-09-23` → `70a37a0`.

- **`copilot-chat/`** first added: 16 Kilo agents as VS Code custom agents, reply-style instructions, `mcp.json` (Peekaboo, Claude Code Local), Custom Endpoint models on the local Claude bridge (`127.0.0.1:32123`), chat settings with accessibility sounds off, and an idempotent `install.sh --dry-run`.
- **Peekaboo** runs with `--no-remote` everywhere so a second window can start it; its Chrome-only `browser` tool is denied. `check-peekaboo-mcp.mjs` guards Kilo, VS Code, Claude Code and Codex configs.
- **Claude bridge** serves VS Code as well as Kilo and runs up to 3 conversations in parallel.
- **Snapshot of live edits:** Astra + Jev Engineering Lead, OpenRouter speed proxy (`127.0.0.1:32126`, LaunchAgent `ai.kilo.openrouter-speed-proxy`), the TypeSafe (Jev) MCP bridge, and the Codex working-status patch with its mockups.

Restore: Kilo, Copilot Chat (`install.sh --dry-run` first) and Claude Code steps above.

## 2026-09-22

Tag `config-2026-09-22` → `1063d67`.

- **Kilo CLI bridge** `claude-cli-provider.mjs` (`claude-local-cli` provider) became the Fable lead's route: compact lead prompt, session resume, streamed answers; conversation mode cut prompt tokens by about 75%.
- **Opus routes** switched to Opus 5.5; Claude subscription limits show as a readable error.
- **Fable** batches tool calls and patches several files per step (a 6-file benchmark went from 20 steps / 168 s to 7 steps / 49 s).
- **Kilo patches:** each agent opens on its own model, new chats open on the last selected agent, Jev leads ordered in the picker; `scripts/reapply-kilo-patches.sh` re-applies them after Kilo updates (LaunchAgent `ai.kilo.reapply-patches`).
- **Fable + Jev Engineering Lead** added. Astra + Jev was already live but only captured in the repository on 2026-09-23.

Restore: Kilo and Claude Code steps above, plus [`docs/local-cli-bridge.md`](local-cli-bridge.md) for the bridge. There is no `copilot-chat/` folder at this tag.

## 2026-09-21

Tag `config-2026-09-21` → `2e12452`.

- **Codex router** (`examples/codex-router/`, service `ai.codex.claude-router` on `127.0.0.1:43128`) adds an Astra lead, a Fable lead and independent DeepSeek and GLM routes to the Codex model picker.
- **Image uploads** for Kilo-backed Codex models; per-request tokens per second logged and shown in routed responses; headerless native Codex streams handled.
- **`agent-vision/`** documents browser automation (Playwright MCP), macOS computer use (Peekaboo) and staged guardrail hooks.

Restore: Kilo and Claude Code steps above, plus [`docs/codex-model-picker.md`](codex-model-picker.md) for the router.

## 2026-09-19

Tag `config-2026-09-19` → `8c850f7`.

- **Kilo multi-agent setup:** Astra Engineering Lead (default) and Fable Engineering Lead, with DeepSeek Implementer, DeepSeek Workstream Lead, GLM Investigator and Luna Utility.
- **Local Claude CLI MCP bridge** (`claude-cli-mcp.mjs`) for Fable and Opus profiles.
- **Instructions:** the Ponytail coding policy and the `Answer` / `My opinion` / `Next step` response style.
- **Claude Code extension:** Fable lead supervising `opus-delivery-lead`, `opus-implementer-fast`, `opus-implementer-high`, `opus-test-integrator` and `sonnet-investigator` (Opus 5 at the time), with focused presentation and fewer preambles.
- **Checks:** `scripts/verify.sh`, scenario checklist and configuration inventory.

Restore: Kilo and Claude Code steps above. There is no `copilot-chat/` folder or Codex router at this tag.

## Restore on a new Mac

Use the current documents rather than a copy here:

1. Clone the repository and pick a date (`git checkout config-YYYY-MM-DD`), or stay on `main` for the latest setup.
2. Follow the [README quick start](../README.md#quick-start) and [`docs/installation.md`](installation.md) for prerequisites, instructions, Kilo and VS Code settings.
3. For VS Code Copilot Chat, follow [`copilot-chat/README.md`](../copilot-chat/README.md#install) (`install.sh --dry-run` first).
4. For the Claude Code extension, follow [`claude-code/README.md`](../claude-code/README.md); for the Codex picker, [`docs/codex-model-picker.md`](codex-model-picker.md).
5. Sign in to each provider through its own UI or CLI, then run `bash scripts/verify.sh` and the [scenario checklist](scenario-checklist.md).

## Local backups on this machine

Local-machine information only, not part of the repository: `~/.config/kilo/archive-20260926/` holds earlier live copies (`kilo.jsonc.bak-*`, `agent-bak-*` and the pre-no-cursor `*.agent.md.bak-20260926-nocursor` prompts). They exist only on the original Mac.
