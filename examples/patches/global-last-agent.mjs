#!/usr/bin/env node
// Kilo 7.8.12: new chats (and the first chat after a reload) open on the last agent the
// user selected, saved under XDG_STATE_HOME/kilo (default ~/.local/state/kilo); kilo.jsonc
// default_agent is used only when nothing valid is saved.
// Usage: global-last-agent.mjs <webview.js> <extension.js> [agent-manager.js ...] [--check]

import fs from "node:fs"
import { pathToFileURL } from "node:url"

const id = "[\\w$]+"
const stateFile = 'require("path").join(process.env.XDG_STATE_HOME||require("path").join(require("os").homedir(),".local","state"),"kilo","last-selected-agent")'

function apply(source, edits, label) {
  for (const [before, after, done] of edits) {
    const pending = source.match(before)?.length ?? 0
    const applied = source.match(done)?.length ?? 0
    if (pending + applied !== 1) throw new Error(`global-last-agent: expected one ${label} anchor, found ${pending} unpatched + ${applied} patched: ${before.source.slice(0, 80)}; no changes made.`)
    if (pending) source = source.replace(before, after)
  }
  return source
}

const uiMarker='/* global-last-agent:7.8.12:v1 */';
const hostMarker='/* global-last-agent-host:7.8.12:v1 */';
export function patchWebview(source) {
  if(source.includes(uiMarker))return source;
  const main=source.includes('function Xgt(e){');
  const b=main?{select:'x0e',arg:'ae',scope:'$e',local:'gt',composer:'Qm',set:'ln',store:'jt',defaultSet:'Te',pendingSet:'Pe',pending:'pt',fallback:'We',agent:'Je',retainer:'Ca',seed:'e1t'}:{select:'hz',arg:'me',scope:'Ke',local:'yt',composer:'R1',set:'An',store:'Vt',defaultSet:'Ne',pendingSet:'He',pending:'At',fallback:'We',agent:'nt',retainer:'Ra',seed:'cEn'};
  const replace=(before,after)=>{if(source.split(before).length!==2)throw Error('global-last-agent: unsupported 7.8.12 anchor: '+before.slice(0,100));source=source.replace(before,()=>after)};
  const {arg,scope,local}=b;
  replace(`function ${b.select}(${arg},${scope}){let ${local}=${scope}??s();if(${local}&&${local}!==${b.composer}){${b.set}("agentSelections",${local},${arg});return}${b.pendingSet}(${arg})}`,`function ${b.select}(${arg},${scope}){for(const id of Object.keys(${b.store}.sessions)){if(!${b.store}.agentSelections[id])${b.set}("agentSelections",id,${b.agent}(id))}${b.retainer}.retain();t.postMessage({type:"persistLastSelectedAgent",agent:${arg}}),${b.defaultSet}(${arg}),${b.pendingSet}(${arg});let ${local}=${scope}??s();if(${local}&&${local}!==${b.composer}){/^(?:sidebar-)?pending:/.test(${local})?${b.retainer}.forget(${local}):${b.retainer}.pin(${local}),${b.set}("agentSelections",${local},${arg});return}}`);
  replace(`Pt=${b.seed}({selections:()=>${b.store}.agentSelections,pending:${b.pending},`, `Pt=${b.seed}({selections:()=>${b.store}.agentSelections,pending:()=>${b.pending}()??${b.fallback}(),`);
  return source+'\n'+uiMarker;
}

