import assert from "node:assert/strict"
import { patch } from "./per-agent-model.mjs"

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

console.log("per-agent-model patch check passed")
