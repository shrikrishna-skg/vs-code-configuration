#!/usr/bin/env bash
# Installs copilot-chat/config into VS Code's user folder (macOS) for the built-in Chat view.
#
# Usage: bash copilot-chat/scripts/install.sh [--dry-run] [--codex-snippet]
#   --dry-run        list (with diffs) what would change; write nothing
#   --codex-snippet  print config.peekaboo.toml with local paths filled in; write nothing
#
# Idempotent: a file is written only when its content changes, after a copy to
# <file>.bak-<timestamp>. JSON files are merged, never replaced: only the Copilot Chat
# keys, the two MCP servers and the "Claude Local CLI" model group are set; other
# settings, servers and model groups (for example an OpenRouter group) are kept.
# Never writes secrets, and never touches Kilo, ~/.claude.json, ~/.claude or ~/.codex.
# Overrides: VSCODE_USER_DIR, PEEKABOO_BIN, NODE_BIN, KILO_CONFIG_DIR.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cfg="$here/config"
user="${VSCODE_USER_DIR:-$HOME/Library/Application Support/Code/User}"
dry=0
codex=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry=1 ;;
    --codex-snippet) codex=1 ;;
    -h|--help) sed -n '2,14s/^# \{0,1\}//p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

PEEKABOO_BIN="${PEEKABOO_BIN:-$(command -v peekaboo || true)}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
KILO_CONFIG_DIR="${KILO_CONFIG_DIR:-$HOME/.config/kilo}"
[ -n "$NODE_BIN" ] || { echo "node not found: install Node.js or set NODE_BIN" >&2; exit 1; }
[ -n "$PEEKABOO_BIN" ] || { echo "peekaboo not found: npm i -g @steipete/peekaboo, or set PEEKABOO_BIN" >&2; exit 1; }
export PEEKABOO_BIN NODE_BIN KILO_CONFIG_DIR

# node <mode> <target> <source>: prints the desired content of <target>.
#   servers: set source.servers.* in target | groups: replace or append groups by name
#   keys: set every top-level source key    | text: fill placeholders in a text file
# Unchanged JSON is printed byte-for-byte; changed JSON keeps the target's indentation.
merge='
const fs = require("node:fs"), { isDeepStrictEqual } = require("node:util");
const [mode, target, source] = process.argv.slice(1);
const vars = { "<ABSOLUTE_PATH_TO_PEEKABOO>": process.env.PEEKABOO_BIN, "<ABSOLUTE_PATH_TO_NODE>": process.env.NODE_BIN,
  "<ABSOLUTE_PATH_TO_NODE_BIN>": require("node:path").dirname(process.env.NODE_BIN),
  "<ABSOLUTE_PATH_TO_KILO_CONFIG>": process.env.KILO_CONFIG_DIR, "<HOME>": process.env.HOME };
const fill = (s, esc = (x) => x) => s.replace(/<[A-Z_]+>/g, (m) => {
  if (!(m in vars)) throw new Error(`${source}: unknown placeholder ${m}`);
  return esc(vars[m]);
});
const json = (s) => JSON.stringify(s).slice(1, -1);
const src = fs.readFileSync(source, "utf8");
if (mode === "text") { process.stdout.write(fill(src, json)); process.exit(0); }
const want = JSON.parse(fill(src.replace(/^[ \t]*\/\/.*$/gm, ""), json));
const text = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
let have;
try { have = text.trim() ? JSON.parse(text) : (mode === "groups" ? [] : {}); }
catch { console.error(`${target} is not plain JSON (comments or trailing commas?); merge ${source} by hand`); process.exit(1); }
const out = structuredClone(have);
if (mode === "servers") out.servers = { ...out.servers, ...want.servers };
if (mode === "groups") for (const g of want) {
  const i = out.findIndex((x) => x.name === g.name);
  i < 0 ? out.push(g) : (out[i] = g);
}
if (mode === "keys") Object.assign(out, want);
if (isDeepStrictEqual(out, have) && text) { process.stdout.write(text); process.exit(0); }
const indent = /^\t/m.test(text) ? "\t" : (text.match(/^( +)"/m)?.[1] ?? "  ");
process.stdout.write(JSON.stringify(out, null, indent) + "\n");
'
render() { "$NODE_BIN" -e "$merge" "$@"; }

if [ "$codex" = 1 ]; then
  render text /dev/null "$cfg/config.peekaboo.toml"
  exit 0
fi

stamp="$(date +%Y%m%d-%H%M%S)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
changes=0

# apply <destination> <file with desired content>
apply() {
  local dest="$1" want="$2"
  if [ -f "$dest" ] && cmp -s "$dest" "$want"; then echo "unchanged  $dest"; return; fi
  changes=$((changes + 1))
  if [ "$dry" = 1 ]; then
    if [ -f "$dest" ]; then
      echo "would update  $dest"
      diff -u "$dest" "$want" | sed 's/^/    /' || true
    else
      echo "would create  $dest"
    fi
    return
  fi
  mkdir -p "$(dirname "$dest")"
  if [ -f "$dest" ]; then cp -p "$dest" "$dest.bak-$stamp"; echo "backup     $dest.bak-$stamp"; fi
  cp "$want" "$dest"
  echo "wrote      $dest"
}

for f in "$cfg"/prompts/*.md; do apply "$user/prompts/$(basename "$f")" "$f"; done
render servers "$user/mcp.json" "$cfg/mcp.json" > "$tmp/mcp.json"
apply "$user/mcp.json" "$tmp/mcp.json"
render groups "$user/chatLanguageModels.json" "$cfg/chatLanguageModels.json" > "$tmp/chatLanguageModels.json"
apply "$user/chatLanguageModels.json" "$tmp/chatLanguageModels.json"
render keys "$user/settings.json" "$cfg/settings.jsonc" > "$tmp/settings.json"
apply "$user/settings.json" "$tmp/settings.json"

[ -f "$KILO_CONFIG_DIR/bridges/claude-cli-mcp.mjs" ] ||
  echo "warning: $KILO_CONFIG_DIR/bridges/claude-cli-mcp.mjs is missing, so claude-code-local will not start (docs/installation.md)" >&2

if [ "$dry" = 1 ]; then echo; echo "Dry run: $changes file(s) would change. Nothing was written."
else echo; echo "$changes file(s) changed."; fi

cat <<'EOF'

Manual steps (see copilot-chat/README.md#user-steps):
  1. Run "Developer: Reload Window" in every VS Code window.
  2. MCP view: start peekaboo and claude-code-local; untick peekaboo > browser in the Agent mode tool picker.
  3. Manage Models: enable the four "Claude ... (Local CLI)" Custom Endpoint models (API key empty).
  4. Manage Models > Add Models > OpenRouter: enter your own key in the VS Code form, then add and pin
     "DeepSeek: DeepSeek V4.1 Flash" (deepseek/deepseek-v4.1-flash) and "Z.ai: GLM 5.3 Flash" (z-ai/glm-5.3-flash).
  5. In Chat, click "Always allow" once for the read-only Peekaboo tools: see, image, capture, inspect_ui,
     analyze, permissions, verify_state, sleep.
  6. Codex tab: bash copilot-chat/scripts/install.sh --codex-snippet, then append it to ~/.codex/config.toml.
     Claude Code tab: see claude-code/README.md and copilot-chat/README.md (Peekaboo --no-remote, browser deny).
  7. Verify: node copilot-chat/scripts/check-copilot-agents.mjs --live
EOF
