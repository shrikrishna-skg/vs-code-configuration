#!/usr/bin/env node
// Kilo 7.8.1: move busy/retrying local sessions into an "Active tasks" group
// at the top of History and show their live activity instead of a timestamp.
// Usage: active-tasks-history.mjs <webview.js> <webview.css> [--check]

import fs from "node:fs"
import { pathToFileURL } from "node:url"

const transforms = [
  {
    name: "activity predicate",
    before: "p=xe(()=>{let k=e.sessionIds?.();return k?t.sessions().filter(w=>k.has(w.id)):t.sessions()});$n(",
    after: "p=xe(()=>{let k=e.sessionIds?.();return k?t.sessions().filter(w=>k.has(w.id)):t.sessions()}),q=k=>VV(t.activityFor(k.id));$n(",
  },
  {
    name: "active group",
    before: "groupBy:C=>n.t(OQa(C.updatedAt)),sortGroupsBy:(C,_)=>{let I=Object.fromEntries(_R.map((T,L)=>[n.t(T),L]));return(I[C.category]??99)-(I[_.category]??99)}",
    after: 'groupBy:C=>q(C)?"Active tasks":n.t(OQa(C.updatedAt)),sortGroupsBy:(C,_)=>{let I=Object.fromEntries([["Active tasks",0],..._R.map((T,L)=>[n.t(T),L+1])]);return(I[C.category]??99)-(I[_.category]??99)}',
  },
  {
    name: "live status",
    before: "Q(_,()=>P0(C.updatedAt)),_})(),E(ue,{get when(){return t.currentSessionID()===C.id}",
    after: 'Q(_,()=>q(C)?n.t(I0e(t.activityFor(C.id))):P0(C.updatedAt)),ot(()=>Ke(_,"data-activity",q(C)?t.activityFor(C.id):null)),_})(),E(ue,{get when(){return t.currentSessionID()===C.id}',
  },
]

const cssMarker = "/* kilo-active-tasks-history */"
const css = `${cssMarker}
.session-list [data-slot=list-item-description][data-activity=busy],.session-list [data-slot=list-item-description][data-activity=retry]{display:inline-flex;align-items:center;gap:6px;color:var(--vscode-testing-iconPassed,#73c991);font-weight:600}
.session-list [data-slot=list-item-description][data-activity=busy]::before,.session-list [data-slot=list-item-description][data-activity=retry]::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 0 color-mix(in srgb,currentColor 35%,transparent);animation:kilo-history-active-pulse 1.6s ease-out infinite}
@keyframes kilo-history-active-pulse{70%,100%{box-shadow:0 0 0 6px transparent}}
@media (prefers-reduced-motion:reduce){.session-list [data-slot=list-item-description][data-activity=busy]::before,.session-list [data-slot=list-item-description][data-activity=retry]::before{animation:none}}`

function replaceOnce(source, { name, before, after }) {
  const pending = source.split(before).length - 1
  const applied = source.split(after).length - 1
  if (pending + applied !== 1) throw new Error(`active-tasks-history: expected one ${name} anchor, found ${pending} unpatched + ${applied} patched; no changes made.`)
  return source.replace(before, after)
}

export function patchWebview(source) {
  return transforms.reduce(replaceOnce, source)
}

export function patchCss(source) {
  if (source.includes(cssMarker)) return source
  if (!source.includes(".session-list")) throw new Error("active-tasks-history: session-list CSS anchor was not found; no changes made.")
  return `${source}\n${css}\n`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const checkOnly = process.argv.includes("--check")
  const files = process.argv.slice(2).filter((arg) => arg !== "--check")
  if (files.length !== 2) {
    console.error("Usage: active-tasks-history.mjs <webview.js> <webview.css> [--check]")
    process.exit(2)
  }
  const patchers = [patchWebview, patchCss]
  const updates = files.map((target, index) => {
    const source = fs.readFileSync(target, "utf8")
    try { return [target, source, patchers[index](source)] }
    catch (error) { console.error(`${target}: ${error.message}`); process.exit(1) }
  })
  let missing = false
  for (const [target, source, updated] of updates) {
    if (checkOnly) {
      if (updated !== source) { console.error(`Active-tasks-history patch is not installed in ${target}.`); missing = true }
      else console.log(`Active-tasks-history patch is installed in ${target}.`)
      continue
    }
    if (updated === source) { console.log(`Active-tasks-history patch already installed in ${target}.`); continue }
    const backup = `${target}.pre-active-tasks-history`
    if (!fs.existsSync(backup)) fs.copyFileSync(target, backup)
    const temporary = `${target}.active-tasks-history-${process.pid}`
    fs.writeFileSync(temporary, updated, { mode: fs.statSync(target).mode & 0o777 })
    fs.renameSync(temporary, target)
    console.log(`Patched ${target} (backup ${backup})`)
  }
  if (missing) process.exit(1)
}
