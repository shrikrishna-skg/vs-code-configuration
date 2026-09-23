#!/usr/bin/env bash
# Check for install.sh in a scratch VS Code user dir: --dry-run writes nothing, a real run
# merges without dropping unrelated settings, servers or model groups, and a rerun is a no-op.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
u="$(mktemp -d)"
trap 'rm -rf "$u"' EXIT
export VSCODE_USER_DIR="$u" PEEKABOO_BIN=/opt/peekaboo NODE_BIN="$(command -v node)" KILO_CONFIG_DIR=/opt/kilo
# expect <pattern> [install.sh args]: output is captured first (grep -q + pipefail would SIGPIPE).
expect() { local out; out="$(bash "$here/install.sh" "${@:2}" 2>/dev/null)"; grep -q "$1" <<<"$out"; }

printf '{\n    "editor.fontSize": 13,\n    "chat.useClaudeMdFile": true\n}\n' > "$u/settings.json"
printf '[{"name": "OpenRouter", "vendor": "openrouter", "apiKey": "${input:x}"}]' > "$u/chatLanguageModels.json"
printf '{"servers": {"other": {"command": "x"}}}' > "$u/mcp.json"

expect '20 file(s) would change' --dry-run
[ "$(ls "$u")" = "$(printf 'chatLanguageModels.json\nmcp.json\nsettings.json')" ]
expect '20 file(s) changed'
[ "$(ls "$u"/*.bak-* | wc -l)" -eq 3 ]
[ "$(ls "$u/prompts" | wc -l)" -eq 17 ]
python3 - "$u" <<'PY'
import json, sys
u = sys.argv[1]
s = json.load(open(f"{u}/settings.json"))
assert s["editor.fontSize"] == 13 and s["chat.useClaudeMdFile"] is False
assert s["accessibility.signals.progress"] == {"sound": "off"}
m = json.load(open(f"{u}/mcp.json"))["servers"]
assert m["other"] == {"command": "x"} and m["peekaboo"]["command"] == "/opt/peekaboo"
assert m["claude-code-local"]["args"] == ["/opt/kilo/bridges/claude-cli-mcp.mjs"]
assert [g["name"] for g in json.load(open(f"{u}/chatLanguageModels.json"))] == ["OpenRouter", "Claude Local CLI"]
PY
! grep -rq '<[A-Z_]*>' "$u"/*.json
expect '^0 file(s) changed'
[ "$(ls "$u"/*.bak-* | wc -l)" -eq 3 ]
expect "^PATH = \"$(dirname "$NODE_BIN"):" --codex-snippet
echo "copilot-chat install checks passed"
