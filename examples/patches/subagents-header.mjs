#!/usr/bin/env node
// Restore the original 7.8.2 top header; preserve the installed native footer.
import fs from 'node:fs';
import {legacyAgentHeader,legacyAgentHeaderCSS,agentIdentityCSS} from './legacy-agent-header.mjs';
import path from 'node:path';
import {describeAgent} from './agent-presentation.mjs';
import {patchAgentIdentity} from './agent-identity-patch.mjs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const specs = [
  {panel:'i0e', context:'ur', popup:'D2', create:'C', show:'le', state:'FKn', insert:'P', bind:'gn', header:'zGn', icons:'T', heading:'L', title:'R', each:'Qt', row:'D'},
  {panel:'t0e', context:'Mr', popup:'Hm', create:'w', show:'Y', state:'URn', insert:'S', bind:'Yt', header:'CMn', icons:'L', heading:'M', title:'T', each:'Ct', row:'R'},
];
const marker = '/* subagent-header-panel:v1 */';
const one = (source, text) => {
  if (source.split(text).length !== 2) throw Error('Missing or ambiguous subagent header anchor: '+text.slice(0,70));
  return source.indexOf(text);
};
const wrapperV1 = s => `/* subagent-header:v1 */(()=>{let state=${s.state}();return ${s.create}(${s.show},{get when(){return state.agents().length>0},get children(){let region=document.createElement("div");region.dataset.component="task-header-agents";region.setAttribute("role","region");region.setAttribute("aria-label","Subagents");region.style.cssText="flex-shrink:0;min-width:0;width:100%;padding:4px 12px 8px;box-sizing:border-box;border-bottom:1px solid var(--border-weak-base,var(--vscode-widget-border))";let panel=${s.create}(${s.panel},{state,inline:!0});panel.style.cssText+=";width:100%;max-height:220px;overflow:auto;box-sizing:border-box";${s.insert}(region,panel);return region}})})()`;

