#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Script} from 'node:vm';

const helper=/function (Rnt|abn)\(e\)\{[\s\S]*?(?=function (?:Fnt|ibn)\()/g;

// 7.8.12 keeps draft choices but drops persisted session choices on reload.
const stableHelpers = [
  {name:'fgt', key:'Pm', match:'ph', global:'gZ', utility:'Fbe', agentUtility:'Hmt', store:'jt', end:'var hgt='},
  {name:'E_n', key:'F1', match:'dA', global:'Ofe', utility:'JWe', agentUtility:'n_n', store:'Vt', end:'var B_n='},
];
function stablePatch(source, undo=false) {
  const specs=stableHelpers.filter(v=>source.includes('function '+v.name+'(e){'));
  if(!specs.length)return null;
  if(specs.length!==1||source.split('function '+specs[0].name+'(e){').length!==2)throw Error('Ambiguous chat effort helper.');
  const v=specs[0],start=source.indexOf('function '+v.name+'(e){'),end=source.indexOf(v.end,start);
  if(end<start)throw Error('Unsupported chat effort boundary.');
  let body=source.slice(start,end);
  const preferred='k=p=>{let m=e.preferred?.();if(m?.providerID===p.providerID&&m.modelID===p.modelID)return m.variant??""},';
  const pairs=[
    ['r=(p,m)=>{',preferred+'r=(p,m)=>{'],
    [`return ${v.agentUtility}(e.selections(),m,e.find(m),p,n(p,m))`,`return ${v.agentUtility}(e.selections(),m,e.find(m),p,n(p,m),k(m))`],
    [`return ${v.utility}(e.selections(),g,f,h,m,n(h,g))`,`return ${v.utility}(e.selections(),g,f,h,m,n(h,g),k(g))`],
    [`A!==void 0&&e.set(${v.key}(p,g,f),A)`,`/* chat-effort-isolation:v3 */if(A!==void 0){let key=${v.key}(p,g,f),dkey=${v.key}(p,g);e.set(key,A),e.post({type:"persistVariant",key,value:A}),e.set(dkey,A),e.post({type:"persistVariant",key:dkey,value:A})}`],
    [`let h=p??"";e.set(${v.key}(f,e.agent(g),g),h),e.draft(g)&&e.remember(e.agent(g),f,h)`,`let h=p??"",key=${v.key}(f,e.agent(g),g),dkey=${v.key}(f,e.agent(g));e.set(key,h),e.post({type:"persistVariant",key,value:h}),e.set(dkey,h),e.post({type:"persistVariant",key:dkey,value:h}),e.draft(g)&&e.remember(e.agent(g),f,h)`],
    [`return h&&Object.keys(e.find(p)?.variants??{}).includes(h)?h:e.selections()[${v.key}(p,m)]??e.selections()[${v.global}(p)]`, `return k(p)??e.selections()[${v.key}(p,m)]??e.selections()[${v.global}(p)]??(h&&Object.keys(e.find(p)?.variants??{}).includes(h)?h:void 0)`],
    ['g.startsWith("session/")||e.set(g,f)','/* chat-effort-load:v3 */e.set(g,f)'],
  ];
  for(const [before,after] of pairs){
    if(body.replace(after,'').split(before).length+body.split(after).length-2!==1)throw Error('Unsupported or ambiguous 7.8.12 effort anchor.');
    body=body.replace(body.includes(after)?after:before,undo?before:after);
  }
  let result=source.slice(0,start)+body+source.slice(end);
  const stock=`l=o??s??e[${v.key}(t,r)]??e[${v.global}(t)]`,patched=`l=/* chat-effort-priority:v3 */o??p??e[${v.key}(t,r)]??e[${v.global}(t)]??s`;
  if(result.split(stock).length+result.split(patched).length-2!==1)throw Error('Unsupported effort precedence anchor.');
  result=result.replace(undo?patched:stock,undo?stock:patched);
  const context=`=${v.name}({selections:()=>${v.store}.variantSelections,`;
  const extra=[
    [`function ${v.utility}(e,t,n,r,a,i){`,`function ${v.utility}(e,t,n,r,a,i,p){`],
    [`function ${v.agentUtility}(e,t,n,r,a){if(n?.variants)return ${v.utility}(e,t,Object.keys(n.variants),r,void 0,a)}`,`function ${v.agentUtility}(e,t,n,r,a,i){if(n?.variants)return ${v.utility}(e,t,Object.keys(n.variants),r,void 0,a,i)}`],
    [context,context+`preferred:()=>${v.store}.sessionOverrides.__kiloPreferred,`],
  ];
  for(const [before,after] of extra){
    // The context prefix remains inside its replacement, so compare after stripping it.
    const bare=result.replace(after,'');
    if(bare.split(before).length-1+(result.split(after).length-1)!==1)throw Error('Unsupported or ambiguous preferred effort context.');
    result=result.replace(result.includes(after)?after:before,undo?before:after);
  }
  new Script(result);return result;
}

// v2: keep the per-session key (isolation) AND record the same value as the
// default for new chats with that model+agent, via the legacy no-session key
// `dm(model,agent)` (webview) / `Hg(model,agent)` (agent-manager). The extension
// stores that key in the variantSelections map, so the existing `saved` chain
// (session key -> preferred -> legacy key -> global key -> agent config) picks it
// up for a new chat. select is a fresh user pick; carry carries that pick onto a
// newly selected model+agent, so it represents the same user choice.
export function patch(source){
  const stable=stablePatch(source);if(stable!==null)return stable;
  const functions=[...source.matchAll(helper)];
  if(functions.length!==1)throw Error('Unsupported or ambiguous chat effort helper.');
  const before=functions[0][0];
  const key=functions[0][1]==='Rnt'?'dm':'Hg';
  const matchVariant=functions[0][1]==='Rnt'?'Mf':'Eb';
  if(before.includes('/* chat-effort-isolation:v2 */')){
    // Repair early v2 installs that duplicated declarations during replacement.
    const repaired=before
      .replace(/carry:\(m,g,f,h\)=>\{[\s\S]*?\},list:/,`carry:(m,g,f,h)=>{let b=Object.keys(e.find(m)?.variants??{});if(b.length===0)return;let A=g===""?"":${matchVariant}(g,b);if(A===void 0)return;let y=${key}(m,f,h),z=${key}(m,f);e.set(y,A),e.post({type:"persistVariant",key:y,value:A}),e.set(z,A),e.post({type:"persistVariant",key:z,value:A})},list:`)
      .replace(/select:\(m,g\)=>\{[\s\S]*?\},load:/,`select:(m,g)=>{let f=g??e.session(),h=e.selected(f);if(!f||!h)return;let key=${key}(h,e.agent(f),f),value=m??"",a=e.agent(f),dkey=${key}(h,a);e.set(key,value),e.post({type:"persistVariant",key,value}),e.set(dkey,value),e.post({type:"persistVariant",key:dkey,value})},load:`);
    const result=source.replace(before,repaired);new Script(result);return result;
  }
  let next;
  if(before.includes('/* chat-effort-isolation:v1 */')){
    next=before.replace('/* chat-effort-isolation:v1 */','/* chat-effort-isolation:v2 */');
  }else{
    next=before.replace('let t=m=>','/* chat-effort-isolation:v2 */let t=m=>');
    const select=/select:\(m,g\)=>\{[\s\S]*?\},load:/;
    if(!select.test(next))throw Error('Chat effort selection anchor missing.');
    next=next.replace(select,`select:(m,g)=>{let f=g??e.session(),h=e.selected(f);if(!f||!h)return;let key=${key}(h,e.agent(f),f),value=m??"";e.set(key,value),e.post({type:"persistVariant",key,value})},load:`);
    const load='f.startsWith("session/")||e.set(f,h)';
    if(!next.includes(load))throw Error('Chat effort restoration anchor missing.');
    next=next.replace(load,'e.set(f,h)');
    if(!next.includes('h||e.post('))throw Error('Chat effort carry anchor missing.');
    next=next.replace('h||e.post(','e.post(');
  }
  // select: add the legacy model+agent default alongside the session key.
  const sel=/\blet key=(\w+)\(h,e\.agent\(f\),f\),value=m\?\?"";e\.set\(key,value\),e\.post\(\{type:"persistVariant",key,value\}\)/;
  if(!sel.test(next))throw Error('Chat effort selection anchor missing.');
  next=next.replace(sel,(all,k)=>`let key=${k}(h,e.agent(f),f),value=m??"",a=e.agent(f),dkey=${k}(h,a);e.set(key,value),e.post({type:"persistVariant",key,value}),e.set(dkey,value),e.post({type:"persistVariant",key:dkey,value})`);
  // carry: add the legacy model+agent default alongside the session key.
  const carry=/\blet y=(\w+)\(m,f,h\);e\.set\(y,(\w)\),e\.post\(\{type:"persistVariant",key:y,value:\2\}\)/;
  if(!carry.test(next))throw Error('Chat effort carry anchor missing.');
  next=next.replace(carry,(all,k,v)=>`let y=${k}(m,f,h),z=${k}(m,f);e.set(y,${v}),e.post({type:"persistVariant",key:y,value:${v}}),e.set(z,${v}),e.post({type:"persistVariant",key:z,value:${v}})`);
  const result=source.replace(before,next);new Script(result);return result;
}

// Reverse v2 back to the pre-patch (v1) text: the v2 additions are the legacy
// model+agent default writes in select and carry. A fresh (pre-v1) bundle cannot
// be reconstructed and is left unchanged.
export function restore(source){
  const stable=stablePatch(source,true);if(stable!==null)return stable;
  const functions=[...source.matchAll(helper)];
  if(functions.length!==1)throw Error('Unsupported or ambiguous chat effort helper.');
  const before=functions[0][0];
  if(!before.includes('/* chat-effort-isolation:v2 */'))return source;
  let next=before.replace('/* chat-effort-isolation:v2 */','/* chat-effort-isolation:v1 */');
  const sel=/let key=(\w+)\(h,e\.agent\(f\),f\),value=m\?\?"",a=e\.agent\(f\),dkey=\w+\(h,a\);e\.set\(key,value\),e\.post\(\{type:"persistVariant",key,value\}\),e\.set\(dkey,value\),e\.post\(\{type:"persistVariant",key:dkey,value\}\)/;
  if(!sel.test(next))throw Error('Chat effort v2 selection anchor missing.');
  next=next.replace(sel,(all,k)=>`let key=${k}(h,e.agent(f),f),value=m??"";e.set(key,value),e.post({type:"persistVariant",key,value})`);
  const carry=/let y=(\w+)\(m,f,h\),z=\w+\(m,f\);e\.set\(y,(\w)\),e\.post\(\{type:"persistVariant",key:y,value:\2\}\),e\.set\(z,\2\),e\.post\(\{type:"persistVariant",key:z,value:\2\}\)/;
  if(!carry.test(next))throw Error('Chat effort v2 carry anchor missing.');
  next=next.replace(carry,(all,k,v)=>`let y=${k}(m,f,h);e.set(y,${v}),e.post({type:"persistVariant",key:y,value:${v}})`);
  return source.replace(before,next);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [target,flag='--apply']=process.argv.slice(2);
 if(!target||!['--apply','--check','--restore'].includes(flag))throw Error('Usage: chat-effort-isolation.mjs <bundle.js> [--apply|--check|--restore]');
 const before=fs.readFileSync(target,'utf8');
 if(flag==='--check'){if(patch(before)!==before)throw Error('Chat effort isolation is not installed.');}
 else{
  const after=flag==='--restore'?restore(before):patch(before);
  if(before!==after){
   const tmp=target+'.chat-effort-'+process.pid;
   try{fs.writeFileSync(tmp,after,{flag:'wx',mode:fs.statSync(target).mode&0o777});if(fs.readFileSync(target,'utf8')!==before)throw Error('Bundle changed during patching.');fs.renameSync(tmp,target);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  }
 }
 console.log('Chat effort isolation '+flag+': '+path.basename(target));
}