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
// These tables describe the 7.8.12 composer closures, not global bundle names.
const symbols = {
  'webview.js': {input:'W', text:'Ge', paste:'Le', old:'$t', pastes:'Mt', counter:'on', id:'Q', finger:'N', mentions:'y', reply:'It', event:'Ge', resize:'ea', field:'B', images:'w', set:'Z', loading:'we', api:'m', lang:'p'},
  'agent-manager.js': {input:'J', text:'Ye', paste:'Se', old:'Kt', pastes:'$t', counter:'xn', id:'F', finger:'$', mentions:'y', reply:'Nt', event:'Ye', resize:'or', field:'E', images:'k', set:'X', loading:'le', api:'m', lang:'p'},
};
export function patch(source, kind, ui = fs.readFileSync(path.join(root, 'clarify-goal-ui.js'), 'utf8')) {
  if (source.includes(marker)) {
    if (kind !== 'extension.js') {
      const start=source.indexOf(marker+'\n/* clarify-goal-ui:v1 */');
      const boundary=source.indexOf('\n"use strict";',start);
      if (start<0 || boundary<0) throw Error('Unsupported installed Clarify goal UI prefix.');
      source=source.slice(0,start)+marker+'\n'+ui+'\n'+source.slice(boundary+1);
    }
    return source;
  }
  const replace=(before,after)=>{source=replaceOnce(source,before,after)};
  if (kind === 'extension.js') {
    replace('sdkClient.enhancePrompt.enhance({text:message6.text},{throwOnError:!0}).then(({data:data2})=>{this.postMessage({type:"enhancePromptResult",text:data2.text,requestId:message6.requestId})})',
      'require(require("node:path").join(__dirname,"clarify-goal.cjs")).clarify(sdkClient,message6,message6.sessionID?this.getSessionDirectory(message6.sessionID):this.getWorkspaceDirectory(),this).then(data2=>{this.postMessage({type:"enhancePromptResult",...data2,requestId:message6.requestId})})');
    replace('.catch(err2=>{let raw2=getErrorMessage(err2)||"Failed to enhance prompt"', '.catch(err2=>{if(err2?.name==="AbortError"){this.postMessage({type:"enhancePromptCancelled",requestId:message6.requestId});return}let raw2=getErrorMessage(err2)||"Failed to enhance prompt"');
    replace('case"enhancePrompt":{', 'case"requestGoalModels":case"setGoalModel":{try{if(!this.client)throw Error("Not connected to CLI backend");const settings=await require(require("node:path").join(__dirname,"clarify-goal.cjs")).modelSettings(this.client,message6,this.getWorkspaceDirectory(),this);this.postMessage({type:"goalModelSettings",...settings,requestId:message6.requestId,saved:message6.type==="setGoalModel"})}catch(error){this.postMessage({type:"goalModelSettingsError",requestId:message6.requestId,error:error?.message||"Unable to load or save the clarification model."})}break}case"cancelEnhancePrompt":{if(!require(require("node:path").join(__dirname,"clarify-goal.cjs")).cancel(this,message6.requestId))this.postMessage({type:"enhancePromptCancelled",requestId:message6.requestId});break}case"enhancePrompt":{');
  } else {
    const b=symbols[kind]; if(!b)throw Error('Expected extension.js, webview.js, or agent-manager.js');
    const fingerprint=`()=>JSON.stringify([${b.id}(),${b.finger}(${b.id}()),t.selected(f()),t.currentVariant(f()),h()])`;
    replace(`${b.old}=${b.input}(),${b.pastes}=${b.paste}.pastes().map(${b.reply}=>${b.reply}.text),${b.counter}++,${b.loading}(!0),${b.api}.postMessage({type:"enhancePrompt",text:${b.text},requestId:\`enhance-\${${b.id}()}-\${${b.counter}}\`})`,
      `${b.old}=${b.input}(),${b.pastes}=${b.paste}.pastes().map(${b.reply}=>${b.reply}.text),${b.counter}++,${b.loading}(!0),globalThis.__kiloGoal.begin(${b.field},(${fingerprint})(),${fingerprint},{requestId:\`enhance-\${${b.id}()}-\${${b.counter}}\`,cancel:requestId=>${b.api}.postMessage({type:"cancelEnhancePrompt",requestId}),post:message=>${b.api}.postMessage(message)}),${b.api}.postMessage({type:"enhancePrompt",text:${b.text},requestId:\`enhance-\${${b.id}()}-\${${b.counter}}\`,sessionID:t.currentSessionID(),providerID:t.selected(f())?.providerID,modelID:t.selected(f())?.modelID,files:[...${b.mentions}.parseFileAttachments(${b.text}),...${b.images}.images().map(image=>({mime:image.mime,url:image.dataUrl,filename:image.filename}))]})`);
    replace(`${b.reply}.requestId===\`enhance-\${${b.id}()}-\${${b.counter}}\`&&(${b.set}(${b.reply}.text),${b.mentions}.seedFromText(${b.reply}.text),${b.loading}(!1),${b.field}&&(${b.field}.value=${b.reply}.text,${b.resize}(),${b.field}.focus()))`,
      `${b.loading}(!1),${b.reply}.requestId===\`enhance-\${${b.id}()}-\${${b.counter}}\`&&${b.field}&&globalThis.__kiloGoal.preview(${b.field},${b.reply},value=>{${b.set}(value),${b.mentions}.seedFromText(value),${b.field}.value=value,${b.resize}(),${b.field}.focus()})`);
    replace(`${b.event}.type==="enhancePromptError"&&${b.event}.requestId===\`enhance-\${${b.id}()}-\${${b.counter}}\`&&${b.loading}(!1)`,
      `${b.event}.type==="enhancePromptCancelled"&&${b.event}.requestId===\`enhance-\${${b.id}()}-\${${b.counter}}\`&&(${b.loading}(!1),${b.field}&&globalThis.__kiloGoal.cancelled(${b.field},${b.event}.requestId)),${b.event}.type==="enhancePromptError"&&(${b.loading}(!1),${b.event}.requestId===\`enhance-\${${b.id}()}-\${${b.counter}}\`&&${b.field}&&globalThis.__kiloGoal.error(${b.field},${b.event}.error,${b.event}.requestId))`);
    replace(`if(!${b.text}){let ${b.reply}=${b.lang}.t("prompt.action.enhanceDescription");${b.set}(${b.reply}),${b.field}&&(${b.field}.value=${b.reply},${b.resize}(),${b.field}.focus());return}`, `if(!${b.text}){${b.field}&&globalThis.__kiloGoal.error(${b.field},"Add a message describing your goal first.");return}`);
    replace(`if(${b.event}.type==="enhancePromptResult"){`, `if((${b.event}.type==="goalModelSettings"||${b.event}.type==="goalModelSettingsError")&&${b.field})globalThis.__kiloGoal.modelSettings(${b.field},${b.event});if(${b.event}.type==="enhancePromptResult"){`);
    if(source.split(`${b.lang}.t("prompt.action.enhance")`).length!==4)throw Error('Unexpected Clarify goal button count.');
    source=source.replaceAll(`${b.lang}.t("prompt.action.enhance")`,'"Clarify goal"');
    source=ui+'\n'+source;
  }
  return marker+'\n'+source+'\n'+cancelMarker+'\n/* clarify-goal-model:v1 */';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),mode=args.includes('--check')?'--check':'--apply';
  const targets=args.filter(arg=>!arg.startsWith('--'));
  if (!targets.length || args.some(arg=>arg.startsWith('--')&&!['--apply','--check'].includes(arg))) throw Error('Usage: clarify-goal.mjs <bundle.js> [...] [--apply|--check]');
  for(const target of targets) {
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
}
