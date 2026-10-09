#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const marker = '/* clarify-goal-patch:v1 */';
const cancelMarker = '/* clarify-goal-cancel:v1 */';
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw Error('Unsupported or ambiguous Clarify goal anchor. No changes made.');
  return source.replace(before, after);
}
export function patch(source, kind, ui = fs.readFileSync(path.join(root, 'clarify-goal-ui.js'), 'utf8')) {
  if (source.includes(marker)) {
    if (kind !== 'extension.js') {
      // Other local patches prepend recovery helpers; retain those wrappers.
      const start=source.indexOf(marker+'\n/* clarify-goal-ui:v1 */');
      const boundary=source.indexOf('\n"use strict";',start);
      if (start<0 || boundary<0) throw Error('Unsupported installed Clarify goal UI prefix.');
      source=source.slice(0,start)+marker+'\n'+ui+'\n'+source.slice(boundary+1);
    }
    return addCancellation(source,kind);
  }
  if (kind === 'extension.js') {
    source = replaceOnce(source,
      'sdkClient.enhancePrompt.enhance({text:message6.text},{throwOnError:!0}).then(({data:data2})=>{this.postMessage({type:"enhancePromptResult",text:data2.text,requestId:message6.requestId})})',
      'require(require("node:path").join(__dirname,"clarify-goal.cjs")).clarify(sdkClient,message6,message6.sessionID?this.getSessionDirectory(message6.sessionID):this.getWorkspaceDirectory()).then(data2=>{this.postMessage({type:"enhancePromptResult",...data2,requestId:message6.requestId})})');
  } else if (['webview.js', 'agent-manager.js'].includes(kind)) {
    const main = kind === 'webview.js';
    const b = main ? {input:'U',text:'ze',paste:'le',old:'He',pastes:'at',counter:'Oe',id:'D',finger:'F',mentions:'A',reply:'Bt',event:'ze',resize:'ct'}
      : {input:'H',text:'Oe',paste:'se',old:'We',pastes:'pt',counter:'Ve',id:'I',finger:'R',mentions:'b',reply:'_t',event:'Oe',resize:'lt'};
    const fingerprint = `()=>JSON.stringify([${b.id}(),${b.finger}(${b.id}()),t.selected(g()),t.currentVariant(g()),f()])`;
    const before = `${b.old}=${b.input}(),${b.pastes}=${b.paste}.pastes().map(${b.reply}=>${b.reply}.text),${b.counter}++,J(!0),p.postMessage({type:"enhancePrompt",text:${b.text},requestId:\`enhance-\${${b.id}()}-\${${b.counter}}\`})`;
    // Snapshot before the async call: never apply over newer typing, attachments or selection.
    const after = `${b.old}=${b.input}(),${b.pastes}=${b.paste}.pastes().map(${b.reply}=>${b.reply}.text),${b.counter}++,J(!0),globalThis.__kiloGoal.begin(w,(${fingerprint})(),${fingerprint}),p.postMessage({type:"enhancePrompt",text:${b.text},sessionID:t.currentSessionID(),providerID:t.selected(g())?.providerID,modelID:t.selected(g())?.modelID,files:[...${b.mentions}.parseFileAttachments(${b.text}),...x.images().map(image=>({mime:image.mime,url:image.dataUrl,filename:image.filename}))],requestId:\`enhance-\${${b.id}()}-\${${b.counter}}\`})`;
    source = replaceOnce(source, before, after);
    const resultBefore = `${b.reply}.requestId===\`enhance-\${${b.id}()}-\${${b.counter}}\`&&(K(${b.reply}.text),${b.mentions}.seedFromText(${b.reply}.text),J(!1),w&&(w.value=${b.reply}.text,${b.resize}(),w.focus()))`;
    const resultAfter = `J(!1),${b.reply}.requestId===\`enhance-\${${b.id}()}-\${${b.counter}}\`&&w&&globalThis.__kiloGoal.preview(w,${b.reply},value=>{K(value),${b.mentions}.seedFromText(value),w.value=value,${b.resize}(),w.focus()})`;
    source = replaceOnce(source, resultBefore, resultAfter);
    source = replaceOnce(source, `${b.event}.type==="enhancePromptError"&&${b.event}.requestId===\`enhance-\${${b.id}()}-\${${b.counter}}\`&&J(!1)`,
      `${b.event}.type==="enhancePromptError"&&(J(!1),${b.event}.requestId===\`enhance-\${${b.id}()}-\${${b.counter}}\`&&w&&globalThis.__kiloGoal.error(w,${b.event}.error))`);
    // An empty composer stays empty; clicking the wand must not insert a generic task.
    source = replaceOnce(source, `if(!${b.text}){let ${b.reply}=u.t("prompt.action.enhanceDescription");K(${b.reply}),w&&(w.value=${b.reply},${b.resize}(),w.focus());return}`,
      `if(!${b.text}){w&&globalThis.__kiloGoal.error(w,"Add a message describing your goal first.");return}`);
    if (source.split('u.t("prompt.action.enhance")').length !== 3) throw Error('Unexpected Clarify goal button count.');
    source = source.replaceAll('u.t("prompt.action.enhance")','"Clarify goal"');
    source = ui + '\n' + source;
  } else throw Error('Expected extension.js, webview.js, or agent-manager.js');
  return addCancellation(marker + '\n' + source,kind);
}

