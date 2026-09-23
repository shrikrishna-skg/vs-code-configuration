#!/usr/bin/env node
// Kilo 7.7.x: a new chat opens on the selected agent's own model (remembered pick,
// then its `model:` pin); Kilo's global "preferred" model becomes the fallback.
// Apply to dist/webview.js and dist/agent-manager.js (same resolver in both).

import fs from "node:fs"
import { pathToFileURL } from "node:url"

const id = "[\\w$]+"

export function patch(source) {
  // Signal holding Kilo's global preferred model, read from the defaults anchor.
  const preferred = source.match(new RegExp(`defaults:${id}=>(${id})\\(\\)\\?\\?\\(`))?.[1]
    ?? source.match(new RegExp(`defaults:(${id})=>\\(${id}\\(\\)\\[\\1\\]\\?[\\w$.]+\\[\\1\\]:void 0\\)\\?\\?${id}\\(\\1\\)\\?\\?(${id})\\(\\)`))?.[2]

  const edits = [
    // uF resolver: session ?? preferred ?? override ?? mode ?? global -> session ?? override ?? mode ?? preferred ?? global
    [
      new RegExp(`(${id})\\((${id})\\.session\\)\\?\\?\\1\\(\\2\\.preferred\\)\\?\\?\\1\\(\\2\\.override\\)\\?\\?\\1\\(\\2\\.mode\\)\\?\\?\\1\\(\\2\\.global\\)`, "g"),
      (_, n, e) => `${n}(${e}.session)??${n}(${e}.override)??${n}(${e}.mode)??${n}(${e}.preferred)??${n}(${e}.global)`,
      new RegExp(`(${id})\\((${id})\\.session\\)\\?\\?\\1\\(\\2\\.override\\)\\?\\?\\1\\(\\2\\.mode\\)\\?\\?\\1\\(\\2\\.preferred\\)\\?\\?\\1\\(\\2\\.global\\)`, "g"),
    ],
    // Pending-chat pin defaults: preferred ?? agentPick ?? mode ?? global -> agentPick ?? mode ?? preferred ?? global
    [
      new RegExp(`defaults:(${id})=>(${id})\\(\\)\\?\\?(\\(${id}\\(\\)\\[\\1\\]\\?[\\w$.]+\\[\\1\\]:void 0\\))\\?\\?(${id}\\(\\1\\))\\?\\?(${id}\\(\\))`, "g"),
      (_, a, p, pick, mode, global) => `defaults:${a}=>${pick}??${mode}??${p}()??${global}`,
      new RegExp(`defaults:(${id})=>\\(${id}\\(\\)\\[\\1\\]\\?[\\w$.]+\\[\\1\\]:void 0\\)\\?\\?${id}\\(\\1\\)\\?\\?${id}\\(\\)\\?\\?${id}\\(\\)`, "g"),
    ],
    // Auto-filled default for an agent with no remembered pick: mode ?? preferred ?? global ?? recent.
    [
      new RegExp(`(${id}\\(\\{\\.\\.\\.${id}\\(\\),mode:${id}\\(${id}\\),global:${id}\\(\\),recent:[\\w$.]+)\\}\\)`, "g"),
      (_, head) => `${head},preferred:${preferred}()})`,
      new RegExp(`${id}\\(\\{\\.\\.\\.${id}\\(\\),mode:${id}\\(${id}\\),global:${id}\\(\\),recent:[\\w$.]+,preferred:${id}\\(\\)\\}\\)`, "g"),
    ],
    // Agent switch in an unsent chat: drop the chat's carried model instead of pinning the old agent's model.
    [
      new RegExp(`if\\((${id})\\)\\{(${id})\\.pin\\(\\1\\),(${id})\\("agentSelections",\\1,(${id})\\);return\\}`, "g"),
      (_, s, x, set, a) => `if(${s}){/^(?:sidebar-)?pending:/.test(${s})?${x}.forget(${s}):${x}.pin(${s}),${set}("agentSelections",${s},${a});return}`,
      new RegExp(`if\\((${id})\\)\\{/\\^\\(\\?:sidebar-\\)\\?pending:/\\.test\\(\\1\\)\\?${id}\\.forget\\(\\1\\):${id}\\.pin\\(\\1\\),`, "g"),
    ],
  ]

  if (!preferred) throw new Error("per-agent-model: model-selection defaults anchor not found; no changes made.")
  for (const [before, after, done] of edits) {
    const pending = source.match(before)?.length ?? 0
    const applied = source.match(done)?.length ?? 0
    if (pending + applied !== 1) throw new Error(`per-agent-model: expected one anchor, found ${pending} unpatched + ${applied} patched: ${before.source.slice(0, 80)}; no changes made.`)
    if (pending) source = source.replace(before, after)
  }
  return source
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const checkOnly = process.argv.includes("--check")
  const targets = process.argv.slice(2).filter((arg) => arg !== "--check")
  if (!targets.length) {
    console.error("Usage: per-agent-model.mjs <webview.js> [agent-manager.js ...] [--check]")
    process.exit(2)
  }
  let failed = false
  for (const target of targets) {
    const source = fs.readFileSync(target, "utf8")
    let updated
    try { updated = patch(source) } catch (error) { console.error(`${target}: ${error.message}`); failed = true; continue }
    if (checkOnly) {
      if (updated !== source) { console.error(`Per-agent model patch is not installed in ${target}.`); failed = true }
      else console.log(`Per-agent model patch is installed in ${target}.`)
      continue
    }
    if (updated === source) { console.log(`Per-agent model patch already installed in ${target}.`); continue }
    const backup = `${target}.pre-per-agent-model`
    if (!fs.existsSync(backup)) fs.copyFileSync(target, backup)
    const temporary = `${target}.per-agent-model-${process.pid}`
    fs.writeFileSync(temporary, updated, { mode: fs.statSync(target).mode & 0o777 })
    fs.renameSync(temporary, target)
    console.log(`Patched ${target} (backup ${backup})`)
  }
  if (failed) process.exit(1)
}
