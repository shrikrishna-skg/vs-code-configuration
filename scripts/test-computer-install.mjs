import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'computer-install-'));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const kilo = path.join(home, '.config/kilo/kilo.jsonc'), codex = path.join(home, '.codex/config.toml');
const before = '{"model":"test/unchanged","mcp":{"Peekaboo":{"enabled":true},"unrelated":{"enabled":true}}}\n';
write(kilo, before); write(codex, 'model = "unchanged"\n');
write(path.join(home, '.local/node/bin/peekaboo'), 'test fixture');
write(path.join(home, '.config/shared-computer/runtime/node_modules/@playwright/mcp/cli.js'), 'test fixture');
const env = { ...process.env, COMPUTER_INSTALL_HOME: home, PEEKABOO_BIN: path.join(home, '.local/node/bin/peekaboo') };
const script = path.resolve('scripts/install-computer-control.mjs');
const run = args => execFileSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
try {
  run([]); assert.equal(fs.readFileSync(kilo, 'utf8'), before, 'dry run changed config');
  const output = run(['--apply']); const backup = output.match(/Backup: (.+)/)[1];
  const installed = fs.readFileSync(kilo, 'utf8');
  assert.equal(JSON.parse(installed).model, 'test/unchanged');
  assert.equal(JSON.parse(installed).mcp.unrelated.enabled, true);
  assert.equal(JSON.parse(installed).mcp.Peekaboo.enabled, false);
  assert.equal(JSON.parse(installed).mcp.computer.enabled, true);
  run(['--apply']); assert.equal(fs.readFileSync(kilo, 'utf8'), installed);
  assert.equal(fs.readFileSync(codex, 'utf8').split('[mcp_servers.computer]').length, 2);
  fs.appendFileSync(kilo, ' ');
  assert.notEqual(spawnSync(process.execPath, [script, '--restore', backup], { env }).status, 0, 'restore must reject later changes');
  fs.writeFileSync(kilo, installed); run(['--restore', backup]);
  assert.equal(fs.readFileSync(kilo, 'utf8'), before);
  assert.equal(fs.readFileSync(codex, 'utf8'), 'model = "unchanged"\n');
  console.log('Computer installer: dry-run, preservation, repeat install, drift rejection and restore passed.');
} finally { fs.rmSync(home, { recursive: true, force: true }); }