const wrapperV2 = s => `/* subagent-header:v2 */(()=>{let state=${s.state}();return ${s.create}(${s.show},{get when(){return state.agents().length>0},get children(){let region=document.createElement("details"),summary=document.createElement("summary");region.dataset.component="task-header-agents";region.setAttribute("aria-label","Subagents");region.style.cssText="flex-shrink:0;min-width:0;width:100%;padding:4px 12px 8px;box-sizing:border-box;border-bottom:1px solid var(--border-weak-base,var(--vscode-widget-border))";summary.style.cssText="cursor:pointer;list-style-position:inside";let panel=${s.create}(${s.panel},{state,inline:!0});panel.style.cssText+=";width:100%;max-height:220px;overflow:auto;box-sizing:border-box";let heading=panel.querySelector('[data-slot="agent-panel-header"]');heading.style.cssText="display:inline-flex;width:calc(100% - 20px);vertical-align:middle";summary.append(heading);region.append(summary);${s.insert}(region,panel);return region}})})()`;
const wrapper = s => `/* subagent-header:v3 */(()=>{let state=${s.state}();return ${s.create}(${s.show},{get when(){return state.agents().length>0},get children(){let region=document.createElement("details"),summary=document.createElement("summary");region.dataset.component="task-header-agents";region.setAttribute("aria-label","Subagents");region.style.cssText="flex-shrink:0;min-width:0;width:100%;padding:4px 12px 8px;box-sizing:border-box;border-bottom:1px solid var(--border-weak-base,var(--vscode-widget-border))";summary.style.cssText="cursor:pointer;list-style-position:inside";let panel=${s.create}(${s.panel},{state,inline:!0,max:4});panel.style.cssText+=";width:100%;max-height:220px;overflow:auto;box-sizing:border-box";let heading=panel.querySelector('[data-slot="agent-panel-header"]');heading.style.cssText="display:inline-flex;width:calc(100% - 20px);vertical-align:middle";summary.append(heading);region.append(summary);${s.insert}(region,panel);return region}})})()`;
const iconHeaderV1 = s => `/* subagent-header-icons:v1 */if(e.inline){${s.icons}.style.flexShrink="0";${s.title}.style.marginRight="auto";${s.heading}.prepend(${s.icons})}`;
// Preserve the 7.8.2 compact icon/name preview, using current native row actions.
const iconHeaderV2 = s => `/* subagent-header-icons:v2 */if(e.inline){let preview=document.createElement("span"),extra=document.createElement("span");preview.dataset.slot="task-header-agents-preview";preview.style.cssText="display:flex;align-items:center;gap:6px;flex:1;min-width:0;overflow:hidden";extra.dataset.slot="agent-stack-extra";extra.style.flexShrink="0";${s.insert}(preview,${s.create}(${s.each},{get each(){return e.state.agents().slice(0,4)},children:agent=>{let button=${s.row}(agent).firstChild;button.dataset.legacyAgentChip="";button.title=A(agent);button.style.cssText="display:inline-flex;align-items:center;gap:5px;flex:1 1 0;min-width:26px;max-width:190px;height:24px;padding:0 4px;border-radius:4px;overflow:hidden;text-align:start";button.querySelector('[data-slot="agent-panel-status"]').remove();button.querySelector('[data-slot="agent-panel-label"]').style.cssText="min-width:0;flex:1";button.addEventListener("click",event=>event.preventDefault());return button}}));${s.insert}(extra,()=>e.state.agents().length>4?"+"+(e.state.agents().length-4):"");preview.append(extra);${s.title}.style.cssText="flex:0 1 auto;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";${s.heading}.prepend(preview)}`;
const iconHeader = s => `/* subagent-header-icons:v3 */if(e.inline){let preview=document.createElement("span"),extra=document.createElement("span");preview.dataset.slot="task-header-agents-preview";preview.style.cssText="display:flex;align-items:center;gap:6px;flex:1;min-width:144px;overflow:hidden";extra.dataset.slot="agent-stack-extra";extra.style.flexShrink="0";${s.insert}(preview,${s.create}(${s.each},{get each(){return e.state.agents().slice(0,4)},children:agent=>{let button=${s.row}(agent).firstChild;button.dataset.legacyAgentChip="";button.title=A(agent);button.style.cssText="display:inline-flex;align-items:center;gap:5px;flex:1 1 0;min-width:26px;max-width:190px;height:24px;padding:0 4px;border-radius:4px;overflow:hidden;text-align:start";button.querySelector('[data-slot="agent-panel-status"]').remove();button.querySelector('[data-slot="agent-panel-label"]').style.cssText="min-width:0;flex:1";button.addEventListener("click",event=>event.preventDefault());return button}}));${s.insert}(extra,()=>e.state.agents().length>4?"+"+(e.state.agents().length-4):"");preview.append(extra);${s.title}.style.cssText="flex:0 1 auto;min-width:0;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";${s.heading}.prepend(preview)}`;




