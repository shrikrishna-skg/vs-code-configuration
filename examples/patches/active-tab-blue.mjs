#!/usr/bin/env node
// Kilo 7.8.x: selected session tabs and Settings navigation items get a clear,
// theme-aware blue active state instead of the theme's subtle grey selection.
// High-contrast rules are untouched.
// Usage: active-tab-blue.mjs <webview.css> [agent-manager.css ...] [--check]
// A sibling settings.css next to webview.css is patched and checked as well.

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const blue = "var(--vscode-focusBorder, #3794ff)"
const before = "am-tab-active{color:var(--text-base);border-bottom-color:var(--surface-interactive-base);background:color-mix(in srgb,var(--surface-interactive-base) 10%,transparent)}"
const after = `am-tab-active{color:var(--text-base);border-bottom-color:${blue};background:color-mix(in srgb,${blue} 10%,transparent)}`
const expected = 2 // plain .am-tab-active and .session-tab-bar .am-tab-active
const compactSettingsBefore = "&[data-active=true]{background-color:var(--surface-interactive-base);border-left:2px solid var(--border-focus)}"
const compactSettingsLegacy = `&[data-active=true]{background-color:color-mix(in srgb,${blue} 18%,transparent);border-left:3px solid ${blue};color:var(--text-strong)}&[data-active=true] [data-slot=settings-nav-icon]{color:${blue}}`
const compactSettingsAfter = `&[data-active=true]{background-color:color-mix(in srgb,${blue} 22%,transparent);border-left:3px solid ${blue};color:${blue}}&[data-active=true] [data-slot=settings-nav-icon]{color:${blue}}`
const wideSettingsBefore = "&:has([data-selected]){background-color:var(--surface-base-active);color:var(--text-strong);[data-component=icon]{color:var(--icon-strong-base)}&:hover:not(:disabled){background-color:var(--surface-base-active)}}"
const wideSettingsLegacy = `&:has([data-selected]){background-color:color-mix(in srgb,${blue} 22%,transparent);color:${blue};box-shadow:inset 3px 0 0 ${blue};[data-component=icon]{color:${blue}}&:hover:not(:disabled){background-color:color-mix(in srgb,${blue} 28%,transparent)}}`
const wideSettingsThemeSelection = `&:has([data-selected]){background-color:var(--vscode-list-activeSelectionBackground, #094771);color:var(--vscode-list-activeSelectionForeground, #fff);box-shadow:inset 3px 0 0 ${blue};[data-component=icon]{color:var(--vscode-list-activeSelectionForeground, #fff)}&:hover:not(:disabled){background-color:var(--vscode-list-activeSelectionBackground, #094771)}}`
const wideSettingsMixedSelection = `&:has([data-selected]){background-color:color-mix(in srgb,${blue} 45%,var(--background-base));color:#fff;box-shadow:inset 3px 0 0 ${blue};[data-component=icon]{color:#fff}&:hover:not(:disabled){background-color:color-mix(in srgb,${blue} 55%,var(--background-base))}}`
const wideSettingsAfter = `&:has([data-selected]){background-color:#0e639c;color:#fff;box-shadow:inset 3px 0 0 ${blue},inset 0 -2px 0 ${blue};[data-component=icon]{color:#fff}&:hover:not(:disabled){background-color:#1177bb}}`
// An unlayered VS Code theme block repaints every selected tab with --input-base, beating the layered rule above.
const themeTabsBefore = "[data-slot=tabs-trigger-wrapper]{padding:8px;border-radius:2px;&:has([data-selected]){background-color:var(--input-base)}}"
const themeTabsAfter = `${themeTabsBefore}@media not (forced-colors:active){&[data-variant=settings] [data-slot=tabs-trigger-wrapper]:has([data-selected]){background-color:#0e639c;&:hover:not(:disabled){background-color:#1177bb}}}`

