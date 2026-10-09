# Native Kilo chat renderer recovery

The local Kilo 7.8.2 patch recovers a chat panel whose renderer stops answering while preserving its extension-side provider and backend task. It covers main chat tabs and native subagent viewer tabs.

## Evidence and scope

In an isolated VS Code profile, deliberately terminating only a webview renderer through Chrome DevTools `Page.crash` reproduced the reported solid grey pane. The extension and backend continued to run. Reloading the webview HTML did not restore painting; replacing the `WebviewPanel` did. Normal replay of the actual session data did not reproduce a JavaScript rendering failure.

This identifies a recoverable failure class. The original spontaneous crash trigger remains unknown; the patch does not claim to prevent every renderer or GPU failure.

An additional October 9 report showed the grey pane again. During direct inspection the same Mobile UAB chat was rendering and its workers were active; no restart was performed by the investigator. This does not establish whether the view recovered automatically or through a user action. There was no new OS crash report tying this occurrence to a particular JavaScript or GPU fault.

The host patch now writes failure-only timing records to the **Kilo Renderer Health** Output channel: unresponsive heartbeat duration, replacement readiness, recovery dispatch, failure and retry-limit events. Records exclude conversation text, attachments, paths and session IDs. Readiness and dispatch are not proof of successful painting; compare these records with the visible pane and VS Code renderer logs. The v3 host helper upgrades v2 in place without rebuilding or replacing other patches. A running extension host loads it after the next normal window reload.

## Recovery behavior

- A five-second heartbeat checks visible chat panels, including panels visible without keyboard focus. Hidden panels and host sleep gaps do not trigger recovery.
- Startup gets at least 60 seconds. After startup, a renderer that fails to respond for approximately 30–35 seconds is replaced. Empty application roots do not acknowledge health.
- Replacement preserves the existing Kilo provider and backend session. It does not restart, abort, or resubmit model work and does not take keyboard focus.
- At most two automatic replacements happen per provider in five minutes. Further failure displays a warning instead of repeatedly replacing the panel.
- Child viewers reopen the same child session, including failures before initial session loading completes.

## Draft preservation

A coalesced snapshot saves text, completed image attachments, mentions, attached context, review comments, browser references, pasted text, model/agent/reasoning selections, and exact live tab identities. Pending unsent tabs retain their IDs and selection rather than being replaced with a new tab or the previous submitted session.

Snapshots occur about 250 milliseconds after a draft or persisted-tab-state change. Unchanged image data is omitted from subsequent snapshots and merged on the host. The latest edit within that short interval, or an image still being read from disk when the renderer dies, may not have reached the host. The patch cannot recover data that had not yet been captured.

## Installation and regression checks

`examples/patches/native-webview-recovery.mjs` applies the host patch and its companion `native-webview-draft-recovery.mjs` patch. Exact bundle anchors and JavaScript syntax checks run before writes; unsupported versions fail closed. The normal local extension reapply hook invokes the patch after an update.

Run:

```sh
node scripts/test-native-webview-recovery.mjs
node examples/patches/native-webview-draft-recovery.mjs --test
node scripts/test-reapply-kilo-patches.mjs
```

These checks cover health and timeout handling, hidden/inactive panels, sleep, stale acknowledgements, retry limits, same-provider/session recovery without model submission, pending-tab identities, attachment snapshot merging, delayed persisted state, and reapply-hook registration.

## Isolated Electron acceptance — 2026-10-09

| Forced failure | Result |
| --- | --- |
| Main chat renderer with an unsent new-tab draft | Repainted after 37.4 seconds; same provider, exact pending tab IDs, text including `</script>`, PNG image, file mention and context preserved. |
| Native child viewer renderer | Repainted after 36.8 seconds; same provider and child session, transcript restored, viewer remained read-only. |
| Backend work during both checks | Main and child message counts remained 87 and 5; no new model turn was submitted. |

The child test caught an additional initialization issue: selecting a child ID alone does not load its transcript. Recovery now follows the native viewer sequence by waiting for the backend, loading messages and restoring session metadata. Closing a panel during any asynchronous step cancels the remaining recovery work.

Installed bundles were rebuilt from their clean pre-recovery copies and checked against the final helper source. Temporary diagnostics were removed. Existing production windows were not reloaded; an existing window activates the fix after its next normal reload.
