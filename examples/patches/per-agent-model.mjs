#!/usr/bin/env node
// Kilo 7.8.12: a new chat opens on the selected agent's own model (remembered pick,
// then its `model:` pin); Kilo's global "preferred" model becomes the fallback.
// Apply to dist/webview.js and dist/agent-manager.js (same resolver in both).

import fs from "node:fs"
import { pathToFileURL } from "node:url"

const id = "[\\w$]+"

const marker='/* per-agent-model:7.8.12:v1 */';
const lastPickMarker='/* per-agent-model:last-pick:v1 */';
// 7.8.12 remembers a model/variant pick only in a draft chat, so a pick made inside an
// existing chat never reaches the next new chat. Remember every explicit pick; Ca/Ra.retain()
// inside the remember function pins every open chat first, so other chats keep their model.
export function patchLastPick(source) {
  if(source.includes(lastPickMarker))return source;
  const main=source.includes('function Rbe(e,t,n,r){return Omt(');
  const b=main?{select:'No',draft:'yt',remember:'Po',agent:'ae',pick:'$e',local:'Et'}:{select:'wo',draft:'xt',remember:'mo',agent:'me',pick:'Ke',local:'Qt'};
  const pairs=[[`if(${b.select}.select(${b.agent},${b.pick},${b.local}),${b.draft}(${b.local})){`,`if(${b.select}.select(${b.agent},${b.pick},${b.local}),!0){`],[`draft:${b.draft},remember:${b.remember}`,`draft:()=>!0,remember:${b.remember}`]];
  for(const [before] of pairs)if(source.split(before).length!==2)throw Error('per-agent-model: unsupported 7.8.12 last-pick anchor: '+before);
  for(const [before,after] of pairs)source=source.replace(before,()=>after);
  return source+'\n'+lastPickMarker;
}
export function patch(source) {
  return patchLastPick(patchPerAgent(source));
}
function patchPerAgent(source) {
  if(source.includes(marker))return source;
  const main=source.includes('function Rbe(e,t,n,r){return Omt(');
  const b=main?{resolve:'pZ',model:'Omt',current:'Rbe',defaults:'jmt',lookup:'mnr',store:'jt',set:'ln',remember:'Po',retain:'Ca',agent:'ae',pick:'$e',variant:'gt',local:'Et',key:'Pm',cleanup:'Xe',batch:'ws'}:{resolve:'Nfe',model:'XCn',current:'YWe',defaults:'e_n',lookup:'JDa',store:'Vt',set:'An',remember:'mo',retain:'Ra',agent:'me',pick:'Ke',variant:'yt',local:'Qt',key:'F1',cleanup:'qe',batch:'Ha'};
  const replace=(before,after)=>{if(source.split(before).length!==2)throw Error('per-agent-model: unsupported 7.8.12 anchor: '+before.slice(0,100));source=source.replace(before,()=>after)};
  replace('r=n(e.session)??n(e.mode)??n(e.global)','r=n(e.session)??n(e.override)??n(e.mode)??n(e.preferred)??n(e.global)');
  replace(`function ${b.model}(e,t,n,r){return ${b.resolve}({providers:e.providers,connected:e.connected,ready:e.ready,organizationId:e.organizationId,defaults:e.defaults,session:n,mode:e.getModeModel(t),global:e.getGlobalModel(),recent:r,fallback:e.fallback})}`,`function ${b.model}(e,t,n,r,agentPick,preferred){return ${b.resolve}({providers:e.providers,connected:e.connected,ready:e.ready,organizationId:e.organizationId,defaults:e.defaults,session:n,override:agentPick,mode:e.getModeModel(t),preferred,global:e.getGlobalModel(),recent:r,fallback:e.fallback})}`);
  replace(`function ${b.current}(e,t,n,r){return ${b.model}(t,r,${b.lookup}(e,n,r),e.recentModels)}`,`function ${b.current}(e,t,n,r){return ${b.model}(t,r,${b.lookup}(e,n,r),e.recentModels,e.sessionOverrides.__kiloPerAgent?.[r],e.sessionOverrides.__kiloPreferred)}`);
  replace(`function ${b.defaults}(e,t,n){return ${b.model}(t,n,void 0,e.recentModels)}`,`function ${b.defaults}(e,t,n){return ${b.model}(t,n,void 0,e.recentModels,e.sessionOverrides.__kiloPerAgent?.[n],e.sessionOverrides.__kiloPreferred)}`);
  const {agent,pick,variant,local}=b;
  replace(`function ${b.remember}(${agent},${pick},${variant}){${b.retain}.retain();let ${local}=`, `const kiloPreferenceState={revision:0,picks:{},preferred:null};function ${b.remember}(${agent},${pick},${variant}){${b.retain}.retain();const revision=++kiloPreferenceState.revision;kiloPreferenceState.picks[${agent}]={revision,model:{providerID:${pick}.providerID,modelID:${pick}.modelID}};kiloPreferenceState.preferred={revision,model:{providerID:${pick}.providerID,modelID:${pick}.modelID,variant:${variant}}};${b.set}("sessionOverrides","__kiloPerAgent",${agent},{providerID:${pick}.providerID,modelID:${pick}.modelID}),${b.set}("sessionOverrides","__kiloPreferred",{providerID:${pick}.providerID,modelID:${pick}.modelID,variant:${variant}}),t.postMessage({type:"persistModelSelection",agent:${agent},providerID:${pick}.providerID,modelID:${pick}.modelID,variant:${variant}});let ${local}=`);
  const load=`const requests=new Map;let sequence=0,accepted=0;const request=()=>{const requestId="per-agent-"+crypto.randomUUID();requests.set(requestId,{revision:kiloPreferenceState.revision,sequence:++sequence});t.postMessage({type:"requestModelSelections",requestId})};const kiloModelPreferences=t.onMessage(message=>{if(message.type==="agentsLoaded"||message.type==="providersLoaded")request();if(message.type==="modelSelectionsLoaded"){const at=requests.get(message.requestId);requests.delete(message.requestId);if(!at||at.sequence<=accepted)return;accepted=at.sequence;const fresh=Object.fromEntries(Object.entries(kiloPreferenceState.picks).filter(([,entry])=>entry.revision>at.revision).map(([agent,entry])=>[agent,entry.model]));const preferred=kiloPreferenceState.preferred;${b.batch}(()=>{${b.set}("sessionOverrides","__kiloPerAgent",void 0);${b.set}("sessionOverrides","__kiloPerAgent",{...(message.selections??{}),...fresh});${b.set}("sessionOverrides","__kiloPreferred",preferred&&preferred.revision>at.revision?preferred.model:message.preferred)});for(const [agent,entry]of Object.entries(kiloPreferenceState.picks))if(entry.revision<=at.revision)delete kiloPreferenceState.picks[agent];if(preferred&&preferred.revision<=at.revision)kiloPreferenceState.preferred=null}});request();${b.cleanup}(kiloModelPreferences);`;
  replace('t.postMessage({type:"requestRecents"})','(()=>{'+load+'})(),t.postMessage({type:"requestRecents"})');
  return source+'\n'+marker;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const checkOnly = process.argv.includes("--check")
  const targets = process.argv.slice(2).filter((arg) => arg !== "--check" && arg !== "--apply")
  if (!targets.length) {
    console.error("Usage: per-agent-model.mjs <webview.js> [agent-manager.js ...] [--check]")
    process.exit(2)
  }
  let failed = false
  for (const target of targets) {
    const source = fs.readFileSync(target, "utf8")
    let updated
    try { updated = patch(source) } catch (error) { console.error(`${target}: ${error.message}`); failed = true; continue }
    if (checkOnly) {
      if (updated !== source) { console.error(`Per-agent model patch is not installed in ${target}.`); failed = true }
      else console.log(`Per-agent model patch is installed in ${target}.`)
      continue
    }
    if (updated === source) { console.log(`Per-agent model patch already installed in ${target}.`); continue }
    const backup = `${target}.pre-per-agent-model`
    if (!fs.existsSync(backup)) fs.copyFileSync(target, backup)
    const temporary = `${target}.per-agent-model-${process.pid}`
    fs.writeFileSync(temporary, updated, { mode: fs.statSync(target).mode & 0o777 })
    fs.renameSync(temporary, target)
    console.log(`Patched ${target} (backup ${backup})`)
  }
  if (failed) process.exit(1)
}