export function patch(source) {
  const pending = source.split(before).length - 1
  const applied = source.split(after).length - 1
  if (pending + applied !== expected) throw new Error(`active-tab-blue: expected ${expected} active-tab anchors, found ${pending} unpatched + ${applied} patched; no changes made.`)
  const compactPending = source.split(compactSettingsBefore).length - 1
  const compactLegacy = source.split(compactSettingsLegacy).length - 1
  const compactApplied = source.split(compactSettingsAfter).length - 1
  if (compactPending + compactLegacy + compactApplied !== 1) throw new Error(`active-tab-blue: expected 1 compact settings-nav anchor, found ${compactPending} unpatched + ${compactLegacy} legacy + ${compactApplied} patched; no changes made.`)
  const widePending = source.split(wideSettingsBefore).length - 1
  const wideLegacy = source.split(wideSettingsLegacy).length - 1
  const wideThemeSelection = source.split(wideSettingsThemeSelection).length - 1
  const wideMixedSelection = source.split(wideSettingsMixedSelection).length - 1
  const wideApplied = source.split(wideSettingsAfter).length - 1
  if (widePending + wideLegacy + wideThemeSelection + wideMixedSelection + wideApplied !== 1) throw new Error(`active-tab-blue: expected 1 wide settings-nav anchor, found ${widePending} unpatched + ${wideLegacy + wideThemeSelection + wideMixedSelection} legacy + ${wideApplied} patched; no changes made.`)
  const themeApplied = source.split(themeTabsAfter).length - 1
  const themePending = source.split(themeTabsBefore).length - 1 - themeApplied
  if (themePending + themeApplied !== 1) throw new Error(`active-tab-blue: expected 1 theme tabs anchor, found ${themePending} unpatched + ${themeApplied} patched; no changes made.`)
  return (themePending ? source.replace(themeTabsBefore, themeTabsAfter) : source).replaceAll(before, after).replace(compactSettingsBefore, compactSettingsAfter).replace(compactSettingsLegacy, compactSettingsAfter).replace(wideSettingsBefore, wideSettingsAfter).replace(wideSettingsLegacy, wideSettingsAfter).replace(wideSettingsThemeSelection, wideSettingsAfter).replace(wideSettingsMixedSelection, wideSettingsAfter)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const checkOnly = process.argv.includes("--check")
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith("--")) // the safe gate also passes --apply
  // The standalone Settings panel loads the sibling settings.css bundle, not webview.css.
  for (const target of [...files]) {
    const settings = path.join(path.dirname(target), "settings.css")
    if (path.basename(target) === "webview.css" && fs.existsSync(settings) && !files.some((file) => path.resolve(file) === path.resolve(settings))) files.push(settings)
  }
  if (!files.length) {
    console.error("Usage: active-tab-blue.mjs <webview.css> [agent-manager.css ...] [--check]")
    process.exit(2)
  }
  const updates = []
  for (const target of files) {
    const source = fs.readFileSync(target, "utf8")
    try { updates.push([target, source, patch(source)]) } catch (error) { console.error(`${target}: ${error.message}`); process.exit(1) }
  }
  let missing = false
  for (const [target, source, updated] of updates) {
    if (checkOnly) {
      if (updated !== source) { console.error(`Active-tab-blue patch is not installed in ${target}.`); missing = true }
      else console.log(`Active-tab-blue patch is installed in ${target}.`)
      continue
    }
    if (updated === source) { console.log(`Active-tab-blue patch already installed in ${target}.`); continue }
    const backup = `${target}.pre-active-tab-blue`
    if (!fs.existsSync(backup)) fs.copyFileSync(target, backup)
    const temporary = `${target}.active-tab-blue-${process.pid}`
    fs.writeFileSync(temporary, updated, { mode: fs.statSync(target).mode & 0o777 })
    fs.renameSync(temporary, target)
    console.log(`Patched ${target} (backup ${backup})`)
  }
  if (missing) process.exit(1)
}
