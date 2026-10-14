import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cto-test-'));
process.env.CTO_STATE_DIR = path.join(temp, 'state');
process.env.CTO_AGENT_DIR = path.join(temp, 'agents');
process.env.CTO_CONFIG = path.join(temp, 'config.json');
process.env.CTO_KILO_BINARY = path.join(temp, 'fake-kilo');
process.env.CTO_PONYTAIL_FILE = path.join(temp, 'Ponytail.md');
fs.writeFileSync(process.env.CTO_PONYTAIL_FILE, '# Ponytail test policy\n');
fs.mkdirSync(process.env.CTO_AGENT_DIR);
for (const name of ['deepseek-implementer', 'glm-investigator', 'luna-utility']) fs.writeFileSync(path.join(process.env.CTO_AGENT_DIR, name + '.md'), '---\nmodel: test/model\n---\n');
fs.writeFileSync(process.env.CTO_CONFIG, '{}');
fs.writeFileSync(process.env.CTO_KILO_BINARY, `#!/usr/bin/env node
const fs=require('fs');let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{
 const wait=input.includes('SLOW')?5000:25;
 setTimeout(()=>{
  if(input.includes('WRITE_A'))fs.writeFileSync('a.js','export const answer = 42;\\n');
  if(input.includes('WRITE_B'))fs.writeFileSync('b.js','export const answer = 43;\\n');
  if(input.includes('OUTSIDE'))fs.writeFileSync('outside.js','bad\\n');
  if(input.includes('NO_FINAL'))return;
  console.log(JSON.stringify({type:'step_start'}));console.log(JSON.stringify({type:'text',part:{text:'Bounded result.'}}));console.log(JSON.stringify({type:'step_finish',part:{reason:'stop'}}));
 },wait);
});`, { mode: 0o755 });
const m = await import('../examples/cto/manager.mjs');
const { parseEvents } = await import('../examples/cto/worker.mjs');
const repo = path.join(temp, 'repo'); fs.mkdirSync(repo);
m.git(repo, ['init']); m.git(repo, ['config', 'user.email', 'test@localhost']); m.git(repo, ['config', 'user.name', 'Test']);
fs.writeFileSync(path.join(repo, 'README.md'), 'initial\n'); m.git(repo, ['add', '.']); m.git(repo, ['commit', '-m', 'initial']);
const repoRoot = fs.realpathSync(repo);
const basic = (extra = {}) => ({ workspace: repoRoot, role: 'implementer', title: 'test', task: 'WRITE_A', acceptance: 'answer is 42', scopes: ['a.js'], checks: [[process.execPath, '--check', 'a.js']], ...extra });
async function wait(id, state) {
  const end = Date.now() + 15000;
  for (;;) {
    const j = (await m.status(id)).tasks[0];
    if (state.includes(j.state)) return j;
    if (Date.now() > end) throw Error(`Timed out: ${JSON.stringify(j)}`);
    await new Promise(r => setTimeout(r, 40));
  }
}
try {
  assert(m.overlap('src', 'src/api.js')); assert(!m.overlap('src', 'src2'));
  for (const s of ['../x', '/x', '.git/config', 'src/../x', 'src/*']) assert.throws(() => m.scope(s));
  const j = { role: 'implementer', writer: true, repo, scopes: ['src'], dependsOn: [] };
  assert(!m.canStart(j, Array.from({ length: 14 }, (_, i) => ({ id: i, role: 'investigator', state: 'running' }))));
  assert(!m.canStart(j, Array.from({ length: 6 }, (_, i) => ({ id: i, role: 'tester', state: 'running', writer: true }))));
  assert(!m.canStart(j, [{ id: 'other', role: 'tester', state: 'ready', writer: true, repo, scopes: ['src/a'] }]));
  assert(!m.canStart({ ...j, dependsOn: ['D'] }, [{ id: 'D', state: 'ready' }]));
  assert(m.canStart({ ...j, dependsOn: ['D'] }, [{ id: 'D', state: 'accepted' }]));
  assert.throws(() => parseEvents('{"type":"step_finish","part":{"reason":"length"}}'));

  // Dirty inputs are visible in a snapshot, while the user's index is untouched.
  fs.writeFileSync(path.join(repo, 'local.txt'), 'user work\n');
  const indexBefore = m.git(repo, ['diff', '--cached']);
  const first = await m.submit(basic());
  const ready = await wait(first.id, ['ready', 'failed']); assert.equal(ready.state, 'ready', ready.error);
  assert.equal(fs.readFileSync(path.join(ready.worktree, 'local.txt'), 'utf8'), 'user work\n');
  assert(!fs.existsSync(path.join(repo, 'a.js'))); assert.equal(m.git(repo, ['diff', '--cached']), indexBefore);
  const dependent = await m.submit(basic({ task: 'WRITE_B', scopes: ['b.js'], dependsOn: [first.id], checks: [[process.execPath, '--check', 'b.js']] }));
  assert.equal(dependent.state, 'queued');
  await m.accept(first.id, 'Inspected a.js and its syntax result.');
  assert.match(fs.readFileSync(path.join(repo, 'a.js'), 'utf8'), /42/);
  const next = await wait(dependent.id, ['ready', 'failed']); assert.equal(next.state, 'ready', next.error);
  assert.match(fs.readFileSync(path.join(next.worktree, 'a.js'), 'utf8'), /42/);
  fs.writeFileSync(path.join(repo, 'b.js'), 'user edit\n');
  await assert.rejects(m.accept(dependent.id, 'Reviewed'), /Owned files changed/);
  assert.equal(fs.readFileSync(path.join(repo, 'b.js'), 'utf8'), 'user edit\n'); await m.cancel(dependent.id);

  const bad = await m.submit(basic({ task: 'OUTSIDE' }));
  assert.equal((await wait(bad.id, ['failed'])).state, 'failed'); assert(!fs.existsSync(path.join(repo, 'outside.js')));
  const fail = await m.submit(basic({ task: 'WRITE_A', checks: [[process.execPath, '-e', 'process.exit(7)']] }));
  const failed = await wait(fail.id, ['failed']); assert.equal(failed.verification[0].exitCode, 7); await assert.rejects(m.accept(fail.id, 'Reviewed'));
  const slow = await m.submit(basic({ task: 'SLOW WRITE_A' })); await wait(slow.id, ['running']);
  await assert.rejects(m.status(slow.id, 20001), /waitMs/);
  const beforeWait = Date.now();
  assert.equal((await m.status(slow.id, 150)).tasks[0].state, 'running');
  assert(Date.now() - beforeWait >= 130, 'Bounded status should wait, not spin');
  const changed = m.status(slow.id, 10000);
  await m.cancel(slow.id);
  assert(['cancelling', 'cancelled'].includes((await changed).tasks[0].state), 'Wait should return on state change');
  assert.equal((await wait(slow.id, ['cancelled', 'failed'])).state, 'cancelled');
  const read = await m.submit(basic({ role: 'reviewer', scopes: [], checks: [], task: 'Inspect README.' }));
  assert.equal((await wait(read.id, ['ready', 'failed'])).state, 'ready'); await m.accept(read.id, 'Read-only findings inspected.');
  assert.equal((await m.status()).activeWorkers, 0);

  // Installer preserves unrelated config, hides old entries, and restores bytes.
  const install = path.join(temp, 'install'); fs.mkdirSync(install);
  const original = '{"default_agent":"astra-engineering-lead","model":"test/main","custom":123,"permission":{"bash":{"echo *":"deny"}},"instructions":["custom-policy.md"],"mcp":{"existing":{"enabled":false}}}\n';
  fs.writeFileSync(path.join(install, 'kilo.jsonc'), original);
  fs.mkdirSync(path.join(install, 'agent'));
  fs.writeFileSync(path.join(install, 'agent', 'deepseek-implementer.md'), '---\nmodel: test/preserved-worker\n---\nOld body\n');
  fs.writeFileSync(path.join(install, 'agent', 'CTO (Recommended).md'), '---\nmodel: test/preserved-cto\nvariant: medium\n---\nOld body\n');
  const script = fileURLToPath(new URL('./install-cto.mjs', import.meta.url));
  const env = { ...process.env, CTO_INSTALL_DIR: install, CTO_SELECTION_FILE: path.join(temp, 'selected') };
  const applied = spawnSync(process.execPath, [script, '--apply'], { env, encoding: 'utf8' }); assert.equal(applied.status, 0, applied.stderr);
  const c = JSON.parse(fs.readFileSync(path.join(install, 'kilo.jsonc')));
  assert.equal(c.custom, 123); assert.equal(c.mcp.existing.enabled, false); assert.equal(c.agent['astra-engineering-lead'].hidden, true);
  assert.equal(c.default_agent, 'CTO (Recommended)');
  assert.equal(c.shared_agent_board, true);
  assert.equal(c.model, 'test/main');
  assert.equal(c.permission.bash['echo *'], 'deny');
  assert(c.instructions.includes('custom-policy.md'));
  const primary = fs.readFileSync(path.join(install, 'agent', 'CTO (Recommended).md'), 'utf8');
  assert.match(primary, /model: test\/preserved-cto\nvariant: medium/);
  assert.match(primary, /^steps: 300$/m);
  assert.match(primary, /task:\n    "\*": deny\n    deepseek-implementer: allow\n    glm-investigator: allow\n    luna-utility: allow/);
  assert.match(primary, /cto_\*: deny/);
  assert.match(primary, /NOT runtime-enforced native limits/);
  assert.match(primary, /background: true/);
  assert.match(fs.readFileSync(path.join(install, 'agent', 'deepseek-implementer.md'), 'utf8'), /model: test\/preserved-worker/);
  for (const name of ['deepseek-implementer', 'glm-investigator', 'luna-utility']) {
    const worker = fs.readFileSync(path.join(install, 'agent', name + '.md'), 'utf8');
    assert.match(worker, /task: deny/); assert.match(worker, /agent_manager\*: deny/);
    assert.match(worker, new RegExp('^steps: ' + { 'deepseek-implementer': 150, 'glm-investigator': 60, 'luna-utility': 20 }[name] + '$', 'm'));
    assert(worker.includes(process.env.CTO_PONYTAIL_FILE));
  }
  assert.match(fs.readFileSync(path.join(install, 'agent', 'deepseek-implementer.md'), 'utf8'), /If a tool denies access, stop/);
  const reviewer = fs.readFileSync(path.join(install, 'agent', 'glm-investigator.md'), 'utf8');
  assert.match(reviewer, /background_process: deny/);
  assert.match(reviewer, /the CTO runs executable tests/);
  assert.match(reviewer, /never retry the same operation through a background process/);
  const backup = applied.stdout.match(/Backup: (.+)/)[1];
  const restored = spawnSync(process.execPath, [script, '--restore', backup], { env, encoding: 'utf8' }); assert.equal(restored.status, 0, restored.stderr);
  assert.equal(fs.readFileSync(path.join(install, 'kilo.jsonc'), 'utf8'), original);
  // Profile-only upgrades must leave the running scheduler and custom instructions intact.
  fs.mkdirSync(path.join(install, 'cto'), { recursive: true });
  fs.writeFileSync(path.join(install, 'cto', 'manager.mjs'), 'running scheduler sentinel');
  const native = spawnSync(process.execPath, [script, '--profiles-only', '--apply'], { env, encoding: 'utf8' });
  assert.equal(native.status, 0, native.stderr);
  assert.equal(fs.readFileSync(path.join(install, 'cto', 'manager.mjs'), 'utf8'), 'running scheduler sentinel');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(install, 'kilo.jsonc'))).mcp, JSON.parse(original).mcp);
  const installed = fs.readFileSync(path.join(install, 'kilo.jsonc'), 'utf8');
  const again = spawnSync(process.execPath, [script, '--profiles-only', '--apply'], { env, encoding: 'utf8' });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(fs.readFileSync(path.join(install, 'kilo.jsonc'), 'utf8'), installed);
  // A native-only install on a fresh directory must not reference a missing policy.
  const fresh = path.join(temp, 'fresh-native'); fs.mkdirSync(fresh);
  fs.writeFileSync(path.join(fresh, 'kilo.jsonc'), original);
  const freshEnv = { ...env, CTO_INSTALL_DIR: fresh };
  const freshApply = spawnSync(process.execPath, [script, '--profiles-only', '--apply'], { env: freshEnv, encoding: 'utf8' });
  assert.equal(freshApply.status, 0, freshApply.stderr);
  const goalPolicy = path.join(fresh, 'cto', 'goal-policy.md');
  assert(JSON.parse(fs.readFileSync(path.join(fresh, 'kilo.jsonc'))).instructions.includes(goalPolicy));
  assert.equal(fs.readFileSync(goalPolicy, 'utf8'), fs.readFileSync(fileURLToPath(new URL('../examples/cto/goal-policy.md', import.meta.url)), 'utf8'));
  fs.writeFileSync(goalPolicy, 'Existing customized goal policy');
  const freshAgain = spawnSync(process.execPath, [script, '--profiles-only', '--apply'], { env: freshEnv, encoding: 'utf8' });
  assert.equal(freshAgain.status, 0, freshAgain.stderr);
  assert.equal(fs.readFileSync(goalPolicy, 'utf8'), 'Existing customized goal policy');
  assert(!fs.existsSync(path.join(fresh, 'cto', 'manager.mjs')));
  console.log('CTO checks passed: capacity, dependencies, scope quarantine, dirty snapshots, guarded acceptance, checks, cancellation, read-only results and installer rollback.');
} finally {
  const jobs = (await m.status()).tasks;
  for (const j of jobs) if (['starting', 'running', 'checking', 'queued', 'cancelling'].includes(j.state)) await m.cancel(j.id);
  // Detached workers need a moment to observe cancellation before test cleanup.
  const deadline = Date.now() + 5000;
  while ((await m.status()).activeWorkers && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  fs.rmSync(temp, { recursive: true, force: true });
}
