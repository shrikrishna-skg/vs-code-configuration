// Check for scripts/reapply-kilo-patches.sh: a pristine fake Kilo install gets all five
// patches plus one notification; a second run is a no-op with no notification; a failing
// patch is logged and notified without blocking the others, and the run exits non-zero.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kilo-reapply-"))) // realpath: patch CLIs compare import.meta.url with argv[1]
const install = (ext) => {
  const dist = path.join(tmp, ext, "kilocode.kilo-code-9.9.9-darwin-arm64", "dist")
  fs.mkdirSync(dist, { recursive: true })
  for (const [name, text] of [["webview.js", webview], ["agent-manager.js", webview], ["extension.js", extension], ["webview.css", css], ["agent-manager.css", css]])
    fs.writeFileSync(path.join(dist, name), text)
  return dist
}

// Trimmed Kilo 7.7.7 anchors (see examples/patches/check-per-agent-model.mjs).
const webview = [
  "function uF(e){let n=a=>a??null,r=n(e.session)??n(e.preferred)??n(e.override)??n(e.mode)??n(e.global);return r}",
  "let Xi=Xnt({defaults:ne=>ue()??(G()[ne]?Mt.modelSelections[ne]:void 0)??Pa(ne)??Mi()});",
  "let Ge=uF({...$i(),mode:Pa(ne),global:Mi(),recent:Mt.recentModels});",
  'function kge(ne,Ge){let ht=Ge??o();if(ht){Xi.pin(ht),tn("agentSelections",ht,ne);return}Nt(ne)}',
  'let Rv=t.onMessage(ne=>{if(ne.type!=="agentsLoaded")return;et(ne.agents),He(ne.allAgents??ne.agents),qe(ne.defaultAgent);let Ge=1});',
  "let rn=Ce(()=>{let ne=o();return ne?Mt.agentSelections[ne]??De():nn()??De()});",
  "let It=Ge?Mt.agentSelections[Ge]:nn(),un=1;",
  '/*,[_e,J]=ye(!0);function Ne(Le)*/',
  '/*Ee=xe(()=>{if(e.favorites===!1)return[];if(!o||x())return[];let Le=new Map(Ue().map(Mt=>[Tb(Mt.providerID,Mt.id),Mt])),rt=o.favoriteModels().map(Mt=>Le.get(Tb(Mt.providerID,Mt.modelID))).filter(Mt=>!!Mt),bt=N();if(!bt)return rt;let Ft=rt.findIndex(Mt=>Tb(Mt.providerID,Mt.id)===bt);if(Ft<=0)return rt;let sn=rt[Ft];return sn?[sn,...rt.slice(0,Ft),...rt.slice(Ft+1)]:rt})*/',
  '/*let sn=[],Mt=Ee();Mt.length>0&&sn.push({key:pJr,label:a.t("model.group.favorites"),rows:Mt.map(yn=>({key:Gw("favorite",yn.providerID,yn.id),kind:"favorite",model:yn}))}),Le.length>0&&sn.push*/',
  '/*Q(gr,()=>Pa.label),*/',
  '/*t.postMessage({type:"toggleFavorite",action:qn,providerID:ne,modelID:je})}function Oa(ne){*/',
  '/*favoriteModels:()=>Mt.favoriteModels,toggleFavorite:zr,variantList:ct*/',
  '/*var Pa=dJr(),Mi=Pa.firstChild,$i=Mi.firstChild,Ji=$i.firstChild,jc=Ji.nextSibling;return Mi.$$dblclick=*/',
  '/*o.toggleFavorite(Le.providerID,Le.id)}function Nt(Le){*/',
].join("\n")
const extension = 'let{visible,defaultAgent}=filterVisibleAgents(agents),message6={type:"agentsLoaded",agents:visible.map(mapAgent),allAgents:agents.map(mapAgent),defaultAgent};switch(x){case"t":break;case"persistVariant":{let stored2=0;break}/*case"requestFavorites":{let favorites=validateFavorites(this.extensionContext?.globalState.get("favoriteModels"));this.postMessage({type:"favoritesLoaded",favorites});break}*/}/*async toggleFavorite(message6){let current=validateFavorites(this.extensionContext?.globalState.get("favoriteModels")),key6=`${message6.providerID}/${message6.modelID}`,exists6=current.some(f2=>`${f2.providerID}/${f2.modelID}`===key6),favorites=message6.action==="add"&&!exists6?[...current,{providerID:message6.providerID,modelID:message6.modelID}]:message6.action==="remove"&&exists6?current.filter(f2=>`${f2.providerID}/${f2.modelID}`!==key6):current;await this.extensionContext?.globalState.update("favoriteModels",favorites),this.connectionService.notifyFavoritesChanged(favorites)}initializeConnection()*/'
// Trimmed Kilo 7.8.1 active-tab rules (plain and .session-tab-bar), see examples/patches/active-tab-blue.mjs.
const tab = "am-tab-active{color:var(--text-base);border-bottom-color:var(--surface-interactive-base);background:color-mix(in srgb,var(--surface-interactive-base) 10%,transparent)}"
const css = `.${tab}.session-tab-bar .${tab}.model-selector-group-label{}`
const dist = install("ext")

