# Security

## Never commit

- API keys, OAuth access/refresh tokens, session cookies, or keychain exports
- Kilo, Claude, OpenAI, DeepSeek, or OpenRouter auth databases
- Agent logs, tool outputs, transcripts, or file-history directories
- Private repository content copied only for debugging
- Personal account IDs or machine-specific secrets

The examples use placeholders for executable paths and contain no credentials.

## Local permissions

Agent permissions should follow least privilege:

- Read-only investigators cannot edit or run arbitrary shell commands.
- Leaf workers cannot create additional agents.
- Concurrent writers receive non-overlapping ownership.
- External-directory access is granted only for explicitly required paths.
- The reproduced Claude file-history permission supports local recovery/context workflows but exposes historical file copies to Kilo; remove it when that capability is unnecessary.
- Local CLI results are reviewed by the lead before acceptance.

## Reporting a problem

Because this is a private personal configuration repository, report a discovered secret by removing it from the working tree, rotating the credential immediately, and rewriting Git history if it was committed. Deleting only the latest line or commit is not sufficient once a credential has entered history.
