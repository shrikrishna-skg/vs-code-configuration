import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {patch,extensionAnchors,uiAnchors,css,promotionAnchor} from '../examples/patches/permission-modes.mjs';
const require=createRequire(import.meta.url);
const {createPermissionController,createPermissionBridge}=require('../examples/patches/permission-modes.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(saved={}){
 let enabled=true,fail=false,listener;const calls=[],errors=[],requests=[],storage={...saved};
 const sdk={session:{get:async({sessionID})=>({data:{parentID:sessionID==='childA'?'A':undefined}})},permission:{list:async()=>({data:requests.slice()})}};
 const context={subscriptions:[],workspaceState:{get:()=>storage.modes,update:async(_,m)=>{if(fail)throw Error('disk full');storage.modes=structuredClone(m);}}};
 const ctrl=createPermissionController({context,readActive:()=>enabled,writeActive:()=>{throw Error('A chat must never change the window setting');},onConfiguration:fn=>(listener=fn,{dispose(){}}),registerCommand:()=>({dispose(){}}),client:()=>sdk,directories:()=>['/repo'],resolve:()=>'/repo',retry:fn=>fn(),showError:e=>errors.push(e),replyOnce:async(_,id,dir,guard)=>{await flush();if(!guard())return false;calls.push(id);const index=requests.findIndex(p=>p.id===id);if(index>=0)requests.splice(index,1);return true;}});
 return{ctrl,storage,calls,requests,fail:()=>fail=true,event:(sessionID,id,extra={})=>({properties:{sessionID,id,...extra}}),external:value=>{enabled=value;listener({affectsConfiguration:()=>true});}};
}
{
 const f=fixture({modes:{A:'full',B:'ask',C:'auto'}});
 for(const [sessionID,id]of [['A','config-restored'],['B','other-chat'],['C','auto-config']])f.requests.push({sessionID,id,permission:'edit',metadata:{configProtected:true}});
 await Promise.all([f.ctrl.state('A'),f.ctrl.state('A')]);
 assert.deepEqual(f.calls,['config-restored'],'Reopening a saved Full access chat drains its existing request once');
 await f.ctrl.state('B');await f.ctrl.state('C');assert.deepEqual(f.calls,['config-restored'],'Other chat modes still govern their own pending requests');
}
{
 const f=fixture();await f.ctrl.state('A');await f.ctrl.state('B');
 await f.ctrl.select('full','A');await f.ctrl.select('ask','B');
 assert.equal(f.ctrl.mode('A'),'full');assert.equal(f.ctrl.mode('B'),'ask');
 assert.equal(await f.ctrl.approve(f.event('A','a')),true);assert.equal(await f.ctrl.approve(f.event('B','b')),false);
 assert.equal(await f.ctrl.approve(f.event('childA','child')),true,'Unconfigured children inherit only their own parent');
 await f.ctrl.select('ask','A');assert.equal(await f.ctrl.approve(f.event('childA','child-ask')),false);
 await f.ctrl.select('full','A');
 for(const metadata of [{sandboxEscalation:true},{skillShell:true}])assert.equal(await f.ctrl.approve(f.event('A','protected',{metadata})),false);
 for(const permission of ['external_directory','edit','bash'])assert.equal(await f.ctrl.approve(f.event('A','config-'+permission,{permission,metadata:{configProtected:true,disableAlways:true}})),true,'Full access includes protected config requests');
 assert.equal(await f.ctrl.approve(f.event('A','escape',{permission:'sandbox_escalation'})),false);
 assert.equal(await f.ctrl.approve(f.event('A','outside',{permission:'external_directory'})),true);
 await f.ctrl.select('auto','A');assert.equal(await f.ctrl.approve(f.event('A','outside-auto',{permission:'external_directory'})),false);
 assert.equal(await f.ctrl.approve(f.event('A','config-auto',{permission:'edit',metadata:{configProtected:true}})),false,'Auto still asks before config edits');
 const duplicate=f.ctrl.approve(f.event('A','duplicate')),same=f.ctrl.approve(f.event('A','duplicate'));assert.equal(await duplicate,true);assert.equal(await same,true);assert.equal(f.calls.filter(x=>x==='duplicate').length,1);
 const pending=f.ctrl.approve(f.event('A','cancel'));await f.ctrl.select('ask','A');assert.equal(await pending,false);
 await f.ctrl.select('auto','A');const unaffected=f.ctrl.approve(f.event('A','unaffected'));await f.ctrl.select('full','B');assert.equal(await unaffected,true,'Other chats do not cancel this chat approval');
 await Promise.all([f.ctrl.select('full','A'),f.ctrl.select('auto','B')]);assert.equal(f.ctrl.mode('A'),'full');assert.equal(f.ctrl.mode('B'),'auto');
 f.external(false);assert.equal(f.ctrl.mode('A'),'full');assert.equal(f.ctrl.mode('B'),'auto');assert.equal(await f.ctrl.state('new'),'ask');
 const reopened=fixture(f.storage);assert.equal(await reopened.ctrl.state('A'),'full');assert.equal(await reopened.ctrl.state('B'),'auto');
 await f.ctrl.select('full','pending:draft-a');await f.ctrl.promote('draft-a','created');assert.equal(f.ctrl.mode('created'),'full');
 await f.ctrl.select('ask','existing');await f.ctrl.select('full','pending:draft-b');await f.ctrl.promote('draft-b','existing');assert.equal(f.ctrl.mode('existing'),'ask','Opening an existing chat cannot promote draft permissions over it');
 await assert.rejects(f.ctrl.select('full'),/chat/);await assert.rejects(f.ctrl.select('bad','A'),/Unknown/);
 f.fail();await assert.rejects(f.ctrl.select('full','B'),/paused for this chat/);assert.equal(f.ctrl.mode('B'),'ask');assert.equal(f.ctrl.mode('A'),'full');
}
{
 const f=fixture(),a=[],b=[];const one=createPermissionBridge(f.ctrl,m=>a.push(m)),two=createPermissionBridge(f.ctrl,m=>b.push(m));
 await one.handle({type:'requestAutoApproveState',sessionID:'A'});await two.handle({type:'requestAutoApproveState',sessionID:'B'});
 await one.handle({type:'setPermissionMode',sessionID:'A',mode:'full',requestID:'1'});await flush();
 assert.equal(a.at(-1).mode,'full');assert(b.every(m=>m.sessionID==='B'&&m.mode==='auto'));
 await two.handle({type:'setPermissionMode',sessionID:'B',mode:'ask',requestID:'2'});await flush();assert.equal(f.ctrl.mode('A'),'full');assert.equal(f.ctrl.mode('B'),'ask');
 one.dispose();two.dispose();
}
for(const [kind,source]of Object.entries({
 'extension.js':extensionAnchors.map(x=>x[0]).join(';')+';'+promotionAnchor,
 ...Object.fromEntries(Object.entries(uiAnchors).map(([kind,a])=>[kind,a.before])),
 'webview.css':'.prompt-input-container{}','agent-manager.css':'.prompt-input-container{}',
})){
 const changed=patch(source,kind);assert.equal(patch(changed,kind),changed,kind+' idempotence');assert.equal(patch(changed,kind,true),source,kind+' restoration');assert.throws(()=>patch('unknown',kind),/Unsupported|ambiguous/);
}
console.log('Permission modes passed: independent chats, persistence, drafts, children, protected actions, concurrent changes, deduplication and failure isolation.');

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
    window.messages=[];window.cleanup=[];window.handlers=[];window.chat='A';window.watchers=[];
    window.emit=m=>window.handlers.forEach(fn=>fn(m));
    const port={onMessage(fn){window.handlers.push(fn);return()=>window.handlers.splice(window.handlers.indexOf(fn),1);},postMessage(m){window.messages.push(m);}};
    document.querySelector('#composer').append(window.__kiloPermissionMenu(port,fn=>window.cleanup.push(fn),()=>window.chat,fn=>{window.watchers.push(fn);fn();}));
    window.emit({type:'autoApproveState',sessionID:window.chat,active:true,mode:'auto'});
   });
   await page.evaluate(()=>{window.chat='B';window.watchers.forEach(fn=>fn());window.emit({type:'autoApproveState',sessionID:'A',mode:'full'});});
   assert.equal(await page.getByRole('button',{name:'Permissions: Loading…'}).isDisabled(),true);
   await page.evaluate(()=>window.emit({type:'autoApproveState',sessionID:'B',mode:'ask'}));
   await page.getByRole('button',{name:'Permissions: Ask'}).waitFor();
   await page.evaluate(()=>{window.chat='A';window.watchers.forEach(fn=>fn());window.emit({type:'autoApproveState',sessionID:'A',mode:'auto'});});
   const trigger=page.getByRole('button',{name:'Permissions: Auto'});
   await trigger.click();const menu=page.getByRole('menu',{name:'Permissions'});await menu.waitFor();
   assert.equal(await page.getByRole('menuitemradio',{name:/Auto/}).getAttribute('aria-checked'),'true');
   assert.equal(await page.locator('.kilo-permission-check').first().evaluate(e=>getComputedStyle(e).color),'rgb(240, 165, 143)','Selection check uses the coral accent');
   await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowDown');
   assert.equal(await page.locator(':focus').evaluate(e=>getComputedStyle(e).outlineColor),'rgb(240, 165, 143)','Keyboard focus uses the coral accent');
   const badge=await page.locator('.kilo-permission-warning').boundingBox(),label=await page.getByRole('menuitemradio',{name:/Full access/}).locator('strong').boundingBox();
   assert(badge.y>=label.y&&badge.y+badge.height<=label.y+label.height,'Warning stays inline with Full access');
   await page.screenshot({path:path.join(os.tmpdir(),'kilo-permission-'+name+'.png')});
   await page.keyboard.press('End');assert.match(await page.locator(':focus').textContent(),/Full access/);await page.keyboard.press('Enter');
   assert.equal(await page.getByRole('button',{name:'Permissions: Auto'}).getAttribute('aria-busy'),'true');
   assert.equal(await menu.isVisible(),false);
   assert.equal(await page.evaluate(()=>window.messages.at(-1).mode),'full');
   await page.evaluate(()=>{const m=window.messages.at(-1);window.emit({type:'permissionModeResult',sessionID:window.chat,requestID:m.requestID,mode:'full'});});
   await page.getByRole('button',{name:'Permissions: Full access'}).click();
   await page.screenshot({path:path.join(os.tmpdir(),'kilo-permission-'+name+'-full.png')});
   await page.keyboard.press('Home');await page.keyboard.press('Enter');
   await page.evaluate(()=>{const m=window.messages.at(-1);window.emit({type:'permissionModeResult',sessionID:window.chat,requestID:'stale',mode:'auto'});window.emit({type:'permissionModeResult',sessionID:window.chat,requestID:m.requestID,mode:'full',error:'Test save failure'});});
   assert.equal(await page.getByRole('alert').textContent(),'Test save failure');
   const full=page.getByRole('button',{name:'Permissions: Full access'});await full.click();await page.keyboard.press('Escape');assert.equal(await full.getAttribute('aria-expanded'),'false');
   await page.setViewportSize({width:420,height:650});await full.click();const box=await menu.boundingBox();assert(box.x>=0&&box.x+box.width<=420,'Menu fits a narrow viewport');
   assert(await menu.evaluate(e=>e.scrollWidth<=e.clientWidth),'Descriptions do not overflow the menu');
   await page.mouse.click(3,3);assert.equal(await menu.isVisible(),false);
   await page.evaluate(()=>window.emit({type:'autoApproveState',sessionID:window.chat,active:false,mode:'ask'}));await page.getByRole('button',{name:'Permissions: Ask'}).waitFor();
   await page.emulateMedia({forcedColors:'active'});assert.equal(await page.getByRole('button',{name:'Permissions: Ask'}).evaluate(e=>getComputedStyle(e).borderTopStyle),'solid');
   await page.evaluate(()=>window.cleanup.forEach(fn=>fn()));assert.equal(await page.evaluate(()=>window.handlers.length),0);assert.equal(await page.getByRole('menu',{name:'Permissions'}).count(),0);
   assert.deepEqual(errors,[]);await page.close();console.log(name+': menu rendering, selection, request acknowledgements, errors, keyboard navigation, outside click, narrow viewport, forced colors and cleanup passed.');
  }
 }finally{await browser.close();}
}
