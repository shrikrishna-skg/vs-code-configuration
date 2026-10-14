// Disk-backed checks in fresh Node and Chromium processes; never restarts the user's VS Code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {todoState} from '../examples/patches/todos-both-locations.mjs';
const require=createRequire(import.meta.url);
const {createPermissionController}=require('../examples/patches/permission-modes.cjs');
if(process.argv[2]==='--child'){
 const file=process.argv[3],saved=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
 const storage={get:(k,d)=>saved[k]??d,update:async(k,v)=>{saved[k]=v;fs.writeFileSync(file,JSON.stringify(saved));}};
 const extension=fs.readFileSync(path.join(os.homedir(),'.vscode/extensions/shrikrishna-skg.kilo-code-local-7.8.2/dist/extension.js'),'utf8');
 const body=extension.slice(extension.indexOf('case"persistVariant":'),extension.indexOf('case"persistRecents":'));assert(body.includes('case"requestVariants":'));
 const handle=new (Object.getPrototypeOf(async function(){}).constructor)('message6','switch(message6.type){'+body+'}');let reply;const host={extensionContext:{globalState:storage},postMessage:m=>reply=m};
 const ctrl=createPermissionController({context:{subscriptions:[],workspaceState:storage},readActive:()=>true,onConfiguration:()=>({dispose(){}}),registerCommand:()=>({dispose(){}}),client:()=>({}),directories:()=>[],replyOnce:async(_,id,dir,guard)=>guard(),showError:m=>{throw Error(m)}});
 if(process.argv[4]==='write'){await ctrl.select('full','A');await ctrl.select('ask','B');for(const [key,value]of [['session/A/claude/opus','max'],['session/B/claude/opus','high']])await handle.call(host,{type:'persistVariant',key,value})}
 else{assert.equal(await ctrl.state('A'),'full');assert.equal(await ctrl.state('B'),'ask');for(const [sessionID,expected]of [['A',true],['B',false]])assert.equal(await ctrl.approve({properties:{id:'config-restart',sessionID,permission:'edit',metadata:{configProtected:true}}},'/repo'),expected);await handle.call(host,{type:'requestVariants'});assert.deepEqual(reply.variants,{'session/A/claude/opus':'max','session/B/claude/opus':'high'})}
 process.exit(0);
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kilo-restart-'));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Isolated persistence check</title>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 for(const mode of ['write','read']){
  const child=spawnSync(process.execPath,[import.meta.filename,'--child',path.join(temp,'state.json'),mode],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
 }
 const runtime=createRequire(path.join(os.homedir(),'.config/shared-computer/runtime/package.json'));
 const {chromium}=runtime('playwright');
 for(const mode of ['write','read']){
  const context=await chromium.launchPersistentContext(path.join(temp,'chrome'),{channel:'chrome',headless:true});
  try{
   const page=context.pages()[0]??await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
   await page.addScriptTag({content:`globalThis.todoState=${todoState.toString()};`});
   const result=await page.evaluate(mode=>{
    const signal=value=>[()=>value,next=>value=typeof next==='function'?next(value):next];let id='A';const [open,set]=todoState(signal,()=>id);
    if(mode==='write'){set(true);id='B';set(false)}
    id='A';const a=open();id='B';return {a,b:open()};
   },mode);
   assert.deepEqual(result,{a:true,b:false});
  }finally{await context.close()}
 }
 console.log('Restart checks passed: permissions and native effort persistence survive a fresh Node process; per-chat to-do state survives a full Chromium restart.');
}finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true})}
