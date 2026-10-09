import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-policy-test-'));
const live = path.join(home, '.config/kilo');
fs.mkdirSync(live, { recursive: true });
fs.mkdirSync(path.join(home, '.codex'));
const original = { model: 'selected/model', default_agent: 'CTO + JEV', instructions: ['/existing/rules.md'], provider: { custom: { options: { apiKey: 'fake-test-key' } } }, permission: { bash: 'ask' }, mcp: { computer: { enabled: true } } };
const originalText = JSON.stringify(original);
fs.writeFileSync(path.join(live, 'kilo.jsonc'), originalText);
fs.writeFileSync(path.join(home, '.codex/AGENTS.md'), '# Keep my response style\n');
const script = path.join(root, 'scripts/install-goal-policy.mjs');
const run = args => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, GOAL_POLICY_HOME: home }, encoding: 'utf8' });
try {
  assert.equal(run([]).status, 0);
  assert.equal(fs.readFileSync(path.join(live, 'kilo.jsonc'), 'utf8'), originalText, 'dry run changed configuration');
  assert(!fs.existsSync(path.join(live, 'cto')));
  const installed = run(['--apply']); assert.equal(installed.status, 0, installed.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(live, 'kilo.jsonc'), 'utf8'));
  assert.deepEqual({ ...config, instructions: original.instructions }, original, 'provider, permissions, model or existing settings changed');
  const ponytail = path.join(home, '.config/ponytail/AGENTS.md');
  assert.deepEqual(config.instructions, [ponytail, ...original.instructions, path.join(live, 'cto/goal-policy.md')]);
  const codex = fs.readFileSync(path.join(home, '.codex/AGENTS.md'), 'utf8');
  assert(codex.startsWith('# Keep my response style\n'));
  assert(codex.includes('# Ponytail, lazy senior dev mode'));
  assert(fs.readFileSync(path.join(home, 'Library/Application Support/Code/User/prompts/ponytail.instructions.md'), 'utf8').includes('applyTo: "**"'));
  assert.equal(run(['--apply']).stdout.includes('"files": []'), true, 'second install should be a no-op');

  process.env.CTO_AGENT_DIR = path.join(home, 'agents');
  process.env.CTO_PONYTAIL_FILE = ponytail;
  fs.mkdirSync(process.env.CTO_AGENT_DIR);
  fs.writeFileSync(path.join(process.env.CTO_AGENT_DIR, 'deepseek-implementer.md'), '---\nmodel: chosen/deepseek\n---\n');
  fs.writeFileSync(path.join(process.env.CTO_AGENT_DIR, 'glm-investigator.md'), '---\nmodel: chosen/glm\n---\n');
  const { workerConfig } = await import('../examples/cto/manager.mjs');
  for (const writer of [true, false]) {
    const spec = workerConfig({ role: writer ? 'implementer' : 'reviewer', writer, scopes: writer ? ['src/a.js'] : [], worktree: '/isolated' }, { mcp: { private: {} }, permission: { computer_read: 'allow' } });
    const agent = spec.config.agent['cto-worker'];
    assert(agent.prompt.includes(fs.readFileSync(ponytail, 'utf8')), 'worker lost exact canonical Ponytail content');
    assert(agent.prompt.includes('Treat a follow-up as a change to the existing goal'));
    assert.equal(agent.permission.external_directory, 'deny');
    assert.equal(agent.permission.bash, 'deny');
    assert.equal(agent.permission.computer_read, 'deny');
    assert.equal(spec.config.mcp.private.enabled, false);
    assert.equal(writer ? agent.permission.edit['src/a.js'] : agent.permission.edit, writer ? 'allow' : 'deny');
  }
  process.env.CTO_PONYTAIL_FILE = path.join(home, 'missing-policy');
  assert.throws(() => workerConfig({ role: 'implementer', writer: true, scopes: [], worktree: '/isolated' }, {}), /ENOENT/, 'missing policy must not silently disappear');

  const backup = installed.stdout.match(/Backup: (.+)/)[1];
  fs.appendFileSync(path.join(live, 'cto/goal-policy.md'), '\nuser edit\n');
  assert.notEqual(run(['--restore', backup]).status, 0, 'rollback overwrote subsequent work');
  fs.copyFileSync(path.join(root, 'examples/cto/goal-policy.md'), path.join(live, 'cto/goal-policy.md'));
  const restored = run(['--restore', backup]); assert.equal(restored.status, 0, restored.stderr);
  assert.equal(fs.readFileSync(path.join(live, 'kilo.jsonc'), 'utf8'), originalText);
  assert.equal(fs.readFileSync(path.join(home, '.codex/AGENTS.md'), 'utf8'), '# Keep my response style\n');
  assert(!fs.existsSync(ponytail));
  console.log('PASS: dry run, preserved model/providers/permissions, idempotent installation, canonical policy delivery to restricted workers, missing-policy failure and guarded rollback.');
} finally { fs.rmSync(home, { recursive: true, force: true }); }
