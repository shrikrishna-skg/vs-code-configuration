import assert from 'node:assert/strict';
import vm from 'node:vm';
import { patchLastPick } from './per-agent-model.mjs';

// Stock 7.8.12 model-pick function plus the variant helper options (webview.js names).
const qc = 'function Qc(ae,$e,gt){let Et=gt??s()??Qm;ws(()=>{if(No.select(ae,$e,Et),yt(Et)){let un={providerID:ae,modelID:$e},qn=Je(Et),Mr=jt.variantSelections[Pm(un,qn,Et)]??or(qn,un),Cn=Object.keys(r.findModel(un)?.variants??{});Po(qn,un,Mr===""?"":ph(Mr,Cn)??"")}})}';
const stock = 'function Rbe(e,t,n,r){return Omt(e)}' + qc + ';Bi=fgt({find:r.findModel,draft:yt,remember:Po});';

const patched = patchLastPick(stock);
assert.equal(patchLastPick(patched), patched, 'idempotent');
assert.throws(() => patchLastPick(stock.replace('draft:yt', 'draft:zz')), /unsupported/, 'fail-closed');
assert.match(patched, /draft:\(\)=>!0,remember:Po/, 'variant picks in existing chats are remembered');

function pick(source, sessionID) {
  const remembered = [];
  const scope = {
    s: () => null, Qm: 'composer', ws: fn => fn(), No: { select() {} },
    yt: id => id === 'composer' || /^(?:sidebar-)?pending:/.test(id),
    Je: () => 'CTO + SUBQ', jt: { variantSelections: {} }, Pm: () => 'k', or: () => 'high',
    r: { findModel: () => ({ variants: { high: {} } }) }, ph: v => v,
    Po: (...args) => remembered.push(args),
  };
  vm.createContext(scope);
  vm.runInContext(source.slice(source.indexOf('function Qc('), source.indexOf(';Bi=')), scope);
  scope.Qc('lithosai', 'deepseek-ai/DeepSeek-V4.1-Flash-ultra-chat', sessionID);
  return remembered;
}
assert.equal(pick(stock, 'ses_existing').length, 0, 'stock bug: existing-chat pick is not remembered');
assert.equal(JSON.stringify(pick(patched, 'ses_existing')), JSON.stringify([['CTO + SUBQ', { providerID: 'lithosai', modelID: 'deepseek-ai/DeepSeek-V4.1-Flash-ultra-chat' }, 'high']]));
assert.equal(pick(patched, 'pending:new').length, 1, 'draft picks are still remembered');
console.log('PASS: last explicit model/variant pick (draft or existing chat) is remembered for new chats; idempotent; fail-closed.');
