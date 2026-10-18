#!/usr/bin/env node
// Footer pin button left of the Auto permission control: when on, typed messages are sent with
// the pinned Prompts-panel prompts appended (blank line, then one prompt per line).
// ponytail: sidebar/editor chat (webview.js) only; the Agent Manager composer needs its own anchors.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = process.env.KILO_PIN_APPEND_DIR || path.dirname(fileURLToPath(import.meta.url));
const count = (s, a) => s.split(a).length - 1;

// Send path: the typed text `ze` is the last part joined into the outgoing message.
const legacySendAnchor = 'ei=[fo,q0,Xo,ur,ze].filter(Boolean)';
const legacySendPatched = 'ei=[fo,q0,Xo,ur,/* pinned-append-send:v1 */globalThis.__kiloPin?.append(ze)??ze].filter(Boolean)';
// Footer: `fo` is the right-hand action group; `ze` is the composer root and `zr` the footer row.
const legacyFooterAnchor = 'Q(fo,E(()=>globalThis.__kiloPermissionMenu(p,nt,';
const installed = /Q\(fo,E\(\(\)=>\/\* pinned-append:v\d+ \*\/[\s\S]*?(?=Q\(fo,E\(\(\)=>globalThis\.__kiloPermissionMenu\(p,nt,)/g;
// Prompts panel loads its list once; reload it when the pin popover saves, so its next save can't undo ours.
// Optional: skipped when the (unscripted) v6 Prompts panel is absent.
const reloadAnchor = 'promptSuggestionsSave=()=>{try{localStorage.setItem(promptSuggestionsStorageKey,JSON.stringify(promptSuggestionsItems))}catch{}},';
const reloadPatched = reloadAnchor + 'promptSuggestionsReload=/* pinned-append-reload:v1 */(h=>(window.addEventListener("kilo-prompt-suggestions-changed",h),nt(()=>window.removeEventListener("kilo-prompt-suggestions-changed",h)),h))(()=>{promptSuggestionsItems=promptSuggestionsLoad(),renderPromptSuggestions()}),';

export function patch(source, restore = false) {
  const helper = fs.readFileSync(path.join(root, 'pinned-append-ui.js'), 'utf8').trim();
  if (!helper.startsWith('(globalThis.__kiloPin ??=') || helper.includes('/* pinned-append')) throw Error('Unsupported pinned-append UI helper file; no changes made.');
  const stable=source.includes('P(X1,C(()=>globalThis.__kiloPermissionMenu(m,Xe,');
  const sendAnchor=stable?'Lg=[Tu,X1,Tg,ey,Ge].filter(Boolean)':legacySendAnchor;
  const sendPatched=stable?'Lg=[Tu,X1,Tg,ey,/* pinned-append-send:v1 */globalThis.__kiloPin?.append(Ge)??Ge].filter(Boolean)':legacySendPatched;
  const footerAnchor=stable?'P(X1,C(()=>globalThis.__kiloPermissionMenu(m,Xe,':legacyFooterAnchor;
  const injected=stable?/P\(X1,C\(\(\)=>\/\* pinned-append:v\d+ \*\/[\s\S]*?(?=P\(X1,C\(\(\)=>globalThis\.__kiloPermissionMenu\(m,Xe,)/g:installed;
  if (count(source, footerAnchor) !== 1) throw Error('Unsupported pinned-append footer anchor; no changes made.');
  if (count(source, sendAnchor) + count(source, sendPatched) !== 1) throw Error('Unsupported pinned-append send anchor; no changes made.');
  const reload=stable?reloadPatched.replace('nt(()=>','Xe(()=>'):reloadPatched;
  const bare = source.replace(injected, '').replace(sendPatched, sendAnchor).replace(reload, reloadAnchor);
  if (restore) return bare;
  const out = bare
    .replace(sendAnchor, () => sendPatched)
    .replace(footerAnchor, () => (stable?'P(X1,C(()=>/* pinned-append:v1 */':'Q(fo,E(()=>/* pinned-append:v1 */') + helper + (stable?'.button(Ge,ci,Xe),{})),':'.button(ze,zr,nt),{}),null),') + footerAnchor);
  return count(out, reloadAnchor) === 1 ? out.replace(reloadAnchor, () => reload) : out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, mode = '--apply', ...extra] = process.argv.slice(2);
  if (!target || extra.length || path.basename(target) !== 'webview.js' || !['--apply', '--check', '--restore'].includes(mode)) throw Error('Usage: pinned-append.mjs <webview.js> [--apply|--check|--restore]');
  const source = fs.readFileSync(target, 'utf8'), next = patch(source, mode === '--restore');
  if (mode === '--check') {
    if (source !== next) throw Error('pinned-append patch missing or outdated');
    console.log('pinned-append patch verified');
  } else if (source === next) console.log('No changes needed');
  else {
    const temp = target + `.pinned-append-${process.pid}.js`;
    try {
      fs.writeFileSync(temp, next, { flag: 'wx', mode: fs.statSync(target).mode & 0o777 });
      const check = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
      if (check.status !== 0) throw Error(check.stderr || 'Syntax check failed.');
      if (fs.readFileSync(target, 'utf8') !== source) throw Error('Bundle changed while patching.');
      const backup = target + '.pre-pinned-append';
      if (mode === '--apply' && !fs.existsSync(backup)) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
      fs.renameSync(temp, target);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    console.log(`pinned-append patch ${mode === '--restore' ? 'restored' : 'applied'}`);
  }
}
