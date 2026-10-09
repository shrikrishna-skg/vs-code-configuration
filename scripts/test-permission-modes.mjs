import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {patch,extensionAnchors,uiAnchors,css} from '../examples/patches/permission-modes.mjs';
const require=createRequire(import.meta.url);
const {createPermissionController}=require('../examples/patches/permission-modes.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(enabled=true){
  let configListener,fail=false,wait;const calls=[],subscriptions=[],errors=[];
  const event=(id,escape=false)=>({properties:{id,sessionID:'session',metadata:{sandboxEscalation:escape}}});
  const api={event,calls,errors,get enabled(){return enabled;},fail(){fail=true;},wait(value){wait=value;},
    external(value){enabled=value;configListener({affectsConfiguration:()=>true});}};
  api.ctrl=createPermissionController({context:{subscriptions},readActive:()=>enabled,
    async writeActive(value){if(wait)await wait.promise;if(fail)throw Error('disk full');enabled=value;configListener({affectsConfiguration:()=>true});},
    onConfiguration(fn){configListener=fn;return{dispose(){}};},registerCommand(){return{dispose(){}};},
    client:()=>({permission:{list:async()=>({data:[]})}}),directories:()=>[],resolve:()=>'/repo',retry:fn=>fn(),showError:message=>errors.push(message),
    async replyOnce(client,id,dir,guard){await flush();if(!guard())return false;calls.push({id,dir});return true;}});
  return api;
}
{
 const f=fixture();assert.equal(f.ctrl.mode(),'auto');
 assert.equal(await f.ctrl.approve(f.event('normal')),true);
 assert.equal(await f.ctrl.approve(f.event('escape',true)),false);
 await f.ctrl.select('full');assert.equal(f.ctrl.mode(),'full');
 assert.equal(await f.ctrl.approve(f.event('escape',true)),true);
 await f.ctrl.select('ask');assert.equal(f.enabled,false);assert.equal(await f.ctrl.approve(f.event('no')),false);
 await f.ctrl.toggle();assert.equal(f.ctrl.mode(),'auto');
 f.external(false);assert.equal(f.ctrl.mode(),'ask');f.external(true);assert.equal(f.ctrl.mode(),'auto');
 await f.ctrl.select('full');assert.equal(fixture(f.enabled).ctrl.mode(),'auto','Full access must not survive window reload');
 await assert.rejects(f.ctrl.select('everything'),/Unknown/);
 const a=f.ctrl.approve(f.event('duplicate')),b=f.ctrl.approve(f.event('duplicate'));assert.equal(await a,true);assert.equal(await b,true);
 assert.equal(f.calls.filter(x=>x.id==='duplicate').length,1,'Do not reply twice to duplicate events');
 const pending=f.ctrl.approve(f.event('race'));await f.ctrl.select('ask');assert.equal(await pending,false,'Ask cancels pending reply retries');
 const wait=deferred();f.wait(wait);const first=f.ctrl.select('full'),last=f.ctrl.select('ask');wait.resolve();await Promise.all([first,last]);assert.equal(f.ctrl.mode(),'ask','Latest selection wins');
 await f.ctrl.select('full');f.fail();await assert.rejects(f.ctrl.select('ask'),/paused/);assert.equal(f.ctrl.mode(),'ask','Persistence failure must fail closed');
}
// Exercise the exact extension adapters with the real controller and mocked VS Code.
{
 let enabled=true,onConfig,registered;const replies=[];
 const normal={id:'pending',sessionID:'s'},escape={id:'sandbox',sessionID:'s',metadata:{sandboxEscalation:true}};
 const sdk={permission:{list:async()=>({data:[normal,escape]})}};
 const space={getConfiguration:()=>({get:()=>enabled,inspect:()=>({}),update:async(_,value)=>{enabled=value;onConfig({affectsConfiguration:()=>true});}}),onDidChangeConfiguration:fn=>(onConfig=fn,{dispose(){}})};
 const ctx={require:createRequire(path.resolve('examples/patches/test-entry.cjs')),__dirname:path.resolve('examples/patches'),CONFIG2:'kilo-code.new.autoApprove',KEY6:'enabled',
  vscode84:{workspace:space,commands:{registerCommand:(name,fn)=>(registered=fn,{dispose(){}})},window:{showErrorMessage(){}}},
  readActive:()=>enabled,target4:()=>1,tryGetClient:()=>sdk,retry:fn=>fn(),replyOnce:async(client,id,dir,guard)=>{if(!guard())return false;replies.push({id,dir});return true;}};
 vm.runInNewContext(extensionAnchors.map(x=>x[1]).join(';'),ctx);
 const ctrl=ctx.registerToggleAutoApprove({subscriptions:[]},{getPermissionDirectory:()=>'/repo'},()=>'/repo',()=>['/repo']);
 const messages=[],pass=[];const bridge=ctx.createAutoApproveBridge(ctrl,m=>messages.push(m),m=>(pass.push(m),m));
 await bridge.handle({type:'webviewReady'});assert.equal(messages.at(-1).mode,'auto');
 await bridge.handle({type:'setPermissionMode',mode:'full',requestID:'1'});await flush();
 assert.equal(messages.at(-1).type,'permissionModeResult');assert.equal(messages.at(-1).mode,'full');
 assert.deepEqual(replies.map(x=>x.id),['pending','sandbox']);
 replies.length=0;await bridge.handle({type:'setPermissionMode',mode:'auto',requestID:'2'});await flush();assert.deepEqual(replies.map(x=>x.id),['pending']);
 await bridge.handle({type:'setPermissionMode',mode:'bad',requestID:'3'});assert.match(messages.at(-1).error,/Unknown/);
 await registered();assert.equal(ctrl.mode(),'ask');bridge.dispose();
 assert.equal(pass.length,1,'Unrelated messages continue to the native handler');
}
for(const [kind,source]of Object.entries({
 'extension.js':extensionAnchors.map(x=>x[0]).join(';'),
 ...Object.fromEntries(Object.entries(uiAnchors).map(([kind,a])=>[kind,a.before])),
 'webview.css':'.prompt-input-container{}', 'agent-manager.css':'.prompt-input-container{}',
})){
 const changed=patch(source,kind);assert.equal(patch(changed,kind),changed,kind+' idempotence');
 assert.equal(patch(changed,kind,true),source,kind+' surgical restoration');
 assert.throws(()=>patch('unknown',kind),/Unsupported|ambiguous/);
 if(kind.endsWith('.js'))assert.throws(()=>patch(source+source,kind),/ambiguous/);
}
assert.throws(()=>patch('.prompt-input-container{}\n'+css+css,'webview.css'),/ambiguous/);
console.log('Permission modes passed: native adapters, Ask/Auto/Full behavior, escalation distinction, pending approvals, race cancellation, deduplication, failed writes, external changes, window-only Full access, patch restoration and version guards.');