// Preserve Kilo's existing CLI state/model.json and state/vscode-model.json formats.
// This bridge was removed upstream with the old modelSelections UI store.
export async function kiloModelPreferences(client,message,post) {
  const fs=require('node:fs').promises,path=require('node:path');
  const valid=value=>value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.providerID==='string'&&value.providerID&&typeof value.modelID==='string'&&value.modelID&&(value.variant===undefined||typeof value.variant==='string');
  const selections=value=>Object.fromEntries(Object.entries(value&&typeof value==='object'&&!Array.isArray(value)?value:{}).filter(([key,pick])=>key&&valid(pick)));
  const operation=async()=>{
    const state=(await client?.path.get())?.data?.state??path.join(process.env.XDG_STATE_HOME||path.join(require('node:os').homedir(),'.local','state'),'kilo');
    const read=async file=>{try{const value=JSON.parse(await fs.readFile(file,'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid saved model preferences');return value}catch(error){if(error.code==='ENOENT')return{};throw error}};
    const file=path.join(state,'model.json'),preferredFile=path.join(state,'vscode-model.json');
    if(message.type==='requestModelSelections'){
      const [models,prefs]=await Promise.all([read(file),read(preferredFile)]);
      post({type:'modelSelectionsLoaded',requestId:message.requestId,selections:selections(models.model),...valid(prefs.preferred)?{preferred:prefs.preferred}:{}});return;
    }
    if(!valid(message)||typeof message.agent!=='string'||!message.agent)return;
    const models=await read(file);models.model={...selections(models.model),[message.agent]:{providerID:message.providerID,modelID:message.modelID}};
    await fs.mkdir(state,{recursive:true});
    const write=async(target,value)=>{const temporary=target+'.'+require('node:crypto').randomUUID()+'.tmp';try{await fs.writeFile(temporary,JSON.stringify(value,null,2),{flag:'wx'});await fs.rename(temporary,target)}finally{await fs.rm(temporary,{force:true})}};
    await write(file,models);await write(preferredFile,{preferred:{providerID:message.providerID,modelID:message.modelID,variant:message.variant??''}});
  };
  const queued=(kiloModelPreferences.queue??Promise.resolve()).then(operation);
  kiloModelPreferences.queue=queued.catch(()=>{});return queued;
}
export function patchExtension(source) {
  if(source.includes(hostMarker))return source;
  source=apply(source,[
    [/message6=\{type:"agentsLoaded",agents:visible\.map\(mapAgent\),allAgents:agents\.map\(mapAgent\),defaultAgent\}/g,
      `message6={type:"agentsLoaded",agents:visible.map(mapAgent),allAgents:agents.map(mapAgent),defaultAgent:(()=>{try{let saved=require("fs").readFileSync(${stateFile},"utf8").trim();return visible.some(a=>a.name===saved)?saved:defaultAgent}catch{return defaultAgent}})()}`,
      /allAgents:agents\.map\(mapAgent\),defaultAgent:\(\(\)=>\{try\{let saved=/g],
    [/;case"persistVariant":\{let stored2=/g,
      `;case"persistLastSelectedAgent":{if(typeof message6.agent==="string"&&message6.agent){let file4=${stateFile};require("fs").mkdirSync(require("path").dirname(file4),{recursive:!0}),require("fs").writeFileSync(file4,message6.agent,"utf8")}break}case"requestModelSelections":case"persistModelSelection":{try{await kiloModelPreferences(this.client,message6,message=>this.postMessage(message))}catch(error){console.error("[Kilo Model Preferences]",error)}break}case"persistVariant":{let stored2=`,
      /case"persistLastSelectedAgent":\{if\(typeof message6\.agent==="string"/g],
  ],'extension');
  return hostMarker+'\n'+kiloModelPreferences.toString()+'\n'+source;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const checkOnly = process.argv.includes("--check")
  const [webview, extension, ...others] = process.argv.slice(2).filter((arg) => arg !== "--check")
  if (!webview || !extension) {
    console.error("Usage: global-last-agent.mjs <webview.js> <extension.js> [agent-manager.js ...] [--check]")
    process.exit(2)
  }
  const targets = [[webview, patchWebview], [extension, patchExtension], ...others.map((file) => [file, patchWebview])]
  const updates = []
  for (const [target, patch] of targets) {
    const source = fs.readFileSync(target, "utf8")
    try { updates.push([target, source, patch(source)]) } catch (error) { console.error(`${target}: ${error.message}`); process.exit(1) }
  }
  let missing = false
  for (const [target, source, updated] of updates) {
    if (checkOnly) {
      if (updated !== source) { console.error(`Global-last-agent patch is not installed in ${target}.`); missing = true }
      else console.log(`Global-last-agent patch is installed in ${target}.`)
      continue
    }
    if (updated === source) { console.log(`Global-last-agent patch already installed in ${target}.`); continue }
    const backup = `${target}.pre-global-last-agent`
    if (!fs.existsSync(backup)) fs.copyFileSync(target, backup)
    const temporary = `${target}.global-last-agent-${process.pid}`
    fs.writeFileSync(temporary, updated, { mode: fs.statSync(target).mode & 0o777 })
    fs.renameSync(temporary, target)
    console.log(`Patched ${target} (backup ${backup})`)
  }
  if (missing) process.exit(1)
}