function previousPatch(source, restore=false) {
  const matching=specs.filter(s=>source.includes(`var ${s.panel}=e=>{let t=${s.context}()`));
  if(matching.length!==1)throw Error('Unsupported or ambiguous native agent panel.');
  const s=matching[0], panelStart=one(source,`var ${s.panel}=e=>{`);
  const panelEnd=source.indexOf(`;${s.bind}(["click"]);`,panelStart);
  if(panelEnd<0)throw Error('Native agent panel ending not found.');
  const component=source.slice(panelStart,panelEnd);
  let nextComponent;
  if(component.includes(marker)) {
    one(component,marker);
    const start=component.indexOf(marker), bodyStart=start+marker.length+'let __kiloHeaderPanel=()=>{'.length;
    const bodyEnd=one(component,`};return e.inline?__kiloHeaderPanel():${s.create}(${s.popup},{`);
    const argsStart=bodyEnd+`};return e.inline?__kiloHeaderPanel():${s.create}(${s.popup},{`.length;
    const argsEnd=one(component,',get children(){return __kiloHeaderPanel()}})}');
    if(!component.endsWith(',get children(){return __kiloHeaderPanel()}})}'))throw Error('Changed native panel suffix.');
    nextComponent=component.slice(0,start)+`return ${s.create}(${s.popup},{`+component.slice(argsStart,argsEnd)+',get children(){'+component.slice(bodyStart,bodyEnd).replace(iconHeaderV1(s),'').replace(iconHeaderV2(s),'').replace(iconHeader(s),'')+'}})}';
  } else nextComponent=component;
  if(!restore) {
    const start=one(nextComponent,`return ${s.create}(${s.popup},{get open()`);
    const bodyMatch=nextComponent.slice(start).match(/,get children\(\)\{var [A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\(\),/);
    if(!bodyMatch)throw Error('Native panel body not found.');
    const contentStart=start+bodyMatch.index;
    if(!nextComponent.endsWith('}})}'))throw Error('Changed native panel ending.');
    let body=nextComponent.slice(contentStart+',get children(){'.length,-4);
    const first=body.indexOf(';');
    if(first<0)throw Error('Native panel declaration not found.');
    body=body.slice(0,first+1)+iconHeader(s)+body.slice(first+1);
    const args=nextComponent.slice(start+`return ${s.create}(${s.popup},{`.length,contentStart);
    nextComponent=nextComponent.slice(0,start)+marker+'let __kiloHeaderPanel=()=>{'+body+`};return e.inline?__kiloHeaderPanel():${s.create}(${s.popup},{`+args+',get children(){return __kiloHeaderPanel()}})}';
  }
  let next=source.slice(0,panelStart)+nextComponent+source.slice(panelEnd);
  const headerStart=one(next,s.header+'=e=>{');
  const headerEnd=next.indexOf(`;${s.bind}(["dblclick","keydown"]);`,headerStart);
  if(headerEnd<0)throw Error('Native task header ending not found.');
  let header=next.slice(headerStart,headerEnd);
  const extra=','+wrapper(s);
  for(const previous of [','+wrapperV1(s),','+wrapperV2(s),extra]) {
    if(header.includes(previous)) {one(header,previous);header=header.replace(previous,'');}
  }
  if(/\/\* subagent-header:v\d+ \*\//.test(header))throw Error('Unknown subagent header version.');
  if(!header.endsWith(')]}})}'))throw Error('Changed task header suffix.');
  if(!restore)header=header.slice(0,-5)+extra+header.slice(-5);
  return next.slice(0,headerStart)+header+next.slice(headerEnd);
}

const legacySpecs = [
  {header:'zGn',bind:'gn',provider:'io',api:'Ir:ur,Qt:Bt,Bn:yn,s3:Z3,ye:Ae,Xe:Ue,Gn:En,nt:Xe,xe:ye,bR:iQ,E:C,ue:le,St:_t,lt:fn=>fn,Ei:Xa,tn:Zt,hn:(fn,node)=>fn(node),Q:P,Ht:Qt,zb:v3,Pn:wn,Cn:fn,ot:tt,Ke:Fe,X:X,jobs:Trt'},
  {header:'CMn',bind:'Yt',provider:'ao',api:'Ir:Mr,Qt:ft,Bn:ln,s3:bv,ye:ie,Xe:Pe,Gn:mn,nt:qe,xe:ye,bR:gQ,E:w,ue:Y,St:vt,lt:fn=>fn,Ei:Er,tn:gt,hn:(fn,node)=>fn(node),Q:S,Ht:Ct,zb:JA,Pn:Gt,Cn:Mt,ot:Le,Ke:Ee,X:V,jobs:WJe'},
];
const legacyHelper='\n/* legacy-agent-header:v4:start */\n'+describeAgent.toString().replace('function describeAgent','function __kiloDescribeAgent')+'\n'+legacyAgentHeader.toString().replace('function legacyAgentHeader','function __kiloLegacyAgentHeader')+'\n/* legacy-agent-header:v4:end */\n';
const legacyStyle='\n/* legacy-agent-header:v4:start */\n'+legacyAgentHeaderCSS+agentIdentityCSS+'\n/* legacy-agent-header:v4:end */\n';
const legacyCallOriginal = s => ',/* subagent-header:v4 */__kiloLegacyAgentHeader(e,{'+s.api+'})';
const legacyCall = s => ',/* subagent-header:v4 */__kiloLegacyAgentHeader(e,{'+s.api+',provider:'+s.provider+'})';
const helperBlock=/\n\/\* legacy-agent-header:v4:start \*\/[\s\S]*?\/\* legacy-agent-header:v4:end \*\/\n/;
const stripHelper=source=>{const start='/* legacy-agent-header:v4:start */',end='/* legacy-agent-header:v4:end */';if(!source.includes(start))return source;one(source,start);one(source,end);return source.replace(helperBlock,'');};

export function patch(source,restore=false) {
  const matches=legacySpecs.filter(s=>source.includes(s.header+'=e=>{'));
  if(matches.length!==1)throw Error('Unsupported legacy header target.');
  const spec=matches[0],call=legacyCall(spec);
  let clean=source;
  for(const candidate of [legacyCallOriginal(spec),call])if(clean.includes(candidate)){one(clean,candidate);clean=clean.replace(candidate,'');}
  clean=patchAgentIdentity(stripHelper(clean),true);
  clean=previousPatch(clean,true);
  if(restore)return clean;
  const start=one(clean,spec.header+'=e=>{'),end=clean.indexOf(';'+spec.bind+'(["dblclick","keydown"]);',start);
  if(end<0)throw Error('Legacy header insertion not found.');
  const header=clean.slice(start,end);
  if(!header.endsWith(')]}})}'))throw Error('Changed header suffix.');
  return patchAgentIdentity(legacyHelper+clean.slice(0,start)+header.slice(0,-5)+call+header.slice(-5)+clean.slice(end));
}
export function patchCSS(source,restore=false) {
  let clean=stripHelper(source);
  if(!clean.includes('[data-component=agent-stack]')||!clean.includes('[data-slot=agent-panel]'))throw Error('Unsupported native agent styles.');
  if(restore)return clean;
  // Update in place: later CSS patches append after this block, and its rules do not rely on file position.
  return clean===source?clean+legacyStyle:source.replace(helperBlock,()=>legacyStyle);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), mode=args.at(-1)?.startsWith('--')?args.pop():'--apply';
  if(!args.length||!['--apply','--check','--restore'].includes(mode))throw Error('Usage: subagents-header.mjs <bundle.js>... [--apply|--check|--restore]');
  for(const target of args) {
    const source=fs.readFileSync(target,'utf8'), next=(target.endsWith('.css')?patchCSS:patch)(source,mode==='--restore');
    if(mode==='--check') {
      if(source!==next)throw Error('Subagent header patch is missing.');
    } else if(source!==next) {
      const temp=target+'.subagent-header-tmp.js';
      try {
        fs.writeFileSync(temp,next,{flag:'wx',mode:fs.statSync(target).mode&0o777});
        const check=target.endsWith('.css')?{status:0}:spawnSync(process.execPath,['--check',temp],{encoding:'utf8'});
        if(check.status!==0)throw Error(check.stderr||'Syntax check failed.');
        if(fs.readFileSync(target,'utf8')!==source)throw Error('Bundle changed while patching.');
        fs.renameSync(temp,target);
      } finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
    }
  }
  console.log('Subagent header '+(mode==='--check'?'verified.':'updated.'));
}
