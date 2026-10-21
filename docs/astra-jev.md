# Astra + Jev Engineering Lead

> **Historical setup.** This page documents the Astra/Fable/Opus leads used before the 2026-10-09 CTO replacement. It is retained for dated restoration and reference. The current setup is **CTO (Recommended)** and **CTO + JEV**; see [CTO setup](cto-setup.md). These are custom Kilo configurations, not stock VS Code or Kilo features.

Installed and smoke-tested on 2026-09-21 (America/Chicago). This is an optional
experimental primary agent, not the default lead and not a replacement for Fable.

## Use

In Kilo Code, select **Astra + Jev Engineering Lead**, directly below
**Fable Engineering Lead**. It uses `openai/gpt-6-astra-fast` and the existing
DeepSeek implementation and GLM investigation workers. Tiny tasks stay with Astra.
Jev supplies optional next-step advice or requirement-by-requirement evidence checks.
The lead remains responsible for decisions, code review and final verification.

If an already-open window cannot see the tool, run Kilo's `/reload` action.
This reloads configuration; it is not a chat request to implement anything.
For a changed picker bundle, run **Developer: Reload Webviews**. Wait for active
work to finish before configuration reloads. Existing sessions remain available.

## Fable + Jev variant

Added 2026-09-22. **Fable + Jev Engineering Lead** is the Fable Engineering Lead
unchanged (`claude-local-cli/fable-5-1-high` through the local Claude CLI bridge,
same steps, task permissions and Opus escalation) plus the same
`TypeSafe_evaluate_work: allow` grant and Jev consultation rules as Astra + Jev.
Source: `examples/agent/Fable + Jev Engineering Lead.md`; installed at
`~/.config/kilo/agent/`. The picker shows Fable Engineering Lead, then Fable + Jev,
then Astra + Jev. `~/.local/state/kilo/model.json` is seeded so the per-agent model
patch opens it on Fable. `scripts/test-typesafe.mjs` asserts the two Jev leads are
the only repository agents that allow `TypeSafe_*`. The ordering patch migrates
the earlier Astra-only ordering on `--apply`; `--check` reports it as missing.

## Opus + Jev variant

Added 2026-09-26. **Opus + Jev Engineering Lead** is Fable + Jev on
`claude-local-cli/opus-5-5-high` (variant `high`) through the same local Claude CLI
bridge, with the same workers, Jev rules and Peekaboo tools. It has no Opus
escalation lane (`Claude_Code_Local_*: deny`; no `claude-code-local` tool in VS Code
Chat) and adds a **Fast screen control** section: one `see`, then act by element ID
with background-first input (no cursor or focus takeover unless announced), re-`see`
only after a state change, and confirm with `verify_state` or one capture. This cuts
round trips; it does not make screen work instant or guaranteed. For latency-sensitive
screen work the user may pick `Claude Opus 5.5 Fast (Local CLI)` manually. Source:
`examples/agent/Opus + Jev Engineering Lead.md` and
`copilot-chat/config/prompts/opus-jev-engineering-lead.agent.md`. The picker shows
Fable Engineering Lead, then Fable + Jev, Opus + Jev, Astra + Jev; `--apply` migrates
the previous Fable + Jev/Astra + Jev ordering, and `--restore` removes it.

