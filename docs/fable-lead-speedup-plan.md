# Fable Engineering Lead: faster and smarter

Goal: cut the fixed cost of every Fable step through the local Claude CLI bridge and stop Fable spending its own context on work that cheaper lanes should do.

Baseline (measured 2026-09-22): trivial tool-mode step = 6.95 s and 28.6K prompt tokens for 4 output tokens. Session log of 564 requests: median 16.7 s per step, p90 57.8 s. Roughly 40% of a step is fixed overhead.

Live files: `~/.config/kilo/bridges/claude-cli-provider.mjs` (LaunchAgent `ai.kilo.claude-local-cli-provider`), `~/.config/kilo/bridges/fable-lead-system.md`, `~/.claude/hooks/verify-on-stop.sh`, `~/.config/kilo/kilo.jsonc`, `~/.config/kilo/agent/Fable Engineering Lead.md`. Repo mirrors live under `examples/`.

## Phase 1: strip fixed overhead

- [x] **Compact system prompt.** `fable-lead-system.md`, 378 words (about 600 tokens). Keeps identity and one-decision contract, condensed Ponytail ladder and rules, the Answer / My opinion / Next step output contract, secrets and no-destructive rules, "Kilo owns tools". Drops Claude Code subagent routing and harness tool docs. Mirrored at `examples/bridges/fable-lead-system.md`.
- [x] **Bridge uses it in tool mode only.** `claudeArgs` passes `--system-prompt` when Kilo tools are present. Conversation mode (Opus escalation, CLI runs tools) keeps the default harness. `--exclude-dynamic-system-prompt-sections` is not passed because the CLI ignores it alongside `--system-prompt`. Guarded by the bridge self-test.
- [x] **Tool catalog once per session.** `toolsHash` persisted on the session record; a resumed step with an unchanged hash sends a one-line "catalog #xxxxxxxx unchanged" marker. An invalid-decision error resends the full catalog once (`catalog_resent` event).
- [x] **Bridge marks tool-mode runs.** Tool-mode spawns carry `CLAUDE_BRIDGE_TOOL_MODE=1`; conversation mode strips it. Self-test asserts both.
- [x] **Stop hook guard.** `~/.claude/hooks/verify-on-stop.sh` exits 0 right after the payload drain when `CLAUDE_BRIDGE_TOOL_MODE` is set (backup `verify-on-stop.sh.bak-20260922-123852`). Verified 2026-09-22 in a dirty scratch repo whose test script fails: with the variable set the hook is silent, without it the hook reports the failing `npm test` exactly like the backup.
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

Median resumed-step prompt fell 88%, from 29371 to 3504 characters, and clears the 5K acceptance bar. The catalog-once change carried nearly all of it: the compact system prompt alone barely moved the median, because the 25-schema tool catalog resent on every step dominated. No `catalog_resent` events have appeared, so the hash reuse is holding. Bridge self-test green. The hook guard is applied and verified.

The remaining tail is Phase 2 work: p90 is still 9181 and max 27696 on a 2-message delta.

## Phase 2: stop transcript replays

Sharper evidence after Phase 1: the oversized prompts are a tail, not the norm. On the current build a `deltaMessages: 2` step has a median of 3504 characters but a p90 of 9181 and a max of 27696, so something occasionally resends far more than the two new messages.

- [x] Cause identified: Kilo rewrites messages the CLI already saw (compacted tool outputs, regrown system `<env>` block), and the old prefix-match logic treated one rewritten early message as a broken prefix, so the whole transcript was replayed. Session persistence was already working and was not the cause.
- [x] Fixed in `sessionDelta` and `matchingClaudeSession`: a resumed step sends the unseen tail plus only the messages whose hash changed, and sessions are matched on a stable conversation anchor (second message hash) with the longest common prefix rather than an exact prefix. Two regression checks guard it in the bridge self-test: a rewritten earlier message must not replay the transcript, and a repeated identical request must resend exactly one message.

## Phase 3: streaming final answers

- [x] Final answers run with `--output-format stream-json --verbose --include-partial-messages` and forward `content_block_delta` text as it arrives. Tool-call steps keep `--output-format json` and stay atomic. `--verbose` is required because the CLI rejects `stream-json` under `--print` without it. The self-test asserts the streaming and tool argument sets separately.
- [x] Throughput still comes from the CLI's own result line, so the tokens-per-second footer is unchanged by streaming.
- [ ] Not yet exercised by a real VS Code Fable run: the streaming build went live at 12:46 and the log since then holds only synthetic checks.

## Tail check (2026-09-22)

- [x] The p90 9181 and max 27696 figures came from builds before the `sessionDelta` fix. On the current build every `session_resumed` event logs `rewrittenMessages: 0`, so nothing is being replayed. The remaining large steps are real content: 11067 and 8765 characters follow `grep` tool outputs of 9779 and 7467 characters, and 18890 is a new user turn with an attached image (`deltaMessages: 3`, `imageFiles: 1`). No change made.

## Subscription limit

- [x] A hit limit, and every request while it is still active, returns HTTP 400 `subscription_limit_error` with "Claude subscription usage limit reached; resets at <local time>" plus the CLI's own text. 400 is not retried by Kilo, which records it as a visible APIError. The bridge self-test replays the CLI's limit result line through a stub binary.

## Phase 4: trim conversation-mode startup (2026-09-22)

