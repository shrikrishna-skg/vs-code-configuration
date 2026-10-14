#!/usr/bin/env node
// Wires the Session map (button left of ✦ Prompts, overlay over the chat) into the installed Kilo bundles.
// ponytail: chat webview only. The Agent Manager composer (agent-manager.js) is not covered;
// upgrading means a second call-site anchor like clarify-goal.mjs keeps for agent-manager.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Tests may point this at a throwaway directory with stub helper files.
const root = process.env.KILO_SESSION_MAP_DIR || path.dirname(fileURLToPath(import.meta.url));
const helpers = ['session-map.cjs', 'session-map-host.cjs'];
const count = (s, a) => s.split(a).length - 1;
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

// extension.js: same sdkClient acquisition as the predict-next host block, placed before enhancePrompt.
const hostMarker = '/* session-map-host:v1 */';
const extensionAnchor = 'case"enhancePrompt":{';
// Every path, including a synchronous throw (missing helper, bad directory), replies with sessionMapResult.
const extensionInsert = `case"requestSessionMap":{${hostMarker}const smFail=err=>{this.postMessage({type:"sessionMapResult",error:String(err&&err.message||err),requestId:message6.requestId})};try{let sdkClient=this.client;if(!sdkClient){smFail("Kilo is not connected yet.");break}require(require("node:path").join(__dirname,"session-map-host.cjs")).load(sdkClient,message6,this.getSessionDirectory(message6.sessionID)).then(map=>{this.postMessage({type:"sessionMapResult",map,requestId:message6.requestId})}).catch(smFail)}catch(err){smFail(err)}break}`;

// webview.js: one fenced block in the composer setup, before predict-next's call when present
// (predict-next strips only its own marker..anchor span, so this block survives its re-apply).
const callAnchor = 'let Be=dBn(p,U,()=>r.isConnected()),';
const callStart = '/* session-map-call:v1 */', callEnd = '/* end session-map-call */';
const installedCall = /\/\* session-map-call:v\d+ \*\/[\s\S]*?\/\* end session-map-call \*\//g;
const predictCall = /\/\* predict-next-call:v\d+ \*\//;

// webview.css: fenced block appended at the end.
const cssStart = '/* kilo-session-map:v1 */', cssEnd = '/* end kilo-session-map */';
const installedCss = /\/\* kilo-session-map:v\d+ \*\/[\s\S]*?\/\* end kilo-session-map \*\/\n?/g;

function callBlock() {
  const ui = read('session-map-ui.js'), attach = read('session-map-attach.js');
  if (!ui.startsWith('/* session-map-ui:v')) throw Error('Unsupported session-map UI file; no changes made.');
  for (const part of [ui, attach]) if (part.includes(callEnd) || part.includes(callStart)) throw Error('Session map helper contains a fence marker; no changes made.');
  return `${callStart}if(!globalThis.__kiloSessionMap){${ui}\n}${attach}${callEnd}`;
}

export function patch(source, kind, restore = false) {
  if (kind === 'extension.js') {
    const exists = source.includes(hostMarker);
    if (exists && count(source, extensionInsert) !== 1) throw Error('Unsupported session-map host block; no changes made.');
    if (!exists && count(source, extensionAnchor) !== 1) throw Error('Unsupported session-map host anchor; no changes made.');
    if (restore) return exists ? source.replace(extensionInsert, '') : source;
    return exists ? source : source.replace(extensionAnchor, extensionInsert + extensionAnchor);
  }
  if (kind === 'webview.js') {
    const bare = source.replace(installedCall, '');
    if (count(bare, callAnchor) !== 1) throw Error('Unsupported session-map webview anchor; no changes made.');
    if (restore) return bare;
    const at = bare.search(predictCall), anchorAt = bare.indexOf(callAnchor);
    const where = at >= 0 && at < anchorAt ? at : anchorAt;
    return bare.slice(0, where) + callBlock() + bare.slice(where);
  }
  if (kind === 'webview.css') {
    const css = read('session-map.css').trim();
    if (!css.startsWith(cssStart) || !css.endsWith(cssEnd) || css.slice(0, -cssEnd.length).includes(cssEnd)) throw Error('Unsupported session-map CSS file; no changes made.');
    const bare = source.replace(installedCss, '');
    return restore ? bare : bare + (bare.endsWith('\n') ? '' : '\n') + css + '\n';
  }
  throw Error('Expected extension.js, webview.js or webview.css');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, mode = '--apply', ...extra] = process.argv.slice(2);
  if (!target || extra.length || !['--apply', '--check', '--restore'].includes(mode)) throw Error('Usage: session-map.mjs <extension.js|webview.js|webview.css> [--apply|--check|--restore]');
  const kind = path.basename(target), source = fs.readFileSync(target, 'utf8'), next = patch(source, kind, mode === '--restore');
  if (mode === '--check') {
    if (source !== next) throw Error('session-map patch missing or outdated: ' + kind);
    console.log('session-map patch verified: ' + kind);
  } else if (source !== next) {
    const temp = target + `.session-map-${process.pid}${path.extname(target)}`;
    try {
      fs.writeFileSync(temp, next, { flag: 'wx', mode: fs.statSync(target).mode & 0o777 });
      if (kind.endsWith('.js')) {
        const check = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
        if (check.status !== 0) throw Error(check.stderr || 'Syntax check failed.');
      }
      if (fs.readFileSync(target, 'utf8') !== source) throw Error('Bundle changed while patching.');
      const backup = target + '.pre-session-map';
      if (mode === '--apply' && !fs.existsSync(backup)) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
      fs.renameSync(temp, target);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    console.log(`session-map patch ${mode === '--restore' ? 'restored' : 'applied'}: ` + kind);
  } else console.log('No changes needed: ' + kind);
  if (kind === 'extension.js') {
    for (const name of helpers) {
      const from = path.join(root, name), to = path.join(path.dirname(target), name);
      if (mode === '--check') {
        if (!fs.existsSync(to) || !fs.readFileSync(from).equals(fs.readFileSync(to))) throw Error('session-map helper missing or outdated: ' + name);
      } else if (mode === '--restore') {
        if (fs.existsSync(to)) fs.unlinkSync(to);
      } else fs.copyFileSync(from, to);
    }
  }
}