**Screen runner.** Added 2026-09-26. For multi-step UI tasks the Opus + Jev lead writes
one JSON plan and runs `examples/bridges/peekaboo-runner.mjs` (live copy:
`~/.config/kilo/bridges/peekaboo-runner.mjs`) in a single shell call. The runner
executes each step through the Peekaboo CLI (`execFile`, no shell, allowlisted
commands only), checks it deterministically (Peekaboo `verify` argv or an
`{on, value?, contains?}` match against a fresh `see --tree --no-screenshot`), retries
a failed check once after 300 ms, asks Jev (`evidence_check`, confidence >= 0.9) only
for `expect_text`, stops before `confirm: true` steps unless `--confirmed <id>` is
given, and prints one compact JSON report. Passing plans can be saved and replayed
as recipes in `~/.config/kilo/recipes/`. This turns about one model turn per click into
one or two per task; it does not make the UI faster. `peekaboo daemon start` keeps
Peekaboo services warm between CLI calls; the runner never starts it. In 4.4.0,
`peekaboo verify` returned `unknown` on this machine (incomplete app enumeration), so
prefer the element-map `expect`. Save sheets and alerts are invisible to `see --app`,
so plans wait for them with `"expect":{"dialog":true,"button":"Delete"}` (checked via
`dialog list`) and act with `dialog click`; `dialog click`/`click` on a destructive
button (Delete, Don't Save, Discard, Send, Pay, Submit…) is forced through the confirm
gate. When a step has an `expect`, Peekaboo's `unverifiable`/`suspected_noop` effect
defers to that check (TextEdit's `window close` reports `suspected_noop` while its
sheet opens; background `menu click File > Close` opened no sheet). Checked by
`scripts/test-peekaboo-runner.mjs`.

## Re-enabled in Kilo, added to VS Code Chat

Updated 2026-09-23. Kilo's `TypeSafe` MCP server is `enabled: true` again (it had
been disabled to trim per-step prompts, which left both Jev leads without the
tool). The global `TypeSafe_*: deny` and the two per-agent allows are unchanged;
the accepted cost is one small tool schema in the Jev leads' prompts.

VS Code Chat runs the same bridge as the `typesafe` server in the user `mcp.json`
(template `copilot-chat/config/mcp.json`). Only the two Copilot Jev leads list
`typesafe/evaluate_work`; `check-copilot-agents.mjs` enforces that. VS Code has
no global deny, so untick `typesafe` in the built-in Agent mode tool picker.

All four Jev lead prompts carry a **Screen decisions with Jev** block: Peekaboo
alone sees and acts; on multi-step or ambiguous UI work the lead sends a short
text summary of what `see` observed as `evidence` (`next_step` before a risky
action, `evidence_check` before claiming done). No screenshots, secrets or
personal data; send, pay, delete and submit still need the user's confirmation.

## Installed pieces

| Purpose | Repository source | Local installation |
|---|---|---|
| Primary agent | `examples/agent/Astra + Jev Engineering Lead.md` | `~/.config/kilo/agent/Astra + Jev Engineering Lead.md` |
| MCP tool | `examples/bridges/typesafe-mcp.mjs` | `~/.config/kilo/bridges/typesafe-mcp.mjs` |
| MCP registration | `examples/kilo.jsonc` (sanitized paths) | `~/.config/kilo/kilo.jsonc` |
| Picker placement | `examples/patches/jev-agent-order.mjs` | Known installed Kilo webview bundles |
| Focused regression checks | `scripts/test-typesafe.mjs` | Included in `scripts/verify.sh` |

The tool name is `TypeSafe_evaluate_work`. Global `TypeSafe_*: deny` keeps it out
of other profiles; only the experimental lead explicitly allows it. Resolved
DeepSeek permissions were checked to retain that deny. The existing default lead
and existing agent definitions were not changed.

## Credential and data handling

The supplied trial credential was stored in macOS Keychain, service
`ai.typesafe.kilo`, account `api`. It is not in repository files or Kilo JSON.
The bridge first accepts `TYPESAFE_API_KEY` from its process environment, then
uses the Keychain item on macOS. Refresh MCP connections after rotating the key,
because each bridge process reads the credential once at startup. The trial key
should be replaced with a fresh key for continuing use; use Keychain Access to
update this item's password after creating the replacement in Typesafe.

The bridge contacts only `https://api.typesafe.ai/v1/systemone`, disallows
redirects, and initially pins `jev-1.13.0`. It sends the explicitly supplied
packet, not files read automatically. Prompts separate observed evidence from
unverified worker claims. Input credential-pattern checks are defense in depth,
not complete secret detection; the lead must sanitize context before calling.

No raw context is logged by the bridge. Kilo itself retains tool inputs/results
in its normal task history, so sanitize those inputs as well. Returned metadata
contains model, token usage and elapsed API time; no background telemetry collector
was added.