Conversation mode (no Kilo tools, the CLI runs its own tools) loaded the whole interactive harness: 10 plugins, 47 MCP servers (claude.ai connectors, playwright, peekaboo, plugin connectors), 73 skills, user CLAUDE.md with its imports, auto-memory, and 33 built-in tools. A trivial "Reply PONG" cost about 49K prompt tokens. Tool mode was already lean (about 2.4K) through `--safe-mode`, `--system-prompt` and `--tools ""`, so it is unchanged.

- [x] Conversation mode now passes `--strict-mcp-config --mcp-config {"mcpServers":{}}`, `--disable-slash-commands` and `--tools <ALLOWED_TOOLS>`; `Skill` left `ALLOWED_TOOLS` because skills are off and Kilo sends its own. Tools outside the allow list could only be denied in `-p`, but their schemas were about 24K tokens.
- [x] Both modes set `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`: Kilo already sends project instructions.
- [x] User settings are still loaded, so the guard-secrets PreToolUse, prettier PostToolUse and Stop hooks keep running in conversation mode (`--safe-mode` and `--setting-sources project,local` would drop them). Verified: a scratch `.env` Read was blocked by guard-secrets while Bash worked.
- [x] Subscription auth unchanged (keychain OAuth; `apiKeySource: none` in the CLI init event).

Before/after, scratch copy of the bridge on its own port and state file, 3 runs each, medians (`curl`, TTFT = first byte; chat mode is not streamed so TTFT equals wall):

| Model | Mode | Prompt tokens before → after | Wall s before → after | TTFT s before → after |
|---|---|---|---|---|
| fable-5-1-high | chat | 49396 → 12288 | 6.11 → 4.21 | 6.11 → 4.21 |
| opus-5-5-fast | chat | 47539 → 10433 | 6.39 → 3.65 | 6.39 → 3.65 |
| fable-5-1-high | tool (stream) | 2367 → 2368 | 2.81 → 2.79 | 2.30 → 2.29 |
| opus-5-5-fast | tool (stream) | 2365 → 2370 | 3.05 → 3.21 | 1.96 → 1.99 |

Also added: `ttftMs` on every `session_started`/`session_resumed` log line (first streamed delta, else the finished result), subscription-limit fixes (hyphenated names, no match on "rate/output token limit reached", dated and zoned resets, a just-passed reset is expired instead of tomorrow, an SSE error event when the limit lands mid-stream, persisted limits bound to the `auth status` email).

## Later

- [ ] Re-measure the 564-request baseline after all phases and record the new median and p90 here.

## Phase 5: fewer steps per task (2026-09-22)

Reference session `ses_f34a21737ffeu2bjQVRDDX7K4v`: Fable 121 steps at 15.9 s (42 single `edit`, 46 bash, 0 task) vs Astra 54 steps at 7.4 s (4 multi-file `apply_patch`). The one-decision contract forced one tool per CLI round-trip.

- [x] **apply_patch by config.** Kilo 7.7.7 `ToolRegistry.usePatch` offers `apply_patch` instead of `edit`/`write` when the model id contains `gpt-` or its `family` starts with `gpt`; every other gpt check reads `api.id`. `kilo.jsonc` sets `"family": "gpt-apply-patch"` on `fable-5-1-high` and `fable-5-1-max` only. No bundle patch.
- [x] **Several tool calls per step.** Decision schema is `{kind, content, tool_calls: [{tool_name, arguments}]}`; `parseDecision` rejects an empty or unknown call, and `openAiToolCalls` emits one OpenAI `tool_calls` entry per call (stream and non-stream). `fable-lead-system.md` and the per-step prompt say to batch independent calls and wait on dependent ones; the "never claim a tool ran" rule is kept. Self-test covers a two-call decision end to end.
- [x] **Delegate sooner.** Both Fable lead agent files hand work over about 5 edits or several files to one `deepseek-implementer` and batch independent reads.
- [x] **Status during long steps.** A streamed tool-mode step still silent after 10 s gets one `reasoning_content` delta ("Claude Fable 5.1 High is working..."). Delay keeps quick failures as plain HTTP errors. Kilo echoes it back as `reasoning_content`, which the transcript ignores; the benchmark logged `rewrittenMessages: 0` on every resumed step.

Benchmark: scratch repo, 6 source files plus a test, task renames `formatPrice` to `formatCurrency` across 6 files, adds a parameter and a test, forbids sed, runs `npm test`. One `kilo run --auto --agent "Fable Engineering Lead"` each, fresh copy.

| Run | Steps | Wall s | edit | apply_patch | bash | read/grep/glob | task | Test |
|---|---|---|---|---|---|---|---|---|
| Before | 20 | 168 | 7 | 0 | 4 | 8 | 0 | pass |
| After | 7 | 49 | 0 | 2 | 3 | 4 | 0 | pass |

After: step 1 batched grep+glob+read, one `apply_patch` edited all 6 files, one step batched bash+grep.

- [x] **Full apply_patch spec.** `compactTools` no longer cuts `apply_patch`'s top-level description (Kilo's is 1092 chars, previously cut to 320); its parameter descriptions and every other tool keep the cap. Self-test asserts both. Cost is on the full-catalog step only (resumed steps send the catalog marker): one fresh tool-mode request with Kilo's real 22-tool catalog went from 9287 to 9604 prompt tokens (+317) and 20523 to 21326 prompt chars.
