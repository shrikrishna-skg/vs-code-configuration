import assert from "node:assert/strict"
import { patch } from "./per-agent-model.mjs"
import { patchExtension, patchWebview } from "./global-last-agent.mjs"

// Kilo 7.7.7 webview.js anchors, trimmed to the resolver body.
const fixture = [
  "function uF(e){let n=a=>a??null,r=n(e.session)??n(e.preferred)??n(e.override)??n(e.mode)??n(e.global);return r}",
  "let Xi=Xnt({defaults:ne=>ue()??(G()[ne]?Mt.modelSelections[ne]:void 0)??Pa(ne)??Mi()});",
  "let Ge=uF({...$i(),mode:Pa(ne),global:Mi(),recent:Mt.recentModels});",
  'function kge(ne,Ge){let ht=Ge??o();if(ht){Xi.pin(ht),tn("agentSelections",ht,ne);return}}',
].join("\n")

const patched = patch(fixture)
assert.equal(patch(patched), patched, "patch must be idempotent")
assert.match(patched, /defaults:ne=>\(G\(\)\[ne\]\?Mt\.modelSelections\[ne\]:void 0\)\?\?Pa\(ne\)\?\?ue\(\)\?\?Mi\(\)/)
assert.match(patched, /recent:Mt\.recentModels,preferred:ue\(\)\}\)/)
assert.match(patched, /pending:\/\.test\(ht\)\?Xi\.forget\(ht\):Xi\.pin\(ht\)/)
assert.throws(() => patch("function uF(e){}"), /anchor/)

const uF = new Function(`${patched.split("\n")[0]};return uF`)()
const fable = "fable", astra = "astra", pinned = "pinned", global = "global"
assert.equal(uF({ override: fable, preferred: astra, global }), fable)
assert.equal(uF({ mode: pinned, preferred: astra, global }), pinned)
assert.equal(uF({ preferred: astra, global }), astra)
assert.equal(uF({ session: "chat", override: fable, preferred: astra }), "chat")

// Last-selected agent (global-last-agent.mjs), Kilo 7.7.7 shapes including the Jev ordering patch.
const agentFixture = [
  'let Rv=t.onMessage(ne=>{if(ne.type!=="agentsLoaded")return;et((x=>x)(ne.agents)),He(ne.allAgents??ne.agents),qe(ne.defaultAgent);let Ge=1});',
  "let rn=Ce(()=>{let ne=o();return ne?Mt.agentSelections[ne]??De():nn()??De()});",
  "function kge(ne,Ge){let ht=Ge??o();if(ht){return}Nt(ne)}",
  "let It=Ge?Mt.agentSelections[Ge]:nn(),un=1;",
].join("\n")
const agentPatched = patchWebview(agentFixture)
assert.equal(patchWebview(agentPatched), agentPatched, "webview patch must be idempotent")
assert.match(agentPatched, /function kge\(ne,Ge\)\{t\.postMessage\(\{type:"persistLastSelectedAgent",agent:ne\}\),qe\(ne\);let ht/)
assert.match(agentPatched, /:nn\(\)\?\?De\(\),un=1/)
assert.match(agentPatched, /et\(\(x=>x\)\(ne\.agents\)\)/, "Jev ordering untouched")

const extFixture = 'let{visible,defaultAgent}=filterVisibleAgents(agents),message6={type:"agentsLoaded",agents:visible.map(mapAgent),allAgents:agents.map(mapAgent),defaultAgent};switch(x){case"t":break;case"persistVariant":{let stored2=1}}'
const extPatched = patchExtension(extFixture)
assert.equal(patchExtension(extPatched), extPatched, "extension patch must be idempotent")
const startAgent = (saved) => new Function("require", "filterVisibleAgents", "agents", "mapAgent", "x",
  `${extPatched};return message6.defaultAgent`)(
  (m) => ({ fs: { readFileSync: () => { if (saved === undefined) throw new Error("ENOENT"); return `${saved}\n` } }, os: { homedir: () => "/h" }, path: { join: (...p) => p.join("/") } })[m],
  () => ({ visible: [{ name: "Fable Engineering Lead" }, { name: "astra-engineering-lead" }], defaultAgent: "astra-engineering-lead" }),
  [], (a) => a, 0)
assert.equal(startAgent("Fable Engineering Lead"), "Fable Engineering Lead")
assert.equal(startAgent(undefined), "astra-engineering-lead")
assert.equal(startAgent("deleted-agent"), "astra-engineering-lead")

console.log("per-agent-model and global-last-agent patch checks passed")
