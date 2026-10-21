# Installation and recovery

This guide installs the current **CTO (Recommended)** and **CTO + JEV** profiles with `scripts/install-cto.mjs`. The repository is a custom configuration: it is not an official VS Code or Kilo Code feature, and some optional patches modify the installed Kilo bundle.

## Prerequisites

- VS Code with the Kilo Code extension.
- Node.js for the installers, helper scripts, and checks.
- Accounts or API access for only the provider routes you choose.
- macOS for the Peekaboo screen-control setup and any LaunchAgent-based local service.
- Chrome and Playwright for the safe Kilo patch gate and the complete `scripts/verify.sh` suite, which includes offline browser checks. They are not needed to install the CTO profiles or run the focused `node scripts/test-cto.mjs` check.
- An authenticated Claude CLI only if you enable the historical local Claude route.

The observed versions are recorded in [Configuration inventory](configuration-inventory.md). The current snapshot used Kilo Code 7.8.12; older notes mention 7.7.2 and 7.8.2. Patches are version-sensitive, so use the checks described below instead of assuming compatibility.

## Clone or download, then back up

```sh
git clone https://github.com/shrikrishna-skg/vs-code-configuration.git
cd vs-code-configuration
mkdir -p ~/.config/kilo
if [ -d ~/.config/kilo ]; then cp -R ~/.config/kilo ~/.config/kilo.backup-$(date +%Y%m%d-%H%M%S); fi
```

If you downloaded a ZIP instead, extract it, open a terminal in its root, and start with the backup command. In VS Code, open the user settings JSON and copy it aside as well before merging any keys.

## Install the instruction files

```sh
mkdir -p ~/.config/ponytail ~/.config/kilo
cp examples/instructions/AGENTS.md ~/.config/ponytail/AGENTS.md
cp examples/instructions/chat-response-style.md ~/.config/kilo/chat-response-style.md
```

These two files provide different controls: `AGENTS.md` governs coding decisions, while `chat-response-style.md` keeps progress updates brief and defines the final response format. The canonical Ponytail text remains unchanged in `examples/instructions/AGENTS.md`; see [Third-party notices](../THIRD_PARTY_NOTICES.md).

## Install the Kilo configuration

The installer reads `~/.config/kilo/kilo.jsonc` and merges the CTO profiles into it. For a new machine, create that file first and replace every placeholder:

```sh
# New installation only. Skip this copy when a live kilo.jsonc already exists,
# because the installer preserves installed routes and unrelated settings.
mkdir -p ~/.config/kilo/agent ~/.config/kilo/bridges
if [ ! -f ~/.config/kilo/kilo.jsonc ]; then cp examples/kilo.jsonc ~/.config/kilo/kilo.jsonc; fi
```

Do not copy `examples/agent/*.md` over an existing installation by hand. The installer selects the current profiles, installs the three native specialist profiles, hides retired profiles, and preserves installed model routes and credentials.

Preview first, then apply:

```sh
node scripts/install-cto.mjs            # dry-run: list targets and changes
node scripts/install-cto.mjs --apply    # back up, then install
```

The default with no arguments is the inspection/dry-run mode. Full installation also installs the separate `cto` MCP server for terminal workflows. To upgrade only the native profiles without replacing a running MCP scheduler:

```sh
node scripts/install-cto.mjs --profiles-only            # dry-run
node scripts/install-cto.mjs --profiles-only --apply
```

The installer prints its private backup directory. Restore a printed backup with:

```sh
node scripts/install-cto.mjs --restore /absolute/path/to/printed/backup
```

Restoration refuses to overwrite files changed since installation. It retains task records and worker worktrees. Cancel active workers before restoring or removing their service.

After installing, open an idle Kilo window and run **Kilo Code: Reload Config and Skills**. A new chat should show **CTO (Recommended)** and **CTO + JEV**. Existing chats can keep their previous agent; select a CTO profile or start a new session. A whole VS Code reload is not required by the installer.

## Merge the VS Code settings

Open VS Code user settings as JSON and merge the keys from `examples/vscode/settings.jsonc`. Do not replace unrelated user settings.

Review these before adopting them on another machine:

- **Auto-approval / Full access:** reduces permission prompts and can let a model act without asking.
- **Desktop control (Peekaboo):** permits screen observation and input; the global config denies the Chrome-only `Peekaboo_browser` tool.
- **Claude file-history access:** exposes historical file copies under `~/.claude/file-history` to Kilo, which aids recovery but widens read access.

Remove or narrow any permission you do not need. Do not modify a live configuration merely to match an example.

