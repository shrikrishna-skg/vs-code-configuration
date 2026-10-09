#!/usr/bin/env node
// Keep the full recommendation in the menu, abbreviating only its trigger.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const bodies = [
  'let b=()=>{let A=e.agents.find(y=>y.name===e.value);return A?MWe(A):e.value||"Code"}',
  'let A=()=>{let b=e.agents.find(y=>y.name===e.value);return b?DUe(b):e.value||"Code"}',
];
const add = s => s.replace('return ', 'return /* cto-selected-label */e.value==="CTO (Recommended)"?"CTO":');
export function patch(source, restore = false) {
  const matches = bodies.flatMap(before => [before, add(before)].flatMap(text => Array.from(source.matchAll(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')), () => ({before, text}))));
  if (matches.length !== 1) throw Error('Unsupported or ambiguous CTO label anchor; no changes made.');
  const {before, text} = matches[0];
  return source.replace(text, restore ? before : add(before));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, mode = '--apply', ...extra] = process.argv.slice(2);
  if (!target || extra.length || !['--apply','--check','--restore'].includes(mode)) throw Error('Usage: cto-selected-label.mjs <bundle.js> [--apply|--check|--restore]');
  const source = fs.readFileSync(target, 'utf8'), next = patch(source, mode === '--restore');
  if (mode === '--check') {
    if (source !== next) throw Error('CTO label patch is missing.');
    console.log('CTO selected-label patch verified.');
  } else if (source !== next) {
    const temp = target + '.cto-label-tmp.js';
    try {
      fs.writeFileSync(temp, next, {flag:'wx', mode:fs.statSync(target).mode & 0o777});
      const check = spawnSync(process.execPath, ['--check',temp], {encoding:'utf8'});
      if (check.status !== 0) throw Error(check.stderr || 'Syntax check failed.');
      if (fs.readFileSync(target,'utf8') !== source) throw Error('Bundle changed while patching.');
      const backup = target + '.pre-cto-selected-label';
      if (mode === '--apply' && !fs.existsSync(backup)) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
      fs.renameSync(temp, target);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    console.log('CTO label updated. Reopen the Kilo view to load the bundle.');
  } else console.log('No changes needed.');
}
