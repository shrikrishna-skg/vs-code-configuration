#!/usr/bin/env node
// Sample 1: restyle only the native composer actions; retain handlers and labels.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const variants = [
  {component:'Cn',send:'gt',enabled:'nn',label:'vn',locale:'u'},
  {component:'Ut',send:'ft',enabled:'dn',label:'Dn',locale:'u'},
  {component:'fn',send:'Yc',enabled:'ut',label:'zi',locale:'p'},
  {component:'Mt',send:'gc',enabled:'mt',label:'ei',locale:'p'},
];
export function anchors(v) {
  const send = `icon:"send",variant:"ghost",size:"small",onClick:${v.send},get disabled(){return!${v.enabled}()},get"aria-label"(){return ${v.label}()}`;
  return [
    `(${v.component},{${send}})`,
    `(${v.component},{${send},get children(){return ${v.locale??'u'}.t("prompt.goal.start")}})`,
    `(${v.component},{icon:"stop",variant:"ghost",size:"small",onClick:()=>t.abort(),get"aria-label"(){return ${v.locale??'u'}.t("prompt.action.stop")}})`,
  ];
}
const styled = text => text.replace('icon:"send"', 'icon:"arrow-up"').replace('variant:"ghost"', 'class:"kilo-composer-action",variant:"ghost"');
const legacyStart = '/* kilo-composer-orange-actions:v1 */';
const previousStart = '/* kilo-composer-orange-actions:v2 */';
const start = '/* kilo-composer-orange-actions:v3 */';
const end = '/* end kilo-composer-orange-actions */';
const legacyCss = `${legacyStart}
[data-component="icon-button"].kilo-composer-action[data-variant="ghost"] {
  width:36px;height:36px;min-width:36px;padding:0;border:0;border-radius:9px;
  background:#de735b;color:#fff;box-shadow:none;cursor:pointer;
}
[data-component="icon-button"].kilo-composer-action[data-variant="ghost"][data-content="true"] {width:auto;padding:0 10px;gap:6px;aspect-ratio:auto}
[data-component="icon-button"].kilo-composer-action[data-variant="ghost"] [data-slot="icon-svg"] {width:22px;height:22px;color:inherit}
[data-component="icon-button"].kilo-composer-action[data-variant="ghost"]:hover:not(:disabled) {background:#ca624b}
[data-component="icon-button"].kilo-composer-action[data-variant="ghost"]:active:not(:disabled) {background:#b6533e}
[data-component="icon-button"].kilo-composer-action[data-variant="ghost"]:focus-visible:not(:disabled):not([aria-disabled="true"]) {outline:2px solid var(--vscode-focusBorder,#3794ff);outline-offset:2px}
[data-component="icon-button"].kilo-composer-action[data-variant="ghost"]:disabled {opacity:.4;cursor:not-allowed}
[data-component="icon-button"].kilo-composer-action[data-variant="ghost"][data-icon="stop"] [data-slot="icon-svg"] rect {animation:none}
@media (forced-colors:active) {
  [data-component="icon-button"].kilo-composer-action[data-variant="ghost"] {background:ButtonFace;color:ButtonText;border:1px solid ButtonText;forced-color-adjust:auto}
  [data-component="icon-button"].kilo-composer-action[data-variant="ghost"]:disabled {color:GrayText;opacity:1}
  [data-component="icon-button"].kilo-composer-action[data-variant="ghost"]:focus-visible:not(:disabled):not([aria-disabled="true"]) {outline-color:Highlight}
}
${end}`;
const previousCss = legacyCss
  .replace(legacyStart, previousStart)
  .replace('border-radius:9px', 'border-radius:6px')
  .replace('color:inherit}', 'color:#fff!important;opacity:1}')
  .replace(':disabled {opacity:.4;cursor:not-allowed}', ':disabled {opacity:1;background:#805449;cursor:not-allowed}')
  .replace('@media (forced-colors:active) {', '@media (forced-colors:active) {\n  [data-component="icon-button"].kilo-composer-action[data-variant="ghost"] [data-slot="icon-svg"] {color:ButtonText!important}\n  [data-component="icon-button"].kilo-composer-action[data-variant="ghost"]:disabled [data-slot="icon-svg"] {color:GrayText!important}');
export const css = previousCss
  .replace(previousStart, start)
  .replace('background:#805449', 'background:#c16c55')
  .replace('rect {animation:none}', 'rect {animation:none;transform:scale(1.4);transform-box:fill-box;transform-origin:center}');
const count = (s, text) => s.split(text).length - 1;
export function patch(source, kind = 'js', restore = false) {
  if (kind === 'css') {
    if (!source.includes('[data-component=icon-button]') || !source.includes('.prompt-input-container')) throw Error('Unsupported composer CSS; no changes made.');
    for (const block of [legacyCss, previousCss, css]) {
      const marker = block.split("\n", 1)[0];
      if (!source.includes(marker)) continue;
      if (count(source,block)!==1 || count(source,end)!==1) throw Error('Ambiguous or modified composer CSS; no changes made.');
      if (block===css && !restore) return source;
      source=source.replace('\n'+block+'\n','');
    }
    if (source.includes('/* kilo-composer-orange-actions:') || source.includes(end)) throw Error('Unknown composer CSS version; no changes made.');
    return restore ? source : source+'\n'+css+'\n';
  }

  const matches = variants.filter(v=>anchors(v).every(a=>count(source,a)+count(source,styled(a))===1));
  if (matches.length!==1) throw Error('Unsupported or ambiguous composer action anchors; no changes made.');
  let result=source;
  for(const a of anchors(matches[0])) result=result.replace(restore?styled(a):a,restore?a:styled(a));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [target,mode='--apply',...extra]=process.argv.slice(2);
  if(!target || extra.length || !['--apply','--check','--restore'].includes(mode) || !/\.(js|css)$/.test(target)) throw Error('Usage: composer-orange-actions.mjs <bundle.js|bundle.css> [--apply|--check|--restore]');
  const kind=path.extname(target).slice(1),source=fs.readFileSync(target,'utf8'),next=patch(source,kind,mode==='--restore');
  if(mode==='--check') {
    if(source!==next) throw Error('Orange composer actions patch is missing.');
    console.log('Orange composer actions verified.');
  } else if(source!==next) {
    const temp=target+`.orange-actions-${process.pid}.${kind}`;
    try {
      fs.writeFileSync(temp,next,{flag:'wx',mode:fs.statSync(target).mode&0o777});
      if(kind==='js') {
        const check=spawnSync(process.execPath,['--check',temp],{encoding:'utf8'});
        if(check.status!==0) throw Error(check.stderr||'Syntax check failed.');
      }
      if(fs.readFileSync(target,'utf8')!==source) throw Error('Bundle changed while patching.');
      const backup=target+'.pre-composer-orange-actions';
      if(mode==='--apply'&&!fs.existsSync(backup)) fs.copyFileSync(target,backup,fs.constants.COPYFILE_EXCL);
      fs.renameSync(temp,target);
    } finally {if(fs.existsSync(temp)) fs.unlinkSync(temp);}
    console.log('Orange composer actions updated. Reopen the Kilo view to load them.');
  } else console.log('No changes needed.');
}
