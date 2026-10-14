import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';
import {patch as effortPatch} from '../examples/patches/chat-effort-isolation.mjs';
import {patch as todoPatch,todoState} from '../examples/patches/todos-both-locations.mjs';
import {patch as permissionPatch} from '../examples/patches/permission-modes.mjs';
import {patch as scrollPatch} from '../examples/patches/chat-scroll-stability.mjs';
const dist=os.homedir()+'/.vscode/extensions/shrikrishna-skg.kilo-code-local-7.8.2/dist/';
const signal=initial=>{let value=initial;return [()=>value,next=>(value=typeof next==='function'?next(value):next)]};
const storage=new Map();let sid='A';
const originalStorage=globalThis.localStorage;
globalThis.localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};
try{
 const [open,setOpen]=todoState(signal,()=>sid);
 assert.equal(open(),false);setOpen(true);assert.equal(open(),true);
 sid='B';assert.equal(open(),false);setOpen(true);setOpen(false);
 sid='A';assert.equal(open(),true);assert.equal(todoState(signal,()=>sid)[0](),true);
 sid='B';assert.equal(todoState(signal,()=>sid)[0](),false);
}finally{if(originalStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=originalStorage;}
for(const name of ['webview','agent-manager']){
 const source=fs.readFileSync(dist+name+'.js','utf8');const patched=effortPatch(source);
 assert.equal(effortPatch(patched),patched);const todos=todoPatch(patched);assert.equal(todoPatch(todos),todos);const composed=permissionPatch(todos,name+'.js');assert.equal(todoPatch(composed),composed);assert.equal(permissionPatch(composed,name+'.js'),composed);
 const fn=patched.match(/function (Rnt|abn)\(e\)\{[\s\S]*?(?=function (?:Fnt|ibn)\()/)[0];
 const main=name==='webview';const helperNames=main?['Rnt','dm','TV','k0e','fnt','Mf']:['abn','Hg','Hme','gGe','z0n','Eb'];
 const [factory,keyName,modelName,currentName,agentName,validName]=helperNames;
 // Execute the installed selection resolver, plus its native key and variant helpers.
 const helpers=helperNames.slice(1).map(n=>source.slice(source.indexOf('function '+n+'('),source.indexOf('function ',source.indexOf('function '+n+'(')+9))).join('\n');
 const create=vm.runInNewContext(helpers+'\n'+fn+'\n'+factory);
 let chat='A',values={},persisted={},listener;const model={providerID:'local',modelID:'claude'},messages=[];
 const api={session:()=>chat,selected:()=>model,agent:()=> 'code',config:()=>({}),find:()=>({variants:{high:{},xhigh:{},max:{},ultracode:{}}}),selections:()=>values,preferred:()=>({...model,variant:'high'}),set:(k,v)=>values[k]=v,post:m=>{messages.push(m);if(m.type==='persistVariant')persisted[m.key]=m.value},listen:fn=>(listener=fn,()=>{}),remember:()=>{throw Error('Must not change shared preferences')}};
 const control=create(api);control.load();control.select('max');assert.equal(control.current(),'max');
 chat='B';assert.equal(control.current(),'high');control.select('xhigh');assert.equal(control.current(),'xhigh');chat='A';assert.equal(control.current(),'max');
 chat='pending:draft';control.select('ultracode');assert.equal(control.current(),'ultracode');control.carry(model,control.current(),'code','created');chat='created';assert.equal(control.current(),'ultracode');
 values={};listener({type:'variantsLoaded',variants:persisted});chat='A';assert.equal(control.current(),'max');chat='B';assert.equal(control.current(),'xhigh');chat='created';assert.equal(control.current(),'ultracode');
 assert(messages.filter(m=>m.type==='persistVariant').every(m=>m.key.startsWith('session/')));
 console.log(name+': per-chat effort, draft promotion, restored selections, default-closed persisted to-dos and idempotent patches pass');
}
let source=fs.readFileSync(dist+'webview.js','utf8'),patched=scrollPatch(source);assert.equal(scrollPatch(patched),patched);
const native=fs.readFileSync(dist+'webview.js.pre-smooth-follow','utf8');assert(!native.includes('__kiloGlide'));const recovered=scrollPatch(native);assert.equal(scrollPatch(recovered),recovered);new vm.Script(recovered);assert(recovered.includes('ready:()=>!t.loading()&&!qe()'));console.log('update recovery: pristine native scroll code is restored without relying on previous patch markers');
let now=1000,frames=new Map(),frameID=0;
const ctx={performance:{now:()=>now},requestAnimationFrame:fn=>(frames.set(++frameID,fn),frameID),cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>({matches:false}),document:{hidden:false}};
vm.createContext(ctx);vm.runInContext(patched.slice(patched.indexOf('/*kilo-glide:v1*/'),patched.indexOf('var Jia=300')),ctx);
const el={scrollHeight:6000,clientHeight:800,scrollTop:0,addEventListener(){}};const glide=ctx.__kiloGlide(el);
glide.to(true,'A');assert.equal(el.scrollTop,6000);now+=2000;el.scrollHeight+=60;glide.to(true,'A');assert(frames.size>0);
// Same DOM element, short new chat: cancel the old chat's queued animation immediately.
el.scrollHeight=1300;el.scrollTop=0;glide.to(true,'B');assert.equal(frames.size,0);assert.equal(el.scrollTop,1300);
el.scrollHeight+=40;now+=80;glide.to(true,'B');assert.equal(frames.size,0);assert.equal(el.scrollTop,1340);
// Exercise the real autoscroller: layout callbacks cannot move content before restoration.
const start=patched.indexOf('function ik('),end=patched.indexOf('var Xia=',start);let effects=[],resizes=[],ready=false,working=true,session='A';
Object.assign(ctx,{yi:v=>[v,(k,x)=>v[k]=x],Xe:fn=>effects.push(fn),Gn:(f,cb)=>()=>cb(f()),f9:(get,fn)=>resizes.push(fn),nt:()=>{},gun:()=>({reset(){},clear(){},consumeScroll:()=>false,isRecent:()=>false,isDragging:()=>false,listen:()=>()=>{}}),ET:()=>true,e_:e=>e.scrollHeight-e.clientHeight-e.scrollTop,Jia:300,setTimeout:()=>0,clearTimeout(){}});
vm.runInContext(patched.slice(start,end),ctx);
const scroller=ctx.ik({working:()=>working,session:()=>session,ready:()=>ready});el.style={};el.scrollTop=12;el.scrollHeight=2000;scroller.scrollRef(el);resizes.forEach(fn=>fn());assert.equal(el.scrollTop,12,'No pre-restoration bottom jump');
scroller.forceScrollToBottom();assert.equal(el.scrollTop,2000,'Restoration can explicitly place the scroll');ready=true;el.scrollTop=0;working=false;resizes.forEach(fn=>fn());assert.equal(el.scrollTop,2000);
console.log('scroll: old animation cancelled on same-element chat switch, initial layout waits for restoration, force placement and idle snap pass');
