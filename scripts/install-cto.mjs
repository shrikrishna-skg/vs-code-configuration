#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const live = process.env.CTO_INSTALL_DIR || path.join(os.homedir(), '.config/kilo');
const state = process.env.CTO_SELECTION_FILE || path.join(os.homedir(), '.local/state/kilo/last-selected-agent');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const args = process.argv.slice(2);

if (args[0] === '--restore') {
  const manifest = JSON.parse(fs.readFileSync(path.join(args[1], 'manifest.json'), 'utf8'));
  for (const x of manifest.files) {
    if (fs.existsSync(x.path) && hash(fs.readFileSync(x.path)) !== x.installedHash) throw Error(`Changed since installation; inspect before restoring: ${x.path}`);
  }
  for (const x of manifest.files) {
    if (x.backup) fs.copyFileSync(path.join(args[1], x.backup), x.path);
    else if (fs.existsSync(x.path)) fs.unlinkSync(x.path);
  }
  console.log('Restored the backed-up files. Task records and worktrees were retained. Reload Kilo configuration when safe.');
  process.exit(0);
}
if (args.some(a => a !== '--apply')) throw Error('Usage: node scripts/install-cto.mjs [--apply | --restore BACKUP_DIRECTORY]');
const configPath = path.join(live, 'kilo.jsonc');
const original = fs.readFileSync(configPath, 'utf8');
const config = JSON.parse(original.replace(/^\s*\/\/.*$/gm, ''));
const policy = fs.readFileSync(path.join(root, 'examples/cto/policy.md'), 'utf8');
const destination = path.join(live, 'cto');
const profiles = ['CTO (Recommended)', 'CTO + JEV'];
const retired = ['astra-engineering-lead', 'Fable Engineering Lead', 'Fable + Jev Engineering Lead', 'Opus + Jev Engineering Lead', 'Astra + Jev Engineering Lead', 'Opus 5.5 High'];
const writes = new Map();
for (const f of ['manager.mjs', 'worker.mjs', 'server.mjs', 'policy.md', 'goal-policy.md']) writes.set(path.join(destination, f), fs.readFileSync(path.join(root, 'examples/cto', f)));
const ponytail = process.env.CTO_PONYTAIL_FILE || path.join(os.homedir(), '.config/ponytail/AGENTS.md');
if (!fs.existsSync(ponytail)) writes.set(ponytail, fs.readFileSync(path.join(root, 'examples/instructions/AGENTS.md')));
config.instructions = [...new Set([ponytail, ...(config.instructions || []), path.join(destination, 'goal-policy.md')])];
for (const name of profiles) {
  const jev = name.endsWith('JEV');
  const description = jev ? 'One accountable CTO with selective JEV advice, isolated workers and verified delivery.' : 'One accountable CTO: plans, dispatches up to 14 isolated workers, reviews and delivers verified work.';
  const extra = jev ? '\n## Selective JEV advice\nUse TypeSafe_evaluate_work only for a genuinely ambiguous decision or a material multi-requirement evidence check. Send sanitized requirements and observed evidence, not source files, private transcripts or secrets. JEV cannot grant permission or certify facts. Normally at most two calls per task; no repeated voting. If unavailable, continue with direct evidence and say so when material.\n' : '\n## Advisory policy\nThis default profile does not call JEV. Use direct evidence and focused independent review when justified.\n';
  writes.set(path.join(live, 'agent', name + '.md'), `---\ndescription: ${description}\nmode: primary\nmodel: claude-local-cli/opus-5-5-high\nvariant: high\ncolor: accent\nsteps: 100\npermission:\n  task: deny\n  schedule_wakeup: deny\n  cto_*: allow\n  TypeSafe_*: ${jev ? 'allow' : 'deny'}\n  Claude_Code_Local_*: deny\n---\n\n${policy}${extra}`);
}
config.agent ||= {};
for (const name of retired) {
  config.agent[name] = { ...config.agent[name], hidden: true };
  const file = path.join(live, 'agent', name + '.md');
  if (fs.existsSync(file)) {
    let text = fs.readFileSync(file, 'utf8');
    if (/^hidden:/m.test(text)) text = text.replace(/^hidden:.*$/m, 'hidden: true');
    else text = text.replace(/^---\r?\n/, '---\nhidden: true\n');
    writes.set(file, text);
  }
}
for (const name of profiles) config.agent[name] = { ...config.agent[name], hidden: false };
config.default_agent = profiles[0];
config.mcp ||= {};
config.mcp.cto = { type: 'local', command: [process.execPath, path.join(destination, 'server.mjs')], enabled: true, timeout: 30000 };
writes.set(configPath, JSON.stringify(config, null, 2) + '\n');
writes.set(state, profiles[0] + '\n');

console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'dry-run', profiles, retired, model: 'claude-local-cli/opus-5-5-high', workerModels: 'Read from current live specialist profiles', limits: { workers: 14, workerWriters: 6 }, files: [...writes.keys()] }, null, 2));
if (!args.includes('--apply')) process.exit(0);
const backup = path.join(live, 'backups', 'cto-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
const manifest = { created: new Date().toISOString(), files: [] };
for (const [target, content] of writes) {
  const entry = { path: target, installedHash: hash(content) };
  if (fs.existsSync(target)) {
    entry.backup = String(manifest.files.length) + '.bak';
    fs.copyFileSync(target, path.join(backup, entry.backup));
    fs.chmodSync(path.join(backup, entry.backup), 0o600);
  }
  manifest.files.push(entry);
}
fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
try {
  for (const [target, content] of writes) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const tmp = target + '.cto-install-tmp';
    fs.writeFileSync(tmp, content, { mode: 0o600 }); fs.renameSync(tmp, target);
  }
} catch (e) {
  for (const x of manifest.files) {
    if (x.backup) fs.copyFileSync(path.join(backup, x.backup), x.path);
    else if (fs.existsSync(x.path)) fs.unlinkSync(x.path);
  }
  throw e;
}
console.log(`Backup: ${backup}\nInstalled. Use Kilo Code: Reload Config and Skills when safe.`);
