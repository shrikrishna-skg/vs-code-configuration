# Codex Local CLI models in Copilot Chat: plan

Goal: use ChatGPT-plan models (GPT-6 Astra, GPT-5.6 Sol/Luna/Terra) in VS Code's Chat view through the
signed-in Codex CLI, exactly like the "Claude Local CLI" models: a Custom Endpoint in
`chatLanguageModels.json`, VS Code runs the tools, streaming works, agents can pick the models.

## Design

- **Same bridge, second backend.** `claude-cli-provider.mjs` (loopback 32123) already does the hard,
  model-agnostic parts: OpenAI chat-completions + streaming, tool-mode "decision JSON" (the model returns
  `{kind, content, tool_calls}` and the bridge emits OpenAI `tool_calls`, so VS Code runs the tools),
  session reuse with prompt deltas, per-conversation locks, a concurrency pool, image attachments,
  subscription-limit errors. Route `codex-*` model ids to a Codex runner instead of `claude`.
  One port, one LaunchAgent, no duplicated 1,500-line file. Kilo gets the models for free.
- **Codex runner.** `codex exec --json --output-schema <decision schema> -m <slug>
  -c model_reasoning_effort=<effort> --sandbox read-only --skip-git-repo-check -C <cwd>`; resume with
  `codex exec resume <thread id>`. Codex's own tools stay off in tool mode, so every action goes
  through VS Code (edit review UI, Peekaboo, subagents, approvals).
- **Auth.** Only the Codex CLI reads `~/.codex/auth.json`. The bridge never reads or forwards the token.
- **Binary.** Resolve the newest `~/.vscode/extensions/openai.chatgpt-*/bin/*/codex` on each start
  (the path changes on every extension update); `CODEX_BRIDGE_BINARY` overrides.
- **Scale.** Separate concurrency pool and session LRU per backend, so Codex load never starves Claude.

## To-do

- [x] 1. **Spike**: prove `codex exec --json --output-schema` returns a valid decision,
      record the JSONL event shapes (text deltas, usage, thread id, errors, limit messages), test
      `resume`, `-i` images, reasoning-effort config, a read-only sandbox with no Codex tool use, and latency.
- [x] 2. **Base state**: live edits committed as `live-config-snapshot` (70a37a0) and merged into this
      branch; `scripts/verify.sh` passes.
- [x] 3. **Backend**: add the Codex runner to the bridge (binary resolution, args, JSONL parser,
      streaming, resume, cancellation, limit detection, per-backend pool), plus `--self-test` cases.
- [x] 4. **Catalog**: "Codex Local CLI" group in `copilot-chat/config/chatLanguageModels.json`
      (Astra, Sol, Luna, Terra at chosen efforts); the bridge's `/v1/models` lists them.
- [x] 5. **Checks**: `scripts/verify.sh`, `check-peekaboo-mcp.mjs --live` model count (expects the
      five Codex ids; passes only after the live bridge is updated), `test-install.sh` group merge.
- [x] 6. **Docs**: `copilot-chat/README.md` model section, `docs/installation.md`.
- [ ] 7. **End to end**: reload VS Code; in Chat pick "GPT-6 Astra (Codex Local CLI)"; run a turn with
      a file edit, a terminal command and a Peekaboo `see`; a follow-up turn resumes the session;
      Kilo still works; Claude models unaffected under parallel load.
- [ ] 8. **Agents (optional)**: point Astra leads / Sol / Luna fallbacks at the Codex models so they use
      the ChatGPT plan instead of Copilot quota.

## Decisions (steps 3-6)

- **Routing:** ids starting with `codex-` use the Codex runner; all other ids are unchanged Claude runs
  (Claude prompts, argv, schema and env verified byte-identical against the previous file).
- **argv:** `codex exec [resume <thread>] - --json --ignore-user-config --skip-git-repo-check [-C <cwd>]
  -c sandbox_mode="read-only" -m <slug> -c model_reasoning_effort="<effort>"`, plus in tool mode
  `--disable` for shell_tool, unified_exec, multi_agent, apps, plugins, browser_use, computer_use,
  image_generation, view_image, `-c web_search="disabled"` and `--output-schema`; then `--image <file>`
  per attachment. The prompt goes on stdin (`-`, verified for new and resumed threads). `resume` takes no
  `-C`/`--sandbox`, so the sandbox is config and the cwd is the process cwd; model and effort are always
  re-passed. apply_patch has no switch; the read-only sandbox blocks its writes.
- **Schema:** strict (closed objects, all keys required); `arguments_json` strings are parsed into the
  shared decision, and bad JSON is an invalid decision (same retry path as Claude).
- **Sessions:** the Codex thread id from `thread.started` becomes the session id; a missing thread
  ("no rollout found") falls back to a fresh thread with the full transcript. Per-backend LRU of 128.
- **Limits:** Codex limit texts ("hit your usage limit", "usage limit", "out of credits", "spend cap",
  "try again at <time>") return the cached 400 limit error, parsed from "try again at 3:04 PM" or
  "Sep 25th, 2026 3:04 PM". In memory only: the bridge cannot tell ChatGPT accounts apart without reading
  `auth.json`.
- **Conversation mode (no tools):** Codex answers read-only with its own tools allowed by the sandbox.
- **End to end (luna medium, spare port):** final answer 3.6 s, streamed `read_file` tool call 5.4 s,
  resumed thread with the tool result 4.0 s, image attachment 3.6 s, `/v1/models` lists the five ids.
  Codex ran none of its own tools.
