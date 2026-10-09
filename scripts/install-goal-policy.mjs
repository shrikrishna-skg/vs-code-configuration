#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.GOAL_POLICY_HOME || os.homedir();
const live = path.join(base, '.config/kilo');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const args = process.argv.slice(2);
if (args[0] === '--restore' && args.length === 2) {
  const manifest = JSON.parse(fs.readFileSync(path.join(args[1], 'manifest.json'), 'utf8'));
  for (const item of manifest.files) {
    if (!fs.existsSync(item.path) || hash(fs.readFileSync(item.path)) !== item.installedHash) throw Error(`Changed since installation: ${item.path}`);
  }
  for (const item of manifest.files) {
    if (item.backup) fs.copyFileSync(path.join(args[1], item.backup), item.path);
    else fs.unlinkSync(item.path);
  }
  console.log('Restored goal policy installation; reload Kilo configuration when safe.');
  process.exit(0);
}
if (args.some(arg => arg !== '--apply')) throw Error('Usage: node scripts/install-goal-policy.mjs [--apply | --restore BACKUP_DIRECTORY]');
const writes = new Map();
const ponytail = path.join(base, '.config/ponytail/AGENTS.md');
const ponytailText = fs.existsSync(ponytail) ? fs.readFileSync(ponytail, 'utf8') : fs.readFileSync(path.join(root, 'examples/instructions/AGENTS.md'), 'utf8');
if (!fs.existsSync(ponytail)) writes.set(ponytail, ponytailText);
const policyPath = path.join(live, 'cto/goal-policy.md');
writes.set(policyPath, fs.readFileSync(path.join(root, 'examples/cto/goal-policy.md'), 'utf8'));
const configPath = path.join(live, 'kilo.jsonc');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
config.instructions = [...new Set([ponytail, ...(config.instructions || []), policyPath])];
writes.set(configPath, JSON.stringify(config, null, 2) + '\n');
// Deploy the policy-forwarding fixes without reinstalling profiles, models or selection.
writes.set(path.join(live, 'cto/manager.mjs'), fs.readFileSync(path.join(root, 'examples/cto/manager.mjs'), 'utf8'));
const bridge = path.join(base, '.config/claude-engineering-lead/kilo-workers-mcp.mjs');
if (fs.existsSync(bridge)) writes.set(bridge, fs.readFileSync(path.join(root, 'claude-code/desktop/kilo-workers-mcp.mjs'), 'utf8'));
const codexPath = path.join(base, '.codex/AGENTS.md');
const codex = fs.existsSync(codexPath) ? fs.readFileSync(codexPath, 'utf8') : '';
const marker = '<!-- BEGIN ponytail-policy (managed) -->';
const block = `${marker}\n${ponytailText.trim()}\n<!-- END ponytail-policy (managed) -->`;
if (codex.includes(marker)) {
  if (!codex.includes('<!-- END ponytail-policy (managed) -->')) throw Error('Incomplete managed Ponytail block in Codex instructions; inspect before replacing.');
  writes.set(codexPath, codex.replace(/<!-- BEGIN ponytail-policy \(managed\) -->[\s\S]*?<!-- END ponytail-policy \(managed\) -->/, block));
} else if (!codex.includes('# Ponytail, lazy senior dev mode')) writes.set(codexPath, codex.trimEnd() + '\n\n' + block + '\n');
const copilotPath = path.join(base, 'Library/Application Support/Code/User/prompts/ponytail.instructions.md');
writes.set(copilotPath, fs.readFileSync(path.join(root, 'copilot-chat/config/prompts/ponytail.instructions.md'), 'utf8'));

for (const [file, value] of writes) if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === value) writes.delete(file);
console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'dry-run', files: [...writes.keys()], modelAndPermissionsPreserved: true }, null, 2));
if (!args.includes('--apply') || !writes.size) process.exit(0);
const backup = path.join(live, 'backups', 'goal-policy-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
const manifest = { files: [] };
for (const [file, value] of writes) {
  const item = { path: file, installedHash: hash(value) };
  if (fs.existsSync(file)) { item.backup = `${manifest.files.length}.bak`; fs.copyFileSync(file, path.join(backup, item.backup)); fs.chmodSync(path.join(backup, item.backup), 0o600); }
  manifest.files.push(item);
}
fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
const installed = [];
try {
  for (const [file, value] of writes) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + '.goal-policy-tmp';
    fs.writeFileSync(temp, value, { mode: 0o600 }); fs.renameSync(temp, file); installed.push(file);
  }
} catch (error) {
  for (const item of manifest.files.filter(item => installed.includes(item.path))) {
    if (item.backup) fs.copyFileSync(path.join(backup, item.backup), item.path);
    else fs.unlinkSync(item.path);
  }
  throw error;
}
console.log(`Backup: ${backup}\nInstalled. Reload Kilo configuration before starting the validation chat.`);