// Fake osascript records notifications instead of showing them.
const bin = path.join(tmp, "bin"), notes = path.join(tmp, "notes")
fs.mkdirSync(bin)
fs.writeFileSync(path.join(bin, "osascript"), `#!/bin/sh\necho "$2" >> "${notes}"\n`, { mode: 0o755 })

// Fake HOME with the sanitized examples, so the Peekaboo guard never reads live
// ~/.claude.json, ~/.codex or the VS Code user dir (a failing guard would add a notification).
const home = path.join(tmp, "home")
for (const [from, to] of [["copilot-chat/config/mcp.json", "Library/Application Support/Code/User/mcp.json"],
  ["claude-code/config/settings.json", ".claude/settings.json"], ["copilot-chat/config/config.peekaboo.toml", ".codex/config.toml"]]) {
  fs.mkdirSync(path.dirname(path.join(home, to)), { recursive: true })
  fs.copyFileSync(path.join(root, from), path.join(home, to))
}
fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { peekaboo: { type: "stdio", command: "peekaboo",
  args: ["mcp", "serve", "--no-remote", "--transport", "stdio", "--allow-foreground"] } } }))

const run = (ext = "ext", patches = path.join(root, "examples/patches")) => execFileSync("bash", [path.join(root, "scripts/reapply-kilo-patches.sh")], {
  env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, KILO_EXTENSIONS_DIR: path.join(tmp, ext),
    KILO_PATCH_DIR: patches, KILO_PATCH_LOG: path.join(tmp, "log"), KILO_PATCH_SETTLE: "0",
    KILO_CONFIG: path.join(root, "examples/kilo.jsonc") },
})
const read = (f) => fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""

run()
assert.match(read(path.join(tmp, "log")), /re-applied patches to kilocode\.kilo-code-9\.9\.9/)
assert.match(read(notes), /Kilo patches re-applied/)
assert.match(read(path.join(tmp, "log")), /Peekaboo MCP config OK: .*\.codex\/config\.toml/)
for (const marker of ["orderAgents", "Xi.forget", "persistLastSelectedAgent", "favoritesFilterOpen", "model-selector-favorite-drag-handle"]) assert.ok(read(path.join(dist, "webview.js")).includes(marker), marker)
assert.match(read(path.join(dist, "extension.js")), /persistLastSelectedAgent/)
assert.match(read(path.join(dist, "extension.js")), /reorderFavorites/)
for (const f of ["webview.css", "agent-manager.css"]) assert.equal(read(path.join(dist, f)).split("border-bottom-color:var(--vscode-focusBorder, #3794ff)").length, 3, f)
const before = ["webview.js", "agent-manager.js", "extension.js", "webview.css", "agent-manager.css"].map((f) => read(path.join(dist, f)))

run()
assert.match(read(path.join(tmp, "log")), /all patches present/)
assert.equal(read(notes).trim().split("\n").length, 1, "second run must not notify")
assert.deepEqual(["webview.js", "agent-manager.js", "extension.js", "webview.css", "agent-manager.css"].map((f) => read(path.join(dist, f))), before)

// A broken first patch (jev-agent-order) must not block per-agent-model and global-last-agent.
const broken = path.join(tmp, "patches")
fs.cpSync(path.join(root, "examples/patches"), broken, { recursive: true })
fs.writeFileSync(path.join(broken, "jev-agent-order.mjs"), "process.exit(1)\n")
const dist2 = install("ext2")
assert.throws(() => run("ext2", broken), (e) => e.status === 1)
assert.match(read(path.join(tmp, "log")), /FAILED jev-agent-order\.mjs/)
assert.match(read(notes), /Kilo patch re-apply FAILED: jev-agent-order/)
for (const marker of ["Xi.forget", "persistLastSelectedAgent"]) assert.ok(read(path.join(dist2, "webview.js")).includes(marker), marker)
assert.match(read(path.join(dist2, "extension.js")), /persistLastSelectedAgent/)

// The custom build must reapply the renderer recovery hook, with directory arguments.
const customDist = path.join(tmp, "custom", "shrikrishna-skg.kilo-code-local-7.8.2", "dist")
fs.mkdirSync(customDist, { recursive: true })
const customPatches = path.join(tmp, "custom-patches"), customCalls = path.join(tmp, "custom-calls")
fs.mkdirSync(customPatches)
for (const name of ["check-peekaboo-mcp", "agent-manager-manual-open", "native-subagent-ready", "cto-selected-label", "subagent-default-open", "clarify-goal", "native-webview-recovery"]) {
  fs.writeFileSync(path.join(customPatches, name + ".mjs"), `import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(customCalls)}, JSON.stringify({name:${JSON.stringify(name)},args:process.argv.slice(2)})+'\\n');`)
}
run("custom", customPatches)
const customInvocations = read(customCalls).trim().split("\n").map(line => JSON.parse(line))
assert(customInvocations.some(call => call.name === "native-webview-recovery" && call.args[0] === customDist && call.args[1] === "--check"), "Custom extension reapply must include renderer recovery")
for (const file of ["webview.js", "agent-manager.js"]) assert(customInvocations.some(call => call.name === "subagent-default-open" && call.args[0] === path.join(customDist, file) && call.args[1] === "--check"), "Custom extension reapply must include expanded subagent cards in both views")

fs.rmSync(tmp, { recursive: true })
console.log("reapply-kilo-patches checks passed")
