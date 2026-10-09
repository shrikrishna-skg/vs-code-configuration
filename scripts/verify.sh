#!/usr/bin/env bash

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

node --check examples/bridges/claude-cli-mcp.mjs
node examples/bridges/claude-cli-provider.mjs --self-test
node --check examples/bridges/typesafe-mcp.mjs
node scripts/test-typesafe.mjs
node --check examples/bridges/peekaboo-runner.mjs
node scripts/test-peekaboo-runner.mjs
node --test scripts/test-computer-control.mjs
node scripts/test-computer-install.mjs
node scripts/test-reapply-kilo-patches.mjs
node --check scripts/validate-long-run-plan.mjs
node scripts/test-validate-long-run-plan.mjs
node scripts/test-cto.mjs
node scripts/test-native-subagent-ready.mjs
node scripts/test-goal-policy.mjs
node scripts/test-minimal-cto.mjs
node scripts/test-adaptive-cto.mjs
python3 scripts/check-workspace-path.py --self-test
node scripts/test-clarify-goal.mjs
node scripts/test-cto-label.mjs
node scripts/test-cto-concurrency.mjs
node --check examples/patches/codex-thinking-status.mjs
node examples/patches/check-codex-thinking-status.mjs
node examples/patches/check-per-agent-model.mjs
node examples/mockups/check-thinking-card.mjs
node --check claude-code/scripts/validate.mjs
node claude-code/scripts/validate.mjs
sed '/^[[:space:]]*\/\//d' examples/kilo.jsonc | python3 -m json.tool >/dev/null
# Sanitized examples only; the inline --claude file stands in for ~/.claude.json.
node examples/patches/check-peekaboo-mcp.mjs examples/kilo.jsonc --vscode copilot-chat/config/mcp.json \
  --claude-settings claude-code/config/settings.json --codex copilot-chat/config/config.peekaboo.toml \
  --claude <(printf '%s' '{"mcpServers":{"peekaboo":{"command":"peekaboo","args":["mcp","serve","--no-remote","--transport","stdio"]}}}')
python3 -m json.tool copilot-chat/config/mcp.json >/dev/null
python3 -m json.tool copilot-chat/config/chatLanguageModels.json >/dev/null
node copilot-chat/scripts/check-copilot-agents.mjs
bash copilot-chat/scripts/test-install.sh
python3 -m json.tool claude-code/config/settings.json >/dev/null
python3 -m json.tool .vscode/extensions.json >/dev/null
for f in examples/vscode/settings.jsonc copilot-chat/config/settings.jsonc; do
  sed '/^[[:space:]]*\/\//d' "$f" | python3 -m json.tool >/dev/null
done
xmllint --noout assets/hero.svg

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node examples/bridges/claude-cli-mcp.mjs /usr/bin/true \
  | python3 -c 'import json,sys; rows=[json.loads(line) for line in sys.stdin if line.strip()]; assert len(rows)==2; assert rows[0]["result"]["serverInfo"]["name"]=="kilo-claude-cli-bridge"; assert len(rows[1]["result"]["tools"])==4'

git diff --check
echo "Configuration verification passed."