if(process.argv.includes('--ui')){
 const runtime=createRequire(path.join(os.homedir(),'.config/shared-computer/runtime/package.json'));
 const {chromium}=runtime('playwright');const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const name of ['webview','agent-manager']){
   const page=await browser.newPage({viewport:{width:1000,height:650}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const dist=path.join(os.homedir(),'.vscode/extensions/shrikrishna-skg.kilo-code-local-7.8.2/dist');
   const source=fs.readFileSync(path.join(dist,name+'.js'),'utf8');patch(source,name+'.js');
   await page.setContent('<style>:root{color-scheme:dark}body{background:#191a1a;color:#ddd;padding:30px;font:14px Arial}#composer{margin-top:440px;border:1px solid #007fd4;padding:14px;display:flex;justify-content:flex-end;gap:12px}.existing{margin-right:auto}</style><div id="composer"><span class="existing">CTO · GPT-6.1 Sol Ultrafast · High</span></div>');
   await page.addStyleTag({content:patch(fs.readFileSync(path.join(dist,name+'.css'),'utf8'),name+'.css')});
   await page.addScriptTag({path:path.resolve('examples/patches/permission-mode-ui.js')});
   await page.evaluate(()=>{
    window.messages=[];window.cleanup=[];window.handlers=[];
    window.emit=m=>window.handlers.forEach(fn=>fn(m));
    const port={onMessage(fn){window.handlers.push(fn);return()=>window.handlers.splice(window.handlers.indexOf(fn),1);},postMessage(m){window.messages.push(m);}};
    document.querySelector('#composer').append(window.__kiloPermissionMenu(port,fn=>window.cleanup.push(fn)));
    window.emit({type:'autoApproveState',active:true,mode:'auto'});
   });
   const trigger=page.getByRole('button',{name:'Permissions: Auto'});
   await trigger.click();const menu=page.getByRole('menu',{name:'Permissions'});await menu.waitFor();
   assert.equal(await page.getByRole('menuitemradio',{name:/Auto/}).getAttribute('aria-checked'),'true');
   await page.screenshot({path:path.join(os.tmpdir(),'kilo-permission-'+name+'.png')});
   await page.keyboard.press('End');assert.match(await page.locator(':focus').textContent(),/Full access/);await page.keyboard.press('Enter');
   assert.equal(await page.getByRole('button',{name:'Permissions: Auto'}).getAttribute('aria-busy'),'true');
   assert.equal(await menu.isVisible(),false);
   assert.equal(await page.evaluate(()=>window.messages.at(-1).mode),'full');
   await page.evaluate(()=>{const m=window.messages.at(-1);window.emit({type:'permissionModeResult',requestID:m.requestID,mode:'full'});});
   await page.getByRole('button',{name:'Permissions: Full access'}).click();await page.keyboard.press('Home');await page.keyboard.press('Enter');
   await page.evaluate(()=>{const m=window.messages.at(-1);window.emit({type:'permissionModeResult',requestID:'stale',mode:'auto'});window.emit({type:'permissionModeResult',requestID:m.requestID,mode:'full',error:'Test save failure'});});
   assert.equal(await page.getByRole('alert').textContent(),'Test save failure');
   const full=page.getByRole('button',{name:'Permissions: Full access'});await full.click();await page.keyboard.press('Escape');assert.equal(await full.getAttribute('aria-expanded'),'false');
   await page.setViewportSize({width:420,height:650});await full.click();const box=await menu.boundingBox();assert(box.x>=0&&box.x+box.width<=420,'Menu fits a narrow viewport');
   await page.mouse.click(3,3);assert.equal(await menu.isVisible(),false);
   await page.evaluate(()=>window.emit({type:'autoApproveState',active:false,mode:'ask'}));await page.getByRole('button',{name:'Permissions: Ask'}).waitFor();
   await page.emulateMedia({forcedColors:'active'});assert.equal(await page.getByRole('button',{name:'Permissions: Ask'}).evaluate(e=>getComputedStyle(e).borderTopStyle),'solid');
   await page.evaluate(()=>window.cleanup.forEach(fn=>fn()));assert.equal(await page.evaluate(()=>window.handlers.length),0);assert.equal(await page.getByRole('menu',{name:'Permissions'}).count(),0);
   assert.deepEqual(errors,[]);await page.close();console.log(name+': menu rendering, selection, request acknowledgements, errors, keyboard navigation, outside click, narrow viewport, forced colors and cleanup passed.');
  }
 }finally{await browser.close();}
}
