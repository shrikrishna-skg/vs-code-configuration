#!/usr/bin/env bash

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

node --check examples/bridges/claude-cli-mcp.mjs
node --check examples/bridges/typesafe-mcp.mjs
node scripts/test-typesafe.mjs
node --check examples/patches/remember-last-agent.mjs
node --check examples/patches/codex-thinking-status.mjs
node examples/patches/check-codex-thinking-status.mjs
node examples/mockups/check-thinking-card.mjs
node --check claude-code/scripts/validate.mjs
node claude-code/scripts/validate.mjs
python3 -m json.tool examples/kilo.jsonc >/dev/null
python3 -m json.tool claude-code/config/settings.json >/dev/null
python3 -m json.tool .vscode/extensions.json >/dev/null
sed '/^[[:space:]]*\/\//d' examples/vscode/settings.jsonc | python3 -m json.tool >/dev/null
xmllint --noout assets/hero.svg

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node examples/bridges/claude-cli-mcp.mjs /usr/bin/true \
  | python3 -c 'import json,sys; rows=[json.loads(line) for line in sys.stdin if line.strip()]; assert len(rows)==2; assert rows[0]["result"]["serverInfo"]["name"]=="kilo-claude-cli-bridge"; assert len(rows[1]["result"]["tools"])==4'

git diff --check
echo "Configuration verification passed."
