#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { adaptiveConfig, names, specialistModel } from '../examples/cto/adaptive/profile.mjs';
import { createRoutine, release } from '../examples/cto/adaptive/session.mjs';
import { discoverBinary, atomic, home, update } from '../examples/cto/manager.mjs';

const { values } = parseArgs({ options: Object.fromEntries(['mode', 'dir', 'scope', 'check', 'intent', 'cto-model', 'variant'].map(k => [k, { type: 'string' }])) });
const mode = values.mode || 'cto';
const directory = fs.realpathSync(values.dir || process.cwd());
const configPath = process.env.CTO_CONFIG || path.join(os.homedir(), '.config/kilo/kilo.jsonc');
const live = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const ponytail = process.env.CTO_PONYTAIL_FILE || path.join(os.homedir(), '.config/ponytail/AGENTS.md');
const agents = process.env.CTO_AGENT_DIR || path.join(os.homedir(), '.config/kilo/agent');
const premiumModel = values['cto-model'] || live.model;
if (!premiumModel?.includes('/')) throw Error('Select an explicit premium CTO provider/model.');
const model = mode === 'cto' ? premiumModel : specialistModel(mode, agents);
const variant = values.variant || 'high';
let job, child;
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-adaptive-'));
try {
  if (mode !== 'cto') {
    const check = JSON.parse(values.check || '[]');
    if (!Array.isArray(check) || !check.length || check.some(v => typeof v !== 'string')) throw Error('Provide one meaningful check as a JSON argv array, e.g. ["node","test.mjs"].');
    job = await createRoutine({ workspace: directory, role: mode === 'utility' ? 'utility' : 'implementer', title: 'Interactive ' + mode,
      task: values.intent || '', acceptance: values.intent || '', scopes: (values.scope || '').split(',').map(s => s.trim()).filter(Boolean), checks: [check] }, model);
  }
  const sessionFile = job ? path.join(home, 'jobs', job.id, 'session.json') : undefined;
  if (job) atomic(sessionFile, { id: job.id, premiumModel, variant, configPath });
  const config = adaptiveConfig(live, { mode, model, variant, ponytail, sessionFile, contract: job && { ...job, intent: values.intent } });
  console.log(`${names[mode]} | ${model}\n${job ? 'Scoped snapshot: ' + job.scopes.join(', ') + '\nChanges reach the original project only after routine_publish passes.' : 'Coordinated work: existing 14-worker / 6-writer shared pool.'}`);
  child = spawn(discoverBinary(), ['run', '--interactive', '--pure', '--agent', names[mode], '--model', model, '--variant', variant, '--dir', job?.worktree || directory], {
    cwd: job?.worktree || directory, stdio: 'inherit',
    env: { ...process.env, XDG_CONFIG_HOME: isolated, KILO_CONFIG: '', KILO_CONFIG_DIR: '', KILO_CONFIG_CONTENT: JSON.stringify(config), CTO_CONFIG: configPath, CTO_PONYTAIL_FILE: ponytail, CTO_AGENT_DIR: agents },
  });
  if (job) child.once('spawn', () => { update(job.id, { childPid: child.pid, executorPid: child.pid }).catch(() => {}); });
  const stop = () => { child.kill('SIGTERM'); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.exitCode = await new Promise(resolve => { child.once('error', error => { console.error(error.message); resolve(1); }); child.once('close', code => resolve(code ?? 1)); });
} finally {
  if (job) await release(job.id);
  fs.rmSync(isolated, { recursive: true, force: true });
}
