import assert from "node:assert/strict"
import { patchCss, patchWebview } from "../examples/patches/active-tasks-history.mjs"

const webview = [
  "function history(e,t,n){let p=xe(()=>{let k=e.sessionIds?.();return k?t.sessions().filter(w=>k.has(w.id)):t.sessions()});$n({",
  "groupBy:C=>n.t(OQa(C.updatedAt)),sortGroupsBy:(C,_)=>{let I=Object.fromEntries(_R.map((T,L)=>[n.t(T),L]));return(I[C.category]??99)-(I[_.category]??99)},",
  "children:C=>[(()=>{var _=$Qa();return Q(_,()=>P0(C.updatedAt)),_})(),E(ue,{get when(){return t.currentSessionID()===C.id},get children(){return null}})]})}",
].join("\n")
const patchedWebview = patchWebview(webview)
assert.notEqual(patchedWebview, webview)
assert.match(patchedWebview, /groupBy:C=>q\(C\)\?"Active tasks"/)
assert.match(patchedWebview, /data-activity/)
assert.equal(patchWebview(patchedWebview), patchedWebview, "webview patch must be idempotent")
assert.throws(() => patchWebview(webview.replace("p=xe(()=>", "p=xe(function(){")), /activity predicate anchor/)

const stylesheet = ".session-list{display:flex}"
const patchedStylesheet = patchCss(stylesheet)
assert.notEqual(patchedStylesheet, stylesheet)
assert.match(patchedStylesheet, /kilo-active-tasks-history/)
assert.match(patchedStylesheet, /prefers-reduced-motion/)
assert.equal(patchCss(patchedStylesheet), patchedStylesheet, "CSS patch must be idempotent")
assert.throws(() => patchCss("body{}"), /session-list CSS anchor/)

console.log("active-tasks-history checks passed")
