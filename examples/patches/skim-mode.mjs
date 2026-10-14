#!/usr/bin/env node
// Skim mode for Kilo chat replies: the first sentence of each point stays bright, the detail is dimmed.
// The helper only paints with the CSS Custom Highlight API, so it needs no anchor inside the minified code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const clarifyMarker = '/* clarify-goal-patch:v1 */';
const installed = /\/\* skim-mode-ui:v\d+ \*\/[\s\S]*?\/\* end skim-mode-ui \*\/\n/g;
// Sits before predict-next's block when present: that patch owns everything from its marker to clarify-goal's.
const anchor = /\/\* predict-next-ui:v\d+ \*\/|\/\* clarify-goal-patch:v1 \*\//;
const count = (s, a) => s.split(a).length - 1;

export function patch(source, restore = false, block = fs.readFileSync(path.join(root, 'skim-mode-ui.js'), 'utf8')) {
  if (!/^\/\* skim-mode-ui:v\d+ \*\//.test(block) || !block.endsWith('/* end skim-mode-ui */\n') || count(block, '/* end skim-mode-ui */') !== 1) throw Error('Unsupported skim-mode helper file; no changes made.');
  if (count(source, clarifyMarker) !== 1) throw Error('Unsupported skim-mode anchor; no changes made.');
  const bare = source.replace(installed, '');
  if (restore) return bare;
  const at = bare.search(anchor);
  return bare.slice(0, at) + block + bare.slice(at);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, mode = '--apply', ...extra] = process.argv.slice(2);
  if (!target || extra.length || !['--apply', '--check', '--restore'].includes(mode) || !target.endsWith('.js')) throw Error('Usage: skim-mode.mjs <webview.js|agent-manager.js> [--apply|--check|--restore]');
  const name = path.basename(target), source = fs.readFileSync(target, 'utf8'), next = patch(source, mode === '--restore');
  if (mode === '--check') {
    if (source !== next) throw Error('Skim mode patch missing or outdated: ' + name);
    console.log('Skim mode verified: ' + name);
  } else if (source !== next) {
    const temp = target + `.skim-mode-${process.pid}.js`;
    try {
      fs.writeFileSync(temp, next, { flag: 'wx', mode: fs.statSync(target).mode & 0o777 });
      const check = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
      if (check.status !== 0) throw Error(check.stderr || 'Syntax check failed.');
      if (fs.readFileSync(target, 'utf8') !== source) throw Error('Bundle changed while patching.');
      const backup = target + '.pre-skim-mode';
      if (mode === '--apply' && !fs.existsSync(backup)) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
      fs.renameSync(temp, target);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    console.log(`Skim mode ${mode === '--restore' ? 'restored' : 'applied'}: ` + name);
  } else console.log('No changes needed: ' + name);
}
