# Security

## Never commit

- API keys, OAuth access/refresh tokens, session cookies, or keychain exports
- Kilo, Claude, OpenAI, DeepSeek, or OpenRouter auth databases
- Agent logs, tool outputs, transcripts, or file-history directories
- Claude `projects/`, `sessions/`, cache, usage, debug, and local backup data
- Private repository content copied only for debugging
- Personal account IDs or machine-specific secrets

This repository is public. Examples use placeholders for executable paths and contain no credentials. A secret committed here should be treated as public immediately, even if the commit is later removed.

## Local permissions

Agent permissions should follow least privilege:

- Read-only investigators cannot edit or run arbitrary shell commands.
- Leaf workers cannot create additional agents.
- Concurrent writers receive non-overlapping ownership.
- External-directory access is granted only for explicitly required paths.
- Auto-approval, Full access, desktop control, and Claude file-history access are opt-in choices, not safe defaults. Review each before adopting it; file-history access exposes historical file copies to Kilo, and desktop control can observe or operate the screen.
- Local CLI results are reviewed by the lead before acceptance.

The examples are illustrative. Do not modify a live configuration solely to match them.

## Reporting a problem

Because this is a public repository, do not open a public issue containing a secret, token, account identifier, private transcript, or other sensitive detail.

If GitHub private vulnerability reporting is enabled for this repository, use **Security > Report a vulnerability** in the GitHub interface. If it is not enabled, open a minimal public issue that describes the class of problem without the sensitive value, or contact the maintainer through the maintainer account listed on the repository. No security email address is stated here because none is provided.

For a discovered secret: remove it from the working tree, rotate the credential immediately, and rewrite Git history if it was committed. Deleting only the latest line or commit is not sufficient once a credential has entered history. Assume any secret pushed to this public repository has been exposed.
