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
const sendAnchor = 'ei=[fo,q0,Xo,ur,ze].filter(Boolean)';
const sendPatched = 'ei=[fo,q0,Xo,ur,/* pinned-append-send:v1 */globalThis.__kiloPin?.append(ze)??ze].filter(Boolean)';
// Footer: `fo` is the right-hand action group; `ze` is the composer root and `zr` the footer row.
const footerAnchor = 'Q(fo,E(()=>globalThis.__kiloPermissionMenu(p,nt,';
const installed = /Q\(fo,E\(\(\)=>\/\* pinned-append:v\d+ \*\/[\s\S]*?(?=Q\(fo,E\(\(\)=>globalThis\.__kiloPermissionMenu\(p,nt,)/g;

export function patch(source, restore = false) {
  const helper = fs.readFileSync(path.join(root, 'pinned-append-ui.js'), 'utf8').trim();
  if (!helper.startsWith('(globalThis.__kiloPin ??=') || helper.includes('/* pinned-append')) throw Error('Unsupported pinned-append UI helper file; no changes made.');
  if (count(source, footerAnchor) !== 1) throw Error('Unsupported pinned-append footer anchor; no changes made.');
  if (count(source, sendAnchor) + count(source, sendPatched) !== 1) throw Error('Unsupported pinned-append send anchor; no changes made.');
  const bare = source.replace(installed, '').replace(sendPatched, sendAnchor);
  if (restore) return bare;
  return bare
    .replace(sendAnchor, () => sendPatched)
    .replace(footerAnchor, () => 'Q(fo,E(()=>/* pinned-append:v1 */' + helper + '.button(ze,zr,nt),{}),null),' + footerAnchor);
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
