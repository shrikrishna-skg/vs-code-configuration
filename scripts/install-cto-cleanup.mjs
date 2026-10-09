#!/usr/bin/env node
// Apply the approved C1–C12 cleanup without widening other permissions.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const live = process.env.KILO_CLEANUP_DIR || path.join(os.homedir(), '.config/kilo');
const prompts = process.env.KILO_CLEANUP_PROMPTS_DIR || path.join(os.homedir(), 'Library/Application Support/Code/User/prompts');
const skills = process.env.KILO_CLEANUP_SKILLS_DIR || path.join(os.homedir(), '.kilo/skills');
const args = process.argv.slice(2);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => fs.readFileSync(file, 'utf8');
if (args[0] === '--restore' && args.length === 2) {
  const manifest = JSON.parse(read(path.join(args[1], 'manifest.json')));
  for (const entry of manifest.files) {
    if (!fs.existsSync(entry.path) || hash(fs.readFileSync(entry.path)) !== entry.installedHash) throw Error(`Changed since installation: ${entry.path}`);
  }
  for (const entry of manifest.files) {
    if (entry.backup) fs.copyFileSync(path.join(args[1], entry.backup), entry.path);
    else fs.unlinkSync(entry.path);
  }
  console.log('Restored the approved cleanup backup.');
  process.exit(0);
}
if (args.length > 1 || args.some(x => !['--apply', '--check'].includes(x))) throw Error('Usage: install-cto-cleanup.mjs [--apply|--check] | --restore BACKUP');
const writes = new Map();
const before = new Map();
function put(file, value) {
  const old = fs.existsSync(file) ? read(file) : null;
  if (old !== value) { before.set(file, old); writes.set(file, value); }
}
const configPath = path.join(live, 'kilo.jsonc');
const config = JSON.parse(read(configPath).replace(/^\s*\/\/.*$/gm, ''));
for (const key of ['echo *', 'true', ':']) {
  if (config.permission?.bash?.[key] === 'deny') delete config.permission.bash[key];
}
if (config.permission?.bash && Object.keys(config.permission.bash).length === 0) delete config.permission.bash;
put(configPath, JSON.stringify(config, null, 2) + '\n');
for (const name of ['chat-response-style', 'shell-usage', 'mockup-preview', 'lean-execution']) {
  put(path.join(live, name + '.md'), read(path.join(root, 'examples/instructions', name + '.md')));
}
put(path.join(live, 'upgrades/delivery-v1/delivery-workflow.md'), read(path.join(root, 'examples/instructions/delivery-workflow.md')));
for (const name of ['project-delivery', 'parallel-worktrees']) {
  const text = read(path.join(root, 'examples/skills', name, 'SKILL.md'));
  put(path.join(live, 'upgrades/delivery-v1/skills', name, 'SKILL.md'), text);
  const active = path.join(skills, name, 'SKILL.md');
  if (fs.existsSync(active)) put(fs.realpathSync(active), text);
}
for (const name of fs.readdirSync(path.join(root, 'examples/commands'))) {
  const text = read(path.join(root, 'examples/commands', name));
  put(path.join(live, 'commands', name), text);
  if (name !== 'kilo-tweak.md') put(path.join(live, 'upgrades/delivery-v1/commands', name), text);
}
const policy = read(path.join(root, 'examples/cto/native-policy.md'));
const handoff = policy.match(/^Before the iteration budget.*$/m)[0];
const finding = policy.match(/^Investigation is bounded.*$/m)[0];
const reviewFinding = read(path.join(root, 'examples/agent/glm-investigator.md')).match(/^- Summarize the top five.*$/m)[0];
for (const name of ['CTO (Recommended)', 'CTO + JEV', 'deepseek-implementer', 'glm-investigator', 'luna-utility']) {
  const file = path.join(live, 'agent', name + '.md');
  let text = read(file);
  text = text.replace(/^Investigation is bounded.*$/m, finding)
    .replace(/^- Return at most five prioritized findings.*$/m, reviewFinding);
  if (!text.includes(handoff)) text = text.trimEnd() + '\n\n' + handoff + '\n';
  put(file, text);
}
// Keep existing Copilot copies coherent without reinstalling unrelated settings.
for (const name of ['reply-style.instructions.md', 'glm-investigator.agent.md']) {
  const file = path.join(prompts, name);
  if (!fs.existsSync(file)) continue;
  let text = read(file);
  if (name === 'reply-style.instructions.md') {
    const marker = '<!-- Exact copy of ~/.config/kilo/chat-response-style.md';
    const start = text.indexOf(marker);
    const end = text.indexOf('-->', start);
    if (start < 0 || end < 0) throw Error(`Missing response-style marker: ${file}`);
    text = text.slice(0, end + 3) + '\n\n' + read(path.join(root, 'examples/instructions/chat-response-style.md'));
  } else text = text.replace(/^- Return at most five prioritized findings.*$/m, reviewFinding);
  put(file, text);
}
console.log(JSON.stringify({mode: args[0] || 'dry-run', files: [...writes.keys()]}, null, 2));
if (args[0] === '--check') process.exit(writes.size ? 1 : 0);
if (args[0] !== '--apply' || !writes.size) process.exit(0);
for (const [file, old] of before) {
  if ((fs.existsSync(file) ? read(file) : null) !== old) throw Error(`Changed during preparation: ${file}`);
}
fs.mkdirSync(path.join(live, 'backups'), {recursive: true, mode: 0o700});
const backup = fs.mkdtempSync(path.join(live, 'backups/cto-cleanup-'));
fs.chmodSync(backup, 0o700);
const manifest = {files: [...writes].map(([file, text], i) => ({path: file, installedHash: hash(text), backup: before.get(file) === null ? null : `${i}.bak`}))};
for (const entry of manifest.files) if (entry.backup) fs.writeFileSync(path.join(backup, entry.backup), before.get(entry.path), {mode: 0o600});
fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2), {mode: 0o600});
const written = [];
try {
  for (const [file, text] of writes) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file + '.cleanup-tmp', text, {mode: 0o600});
    fs.renameSync(file + '.cleanup-tmp', file);
    written.push(file);
  }
} catch (error) {
  for (const file of written.reverse()) {
    const old = before.get(file);
    if (old === null) fs.unlinkSync(file);
    else fs.writeFileSync(file, old, {mode: 0o600});
  }
  throw error;
}
console.log(`Backup: ${backup}\nInstalled. Reload Kilo configuration when idle; no active window was reloaded.`);
