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

# All automatic installs stage and validate before touching the live extension.
if [ "${KILO_PATCH_STAGING:-}" != 1 ]; then
  sleep "$settle"
  exec node "$patches/safe-kilo-patches.mjs" reapply "$0"
fi

mkdir -p "$(dirname "$log")"
exec >>"$log" 2>&1
say() { echo "$(date '+%F %T') $*"; }
notify() { :; } # Staging is silent; the outer gate reports the result.

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
  local dir local_dir
  failed=""
  # The custom Kilo build has an independent, fail-closed UI opening patch.
  local_dir=$(ls -d "$extensions"/shrikrishna-skg.kilo-code-local-*/ 2>/dev/null | sort -V | tail -1)
  if [ -n "$local_dir" ]; then
    # Preserve the existing v6 prompt library and Continue menu before dependent UI patches.
    ensure prompt-suggestions.mjs "${local_dir%/}/dist/webview.js" "${local_dir%/}/dist/webview.css"
    ensure agent-manager-manual-open.mjs "${local_dir%/}/dist/extension.js"
    ensure native-subagent-ready.mjs "${local_dir%/}/dist/extension.js"
    # Baseline custom build also carries these preferences and picker changes.
    ensure jev-agent-order.mjs "${local_dir%/}/dist/webview.js"
    ensure per-agent-model.mjs "${local_dir%/}/dist/webview.js" "${local_dir%/}/dist/agent-manager.js"
    ensure global-last-agent.mjs "${local_dir%/}/dist/webview.js" "${local_dir%/}/dist/extension.js" "${local_dir%/}/dist/agent-manager.js"
    ensure active-tab-blue.mjs "${local_dir%/}/dist/webview.css" "${local_dir%/}/dist/agent-manager.css"
    ensure model-favorites.mjs "${local_dir%/}/dist/webview.js" "${local_dir%/}/dist/extension.js" "${local_dir%/}/dist/webview.css"
    ensure cto-selected-label.mjs "${local_dir%/}/dist/webview.js"
    ensure cto-selected-label.mjs "${local_dir%/}/dist/agent-manager.js"
    ensure subagent-default-open.mjs "${local_dir%/}/dist/webview.js"
    ensure subagent-default-open.mjs "${local_dir%/}/dist/agent-manager.js"
    ensure todos-both-locations.mjs "${local_dir%/}/dist/webview.js"
    ensure todos-both-locations.mjs "${local_dir%/}/dist/agent-manager.js"
    ensure subagents-header.mjs "${local_dir%/}/dist/webview.js"
    ensure subagents-header.mjs "${local_dir%/}/dist/agent-manager.js"
    ensure subagents-header.mjs "${local_dir%/}/dist/webview.css"
    ensure subagents-header.mjs "${local_dir%/}/dist/agent-manager.css"
    ensure clarify-goal.mjs "${local_dir%/}/dist/extension.js"
    ensure clarify-goal.mjs "${local_dir%/}/dist/webview.js"
    ensure clarify-goal.mjs "${local_dir%/}/dist/agent-manager.js"
    ensure predict-next.mjs "${local_dir%/}/dist/extension.js"
    ensure predict-next.mjs "${local_dir%/}/dist/webview.js"
    ensure skim-mode.mjs "${local_dir%/}/dist/webview.js"
    ensure skim-mode.mjs "${local_dir%/}/dist/agent-manager.js"
    ensure composer-orange-actions.mjs "${local_dir%/}/dist/webview.js"
    ensure composer-orange-actions.mjs "${local_dir%/}/dist/agent-manager.js"
    ensure composer-orange-actions.mjs "${local_dir%/}/dist/webview.css"
    ensure composer-orange-actions.mjs "${local_dir%/}/dist/agent-manager.css"
    ensure chat-effort-isolation.mjs "${local_dir%/}/dist/webview.js"
    ensure chat-effort-isolation.mjs "${local_dir%/}/dist/agent-manager.js"
    # Off 2026-10-15: user chose Kilo's native chat scroll over the glide. Re-enable this line to bring the glide back.
    # ensure chat-scroll-stability.mjs "${local_dir%/}/dist/webview.js"
    ensure permission-modes.mjs "${local_dir%/}/dist/extension.js"
    ensure permission-route.mjs "${local_dir%/}/dist/extension.js"
    ensure permission-modes.mjs "${local_dir%/}/dist/webview.js"
    ensure permission-modes.mjs "${local_dir%/}/dist/agent-manager.js"
    ensure permission-modes.mjs "${local_dir%/}/dist/webview.css"
    ensure permission-modes.mjs "${local_dir%/}/dist/agent-manager.css"
    ensure native-webview-recovery.mjs "${local_dir%/}/dist"
    ensure provider-save-message.mjs "${local_dir%/}/dist/webview.js"
    ensure chat-font.mjs "${local_dir%/}/dist/webview.css"
    ensure chat-font.mjs "${local_dir%/}/dist/agent-manager.css"
    # Background-agent strip cards: agent · model · provider line at 9px.
    ensure subagent-model-small.mjs "${local_dir%/}/dist/webview.css"
    ensure subagent-model-small.mjs "${local_dir%/}/dist/agent-manager.css"
    ensure composer-chevrons.mjs "${local_dir%/}/dist/webview.css"
    ensure composer-chevrons.mjs "${local_dir%/}/dist/agent-manager.css"
    # Needs the Continue quick-action button, which not every build has; a miss is logged, not fatal.
    ensure composer-chevrons.mjs "${local_dir%/}/dist/webview.js"
    # Composer controls on one line; model name truncated, full name on hover.
    ensure composer-one-line.mjs "${local_dir%/}/dist/webview.css"
    ensure composer-one-line.mjs "${local_dir%/}/dist/agent-manager.css"
    ensure composer-one-line.mjs "${local_dir%/}/dist/webview.js"
    ensure composer-one-line.mjs "${local_dir%/}/dist/agent-manager.js"
    # Session map: button left of ✦ Prompts plus the overlay; host block, call site, CSS.
    ensure session-map.mjs "${local_dir%/}/dist/extension.js"
    ensure session-map.mjs "${local_dir%/}/dist/webview.js"
    ensure session-map.mjs "${local_dir%/}/dist/webview.css"
    # Footer pin button: appends pinned Prompts-panel prompts to typed messages.
    ensure pinned-append.mjs "${local_dir%/}/dist/webview.js"
  fi
  dir=$(ls -d "$extensions"/kilocode.kilo-code-*/ 2>/dev/null | sort -V | tail -1)
  [ -n "$dir" ] || { say "Custom Kilo patch check finished; no separate marketplace Kilo under $extensions"; [ -z "$failed" ]; return $?; }
  local dist="${dir%/}/dist"
  local wv="$dist/webview.js" ext="$dist/extension.js" am="$dist/agent-manager.js"
  for f in "$wv" "$ext" "$am"; do [ -s "$f" ] || { say "missing $f (still extracting?)"; return 1; }; done
  # Each patch is attempted independently: one failing anchor must not block the others.
  ensure jev-agent-order.mjs "$wv"
  ensure per-agent-model.mjs "$wv" "$am"
  ensure global-last-agent.mjs "$wv" "$ext" "$am"
  ensure active-tab-blue.mjs "$dist/webview.css" "$dist/agent-manager.css"
  ensure model-favorites.mjs "$wv" "$ext" "$dist/webview.css"
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
