#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = process.env.COMPUTER_INSTALL_HOME || os.homedir();
const live = path.join(home, '.config/shared-computer');
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
const args = process.argv.slice(2);
if (args[0] === '--restore') {
  const manifest = JSON.parse(fs.readFileSync(path.join(args[1], 'manifest.json'), 'utf8'));
  for (const f of manifest.files) {
    if (!fs.existsSync(f.path) || hash(fs.readFileSync(f.path)) !== f.installedHash) throw Error(`File changed since installation; inspect before restoring: ${f.path}`);
  }
  for (const f of manifest.files) f.backup ? fs.copyFileSync(path.join(args[1], f.backup), f.path) : fs.unlinkSync(f.path);
  console.log('Restored registered files. Runtime dependencies and private audit records retained.'); process.exit(0);
}
if (args.some(a => !['--apply'].includes(a))) throw Error('Usage: install-computer-control.mjs [--apply | --restore BACKUP_DIRECTORY]');
const apply = args.includes('--apply');
const peekaboo = process.env.PEEKABOO_BIN || path.join(home, '.local/node/bin/peekaboo');
const cli = path.join(live, 'runtime/node_modules/@playwright/mcp/cli.js');
const writes = new Map();
for (const name of ['client.mjs', 'lease.mjs', 'server.mjs']) writes.set(path.join(live, name), fs.readFileSync(path.join(repo, 'examples/computer-control', name)));
const config = {
  stateDir: path.join(live, 'state'),
  desktop: [peekaboo, 'mcp', 'serve', '--no-remote', '--transport', 'stdio', '--allow-foreground'],
  browser: [process.execPath, cli, '--browser', 'chrome', '--headless', '--user-data-dir', path.join(live, 'browser-profile'), '--timeout-action', '10000', '--timeout-navigation', '30000', '--output-dir', path.join(live, 'artifacts')],
  timeout: 45000,
};
writes.set(path.join(live, 'config.json'), JSON.stringify(config, null, 2) + '\n');
const kiloFile = path.join(home, '.config/kilo/kilo.jsonc');
const kilo = JSON.parse(fs.readFileSync(kiloFile, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
kilo.mcp ||= {};
kilo.mcp.computer = { type: 'local', command: [process.execPath, path.join(live, 'server.mjs')], enabled: true, timeout: 60000 };
if (kilo.mcp.Peekaboo) kilo.mcp.Peekaboo.enabled = false;
kilo.permission ||= {}; kilo.permission['Peekaboo_*'] = 'deny'; kilo.permission['computer_*'] = 'allow';
writes.set(kiloFile, JSON.stringify(kilo, null, 2) + '\n');
const skill = fs.readFileSync(path.join(repo, 'examples/computer-control/skill/SKILL.md'));
for (const dir of ['.config/kilo/skills', '.claude/skills', '.codex/skills']) writes.set(path.join(home, dir, 'shared-computer/SKILL.md'), skill);
const operator = `<!-- shared-computer:start -->\n## Shared computer operator\nFor native-app or browser interaction, load the shared-computer skill and use computer_* tools. One lease-owning operator may control the UI; isolated code workers can continue in parallel. Observe after mutations, verify the requested outcome, and release on completion or failure. A busy lease means wait or do independent work, not bypass ownership. The service does not authorize actions outside the user's request.\n<!-- shared-computer:end -->`;
for (const name of ['CTO (Recommended)', 'CTO + JEV']) {
  const file = path.join(home, '.config/kilo/agent', name + '.md');
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  writes.set(file, text.includes('<!-- shared-computer:start -->') ? text.replace(/<!-- shared-computer:start -->[\s\S]*?<!-- shared-computer:end -->/, operator) : text.trimEnd() + '\n\n' + operator + '\n');
}
const codexFile = path.join(home, '.codex/config.toml');
let codex = fs.existsSync(codexFile) ? fs.readFileSync(codexFile, 'utf8') : '';
const begin = '# BEGIN shared-computer managed registration', end = '# END shared-computer managed registration';
const block = `${begin}\n[mcp_servers.computer]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(path.join(live, 'server.mjs'))}]\nstartup_timeout_sec = 90\ntool_timeout_sec = 60\n${end}`;
if (codex.includes(begin)) codex = codex.replace(/# BEGIN shared-computer managed registration[\s\S]*?# END shared-computer managed registration/, block);
else {
  if (/^\[mcp_servers\.computer\]/m.test(codex)) throw Error('Unmanaged Codex computer registration exists; inspect before replacing.');
  codex += '\n' + block + '\n';
}
writes.set(codexFile, codex);
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', desktop: peekaboo, browserVersion: '0.0.83', files: [...writes.keys()] }, null, 2));
if (!apply) process.exit(0);
if (!fs.existsSync(peekaboo)) throw Error('Peekaboo binary is missing.');
fs.mkdirSync(live, { recursive: true, mode: 0o700 });
// Pin the tested engine and keep it outside a disposable npx cache.
if (!fs.existsSync(cli)) execFileSync(process.execPath, [path.join(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'), 'install', '--prefix', path.join(live, 'runtime'), '--ignore-scripts', '--no-audit', '--no-fund', '@playwright/mcp@0.0.83'], { stdio: 'pipe', timeout: 120000 });
const backup = path.join(live, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
const manifest = { created: new Date().toISOString(), files: [] };
for (const [target, content] of writes) {
  const entry = { path: target, installedHash: hash(content) };
  if (fs.existsSync(target)) {
    entry.backup = String(manifest.files.length) + '.bak';
    fs.copyFileSync(target, path.join(backup, entry.backup)); fs.chmodSync(path.join(backup, entry.backup), 0o600);
  }
  manifest.files.push(entry);
}
fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
try {
  for (const [target, content] of writes) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = target + '.computer-tmp'; fs.writeFileSync(temp, content, { mode: 0o600 }); fs.renameSync(temp, target);
  }
} catch (e) {
  for (const f of manifest.files) f.backup ? fs.copyFileSync(path.join(backup, f.backup), f.path) : fs.rmSync(f.path, { force: true });
  throw e;
}
console.log('Backup: ' + backup + '\nInstalled in Kilo and Codex. Claude registration uses its MCP CLI; see setup guide.');
