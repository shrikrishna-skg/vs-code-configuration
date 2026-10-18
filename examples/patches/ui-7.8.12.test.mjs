// Isolated 7.8.12 patch and behavior checks. Reads stock only; all patching is in memory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {patch as permissions} from './permission-modes.mjs';
import {patch as skim} from './skim-mode.mjs';
import {patch as pinned} from './pinned-append.mjs';
import {todoState,todoHeader} from './todos-both-locations.mjs';
const stock=new URL('../stock/extension/dist/',import.meta.url);
const names=['cto-selected-label','subagent-default-open','todos-both-locations','composer-orange-actions','composer-one-line','provider-save-message','chat-effort-isolation'];
let count=0;
const ok=label=>{count++;console.log('ok - '+label)};
for(const file of ['webview.js','agent-manager.js']){
  const original=fs.readFileSync(new URL(file,stock),'utf8');
  for(const name of names){
    const mod=await import('./'+name+'.mjs');
    const typed=['composer-orange-actions','composer-one-line'].includes(name);
    const apply=s=>typed?mod.patch(s,'js'):mod.patch(s);
    const restore=s=>mod.restore?mod.restore(s):typed?mod.patch(s,'js',true):mod.patch(s,true);
    const patched=apply(original);
    assert.notEqual(patched,original);new vm.Script(patched);
    assert.equal(apply(patched),patched);assert.equal(restore(patched),original);assert.equal(restore(original),original);
    assert.throws(()=>apply('unsupported'));assert.throws(()=>apply(original+original));
    ok(file+' '+name+' syntax/idempotence/exact restore/fail closed');
    if(name==='cto-selected-label'){
      const body=patched.match(/let A=\(\)=>\{let b=e.agents.find\(y=>y.name===e.value\);return \/\* cto-selected-label \*\/[\s\S]*?\}/)[0];
      const get=value=>vm.runInNewContext(body+';A()',{e:{agents:[{name:'Other'}],value},prt:()=> 'Other label',MJe:()=> 'Other label'});
      assert.equal(get('CTO (Recommended)'),'CTO');assert.equal(get('Other'),'Other label');assert.equal(get(''),'Code');
    }
    if(name==='subagent-default-open'){
      const body=patched.match(/function (?:GWn|kEn)\(e,t\)\{\/\* subagent-default-open:v1 \*\/return!0\}/)[0];
      const fn=vm.runInNewContext('('+body+')');for(const state of ['pending','running','completed','error'])assert.equal(fn(state,true),true);
    }
    if(name==='provider-save-message'){
      const name=file==='webview.js'?'dR':'TQ',start=patched.indexOf('function '+name+'(e)'),end=patched.indexOf('return{clear:a,send:r,dispose:i}}',start)+'return{clear:a,send:r,dispose:i}}'.length;
      const make=vm.runInNewContext('('+patched.slice(start,end)+')',{crypto:webcrypto});let receive,sent,error,connected=0;
      const client=make({onMessage(fn){receive=fn;return()=>{}},postMessage(message){sent=structuredClone(message)}});
      const id=client.send({providerID:'sample',config:new Proxy({variants:{high:new Proxy({reasoningEffort:'high'}, {})}}, {})},{onConnected(){connected++},onError(e){error=e}});
      assert.equal(sent.config.variants.high.reasoningEffort,'high');receive({type:'providerConnected',requestId:id});receive({type:'providerConnected',requestId:id});assert.equal(connected,1);assert.equal(error,undefined);
      let failures=0;const broken=make({onMessage(fn){receive=fn;return()=>{}},postMessage(){throw Error('failure')}});const bad=broken.send({providerID:'sample'},{onError(){failures++}});receive({type:'providerActionError',requestId:bad});assert.equal(failures,1);client.dispose();broken.dispose();
      ok(file+' provider proxy clone and callback cleanup behavior');
    }
    if(name==='chat-effort-isolation'){
      const name=file==='webview.js'?'fgt':'E_n',key=file==='webview.js'?'Pm':'F1',match=file==='webview.js'?'ph':'dA',end=file==='webview.js'?'var hgt=':'var B_n=';
      const start=patched.indexOf('function '+name+'(e)'),helper=patched.slice(start,patched.indexOf(end,start));
      const keyFn=(m,a,id)=>[m.modelID,a,id??'default'].join('/'),model={providerID:'p',modelID:'m'},writes=[],messages=[],remember=[];
      const make=vm.runInNewContext(helper+';'+name,{[key]:keyFn,[match]:(x,variants)=>variants.includes(x)?x:undefined});let listener;
      const ctrl=make({selected:()=>model,find:()=>({variants:{high:{}}}),session:()=> 'chat',agent:()=> 'agent',set:(...x)=>writes.push(x),post:x=>messages.push(x),draft:()=>true,remember:(...x)=>remember.push(x),listen:fn=>{listener=fn;return()=>{}}});
      ctrl.carry(model,'high','agent','chat');ctrl.select('high','chat');
      assert.deepEqual(writes.map(x=>x[0]),['m/agent/chat','m/agent/default','m/agent/chat','m/agent/default']);assert.equal(messages.length,4);assert.equal(remember.length,1);
      ctrl.load();listener({type:'variantsLoaded',variants:{'session/chat':'high'}});assert.equal(writes.at(-1)[0],'session/chat');const n=writes.length;ctrl.carry(model,'invalid','agent','chat');assert.equal(writes.length,n);
      ok(file+' per-chat and default effort persistence, reload, draft memory, invalid carry');
    }
  }
  const withPermission=permissions(original,file)+'\n/* clarify-goal-patch:v1 */',withSkim=skim(withPermission);
  assert.equal(skim(withSkim),withSkim);assert.equal(skim(withSkim,true),withPermission);new vm.Script(withSkim);
  assert.ok(original.includes('data-component="text-part"')||original.includes('data-component=text-part'));
  assert.ok(original.includes('data-component="markdown"')||original.includes('data-component=markdown'));
  if(file==='webview.js'){
    const withPin=pinned(withSkim);new vm.Script(withPin);assert.equal(pinned(withPin),withPin);assert.equal(pinned(withPin,true),withSkim);assert.ok(withPin.includes('.button(Ge,ci,Xe)'));assert.ok(withPin.includes('__kiloPin?.append(Ge)??Ge'));ok('webview pin send and permission-footer integration');
  }
}
for(const file of ['webview.css','agent-manager.css']){
  const original=fs.readFileSync(new URL(file,stock),'utf8');
  for(const name of ['composer-orange-actions','composer-one-line','composer-chevrons']){
    const {patch}=await import('./'+name+'.mjs'),base=name==='composer-chevrons'?permissions(original,file):original;
    const once=patch(base,'css');assert.equal(patch(once,'css'),once);assert.equal(patch(once,'css',true),base);assert.throws(()=>patch(once+once,'css'));assert.throws(()=>patch('body{}','css'));
    ok(file+' '+name+' CSS/idempotence/restore/fail closed');
  }
}
// Per-session expansion remains isolated and persists through a new state instance.
const saved=new Map();globalThis.localStorage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
const signal=initial=>{let value=initial;return[()=>value,next=>(value=typeof next==='function'?next(value):next)]};let session='a';
const [get,set]=todoState(signal,()=>session);assert.equal(get(),false);set(true);session='b';assert.equal(get(),false);session='a';assert.equal(get(),true);assert.equal(todoState(signal,()=>session)[0](),true);
// Native details header updates from reactive callbacks and emits only text, never HTML.
const element=tag=>({tag,dataset:{},style:{},children:[],append(...xs){this.children.push(...xs)},replaceChildren(...xs){this.children=xs},addEventListener(type,fn){this[type]=fn},removeEventListener(){}});
globalThis.document={createElement:element};globalThis.__kiloTodoState=todoState;const effects=[],cleanups=[];let todos=[{status:'in_progress',content:'<script>safe text</script>'}];
const header=todoHeader(signal,fn=>effects.push(fn),fn=>cleanups.push(fn),()=>session,()=>todos);effects.forEach(fn=>fn());assert.equal(header.hidden,false);assert.equal(header.open,true);assert.equal(header.children[1].children[0].textContent,'→ <script>safe text</script>');
header.open=false;header.toggle();assert.equal(get(),true);assert.equal(saved.get('kilo.todo.expanded.v2:a'),'false');todos=[];effects.forEach(fn=>fn());assert.equal(header.hidden,true);cleanups.forEach(fn=>fn());
ok('todo header text rendering, empty hiding, expansion storage and session isolation');
delete globalThis.document;delete globalThis.localStorage;delete globalThis.__kiloTodoState;
console.log('PASS '+count+' isolated UI checks');
