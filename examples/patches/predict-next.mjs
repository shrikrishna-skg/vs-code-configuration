#!/usr/bin/env node
// Wires the predicted-next-message feature into the installed Kilo bundles.
// ponytail: chrome only. The Agent Manager composer (agent-manager.js) is not
// covered; upgrading means a second identifier table like clarify-goal.mjs uses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Tests may point this at a throwaway directory containing a stub predict-next.cjs.
const root = process.env.KILO_PREDICT_NEXT_DIR || path.dirname(fileURLToPath(import.meta.url));
const hostMarker = '/* predict-next-host:v1 */';
const helperName = 'predict-next.cjs';

const count = (s, a) => s.split(a).length - 1;

// extension.js: replicate the enhanced-prompt case's sdkClient acquisition and guard.
const extensionAnchor = 'case"enhancePrompt":{';
const extensionInsert = `case"requestNextPrompt":{${hostMarker}let sdkClient=this.client;if(!sdkClient){this.postMessage({type:"nextPromptResult",text:"",requestId:message6.requestId,sessionID:message6.sessionID});break}require(require("node:path").join(__dirname,"predict-next.cjs")).predict(sdkClient,message6,this.getSessionDirectory(message6.sessionID),this).then(data2=>{this.postMessage({type:"nextPromptResult",text:data2.text,requestId:message6.requestId,sessionID:message6.sessionID})}).catch(()=>{this.postMessage({type:"nextPromptResult",text:"",requestId:message6.requestId,sessionID:message6.sessionID})});break}`;

// webview.js: one call site at the autocomplete hook; helper block placed before
// clarify-goal's marker so permission-modes (whose own block also prepends) still verifies.
// Any installed version is removed by its marker first, so --apply also upgrades in place.
const webviewCallAnchor = 'let Be=dBn(p,U,()=>r.isConnected()),';
const webviewCallInsert = '/* predict-next-call:v2 */var __kiloNextStop=globalThis.__kiloNext.attach({input:()=>w,post:m=>p.postMessage(m),on:f=>p.onMessage(f),session:()=>t.currentSessionID(),apply:value=>{K(value),A.seedFromText(value),w.value=value,ct(),w.focus()}});Xe(()=>{t.currentSessionID();__kiloNextStop.sync()});nt(()=>__kiloNextStop());';
const webviewHelperAnchor = '/* clarify-goal-patch:v1 */';
const installedHelper = /\/\* predict-next-ui:v\d+ \*\/[\s\S]*?(?=\/\* clarify-goal-patch:v1 \*\/)/g;
const installedCall = /\/\* predict-next-call:v\d+ \*\/[\s\S]*?(?=let Be=dBn\(p,U,\(\)=>r\.isConnected\(\)\),)/g;

export function patch(source, kind, restore = false) {
  if (kind === 'extension.js') {
    const exists = source.includes(hostMarker);
    if (exists && count(source, extensionInsert) !== 1) throw Error('Unsupported predict-next host block; no changes made.');
    if (!exists && count(source, extensionAnchor) !== 1) throw Error('Unsupported predict-next host anchor; no changes made.');
    if (restore) return exists ? source.replace(extensionInsert, '') : source;
    return exists ? source : source.replace(extensionAnchor, extensionInsert + extensionAnchor);
  }
  if (kind === 'webview.js') {
    const block = fs.readFileSync(path.join(root, 'predict-next-ui.js'), 'utf8');
    if (!/^\/\* predict-next-ui:v\d+ \*\//.test(block) || block.includes(webviewHelperAnchor)) throw Error('Unsupported predict-next UI helper file; no changes made.');
    if (count(source, webviewHelperAnchor) !== 1 || count(source, webviewCallAnchor) !== 1) throw Error('Unsupported predict-next webview anchors; no changes made.');
    const bare = source.replace(installedHelper, '').replace(installedCall, '');
    if (restore) return bare;
    return bare.replace(webviewHelperAnchor, () => block + webviewHelperAnchor).replace(webviewCallAnchor, () => webviewCallInsert + webviewCallAnchor);
  }
  throw Error('Expected extension.js or webview.js');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, mode = '--apply', ...extra] = process.argv.slice(2);
  if (!target || extra.length || !['--apply', '--check', '--restore'].includes(mode)) throw Error('Usage: predict-next.mjs <extension.js|webview.js> [--apply|--check|--restore]');
  const kind = path.basename(target), source = fs.readFileSync(target, 'utf8'), next = patch(source, kind, mode === '--restore');
  if (mode === '--check') {
    if (source !== next) throw Error('predict-next patch missing or outdated: ' + kind);
    console.log('predict-next patch verified: ' + kind);
  } else {
    if (source !== next) {
      const temp = target + `.predict-next-${process.pid}.js`;
      try {
        fs.writeFileSync(temp, next, { flag: 'wx', mode: fs.statSync(target).mode & 0o777 });
        const check = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
        if (check.status !== 0) throw Error(check.stderr || 'Syntax check failed.');
        if (fs.readFileSync(target, 'utf8') !== source) throw Error('Bundle changed while patching.');
        const backup = target + '.pre-predict-next';
        if (mode === '--apply' && !fs.existsSync(backup)) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
        fs.renameSync(temp, target);
      } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
      console.log(`predict-next patch ${mode === '--restore' ? 'restored' : 'applied'}: ` + kind);
    } else console.log('No changes needed: ' + kind);
  }
  if (kind === 'extension.js') {
    const from = path.join(root, helperName), to = path.join(path.dirname(target), helperName);
    if (mode === '--check') {
      if (!fs.existsSync(to) || !fs.readFileSync(from).equals(fs.readFileSync(to))) throw Error('predict-next backend helper missing or outdated.');
    } else if (mode === '--restore') {
      if (fs.existsSync(to)) fs.unlinkSync(to);
    } else fs.copyFileSync(from, to);
  }
}
