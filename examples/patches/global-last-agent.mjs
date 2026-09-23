#!/usr/bin/env node
// Kilo 7.7.x: new chats (and the first chat after a reload) open on the last agent the
// user selected, saved in ~/.local/state/kilo/last-selected-agent; kilo.jsonc
// default_agent is used only when nothing valid is saved.
// Usage: global-last-agent.mjs <webview.js> <extension.js> [agent-manager.js ...] [--check]

import fs from "node:fs"
import { pathToFileURL } from "node:url"

const id = "[\\w$]+"
const stateFile = 'require("path").join(require("os").homedir(),".local","state","kilo","last-selected-agent")'

function apply(source, edits, label) {
  for (const [before, after, done] of edits) {
    const pending = source.match(before)?.length ?? 0
    const applied = source.match(done)?.length ?? 0
    if (pending + applied !== 1) throw new Error(`global-last-agent: expected one ${label} anchor, found ${pending} unpatched + ${applied} patched: ${before.source.slice(0, 80)}; no changes made.`)
    if (pending) source = source.replace(before, after)
  }
  return source
}

export function patchWebview(source) {
  const post = source.match(new RegExp(`(${id})\\.onMessage\\((${id})=>\\{if\\(\\2\\.type!=="agentsLoaded"\\)return;`))?.[1]
  const setDefault = source.match(new RegExp(`(${id})\\((${id})\\.defaultAgent\\);let`))?.[1]
  const getDefault = source.match(new RegExp(`return (${id})\\?[\\w$.]+\\.agentSelections\\[\\1\\]\\?\\?(${id})\\(\\):${id}\\(\\)\\?\\?\\2\\(\\)\\}`))?.[2]
  if (!post || !setDefault || !getDefault) throw new Error("global-last-agent: agent store anchors not found; no changes made.")
  return apply(source, [
    // Selecting an agent saves it and makes it the default for the next new chat.
    [
      new RegExp(`function (${id})\\((${id}),(${id})\\)\\{let (${id})=\\3\\?\\?(${id})\\(\\);if\\(\\4\\)\\{`, "g"),
      (m, _f, agent) => m.replace("{let", `{${post}.postMessage({type:"persistLastSelectedAgent",agent:${agent}}),${setDefault}(${agent});let`),
      new RegExp(`\\{${id}\\.postMessage\\(\\{type:"persistLastSelectedAgent",agent:${id}\\}\\),${id}\\(${id}\\);let`, "g"),
    ],
    // New sessions record their agent, so later default changes never relabel them.
    [
      new RegExp(`let (${id})=(${id})\\?([\\w$.]+)\\.agentSelections\\[\\2\\]:(${id})\\(\\),`, "g"),
      (_, v, s, store, pending) => `let ${v}=${s}?${store}.agentSelections[${s}]:${pending}()??${getDefault}(),`,
      new RegExp(`let (${id})=(${id})\\?[\\w$.]+\\.agentSelections\\[\\2\\]:${id}\\(\\)\\?\\?${id}\\(\\),`, "g"),
    ],
  ], "webview")
}

export function patchExtension(source) {
  return apply(source, [
    [
      /message6=\{type:"agentsLoaded",agents:visible\.map\(mapAgent\),allAgents:agents\.map\(mapAgent\),defaultAgent\}/g,
      `message6={type:"agentsLoaded",agents:visible.map(mapAgent),allAgents:agents.map(mapAgent),defaultAgent:(()=>{try{let saved=require("fs").readFileSync(${stateFile},"utf8").trim();return visible.some(a=>a.name===saved)?saved:defaultAgent}catch{return defaultAgent}})()}`,
      /allAgents:agents\.map\(mapAgent\),defaultAgent:\(\(\)=>\{try\{let saved=/g,
    ],
    [
      /;case"persistVariant":\{let stored2=/g,
      `;case"persistLastSelectedAgent":{if(typeof message6.agent=="string"&&message6.agent){let file4=${stateFile};require("fs").mkdirSync(require("path").dirname(file4),{recursive:!0}),require("fs").writeFileSync(file4,message6.agent,"utf8")}break}case"persistVariant":{let stored2=`,
      /case"persistLastSelectedAgent":\{if\(typeof message6\.agent=="string"/g,
    ],
  ], "extension")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const checkOnly = process.argv.includes("--check")
  const [webview, extension, ...others] = process.argv.slice(2).filter((arg) => arg !== "--check")
  if (!webview || !extension) {
    console.error("Usage: global-last-agent.mjs <webview.js> <extension.js> [agent-manager.js ...] [--check]")
    process.exit(2)
  }
  const targets = [[webview, patchWebview], [extension, patchExtension], ...others.map((file) => [file, patchWebview])]
  const updates = []
  for (const [target, patch] of targets) {
    const source = fs.readFileSync(target, "utf8")
    try { updates.push([target, source, patch(source)]) } catch (error) { console.error(`${target}: ${error.message}`); process.exit(1) }
  }
  let missing = false
  for (const [target, source, updated] of updates) {
    if (checkOnly) {
      if (updated !== source) { console.error(`Global-last-agent patch is not installed in ${target}.`); missing = true }
      else console.log(`Global-last-agent patch is installed in ${target}.`)
      continue
    }
    if (updated === source) { console.log(`Global-last-agent patch already installed in ${target}.`); continue }
    const backup = `${target}.pre-global-last-agent`
    if (!fs.existsSync(backup)) fs.copyFileSync(target, backup)
    const temporary = `${target}.global-last-agent-${process.pid}`
    fs.writeFileSync(temporary, updated, { mode: fs.statSync(target).mode & 0o777 })
    fs.renameSync(temporary, target)
    console.log(`Patched ${target} (backup ${backup})`)
  }
  if (missing) process.exit(1)
}
