#!/usr/bin/env node
// Kilo 7.8.x: the selected session tab (.am-tab-active / .session-tab-bar .am-tab-active)
// gets a blue bottom bar and faint blue tint instead of the theme's grey
// --surface-interactive-base (list selection background). High-contrast rules are untouched.
// Usage: active-tab-blue.mjs <webview.css> [agent-manager.css ...] [--check]

import fs from "node:fs"
import { pathToFileURL } from "node:url"

const blue = "var(--vscode-focusBorder, #3794ff)"
const before = "am-tab-active{color:var(--text-base);border-bottom-color:var(--surface-interactive-base);background:color-mix(in srgb,var(--surface-interactive-base) 10%,transparent)}"
const after = `am-tab-active{color:var(--text-base);border-bottom-color:${blue};background:color-mix(in srgb,${blue} 10%,transparent)}`
const expected = 2 // plain .am-tab-active and .session-tab-bar .am-tab-active

export function patch(source) {
  const pending = source.split(before).length - 1
  const applied = source.split(after).length - 1
  if (pending + applied !== expected) throw new Error(`active-tab-blue: expected ${expected} active-tab anchors, found ${pending} unpatched + ${applied} patched; no changes made.`)
  return source.replaceAll(before, after)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const checkOnly = process.argv.includes("--check")
  const files = process.argv.slice(2).filter((arg) => arg !== "--check")
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