## Limits and fallback

- Default zero consultations; normally at most two per task, with extra calls
  justified by materially changed evidence. This is a lead instruction, not a
  tamper-proof server budget (the MCP input has no trusted task identity).
- Five-second API deadline (tuned October 14, 2026); no automatic retries. MCP
  timeout is ten seconds, leaving room for initialization and credential retrieval.
  Cancellation still aborts promptly rather than waiting for the deadline.
- Maximum 24 KB input, eight evidence requirements, two concurrent calls per
  bridge, and 64 KB response. Responses are validated before returning advice.
- Explicit `no_delegation` bypasses the API for next-step advice. Existing
  permissions, ownership and other constraints remain authoritative.
- Below 0.9 confidence, advice is marked for lead judgment. This threshold is
  provisional and not an accuracy guarantee. High confidence is not approval.
- Missing credential, HTTP error, cancellation, timeout or invalid response returns
  unavailable advice with lead-judgment fallback. No silent approval or substitute
  provider is used.

## Verified behavior

| Test | Observed result |
|---|---|
| Unit/protocol checks | Passed input/output validation, duplicate IDs, constraints, secret-pattern rejection, missing key, HTTP errors, timeout, cancellation, and MCP initialization/discovery/call handling |
| Repository verification | `bash scripts/verify.sh` passed |
| Picker | Visually observed Astra, Fable, then Astra + Jev; selected new profile without changing the existing Fable task |
| Actual VS Code MCP call | `cancel` returned `insufficient`, confidence 0.92, API elapsed 336 ms; expanded tool result verified in the panel |
| Tiny-task fast path | One-sentence answer, no tools, Jev call or delegation |
| DeepSeek delegation | Exactly one `deepseek-implementer`, `deepseek/deepseek-flash` high; implemented scratch CSV parser; lead inspected code and acceptance command passed |
| GLM investigation | Exactly one `glm-investigator`, `openrouter/z-ai/glm-5.3-flash`; source-based explanation of malformed quoting; recorded tools were read and board updates, no file writes or shell |
| Real invalid-key failure | HTTP 401 returned unavailable; lead reported the failure, assessed the evidence itself, and did not retry |
| No-delegation shortcut | Returned `explicit_no_delegation`, `api_called: false`; lead distinguished it from model advice |

The first UI attempt correctly reported the tool unavailable: the existing backend
had not loaded the MCP addition. Kilo `/reload` resolved it; the subsequent actual
panel call passed. The initial noninteractive delegated test could not run its shell
check because the CLI auto-rejected the permission request. Verification was resumed
with only `node check-csv.mjs` allowed for that test process; the command exited 0.
No global shell approval was broadened. The lead explicitly reported the earlier
rejection rather than pretending that check had run.

Local test sessions (inspect with `kilo export <id>`):

- MCP: `ses_f394a6512ffe2G9LrYx0Klqk14`
- Fast path: `ses_f3948f1bdffeAcdy3Rb4QXDmoN`
- DeepSeek and resumed verification: `ses_f3948b12effeFkWFQ0EAYJki00`
- GLM: `ses_f3944ca8fffea0HAmmTvMW17Pl`
- Invalid-key fallback: `ses_f3942f73bffeaPWvUJZ1PAV0tA`

These are integration checks, not an Astra versus Astra + Jev performance benchmark.
They demonstrate wiring and observed behavior, not guaranteed autonomous routing,
production reliability, lower total cost or faster completion. Larger controlled
comparisons and threshold calibration remain future evaluation work.

### Controlled comparison protocol (not yet run)

Use baseline Astra versus Astra + Jev, with the same worker models, permissions,
task prompt, starting commit, acceptance checks and time limit. Use separate clean
checkouts and fresh sessions; do not share one arm's answers with the other.
Record exact model IDs, agent instructions and extension version for each run.

Choose three representative tasks from actual work before running either arm:

1. A small, well-specified edit with an executable acceptance check. This tests
   whether the experimental profile avoids unnecessary Jev/delegation overhead.
