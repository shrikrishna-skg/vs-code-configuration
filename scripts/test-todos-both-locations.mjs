import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {patch,todoState} from '../examples/patches/todos-both-locations.mjs';

const variants = [
  {getter:'ZIn', store:'Mt', parts:'me', fallback:'Tnt', state:'ye', open:'D', set:'R', start:'sFn', end:'Lnt', original:'let ZIn=()=>{let ne=o();return ne?Mt.todos[ne]||[]:[]};let [D,R]=ye(!1),[F,z]=ye(),P=()=>{if(e.readonly)return;};'},
  {getter:'QY', store:'Qt', parts:'ge', fallback:'nbn', state:'ie', open:'I', set:'D', start:'N0a', end:'rbn', original:'let QY=()=>{let te=o();return te?Qt.todos[te]||[]:[]};let [I,D]=ie(!1),[R,$]=ie(),Q=()=>{if(e.readonly)return;};'},
];
const saved = [{content:'Inspect', status:'completed'}, {content:'Verify', status:'pending'}];
function check(variant, source, nativeHelpers = '') {
  let session = 'main', calls = 0;
  const data = {todos:{}, messages:{main:[{id:'m1'},{id:'m2'}]}, parts:{}, sessions:{}};
  const messages = data.messages.main;
  const part = (id, todos) => ({id, type:'tool', tool:'todowrite', state:{status:'completed', metadata:{todos}}});
  data.parts.m1 = [part('p1', [{content:'Older',status:'pending'}])];
  // The most recent part may live in Kilo's existing part cache, not the store.
  const partCache = {m2:[part('p2', saved)]};
  const context = {
    [variant.store]:data, o:()=>session, t:{currentSessionID:()=>session}, localStorage:{getItem:()=>null,setItem:()=>{}}, [variant.parts]:{peek:id=>partCache[id]},
    [variant.state]:(value)=>[()=>value, next=>{value=typeof next==='function'?next(value):next;}],
    [variant.fallback]:args=>{calls++;if(!args.messages.length)return [];assert.equal(args.messages,messages);assert.equal(args.parts('m2'),partCache.m2);return saved;},
  };
  const api = vm.runInNewContext(`globalThis.__kiloTodoState=${todoState.toString()};${nativeHelpers}${source};({todos:${variant.getter},open:${variant.open},toggle:()=>${variant.set}(x=>!x)})`,context);
  assert.equal(api.open(),false);api.toggle();assert.equal(api.open(),true);api.toggle();assert.equal(api.open(),false);
  assert.equal(api.todos(),saved,'Reopened chat recovers the most recent saved checklist');
  const live = [{content:'Live update',status:'pending'}];data.todos.main=live;
  assert.equal(api.todos(),live,'Live updates take priority over saved history');
  data.todos.main=[];assert.equal(api.todos(),data.todos.main,'An explicitly cleared live list must stay empty');
  delete data.todos.main;
  if (nativeHelpers) {
    data.sessions.main={revert:{messageID:'m2',partID:'p2'}};
    assert.equal(api.todos()[0].content,'Older','Reverted checklist updates must not reappear');
  }
  session='other'; assert.equal(api.todos().length,0,'Do not leak another chat’s checklist');
  session=undefined;assert.equal(api.todos().length,0);
  if (!nativeHelpers) assert.equal(calls,2);
}
for (const variant of variants) {
  const changed=patch(variant.original);
  assert.equal(patch(changed),changed);assert.equal(patch(changed,true),variant.original);
  assert.throws(()=>patch(variant.original+variant.original),/ambiguous/);
  assert.throws(()=>patch(variant.original.split(';let ')[0]),/anchor/);
  check(variant,changed);
}
assert.throws(()=>patch('unknown'),/Unsupported/);
for (const file of process.argv.slice(2)) {
  const source=fs.readFileSync(file,'utf8'), variant=variants.find(v=>source.includes(`let ${v.getter}=`));
  assert.equal(patch(source),source,'Installed patch missing');
  const getter=source.slice(source.indexOf(`let ${variant.getter}=`),source.indexOf(`let ${variant.getter}=`)+700).match(/^let \w+=\(\)=>\{[\s\S]*?:\[\]\}/)[0];
  const patchedHeader=patch(variant.original).slice(patch(variant.original).indexOf(';let ')+1);
  const helpers=source.slice(source.indexOf(`function ${variant.start}(`),source.indexOf(`function ${variant.end}(`));
  check(variant,getter+';'+patchedHeader,helpers);
  assert(source.includes(`[${variant.open},${variant.set}]=globalThis.__kiloTodoState(${variant.state},()=>t.currentSessionID())`));
  assert(source.includes('name:"todowrite"'),'Inline checklist renderer must remain installed');
}
console.log('To-do views passed: header starts collapsed, manual toggle, live priority, saved fallback, explicit clearing, session isolation, idempotence and restoration.');