The VS Code Chat (Copilot) keys, including the accessibility sound-off keys, are installed separately by `bash copilot-chat/scripts/install.sh`, together with the Chat custom agents, `mcp.json` and the Claude Local CLI models. Run it with `--dry-run` first; see [`copilot-chat/README.md`](../copilot-chat/README.md).

## Authentication

Authenticate through Kilo's provider UI or the provider's official CLI. Do not add keys to `kilo.jsonc`, agent Markdown, shell scripts, or this repository. Configure credentials only for the routes you actually use. If a route is unavailable, leave it unauthenticated rather than substituting a provider silently.

## Optional local bridges and screen control

The CTO profiles use native Kilo `task` children and do not require the separate terminal scheduler or the local Claude bridge. Full installation still registers the separate `cto` MCP server; `--profiles-only` leaves it untouched.

For screen automation, install Peekaboo and set its absolute path in `kilo.jsonc` as shown in the example:

```sh
npm i -g @steipete/peekaboo
```

Keep `--no-remote` immediately after `mcp serve`. Without it, Peekaboo routes through one shared bridge daemon, and a second VS Code window can fail to start it. On macOS, grant Visual Studio Code Screen Recording and Accessibility access in System Settings > Privacy & Security, then reload the window.

Run `node examples/patches/check-peekaboo-mcp.mjs [kilo.jsonc] --live` to check the entry and list the server's tools. The separate `examples/bridges/peekaboo-runner.mjs` and the Claude CLI bridge are described in [Astra, Fable and Opus + Jev](astra-jev.md) and [Local Claude CLI bridge](local-cli-bridge.md).

## Optional version-sensitive patches

The patches under `examples/patches/` are custom modifications to the installed Kilo bundle, not stock Kilo features. They match exact text in specific builds and refuse an unknown or ambiguous bundle. The current snapshot targets Kilo 7.8.12; historical notes mention 7.8.1, 7.8.2 and 7.7.x, and those do not establish compatibility with the current build.

Install patches only through the safe gate:

```sh
# Managed batch, if you have copied the patch scripts into ~/.config/kilo/patches.
bash scripts/reapply-kilo-patches.sh

# One patch against explicit installed dist targets.
node ~/.config/kilo/patches/safe-kilo-patches.mjs patch <patch.mjs> <installed-dist-targets...>
```

The gate stages the batch, syntax-checks every JavaScript file, checks that a second application changes nothing, and renders both real chat bundles in an isolated offline browser. A failed batch leaves the installed version untouched. Playwright and Chrome must be available for that render step; missing validation tools block installation. Validated replacements keep rollback copies. The gate never reloads VS Code or changes chat storage.

The reapply script is included in this repository. A LaunchAgent plist is **not** included; do not follow older instructions to load `~/Library/LaunchAgents/ai.kilo.reapply-patches.plist`. Run the script manually when appropriate, or create and review your own service definition. This is macOS-specific and optional.

## Smoke checks

Run one check per route you enabled:

1. Start a new chat with **CTO (Recommended)** and ask a simple repository question. It should answer directly without unnecessary workers.
2. Give it a bounded implementation with one exclusive file and one executable check. Confirm a DeepSeek implementer appears as a native child and that the CTO reviews the diff.
3. Ask for a read-only diagnosis. Confirm the GLM investigator does not modify files.
4. Enable **CTO + JEV** only if the TypeSafe route is configured. Confirm advice is treated as advisory and the CTO still verifies the result.
5. If you installed optional chat patches, confirm the changed controls render and the affected interaction works. A successful startup render alone does not prove an interaction.
6. Confirm a reply uses the exact `Answer`, `My opinion`, and `Next step` headings when that style is installed.
7. Inspect `git status` after every check. Native child agents share the checkout and must stay within their assigned files; use an Agent Manager worktree or the isolated terminal scheduler when a separate checkout is needed.
8. Complete the broader [Scenario checklist](scenario-checklist.md) for your enabled routes.

## Historical leads

Astra, Fable, Opus + Jev, and the local Claude CLI routes are earlier configurations. They are documented in [Astra, Fable and Opus + Jev](astra-jev.md) and remain selectable only if your installed configuration still contains them. The CTO installer hides the retired profiles without deleting their definitions.

## Recovery

If Kilo fails to load after a change:

1. Restore the backup configuration, or use `node scripts/install-cto.mjs --restore <printed-backup>`.
2. Restart VS Code.
3. Reapply one file or one patch at a time.
4. Check paths and model IDs first; they are the most machine-specific values.
5. If only a bundle patch broke after an extension upgrade, leave Kilo unpatched until the patch's anchors are reviewed.

Never restore auth databases from this repository. Reauthenticate through the official provider flow instead.
