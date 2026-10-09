# Shared computer control — implementation checklist

Goal: provide the same local computer tools to compatible Kilo models and other MCP clients. One active operator owns the desktop; coding workers remain independent. The model reasons, the tools act, and observed evidence determines success.

## Inventory and design
- [x] Inspect current Kilo, Claude and Codex registrations without exposing credentials.
- [x] Discover the installed Peekaboo tool schemas rather than assume an older version.
- [x] Confirm existing macOS permission grants and browser runtime availability.
- [x] Define a model-independent MCP entry point, shared lease, bounded operations and cleanup.
- [x] Keep native screenshots as MCP image blocks, with accessibility text alongside them.
- [x] Use a separate browser profile; do not assume access to the user's logged-in sessions.

## Service
- [x] Implement cross-process exclusive ownership and expiry recovery.
- [x] Keep ownership during operations; terminate a timed-out backend before another owner proceeds.
- [x] Bind observations and actions to the same owner; reject stale or foreign snapshots.
- [x] Pass through native desktop and browser tools using their actual schemas.
- [x] Exclude nested autonomous agents and arbitrary browser code execution from the service's tool surface.
- [x] Preserve underlying refusals and verification failures; never convert an attempted action into success.
- [x] Record compact operational events without typed text, images, credentials or page contents.

## Installation and guidance
- [x] Provide a dry-run installer, private backups and guarded rollback.
- [x] Install in Kilo and replace the older direct desktop route to avoid bypassing coordination.
- [x] Make the reusable workflow discoverable to Kilo and other compatible clients.
- [x] Document equivalent Claude/Codex registration and actual compatibility limits.
- [x] Preserve the selected CTO model and unrelated settings.

## Tests and rollout
- [x] Test two clients contending for one lease, expiry, disconnect and process death.
- [x] Test invalid/foreign/stale snapshot use and mutation invalidation.
- [x] Test backend timeout, error propagation and image forwarding.
- [x] Run a real desktop observation and action using the installed engine.
- [x] Run a critical browser task with invalid input, recovery, save and reload verification.
- [x] Run the workflow through a real Kilo model, then independently check the result.
- [x] Run relevant repository checks and document exact evidence and limitations.

## Completion standard
The service must demonstrate useful UI work and rejection of unsafe concurrent/stale operations. A successful MCP handshake alone is insufficient. Compatibility does not mean equal competence: models must support tool calls, and screenshot reasoning requires image support. This local service cannot export Codex's private computer-use implementation.

## Results — 2026-10-09

- Installed `computer` in Kilo, Claude Code and Codex; installed the shared workflow skill in all three. Replaced Kilo/Claude's legacy direct Peekaboo routes. Kilo's built-in browser and Codex's native tools remain separate capabilities; the lease coordinates participating service clients, not the whole OS.
- Confirmed Kilo MCP connectivity and skill discovery. Used Kilo's configuration reload command while idle; the existing conversation, attached image and selected DeepSeek model remained intact. Neither CTO model route was changed.
- Nine automated service checks passed, including cross-process contention, stale snapshots, image forwarding, timeout cleanup, expiry, orphan lock recovery and abrupt process death. Installer dry-run, configuration preservation, repeat installation, drift rejection and restore passed.
- The full repository verification script passed. Skill validation passed using a temporary Python environment with PyYAML.
- **GPT-6.1 Sol Ultrafast:** 66 seconds for the browser challenge plus native Calculator. Invalid quantity rejected, exactly one valid save, invoice total 64.79 persisted through reload. Native clicks produced 54, independently checked through the accessibility tree; a native screenshot was delivered as an image attachment to Kilo.
- **Current Opus CTO model route:** 65 seconds for the browser challenge. The same invalid-input rejection, single correct save, reload, screenshot and lease-release checks passed. These timings cover different workloads and are not a model speed comparison.
- **DeepSeek V4.1 Flash Ultra on LithosAI:** 61 seconds for the browser challenge plus native Calculator. The real server rejected one invalid save, accepted exactly one corrected invoice and returned the persisted total 64.79 after reload. Independently checked all five native click targets, display transitions `54 → 0 → 6 → 6 × → 6 × 9 → 54`, six native image attachments, the saved PNG and final accessibility evidence. The model re-observed after unconfirmed clicks without duplicating them and released its lease. This was a separate validation session; the user's selected main model was not changed.
- Caught an actual screenshot-engine ownership conflict. Added and tested a read-only classic-capture fallback instead of stopping the existing owner. Native clicks sometimes return an unconfirmed delivery result; the successful live run verified their effects from fresh observations and did not repeat them blindly.
- Forward native evidence metadata as text as well as MCP metadata because some clients omit metadata from model-visible results. Keep errors and uncertainty intact.

Private live evidence:

- GPT-6.1: `/private/var/folders/_c/glmm06ws2q546h8fvqf6mq200000gn/T/computer-live-elIyKj/result.json`
- Opus: `/private/var/folders/_c/glmm06ws2q546h8fvqf6mq200000gn/T/computer-live-C35Jlc/result.json`
- DeepSeek: `/private/var/folders/_c/glmm06ws2q546h8fvqf6mq200000gn/T/computer-live-ftNKPa/result.json`; independent checks: `verification.json` in the same directory.
- Repository verification: `/tmp/shared-computer-full-verification.log`
- Installer backups: `~/.config/shared-computer/backups/`; Claude's prior registrations are recorded in its private `claude-before-computer.json` backup.

Limits: native GUI verification was performed on GPT-6.1 and this specific DeepSeek route, not every model. The Opus test exercised browser controls. No claim is made that every model/provider supports images or has equal computer-use ability. The native tasks also provided accessibility text, so these runs do not independently establish pixel-only reasoning ability. The tests are functional checks, not proof of error-free automation on arbitrary applications.
