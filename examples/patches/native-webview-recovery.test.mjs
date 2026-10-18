import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { patch as manual } from './agent-manager-manual-open.mjs';
import { patch as ready } from './native-subagent-ready.mjs';
import { patchHost, patchClient, installNativeWebviewRecovery } from './native-webview-recovery.mjs';
import { patch as permission } from './permission-modes.mjs';
import { patch as route } from './permission-route.mjs';
import { patch as clarify } from './clarify-goal.mjs';
import { patch as predict } from './predict-next.mjs';
import { patch as map } from './session-map.mjs';
import routeHelper from './permission-route.cjs';
const stock=fileURLToPath(new URL('../stock/extension/dist/',import.meta.url));
const read=name=>fs.readFileSync(stock+name,'utf8');
let host=read('extension.js');
for(const fn of [manual,ready]){const before=host;host=fn(host);assert.equal(fn(host),host);assert.equal(fn(host,true),before);}
for(const fn of [clarify,predict,permission,map])host=fn(host,'extension.js');
host=route(host);host=patchHost(host);
assert.equal(patchHost(host),host);assert.equal(route(host),host);
for(const fn of [clarify,predict,permission,map])assert.equal(fn(host,'extension.js'),host);
for(const kind of ['webview.js','agent-manager.js']){
 let source=clarify(read(kind),kind);
 if(kind==='webview.js')source=predict(source,kind);
 source=permission(source,kind);
 if(kind==='webview.js')source=map(patchClient(source),kind);
 assert.equal(clarify(source,kind),source);assert.equal(permission(source,kind),source);
 if(kind==='webview.js'){assert.equal(predict(source,kind),source);assert.equal(map(source,kind),source);assert.equal(patchClient(source),source);}
 const result=spawnSync(process.execPath,['--check'],{input:source,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
assert.equal(spawnSync(process.execPath,['--check'],{input:host,encoding:'utf8'}).status,0);
// Execute the patched Clarify request against both real composer identifier tables.
// This catches valid-JavaScript ports that accidentally bind an unrelated local.
for(const [kind,names,next]of[
 ['webview.js',{field:'B',input:'W',paste:'Le',counter:'on',id:'Q',finger:'N',old:'$t',pastes:'Mt',busy:'we',text:'Ge',images:'w'},'},ko='],
 ['agent-manager.js',{field:'E',input:'J',paste:'Se',counter:'xn',id:'F',finger:'$',old:'Kt',pastes:'$t',busy:'le',text:'Ye',images:'k'},'},va='],
]){
 const source=clarify(read(kind),kind),start=source.indexOf(names.old+'='+names.input+'(),'+names.pastes+'='),end=source.indexOf(next,start);
 const posted=[],states=[],field={value:'Draft'},goal=[];
 const context={t:{currentSessionID:()=>'session-child',selected:id=>({id,providerID:'openai',modelID:'sol'}),currentVariant:id=>'high'},f:()=>'session-child',h:()=>'project-box',m:{postMessage:value=>posted.push(value)},globalThis:{__kiloGoal:{begin:(...args)=>goal.push(args)}},[names.field]:field,[names.input]:()=>'Draft',[names.paste]:{pastes:()=>[{text:'original paste'}]},[names.counter]:0,[names.id]:()=>'prompt:session-child',[names.finger]:id=>'draft:'+id,[names.busy]:value=>states.push(value),[names.text]:'Draft',y:{parseFileAttachments:()=>[{mime:'text/plain',url:'file:///isolated/reference.txt'}]},[names.images]:{images:()=>[{mime:'image/png',dataUrl:'data:image/png;base64,isolated',filename:'reference.png'}]}};
 vm.runInNewContext(source.slice(start,end),context);
 assert.deepEqual(states,[true]);assert.equal(posted[0].sessionID,'session-child');assert.equal(posted[0].text,'Draft');assert.equal(posted[0].providerID,'openai');assert.equal(posted[0].modelID,'sol');assert.equal(posted[0].files.length,2);assert.equal(posted[0].files[0].url,'file:///isolated/reference.txt');assert.equal(posted[0].files[1].url,'data:image/png;base64,isolated');assert.equal(posted[0].requestId,'enhance-prompt:session-child-1');
 assert.equal(goal[0][0],field);assert.equal(goal[0][1],goal[0][2]());
 context[names.finger]=()=> 'newly typed draft';assert.notEqual(goal[0][1],goal[0][2]());
 goal[0][3].cancel(posted[0].requestId);assert.equal(posted[1].type,'cancelEnhancePrompt');
}
// Execute the actual installed callback: loading must wait for connection readiness,
// and closing a viewer while connecting must prevent all subsequent dispatch.
const changed=ready(read('extension.js'));
const start=changed.indexOf('readyDisposable=panel.webview.onDidReceiveMessage(async msg=>');
const end=changed.indexOf('),closeDisposable=',start);
const callback=changed.slice(start+'readyDisposable=panel.webview.onDidReceiveMessage('.length,end);
for(const closed of [false,true]){
 const calls=[];let release;const initialized=new Promise(resolve=>release=resolve),panel={};
 const context={readyDisposable:{dispose(){calls.push('dispose')}},panel,sessionID:'child',directory5:'/work',provider:{initializeConnection(){calls.push('initialize');return initialized},postMessage(m){calls.push(m.type)},loadMessages(){calls.push('load')},registerSession(){calls.push('register')}},console};
 const owner={panels:new Map([['child',panel]]),connectionService:{getClient(){return{session:{get:async()=>({data:{id:'child'}})}}}}};
 const fn=vm.runInNewContext('(function(){return '+callback+'}).call(owner)',{...context,owner});
 const task=fn({type:'webviewReady'});assert.deepEqual(calls,['dispose','initialize']);
 if(closed)owner.panels.delete('child');release();await task;await Promise.resolve();
 assert.equal(calls.includes('load'),!closed);assert.equal(calls.includes('viewSubAgentSession'),!closed);
}
// Browser events keep upstream's no-project guard, but never reveal Agent Manager.
const manualHost=manual(read('extension.js'));const browserStart=manualHost.indexOf('post=state=>{/* kilo-manual-open:');const browserEnd=manualHost.indexOf(',off=browser.subscribe(post)',browserStart);
const posted=[];const post=vm.runInNewContext('('+manualHost.slice(browserStart+5,browserEnd)+')',{input:{post:value=>posted.push(value),openPanel(){throw Error('Unexpected panel reveal')}},browserMessage:value=>value});
post({status:'starting'});post({projectId:'p',status:'loading'});assert.equal(posted.length,1);
// Route recovery validates the request's real session and directory before allowing a reply.
const records=[];const ctx={client:{permission:{list:async()=>({data:[{id:'req',sessionID:'child'}]})}},getWorkspaceDirectory:()=>'/work',sessionDirectories:new Map(),recordPermissionDirectory:(...args)=>records.push(args)};
assert.equal(await routeHelper.recoverPermissionRoute(ctx,'req','other'),'error');assert.equal(records.length,0);
assert.equal(await routeHelper.recoverPermissionRoute(ctx,'req','child'),'ready');assert.deepEqual(records,[['req','/work','child']]);
// Recovery keeps backend tasks alive, ignores hidden views, and transfers draft snapshots.
let now=0,tick;const originalNow=Date.now;Date.now=()=>now;
try{
 const sent=[],listeners=[];const panel={viewType:'kilo-code.new.TabPanel',visible:false,title:'Chat',webview:{onDidReceiveMessage(fn){listeners.push(fn);return{dispose(){}}},postMessage(m){sent.push(m);return Promise.resolve()}},onDidDispose(){return{dispose(){}}}};
 const provider={panel,opts:{}};const clock={setInterval(fn){tick=fn;return{unref(){}}},clearInterval(){}};
 installNativeWebviewRecovery(provider,panel,{window:{}},clock);now=5000;tick();assert.equal(sent.length,0);
 panel.visible=true;now=10000;tick();assert.equal(sent[0].type,'__nativeWebviewPing');
 listeners[0]({type:'__nativeWebviewSnapshot',snapshot:{drafts:{version:1,maps:{images:[['draft',['image']]]}}}});
 listeners[0]({type:'__nativeWebviewSnapshot',snapshot:{drafts:{version:1,maps:{text:[['draft','new edit']]}}}});
 assert.deepEqual(provider.nativeWebviewRecoveryState.snapshot.drafts.maps.images,[['draft',['image']]]);
 assert.deepEqual(provider.nativeWebviewRecoveryState.snapshot.drafts.maps.text,[['draft','new edit']]);
 provider.nativeWebviewRecovery.dispose();
}finally{Date.now=originalNow}
console.log('PASS: real 7.8.12 host/client patch composition, syntax, idempotence, restore, subagent connection/closed-panel race, browser manual opening, permission route isolation, hidden renderer and draft snapshot retention.');
