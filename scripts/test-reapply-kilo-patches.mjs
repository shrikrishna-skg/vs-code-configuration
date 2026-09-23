// Check for scripts/reapply-kilo-patches.sh: a pristine fake Kilo install gets all three
// patches plus one notification; a second run is a no-op with no notification.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-reapply-"))
const dist = path.join(tmp, "ext", "kilocode.kilo-code-9.9.9-darwin-arm64", "dist")
fs.mkdirSync(dist, { recursive: true })

// Trimmed Kilo 7.7.7 anchors (see examples/patches/check-per-agent-model.mjs).
const webview = [
  "function uF(e){let n=a=>a??null,r=n(e.session)??n(e.preferred)??n(e.override)??n(e.mode)??n(e.global);return r}",
  "let Xi=Xnt({defaults:ne=>ue()??(G()[ne]?Mt.modelSelections[ne]:void 0)??Pa(ne)??Mi()});",
  "let Ge=uF({...$i(),mode:Pa(ne),global:Mi(),recent:Mt.recentModels});",
  'function kge(ne,Ge){let ht=Ge??o();if(ht){Xi.pin(ht),tn("agentSelections",ht,ne);return}Nt(ne)}',
  'let Rv=t.onMessage(ne=>{if(ne.type!=="agentsLoaded")return;et(ne.agents),He(ne.allAgents??ne.agents),qe(ne.defaultAgent);let Ge=1});',
  "let rn=Ce(()=>{let ne=o();return ne?Mt.agentSelections[ne]??De():nn()??De()});",
  "let It=Ge?Mt.agentSelections[Ge]:nn(),un=1;",
].join("\n")
const extension = 'let{visible,defaultAgent}=filterVisibleAgents(agents),message6={type:"agentsLoaded",agents:visible.map(mapAgent),allAgents:agents.map(mapAgent),defaultAgent};switch(x){case"t":break;case"persistVariant":{let stored2=1}}'
for (const [name, text] of [["webview.js", webview], ["agent-manager.js", webview], ["extension.js", extension]])
  fs.writeFileSync(path.join(dist, name), text)

// Fake osascript records notifications instead of showing them.
const bin = path.join(tmp, "bin"), notes = path.join(tmp, "notes")
fs.mkdirSync(bin)
fs.writeFileSync(path.join(bin, "osascript"), `#!/bin/sh\necho "$2" >> "${notes}"\n`, { mode: 0o755 })

const run = () => execFileSync("bash", [path.join(root, "scripts/reapply-kilo-patches.sh")], {
  env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, KILO_EXTENSIONS_DIR: path.join(tmp, "ext"),
    KILO_PATCH_DIR: path.join(root, "examples/patches"), KILO_PATCH_LOG: path.join(tmp, "log"), KILO_PATCH_SETTLE: "0" },
})
const read = (f) => fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""

run()
assert.match(read(path.join(tmp, "log")), /re-applied patches to kilocode\.kilo-code-9\.9\.9/)
assert.match(read(notes), /Kilo patches re-applied/)
for (const marker of ["orderAgents", "Xi.forget", "persistLastSelectedAgent"]) assert.ok(read(path.join(dist, "webview.js")).includes(marker), marker)
assert.match(read(path.join(dist, "extension.js")), /persistLastSelectedAgent/)
const before = ["webview.js", "agent-manager.js", "extension.js"].map((f) => read(path.join(dist, f)))

run()
assert.match(read(path.join(tmp, "log")), /all patches present/)
assert.equal(read(notes).trim().split("\n").length, 1, "second run must not notify")
assert.deepEqual(["webview.js", "agent-manager.js", "extension.js"].map((f) => read(path.join(dist, f))), before)

fs.rmSync(tmp, { recursive: true })
console.log("reapply-kilo-patches checks passed")
