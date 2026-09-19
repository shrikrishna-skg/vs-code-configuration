# Scenario checklist

Use this checklist after installation, provider changes, model changes, or extension upgrades.

| Scenario | Expected behavior | Check |
|---|---|---|
| Simple question | Selected lead answers directly | No task delegation appears |
| Small fix | Lead makes a focused change | One relevant check; no unnecessary reviewer |
| Medium bounded implementation | One DeepSeek implementer may be used | Exclusive file scope and completion evidence |
| Large separable feature | Workstream lead may coordinate independent workers | No overlapping writers; primary lead integrates |
| Unclear regression | GLM performs read-only investigation | `git status` remains unchanged by GLM |
| Tiny mechanical chore | Luna may be used exceptionally | Scope is deterministic and very small |
| Fable mode | Request routes through local `fable_5_1_high` | Bridge output appears; no gateway fallback |
| High-risk escalation | Local Opus High receives a complete bounded prompt | Primary lead inspects diff and verifies |
| Bridge unavailable | Error is reported explicitly | No silent provider/model switch |
| Provider auth expired | Kilo reports authentication failure | Reauthenticate outside Git |
| Dirty worktree | Existing edits are preserved | Diff distinguishes prior and new changes |
| New or cleared session | Selected lead remains selected when patch is installed | Patch `--check` passes |
| Kilo extension updated | Version-sensitive patch may be absent | Review and rerun exact-match check |
| Claude extension updated | Native binary path may change | Update MCP command path and smoke-test |
| Response style | Every user-facing reply has Answer, My opinion, Next step | Headings are unnumbered and in order |
| Completion | Lead reports changes, checks, and limitations | Claims are supported by evidence |

## Files intentionally excluded

- Auth databases and keychains
- Runtime logs and tool-output caches
- Chat transcripts and file history
- Copilot network diagnostic dumps
- The unused HTTP Claude-provider experiment
- Versioned backups containing machine-specific paths

These exclusions prevent secrets, personal diagnostics, and inactive experiments from being mistaken for required configuration.
