#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function addMinimalTask(existing, directory = root) {
  const label = 'Kilo: Minimal CTO (experimental)';
  const inputIds = ['minimalCtoModel', 'minimalCtoEffort'];
  return {
    ...existing, version: existing.version || '2.0.0',
    tasks: [...(existing.tasks || []).filter(t => t.label !== label), {
      label, type: 'process', command: process.execPath,
      args: [path.join(directory, 'scripts/run-minimal-cto.mjs'), '--model', '${input:minimalCtoModel}', '--variant', '${input:minimalCtoEffort}', '--dir', '${workspaceFolder}'],
      presentation: { reveal: 'always', focus: true, panel: 'dedicated' }, problemMatcher: [],
    }],
    inputs: [...(existing.inputs || []).filter(i => !inputIds.includes(i.id)),
      { id: inputIds[0], type: 'promptString', description: 'Explicit provider/model for this isolated CTO session', default: 'lithosai/deepseek-ai/DeepSeek-V4.1-Flash-ultra' },
      { id: inputIds[1], type: 'pickString', description: 'Reasoning variant supported by the selected route', options: ['high', 'medium', 'low'], default: 'high' },
    ],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.some(a => a !== '--apply')) throw Error('Usage: node scripts/install-minimal-cto.mjs [--apply]');
  const file = process.env.MINIMAL_CTO_TASK_FILE || path.join(os.homedir(), 'Library/Application Support/Code/User/tasks.json');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  // Do not strip comments or guess at malformed user configuration.
  const existing = before ? JSON.parse(before) : {};
  const next = JSON.stringify(addMinimalTask(existing), null, 2) + '\n';
  const changed = before !== next;
  console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'dry-run', file, changed, label: 'Kilo: Minimal CTO (experimental)' }));
  if (args.includes('--apply') && changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (before !== null) {
      const backup = file + '.minimal-cto-' + Date.now() + '.bak';
      fs.writeFileSync(backup, before, { mode: 0o600 });
      console.log('Backup: ' + backup);
    }
    const mode = fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o600;
    const temporary = file + '.minimal-cto-tmp';
    fs.writeFileSync(temporary, next, { mode });
    fs.renameSync(temporary, file);
  }
}
