# Fable Engineering Lead: faster and smarter

Goal: cut the fixed cost of every Fable step through the local Claude CLI bridge and stop Fable spending its own context on work that cheaper lanes should do.

Baseline (measured 2026-09-22): trivial tool-mode step = 6.95 s and 28.6K prompt tokens for 4 output tokens. Session log of 564 requests: median 16.7 s per step, p90 57.8 s. Roughly 40% of a step is fixed overhead.

Live files: `~/.config/kilo/bridges/claude-cli-provider.mjs` (LaunchAgent `ai.kilo.claude-local-cli-provider`), `~/.config/kilo/bridges/fable-lead-system.md`, `~/.claude/hooks/verify-on-stop.sh`, `~/.config/kilo/kilo.jsonc`, `~/.config/kilo/agent/Fable Engineering Lead.md`. Repo mirrors live under `examples/`.

## Phase 1: strip fixed overhead

- [x] **Compact system prompt.** `fable-lead-system.md`, 378 words (about 600 tokens). Keeps identity and one-decision contract, condensed Ponytail ladder and rules, the Answer / My opinion / Next step output contract, secrets and no-destructive rules, "Kilo owns tools". Drops Claude Code subagent routing and harness tool docs. Mirrored at `examples/bridges/fable-lead-system.md`.
- [x] **Bridge uses it in tool mode only.** `claudeArgs` passes `--system-prompt` when Kilo tools are present. Conversation mode (Opus escalation, CLI runs tools) keeps the default harness. `--exclude-dynamic-system-prompt-sections` is not passed because the CLI ignores it alongside `--system-prompt`. Guarded by the bridge self-test.
- [x] **Tool catalog once per session.** `toolsHash` persisted on the session record; a resumed step with an unchanged hash sends a one-line "catalog #xxxxxxxx unchanged" marker. An invalid-decision error resends the full catalog once (`catalog_resent` event).
- [x] **Bridge marks tool-mode runs.** Tool-mode spawns carry `CLAUDE_BRIDGE_TOOL_MODE=1`; conversation mode strips it. Self-test asserts both.
- [ ] **Stop hook guard.** Blocked on user approval: `~/.claude/hooks/verify-on-stop.sh` is a sensitive executable file and both the implementer and the lead were refused write access. The reviewed change is two lines after the payload drain on line 5, before the first `git` call:

      ```sh
      # Kilo bridge tool-mode steps run no tools, so npm test here is pure latency.
      [ -n "$CLAUDE_BRIDGE_TOOL_MODE" ] && exit 0
      ```

      Effect: `npm test` (up to 110 s) stops running after every decision step. The script does not use `set -e`, so an empty variable falls through unchanged. `--bare` is not an option because it breaks keychain auth.
- [x] **Disable dead MCP.** `TypeSafe` in `kilo.jsonc` has `enabled: false`.
- [x] **Allow explore delegation.** Fable lead agent has `explore: allow` and the sentence sending read-heavy searches to the explore lane.
- [x] **Mirror to repo.** Live `claude-cli-provider.mjs` copied to `examples/bridges/` (same sha1 `54b7fbfa`), and `docs/local-cli-bridge.md` describes tool-mode overhead, delta resumes and streaming.
- [x] **Measure.** Numbers below, taken from `~/.config/kilo/logs/claude-cli-provider.log` split on the `provider_started` lines.

Acceptance: resumed-step prompt under 5K characters before the message delta; compact prompt at most 700 tokens; hook silent in tool mode; bridge self-test green; before/after numbers recorded here.

Measured after Phase 1 (2026-09-22, `session_resumed` events, `deltaMessages` median 2 in every segment so the workloads are comparable):

| Build | n | median promptChars | p90 | max |
|---|---|---|---|---|
| Before Phase 1 | 484 | 29371 | 81655 | 94741 |
| Compact prompt only | 47 | 28762 | 53599 | 86807 |
| Plus catalog-once | 11 | **3504** | 9181 | 27696 |

Median resumed-step prompt fell 88%, from 29371 to 3504 characters, and clears the 5K acceptance bar. The catalog-once change carried nearly all of it: the compact system prompt alone barely moved the median, because the 25-schema tool catalog resent on every step dominated. No `catalog_resent` events have appeared, so the hash reuse is holding. Bridge self-test green. The hook guard is still unverified because the edit is blocked.

The remaining tail is Phase 2 work: p90 is still 9181 and max 27696 on a 2-message delta.

## Phase 2: stop transcript replays

Sharper evidence after Phase 1: the oversized prompts are a tail, not the norm. On the current build a `deltaMessages: 2` step has a median of 3504 characters but a p90 of 9181 and a max of 27696, so something occasionally resends far more than the two new messages.

- [x] Cause identified: Kilo rewrites messages the CLI already saw (compacted tool outputs, regrown system `<env>` block), and the old prefix-match logic treated one rewritten early message as a broken prefix, so the whole transcript was replayed. Session persistence was already working and was not the cause.
- [x] Fixed in `sessionDelta` and `matchingClaudeSession`: a resumed step sends the unseen tail plus only the messages whose hash changed, and sessions are matched on a stable conversation anchor (second message hash) with the longest common prefix rather than an exact prefix. Two regression checks guard it in the bridge self-test: a rewritten earlier message must not replay the transcript, and a repeated identical request must resend exactly one message.

## Phase 3: streaming final answers

- [x] Final answers run with `--output-format stream-json --verbose --include-partial-messages` and forward `content_block_delta` text as it arrives. Tool-call steps keep `--output-format json` and stay atomic. `--verbose` is required because the CLI rejects `stream-json` under `--print` without it. The self-test asserts the streaming and tool argument sets separately.
- [x] Throughput still comes from the CLI's own result line, so the tokens-per-second footer is unchanged by streaming.
- [ ] Not yet exercised by a real VS Code Fable run: the streaming build went live at 12:46 and the log since then holds only synthetic checks.

## Later

- [ ] Re-measure the 564-request baseline after all phases and record the new median and p90 here.
