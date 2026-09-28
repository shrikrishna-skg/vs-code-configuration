# Hermes Agent in VS Code

[Hermes Agent](https://hermes-agent.nousresearch.com/docs/user-guide/features/overview) is Nous Research's open-source agent. Here it runs as an engineering lead inside VS Code through the Agent Client Protocol (ACP), with the same Ponytail coding policy, chat style and guardrails as the other leads.

> **Status on 2026-09-27:** Hermes v0.21.5+3169.g28e6496 is installed at `~/.local/bin/hermes`; the ACP Client extension and absolute-path VS Code registration are in place; `hermes acp --check` passes; and the live `~/.hermes/SOUL.md` matches this repository’s template. The lead is `anthropic/claude-opus-5.5` through OpenRouter, with `deepseek/deepseek-v4.1-flash` workers and a three-worker limit. OpenRouter is logged out because `~/.hermes/.env` still has only a commented `OPENROUTER_API_KEY` placeholder, so the agent cannot yet complete a model request.

## Files

| File | Live location |
|---|---|
| [`config/SOUL.md`](config/SOUL.md) | `~/.hermes/SOUL.md` (Hermes puts it first in the system prompt) |
| [`config/vscode-acp-settings.jsonc`](config/vscode-acp-settings.jsonc) | merged into `~/Library/Application Support/Code/User/settings.json` |

`SOUL.md` holds the identity (lead in VS Code, `delegate_task` for separable work, max 3 workers with exclusive file scopes, Ponytail forwarded to each), the stop-and-ask guardrails, the Ponytail upstream rule text verbatim with provenance, and `~/.config/kilo/chat-response-style.md` verbatim plus the Claude Code presentation additions. Hermes does not expand Claude-style `@path` imports, so the text is embedded; re-copy it when either source changes.

## Finish activation

The install, ACP dependencies, model routing and VS Code registration are already in place. To finish activation:

1. In `~/.hermes/.env`, uncomment `OPENROUTER_API_KEY=` and enter your own key after the equals sign, without quotes. Keep this file local; never copy the key into this repository or a chat.
2. In VS Code, open **ACP Client**, choose **Hermes Agent**, click **Connect**, and send `hi`.

The ACP dependency check already passes. After the key is saved, a reply in the panel is the end-to-end check that the configured lead can call its provider and use delegated workers. The current setup does not need the installer or `hermes model` wizard again.

## Guardrails

- Dangerous-command approval stays **on**; no yolo or auto-approve mode.
- The messaging gateway stays **off** (no `hermes gateway install`).
- `delegate_task` concurrency is capped at 3 in `~/.hermes/config.yaml`.
- `SOUL.md` makes Hermes stop and ask before pushing, rewriting history, deleting data, deploying, sending messages, touching secrets, or changing security or system settings, and forbids entering credentials or taking the mouse cursor.
- `/rollback` restores Hermes checkpoints if an edit goes wrong.

## Nightly drift report (optional)

A read-only report comparing live config with this repository. Create it only after OpenRouter authentication is configured, and keep it paused:

```bash
hermes cron create "0 2 * * *" "Read-only drift report. Compare ~/.config/kilo, ~/.claude, ~/Library/Application Support/Code/User/settings.json and ~/.hermes/SOUL.md with the matching files in ~/Downloads/Code/vs-code-configuration. List files that differ and summarise each difference. Never edit, commit or push anything, and never print secrets, tokens or .env contents." --paused --paused-reason "Needs the gateway daemon"
hermes cron list
hermes cron resume <job_id>
```

**Limit:** Hermes cron jobs fire only while the gateway daemon runs, and this setup keeps the gateway off. Resume the job only if you decide to run the gateway.

## Known limits

- Editor approval cards time out after 300 s (`approvals.timeout` in `~/.hermes/config.yaml`) and the command is denied.
- Browser tools are not installed (`--skip-browser`). Add them with `hermes acp --setup-browser` (about 400 MB: Node, Playwright Chromium).
- Hermes memory (`MEMORY.md`, `USER.md`), sessions and `.env` live under `~/.hermes/` and are never mirrored here.
