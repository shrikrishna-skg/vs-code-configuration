#!/bin/bash
# Re-apply the local Kilo Code patches after the VS Code extension auto-updates.
# Idempotent: on an already-patched install it only logs one line (no notification).
# Live copy: ~/.config/kilo/patches/reapply-kilo-patches.sh, run by LaunchAgent
# ai.kilo.reapply-patches (WatchPaths ~/.vscode/extensions + RunAtLoad).
set -uo pipefail

extensions="${KILO_EXTENSIONS_DIR:-$HOME/.vscode/extensions}"
patches="${KILO_PATCH_DIR:-$HOME/.config/kilo/patches}"
log="${KILO_PATCH_LOG:-$HOME/.config/kilo/logs/kilo-patches.log}"
settle="${KILO_PATCH_SETTLE:-15}" # seconds for VS Code to finish extracting an update

mkdir -p "$(dirname "$log")"
exec >>"$log" 2>&1
say() { echo "$(date '+%F %T') $*"; }
notify() { osascript -e "display notification \"$1\" with title \"Kilo Code\""; }

applied=0 failed=""
# ensure <patch.mjs> <files...>: apply only when its --check fails, then re-check.
ensure() {
  local script="$patches/$1"; shift
  node "$script" "$@" --check >/dev/null 2>&1 && return 0
  say "applying $(basename "$script")"
  node "$script" "$@" && node "$script" "$@" --check >/dev/null || { say "FAILED $(basename "$script")"; failed+=" $(basename "$script" .mjs)"; return 1; }
  applied=1
}

attempt() {
  local dir
  dir=$(ls -d "$extensions"/kilocode.kilo-code-*/ 2>/dev/null | sort -V | tail -1)
  [ -n "$dir" ] || { say "no Kilo extension under $extensions"; return 0; }
  local dist="${dir%/}/dist"
  local wv="$dist/webview.js" ext="$dist/extension.js" am="$dist/agent-manager.js"
  for f in "$wv" "$ext" "$am"; do [ -s "$f" ] || { say "missing $f (still extracting?)"; return 1; }; done
  # Each patch is attempted independently: one failing anchor must not block the others.
  failed=""
  ensure jev-agent-order.mjs "$wv"
  ensure per-agent-model.mjs "$wv" "$am"
  ensure global-last-agent.mjs "$wv" "$ext" "$am"
  ensure active-tab-blue.mjs "$dist/webview.css" "$dist/agent-manager.css"
  if [ "$applied" = 1 ]; then
    for f in "$wv" "$ext" "$am"; do node --check "$f" || { say "FAILED node --check $f"; return 1; }; done
    say "re-applied patches to $(basename "$dir")"
  elif [ -z "$failed" ]; then
    say "$(basename "$dir"): all patches present"
  fi
  [ -z "$failed" ]
}

sleep "$settle"
# Screen automation guard: Kilo, VS Code Chat (mcp.json), Claude Code (~/.claude.json, settings.json)
# and Codex (~/.codex/config.toml) need Peekaboo started with "mcp serve --no-remote", browser off.
node "$patches/check-peekaboo-mcp.mjs" "${KILO_CONFIG:-$HOME/.config/kilo/kilo.jsonc}" ||
  notify "Peekaboo MCP config check FAILED — see ~/.config/kilo/logs/kilo-patches.log"
if attempt || { say "retrying in ${settle}s"; sleep "$settle"; attempt; }; then
  [ "$applied" = 1 ] && notify "Kilo patches re-applied — run Developer: Reload Window"
  exit 0
fi
notify "Kilo patch re-apply FAILED${failed:+:$failed} — see ~/.config/kilo/logs/kilo-patches.log"
exit 1