2. An investigation with a reproducible defect and evidence-backed root cause.
   Keep both arms read-only and score against independently verified evidence.
3. A multi-file implementation with a known edge case and regression tests.
   Review the final diff and run the same checks in both checkouts.

Run each pair twice, reversing which arm goes first on the second run (12 runs
total). Set the same per-run time and spend ceilings before starting. Stop at the
ceiling and retain failures/timeouts in the results, rather than dropping them.
Use sanitized inputs; never send secrets or unrelated private files to Jev.

For each run record: task, arm, order, acceptance checks passed/total, review-found
defects, missed requirements, false alarms, user corrections, rework time,
end-to-end elapsed time, Jev calls/timeouts, and token usage/cost for **all** models.
Missing usage is unknown, not zero; DeepSeek also consumes tokens and may incur
provider charges. Time starts at task submission and ends after final verification,
including retries, tool overhead and review. Score outputs without revealing the
arm to the reviewer where practical.

Compare paired results by task category, reporting individual runs and median
elapsed time/cost. Keep Jev opt-in unless it catches a meaningful omission without
introducing a correctness regression and its measured overhead is acceptable for
that category. Two pairs per category are a pilot, not statistical proof. If Jev
is never called, the run tests the profile fast path, not Jev's advisory quality.
Do not change routing defaults or expand to Fable on integration checks alone.

## Picker patch and recovery

Kilo's inspected schema has no agent-order setting. A narrow reversible patch
reorders only the visible array after `agentsLoaded`, leaving default selection
and backend agent definitions alone. Exact anchors were checked in installed
7.7.2, 7.7.5, 7.7.6, 7.7.7, 7.7.9 and 7.8.1 bundles (older versions remain during pending updates).
These historical checks do not establish compatibility with the current 7.8.12 snapshot or any other build; run `--check` first. The script refuses unknown/ambiguous bundle layouts and is idempotent.

After an update, run these commands from this repository. The script reads VS
Code's extension registry, checks Kilo's identity/version against its manifest,
and selects that installation instead of guessing the newest directory:

```sh
node examples/patches/jev-agent-order.mjs --check
node examples/patches/jev-agent-order.mjs --apply
```

In this repository's VS Code window, the same commands are available under
**Terminal → Run Task → Kilo: Check Jev picker order** and
**Kilo: Repair Jev picker order**. Check first; repair only a missing patch on a
recognized bundle. These tasks are manual, not startup hooks or update watchers.
An unsupported-layout error requires review, not a forced repair. Run the focused
maintenance and bridge regression checks with `node scripts/test-typesafe.mjs`.

No arguments defaults to a read-only check. `--apply` is idempotent, creates a
backup before the first change, preserves file permissions, and refuses to write
if the bundle changed during maintenance. Then use **Developer: Reload Webviews**
when convenient. The command does not restart VS Code or run in the background.

To remove only this ordering change while preserving other bundle edits:

```sh
node examples/patches/jev-agent-order.mjs --restore
```

For VS Code Insiders, a custom extensions directory, or a still-running older
version during a pending update, supply its exact `dist/webview.js` path before
the flag. Default discovery covers the standard `~/.vscode/extensions` registry;
it does not identify which older version a running window has loaded.

Future versions retaining a verified anchor can be repaired automatically by the
command. Unknown or ambiguous layouts are refused without modifying the bundle;
they require reviewing and updating the anchor. There is no claim of compatibility
with arbitrary future builds. An update can reset ordering while the agent and
API integration continue to work. `.pre-jev-order` backups remain available, but
prefer `--restore` over replacing the entire bundle with an older backup.

Pre-install Kilo config backup:
`~/.config/kilo/jev-backup.sCyou8/kilo.jsonc` (on the audited machine; use the backup path printed by your own installer).
For rollback, remove only the new MCP entry and its global permission rule, move
the new agent/bridge files aside, and refresh Kilo. Preserve unrelated newer config
changes instead of blindly restoring the whole backup. Remove the Keychain item
only when it is no longer needed. No old profiles need removal.
