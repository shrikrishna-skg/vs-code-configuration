#!/usr/bin/env node
// Change only native task-card defaults; keep Kilo's manual toggle state.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const names = ['CSn', 'Hbn']; // Local Kilo 7.8.2: editor and Agent Manager.
const before = name => `function ${name}(e,t){return e==="running"&&!t}`;
const after = name => `function ${name}(e,t){/* subagent-default-open:v1 */return!0}`;

export function patch(source, restore = false) {
  const matches = names.flatMap(name => [before(name), after(name)].flatMap(text =>
    Array.from(source.matchAll(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')), () => ({name, text}))));
  if (matches.length !== 1) throw Error('Unsupported or ambiguous subagent expansion anchor; no changes made.');
  const { name, text } = matches[0];
  return source.replace(text, restore ? before(name) : after(name));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, mode = '--apply', ...extra] = process.argv.slice(2);
  if (!target || extra.length || !['--apply', '--check', '--restore'].includes(mode)) throw Error('Usage: subagent-default-open.mjs <bundle.js> [--apply|--check|--restore]');
  const source = fs.readFileSync(target, 'utf8'), next = patch(source, mode === '--restore');
  if (mode === '--check') {
    if (source !== next) throw Error('Subagent default-open patch is missing.');
    console.log('Subagent default-open patch verified.');
  } else if (source !== next) {
    const temp = target + '.subagent-open-tmp.js';
    try {
      fs.writeFileSync(temp, next, { flag: 'wx', mode: fs.statSync(target).mode & 0o777 });
      const check = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
      if (check.status !== 0) throw Error(check.stderr || 'Syntax check failed.');
      if (fs.readFileSync(target, 'utf8') !== source) throw Error('Bundle changed while patching.');
      const backup = target + '.pre-subagent-default-open';
      if (mode === '--apply' && !fs.existsSync(backup)) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
      fs.renameSync(temp, target);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    console.log('Subagent cards updated. Reopen the Kilo view to load the bundle.');
  } else console.log('No changes needed.');
}
