#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function patch(source){
  const functions=[...source.matchAll(/function (Rnt|abn)\(e\)\{[\s\S]*?(?=function (?:Fnt|ibn)\()/g)];
  if(functions.length!==1)throw Error('Unsupported or ambiguous chat effort helper.');
  const before=functions[0][0];if(before.includes('/* chat-effort-isolation:v1 */'))return source;
  const key=functions[0][1]==='Rnt'?'dm':'Hg';
  let next=before.replace('let t=m=>','/* chat-effort-isolation:v1 */let t=m=>');
  const select=/select:\(m,g\)=>\{[\s\S]*?\},load:/;
  if(!select.test(next))throw Error('Chat effort selection anchor missing.');
  next=next.replace(select,`select:(m,g)=>{let f=g??e.session(),h=e.selected(f);if(!f||!h)return;let key=${key}(h,e.agent(f),f),value=m??"";e.set(key,value),e.post({type:"persistVariant",key,value})},load:`);
  const load='f.startsWith("session/")||e.set(f,h)';
  if(!next.includes(load))throw Error('Chat effort restoration anchor missing.');
  next=next.replace(load,'e.set(f,h)');
  if(!next.includes('h||e.post('))throw Error('Chat effort carry anchor missing.');
  next=next.replace('h||e.post(','e.post(');
  return source.replace(before,next);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [target,flag='--apply']=process.argv.slice(2);if(!target||!['--apply','--check'].includes(flag))throw Error('Usage: chat-effort-isolation.mjs <bundle.js> [--apply|--check]');
 const before=fs.readFileSync(target,'utf8'),after=patch(before);
 if(flag==='--check'){if(after!==before)throw Error('Chat effort isolation is not installed.');}
 else if(before!==after){
  const tmp=target+'.chat-effort-'+process.pid;
  try{fs.writeFileSync(tmp,after,{flag:'wx',mode:fs.statSync(target).mode&0o777});if(fs.readFileSync(target,'utf8')!==before)throw Error('Bundle changed during patching.');fs.renameSync(tmp,target);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
 }
 console.log('Chat effort isolation '+flag+': '+path.basename(target));
}