function addCancellation(source,kind) {
  if(kind!=='extension.js') {
    const event=kind==='webview.js'?'ze':'Oe';
    source=source.replace(`globalThis.__kiloGoal.error(w,${event}.error)`,`globalThis.__kiloGoal.error(w,${event}.error,${event}.requestId)`);
  }
  if(source.includes(cancelMarker))return source;
  if(kind==='extension.js') {
    source=replaceOnce(source,'case"enhancePrompt":{',
      'case"cancelEnhancePrompt":{if(!require(require("node:path").join(__dirname,"clarify-goal.cjs")).cancel(this,message6.requestId))this.postMessage({type:"enhancePromptCancelled",requestId:message6.requestId});break}case"enhancePrompt":{');
    source=replaceOnce(source,'message6.sessionID?this.getSessionDirectory(message6.sessionID):this.getWorkspaceDirectory()).then(data2=>',
      'message6.sessionID?this.getSessionDirectory(message6.sessionID):this.getWorkspaceDirectory(),this).then(data2=>');
    source=replaceOnce(source,'.catch(err2=>{let raw2=getErrorMessage(err2)||"Failed to enhance prompt"',
      '.catch(err2=>{if(err2?.name==="AbortError"){this.postMessage({type:"enhancePromptCancelled",requestId:message6.requestId});return}let raw2=getErrorMessage(err2)||"Failed to enhance prompt"');
  }else{
    const main=kind==='webview.js';
    const id=main?'D':'I', counter=main?'Oe':'Ve', finger=main?'F':'R', event=main?'ze':'Oe';
    const fingerprint=`()=>JSON.stringify([${id}(),${finger}(${id}()),t.selected(g()),t.currentVariant(g()),f()])`;
    source=replaceOnce(source,`globalThis.__kiloGoal.begin(w,(${fingerprint})(),${fingerprint})`,
      `globalThis.__kiloGoal.begin(w,(${fingerprint})(),${fingerprint},{requestId:\`enhance-\${${id}()}-\${${counter}}\`,cancel:requestId=>p.postMessage({type:"cancelEnhancePrompt",requestId})})`);
    source=replaceOnce(source,`${event}.type==="enhancePromptError"&&`,
      `${event}.type==="enhancePromptCancelled"&&${event}.requestId===\`enhance-\${${id}()}-\${${counter}}\`&&(J(!1),w&&globalThis.__kiloGoal.cancelled(w,${event}.requestId)),${event}.type==="enhancePromptError"&&`);
  }
  // Keep the UI prefix stable so future upgrades can replace it independently.
  return kind==='extension.js'?source+'\n'+cancelMarker:source.replace('\n"use strict";','\n"use strict";'+cancelMarker);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, mode='--apply'] = process.argv.slice(2);
  if (!target || !['--apply','--check'].includes(mode)) throw Error('Usage: clarify-goal.mjs <bundle.js> [--apply|--check]');
  const source=fs.readFileSync(target,'utf8'),next=patch(source,path.basename(target));
  if(mode==='--check') {if(next!==source)throw Error('Clarify goal patch missing.');}
  else if(next!==source) {
    const temp=target+'.clarify-tmp.js';
    try {
      fs.writeFileSync(temp,next,{flag:'wx',mode:fs.statSync(target).mode & 0o777});
      const checked=spawnSync(process.execPath,['--check',temp],{encoding:'utf8'});
      if(checked.status!==0)throw Error(checked.stderr);
      if(fs.readFileSync(target,'utf8')!==source)throw Error('Bundle changed during patching.');
      if(!fs.existsSync(target+'.pre-clarify-goal'))fs.copyFileSync(target,target+'.pre-clarify-goal',fs.constants.COPYFILE_EXCL);
      fs.renameSync(temp,target);
    }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }
  if(path.basename(target)==='extension.js') {
    const helper=path.join(root,'clarify-goal.cjs'),destination=path.join(path.dirname(target),'clarify-goal.cjs');
    if(mode==='--check') {
      if(!fs.existsSync(destination)||!fs.readFileSync(helper).equals(fs.readFileSync(destination)))throw Error('Clarify goal backend helper missing or outdated.');
    } else fs.copyFileSync(helper,destination);
  }
  console.log('Clarify goal patch verified: '+path.basename(target));
}
