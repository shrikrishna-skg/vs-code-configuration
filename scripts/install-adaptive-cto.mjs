#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function addAdaptiveTasks(existing, premiumModel) {
  const tasks = [
    ['coordinated work', 'cto'], ['routine edits', 'routine'], ['mechanical work', 'utility'],
  ].map(([label, mode]) => ({
    label: 'Kilo: CTO — ' + label, type: 'process', command: process.execPath,
    args: [path.join(root, 'scripts/run-adaptive-cto.mjs'), '--mode', mode, '--dir', '${workspaceFolder}', '--cto-model', '${input:adaptiveCtoModel}', '--variant', '${input:adaptiveCtoEffort}',
      ...(mode === 'cto' ? [] : ['--scope', '${input:adaptiveCtoScope}', '--check', '${input:adaptiveCtoCheck}', '--intent', '${input:adaptiveCtoIntent}'])],
    presentation: { reveal: 'always', focus: true, panel: 'dedicated' }, problemMatcher: [],
  }));
  const inputs = [
    { id: 'adaptiveCtoModel', type: 'promptString', description: 'Premium CTO provider/model (routine work uses its configured specialist instead)', default: premiumModel },
    { id: 'adaptiveCtoEffort', type: 'pickString', description: 'Reasoning variant supported by the selected routes', options: ['high', 'medium', 'low'], default: 'high' },
    { id: 'adaptiveCtoScope', type: 'promptString', description: 'Approved writable paths, comma separated and relative to the Git root. No wildcards.', default: '' },
    { id: 'adaptiveCtoCheck', type: 'promptString', description: 'Meaningful check as JSON argv, e.g. ["node","test.mjs"]. It runs before changes reach your project.', default: '' },
    { id: 'adaptiveCtoIntent', type: 'promptString', description: 'Approved task family and constraints for this session, e.g. report typography only; preserve controls.', default: '' },
  ];
  return { ...existing, version: existing.version || '2.0.0',
    tasks: [...(existing.tasks || []).filter(t => !tasks.some(added => added.label === t.label)), ...tasks],
    inputs: [...(existing.inputs || []).filter(i => !inputs.some(added => added.id === i.id)), ...inputs],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.slice(2).some(a => a !== '--apply')) throw Error('Usage: node scripts/install-adaptive-cto.mjs [--apply]');
  const base = process.env.ADAPTIVE_CTO_HOME || os.homedir();
  const file = path.join(base, 'Library/Application Support/Code/User/tasks.json');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const live = JSON.parse(fs.readFileSync(path.join(base, '.config/kilo/kilo.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  const next = JSON.stringify(addAdaptiveTasks(before ? JSON.parse(before) : {}, live.model), null, 2) + '\n';
  console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run', file, changed: next !== before, defaultAndPickerUnchanged: true }));
  if (process.argv.includes('--apply') && next !== before) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (before !== null) { const backup = file + '.adaptive-cto-' + Date.now() + '.bak'; fs.writeFileSync(backup, before, { mode: 0o600 }); console.log('Backup: ' + backup); }
    fs.writeFileSync(file + '.adaptive-tmp', next, { mode: before === null ? 0o600 : fs.statSync(file).mode & 0o777 });
    fs.renameSync(file + '.adaptive-tmp', file);
  }
}
