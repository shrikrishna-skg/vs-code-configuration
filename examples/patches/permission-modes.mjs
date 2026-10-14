#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.dirname(fileURLToPath(import.meta.url));
export const extensionAnchors=[["function registerToggleAutoApprove(context3,connectionService,resolve24,directories){let active2=readActive(),generation=0,listeners=new Set,notify=()=>{for(let listener of listeners)listener(active2)},setActive=async next=>{active2=next,generation++,notify(),await vscode84.workspace.getConfiguration(CONFIG2).update(KEY6,active2,target4())},toggle=async()=>{await setActive(!active2);let snapshot2=generation;if(!active2)return vscode84.window.showInformationMessage(\"Auto-approve disabled\"),active2;vscode84.window.showInformationMessage(\"Auto-approve enabled. Sandbox escalation prompts are excluded.\");let client2=tryGetClient(connectionService);if(!client2)return active2;for(let dir2 of directories()){if(generation!==snapshot2)break;try{let{data:pending3}=await retry(()=>client2.permission.list({directory:dir2},{throwOnError:!0}));for(let req of pending3){if(generation!==snapshot2)break;req.metadata?.sandboxEscalation!==!0&&await replyOnce(client2,req.id,dir2,()=>generation===snapshot2)}}catch(err2){console.error(\"[Kilo New] toggleAutoApprove: failed to list pending permissions:\",err2)}}return active2},approve=async(event,directory5)=>{if(!active2)return!1;let client2=tryGetClient(connectionService);if(!client2||event.properties.metadata?.sandboxEscalation===!0)return!1;let dir2=directory5??connectionService.getPermissionDirectory(event.properties.id)??resolve24(event.properties.sessionID);return replyOnce(client2,event.properties.id,dir2)};return context3.subscriptions.push(vscode84.workspace.onDidChangeConfiguration(event=>{if(!event.affectsConfiguration(`${CONFIG2}.${KEY6}`))return;let next=readActive();next!==active2&&(active2=next,generation++,notify())})),context3.subscriptions.push(vscode84.commands.registerCommand(\"kilo-code.new.toggleAutoApprove\",toggle)),{active:()=>active2,approve,toggle,onChange(listener){listeners.add(listener);let disposed=!1;return{dispose(){disposed||(disposed=!0,listeners.delete(listener))}}}}}", "function registerToggleAutoApprove(context3,connectionService,resolve24,directories){/* permission-modes-controller:v1 */return require(require(\"node:path\").join(__dirname,\"permission-modes.cjs\")).createPermissionController({context:context3,readActive,writeActive:value=>vscode84.workspace.getConfiguration(CONFIG2).update(KEY6,value,target4()),onConfiguration:listener=>vscode84.workspace.onDidChangeConfiguration(listener),registerCommand:(name,action)=>vscode84.commands.registerCommand(name,action),client:()=>tryGetClient(connectionService),directories,resolve:request=>connectionService.getPermissionDirectory(request.id)??resolve24(request.sessionID),replyOnce,retry,showError:message=>vscode84.window.showErrorMessage(message)})}"], ["function createAutoApproveBridge(ctrl,post,next){let send3=(active2=ctrl.active())=>post({type:\"autoApproveState\",active:active2}),sub=ctrl.onChange(send3);return{dispose:()=>sub.dispose(),async handle(msg){return msg.type===\"toggleAutoApprove\"?(await ctrl.toggle(),null):msg.type===\"requestAutoApproveState\"?(send3(),null):(msg.type===\"webviewReady\"&&send3(),next?next(msg):msg)}}}", "function createAutoApproveBridge(ctrl,post,next){/* permission-modes-bridge:v1 */let send3=()=>post({type:\"autoApproveState\",active:ctrl.active(),mode:ctrl.mode()}),sub=ctrl.onChange(send3);return{dispose:()=>sub.dispose(),async handle(msg){if(msg.type===\"setPermissionMode\"){try{await ctrl.select(msg.mode);post({type:\"permissionModeResult\",requestID:msg.requestID,mode:ctrl.mode()})}catch(error){post({type:\"permissionModeResult\",requestID:msg.requestID,mode:ctrl.mode(),error:error.message||\"Could not change permission mode.\"})}return null}return msg.type===\"toggleAutoApprove\"?(await ctrl.toggle(),null):msg.type===\"requestAutoApproveState\"?(send3(),null):(msg.type===\"webviewReady\"&&send3(),next?next(msg):msg)}}}"]];
export const uiAnchors={"webview.js": {"before": "E(Pn,{get value(){return`${u.t(Ne()?\"prompt.action.autoApprove.enabled\":\"prompt.action.autoApprove.disabled\")} ${u.t(\"prompt.action.autoApprove.sandboxExcluded\")}`},placement:\"top\",openDelay:0,get children(){return E(Cn,{icon:\"shield\",variant:\"ghost\",size:\"small\",onClick:()=>p.postMessage({type:\"toggleAutoApprove\"}),get\"aria-label\"(){return lt(()=>!!Ne())()?u.t(\"prompt.action.autoApprove.disable\"):u.t(\"prompt.action.autoApprove.enable\")},get\"aria-pressed\"(){return Ne()},get class(){return`prompt-status-button ${Ne()?\"prompt-status-button--active\":\"\"}`}})}})", "after": "E(()=>globalThis.__kiloPermissionMenu(p,nt),{})"}, "agent-manager.js": {"before": "C(en,{get value(){return`${u.t(Se()?\"prompt.action.autoApprove.enabled\":\"prompt.action.autoApprove.disabled\")} ${u.t(\"prompt.action.autoApprove.sandboxExcluded\")}`},placement:\"top\",openDelay:0,get children(){return C(Ut,{icon:\"shield\",variant:\"ghost\",size:\"small\",onClick:()=>p.postMessage({type:\"toggleAutoApprove\"}),get\"aria-label\"(){return He(()=>!!Se())()?u.t(\"prompt.action.autoApprove.disable\"):u.t(\"prompt.action.autoApprove.enable\")},get\"aria-pressed\"(){return Se()},get class(){return`prompt-status-button ${Se()?\"prompt-status-button--active\":\"\"}`}})}})", "after": "C(()=>globalThis.__kiloPermissionMenu(p,Ye),{})"}};
const legacyPermissionBridge=extensionAnchors[1][1];
extensionAnchors[1][1]='function createAutoApproveBridge(ctrl,post,next){/* permission-modes-bridge:v2 */return require(require("node:path").join(__dirname,"permission-modes.cjs")).createPermissionBridge(ctrl,post,next)}';
const legacyMenus=Object.fromEntries(Object.entries(uiAnchors).map(([key,value])=>[key,value.after]));
uiAnchors['webview.js'].after='E(()=>globalThis.__kiloPermissionMenu(p,nt,()=>g()??(t.setDraftSessionID("pending:"+crypto.randomUUID()),g()),fn=>Xe(fn)),{})';
uiAnchors['agent-manager.js'].after='C(()=>globalThis.__kiloPermissionMenu(p,Ye,()=>g()??(t.setDraftSessionID("pending:"+crypto.randomUUID()),g()),fn=>qe(fn)),{})';
export const promotionAnchor='this.postMessage({type:"sessionCreated",projectId:this.opts.projectQualifier?.()?.projectId,session:this.sessionToWebview(session),draftID});let resolved=';
const promotionAfter='await this.autoApproveBridge?.promote(draftID,session.id),'+promotionAnchor;
export const css=`/* permission-modes-css:v3 */
.kilo-permission-control{position:relative;display:inline-flex;align-items:center;--permission-accent:#f0a58f;--permission-fill:#de735b1a;--permission-edge:#de735b66}
.kilo-permission-trigger{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px;border:1px solid var(--vscode-widget-border,#3b3b3b);border-radius:6px;background:transparent;color:var(--text-base,#ccc);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
.kilo-permission-trigger svg{flex-shrink:0}.kilo-permission-trigger:hover:not(:disabled){background:var(--permission-fill);border-color:var(--permission-edge)}
.kilo-permission-trigger[data-mode=full]{color:var(--permission-accent);background:var(--permission-fill);border-color:var(--permission-edge)}
.kilo-permission-trigger[aria-expanded=true]{border-color:var(--permission-accent)}
.kilo-permission-trigger:focus-visible{outline:2px solid var(--permission-accent);outline-offset:2px}
.kilo-permission-trigger:disabled{opacity:.55;cursor:wait}
.kilo-permission-menu{--permission-accent:#f0a58f;--permission-fill:#de735b1a;--permission-edge:#de735b66;position:fixed;z-index:2147483646;box-sizing:border-box;max-height:calc(100vh - 16px);overflow:auto;padding:6px;border:1px solid var(--vscode-widget-border,#3b3b3b);border-radius:10px;background:var(--vscode-menu-background,#232323);color:var(--vscode-menu-foreground,#ddd);box-shadow:0 8px 28px #0006;font-family:var(--vscode-font-family,Arial,sans-serif);font-size:13px}
.kilo-permission-menu[hidden],.kilo-permission-error[hidden]{display:none}
.kilo-permission-title{padding:7px 9px 6px;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--vscode-descriptionForeground,#9a9a9a)}
.kilo-permission-menu button{display:flex;align-items:center;text-align:left;gap:10px;width:100%;box-sizing:border-box;padding:9px;border:1px solid transparent;border-radius:7px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.kilo-permission-menu button:hover:not(:disabled){background:var(--permission-fill)}
.kilo-permission-menu button[aria-checked=true]{background:var(--permission-fill);border-color:var(--permission-edge)}
.kilo-permission-menu button:focus-visible{outline:2px solid var(--permission-accent);outline-offset:-2px}
.kilo-permission-menu button>span:first-child{min-width:0;flex:1}
.kilo-permission-menu strong{display:flex;align-items:center;gap:6px;font-weight:600;line-height:1.4}
.kilo-permission-menu small{display:block;margin-top:3px;font-size:11.5px;line-height:1.4;white-space:normal;color:var(--vscode-descriptionForeground,#aaa)}
.kilo-permission-warning{display:inline-block;flex:none;color:var(--permission-accent)}
.kilo-permission-check{flex:none;margin-left:auto;color:var(--permission-accent);visibility:hidden}.kilo-permission-menu button[aria-checked=true] .kilo-permission-check{visibility:visible}
.kilo-permission-footer{margin-top:5px;padding:9px 9px 5px;border-top:1px solid var(--vscode-widget-border,#3b3b3b);font-size:11px;line-height:1.45;color:var(--vscode-descriptionForeground,#aaa)}
.kilo-permission-error{position:absolute;bottom:36px;right:0;width:250px;padding:10px;border:1px solid var(--vscode-errorForeground,#f88);border-radius:6px;background:var(--vscode-menu-background,#232323);color:var(--vscode-errorForeground,#f88);font-size:12px;z-index:2147483646}
@media(forced-colors:active){.kilo-permission-menu,.kilo-permission-trigger,.kilo-permission-trigger[data-mode=full],.kilo-permission-error{background:Canvas;color:CanvasText;border-color:CanvasText}.kilo-permission-menu button[aria-checked=true]{border-color:Highlight}.kilo-permission-check,.kilo-permission-warning{color:Highlight}.kilo-permission-trigger:focus-visible,.kilo-permission-menu button:focus-visible{outline-color:Highlight}}
/* end permission-modes-css */`;
const count=(s,x)=>s.split(x).length-1;
function replace(source,before,after,restore){
  if(count(source,before)+count(source,after)!==1)throw Error('Unsupported or ambiguous permission-mode anchor.');
  return source.replace(restore?after:before,restore?before:after);
}
export function patch(source,kind,restore=false){
  if(kind==='extension.js'){
    if(source.includes(legacyPermissionBridge))source=source.replace(legacyPermissionBridge,extensionAnchors[1][1]);
    if(source.includes(promotionAfter)){if(restore)source=source.replace(promotionAfter,promotionAnchor);}
    else{if(count(source,promotionAnchor)!==1)throw Error('Unsupported session promotion anchor.');if(!restore)source=source.replace(promotionAnchor,promotionAfter);}
    for(const [before,after]of extensionAnchors)source=replace(source,before,after,restore);
    return source;
  }
  if(kind.endsWith('.css')){
    if(!source.includes('.prompt-input-container'))throw Error('Unsupported composer CSS.');
    const start='/* permission-modes-css:',end='/* end permission-modes-css */';
    if(source.includes(start)){
      if(count(source,start)!==1||count(source,end)!==1)throw Error('Modified or ambiguous permission CSS.');
      const a=source.indexOf(start),ei=source.indexOf(end,a);
      if(ei<0)throw Error('Modified or ambiguous permission CSS.');
      const before=source.slice(0,a),after=source.slice(ei+end.length);
      const stripped=(before.endsWith('\n')?before.slice(0,-1):before)+(after.startsWith('\n')?after.slice(1):after);
      if(restore)return stripped;
      return source.slice(a,ei+end.length)===css?source:stripped+'\n'+css+'\n';
    }
    return restore?source:source+'\n'+css+'\n';
  }
  const anchor=uiAnchors[kind];if(!anchor)throw Error('Unsupported bundle.');
  if(source.includes(legacyMenus[kind]))source=source.replace(legacyMenus[kind],anchor.after);
  source=replace(source,anchor.before,anchor.after,restore);
  const start='/* permission-mode-ui:v1 */',end='/* end permission-mode-ui */';
  if(source.includes(start)){
    if(count(source,start)!==1||count(source,end)!==1)throw Error('Ambiguous permission UI.');
    const a=source.indexOf(start),b=source.indexOf(end,a)+end.length;
    if(b<a)throw Error('Invalid permission UI.');
    source=source.slice(0,a)+source.slice(b).replace(/^\n/,'');
  }
  return restore?source:fs.readFileSync(path.join(root,'permission-mode-ui.js'),'utf8').trimEnd()+'\n'+source;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const[target,mode='--apply',...extra]=process.argv.slice(2);
  if(!target||extra.length||!['--apply','--check','--restore'].includes(mode))throw Error('Usage: permission-modes.mjs <bundle.js|bundle.css> [--apply|--check|--restore]');
  const kind=path.basename(target),source=fs.readFileSync(target,'utf8'),next=patch(source,kind,mode==='--restore');
  if(mode==='--check'){if(source!==next)throw Error('Permission selector patch missing.');}
  else if(source!==next){
    const temp=target+`.permission-${process.pid}`+path.extname(target);
    try{
      fs.writeFileSync(temp,next,{flag:'wx',mode:fs.statSync(target).mode&0o777});
      if(kind.endsWith('.js')){const check=spawnSync(process.execPath,['--check',temp],{encoding:'utf8'});if(check.status!==0)throw Error(check.stderr);}
      if(fs.readFileSync(target,'utf8')!==source)throw Error('Bundle changed while patching.');
      if(mode==='--apply'&&!fs.existsSync(target+'.pre-permission-modes'))fs.copyFileSync(target,target+'.pre-permission-modes',fs.constants.COPYFILE_EXCL);
      fs.renameSync(temp,target);
    }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }
  if(kind==='extension.js'&&mode!=='--restore'){
    const from=path.join(root,'permission-modes.cjs'),to=path.join(path.dirname(target),'permission-modes.cjs');
    if(mode==='--check'){if(!fs.existsSync(to)||!fs.readFileSync(from).equals(fs.readFileSync(to)))throw Error('Permission backend helper missing or outdated.');}
    else fs.copyFileSync(from,to);
  }
  console.log('Permission selector '+mode+': '+kind);
}
