#!/usr/bin/env node
// Provider forms contain Solid store proxies; the native webview bridge requires plain JSON.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const original='function r(o,s={}){let l=crypto.randomUUID();return t.set(l,s),e.postMessage({...o,requestId:l}),l}';
const replacement='function r(o,s={}){/* kilo-provider-save-message:v1 */let l=crypto.randomUUID();t.set(l,s);try{e.postMessage(JSON.parse(JSON.stringify({...o,requestId:l})))}catch{t.delete(l);s.onError?.({type:"providerActionError",requestId:l,providerID:o.providerID,message:"Unable to send provider request. Please reopen settings and try again."})}return l}';
const contexts=['JD','dR','TQ'].map(name=>'function '+name+'(e){let t=new Map,n=e.onMessage(o=>{');
const count=(s,a)=>s.split(a).length-1;
export function patch(source,restore=false){
  const matches=contexts.filter(context=>count(source,context)===1);
  if(matches.length!==1)throw Error('Unsupported provider request helper; no changes made.');
  const start=source.indexOf(matches[0]),end=source.indexOf('return{clear:a,send:r,dispose:i}}',start)+'return{clear:a,send:r,dispose:i}}'.length,helper=source.slice(start,end);
  if(end<=start||!helper.includes('o.type==="providerActionError"')||count(helper,original)+count(helper,replacement)!==1) throw Error('Unsupported provider request helper; no changes made.');
  const next=restore?helper.replace(replacement,original):helper.replace(original,replacement);
  return source.slice(0,start)+next+source.slice(end);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [target,mode='--apply',...extra]=process.argv.slice(2);
  if(!target||extra.length||!['--apply','--check','--restore'].includes(mode))throw Error('Usage: provider-save-message.mjs <webview.js> [--apply|--check|--restore]');
  const source=fs.readFileSync(target,'utf8'),next=patch(source,mode==='--restore');
  if(mode==='--check'){
    if(source!==next)throw Error('Provider message patch missing.');
    console.log('Provider message patch verified.');
  }else if(source!==next){
    const temp=target+`.provider-save-${process.pid}.js`;
    try{
      fs.writeFileSync(temp,next,{flag:'wx',mode:fs.statSync(target).mode&0o777});
      const check=spawnSync(process.execPath,['--check',temp],{encoding:'utf8'});
      if(check.status!==0)throw Error(check.stderr||'Syntax check failed.');
      if(fs.readFileSync(target,'utf8')!==source)throw Error('Bundle changed while patching.');
      const backup=target+'.pre-provider-save-message';
      if(mode==='--apply'&&!fs.existsSync(backup))fs.copyFileSync(target,backup,fs.constants.COPYFILE_EXCL);
      fs.renameSync(temp,target);
    }finally{if(fs.existsSync(temp))fs.unlinkSync(temp)}
    console.log('Provider message patch applied. Reload the VS Code window.');
  }else console.log('No changes needed.');
}
