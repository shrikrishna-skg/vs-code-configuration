import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cto-cleanup-test-'));
const live = path.join(temp, 'kilo'), prompts = path.join(temp, 'prompts'), skills = path.join(temp, 'skills');
const env = {...process.env, KILO_CLEANUP_DIR: live, KILO_CLEANUP_PROMPTS_DIR: prompts, KILO_CLEANUP_SKILLS_DIR: skills};
const file = relative => path.join(live, relative);
function write(p, text) { fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, text); }
function run(...args) { return spawnSync(process.execPath, [path.join(root, 'scripts/install-cto-cleanup.mjs'), ...args], {env, encoding: 'utf8'}); }
const config = {model: 'chosen/model', subagent_depth: 2, instructions: ['custom.md'], provider: {custom: {secret: 'test-only-sentinel'}}, permission: {
  doom_loop: 'deny', 'computer_*': 'allow', 'Peekaboo_*': 'deny', external_directory: {'private/*': 'ask'},
  bash: {'echo *': 'deny', true: 'deny', ':': 'deny', 'rm *': 'ask', 'git status*': 'allow'}
}};
const roles = ['CTO (Recommended)', 'CTO + JEV', 'deepseek-implementer', 'glm-investigator', 'luna-utility'];
const originals = new Map();
try {
  write(file('kilo.jsonc'), JSON.stringify(config));
  for (const name of roles) {
    const source = name.startsWith('CTO') ? 'examples/cto/native-policy.md' : `examples/agent/${name}.md`;
    let body = fs.readFileSync(path.join(root, source), 'utf8').replace(/^Before the iteration budget.*\n/gm, '')
      .replace(/^Investigation is bounded.*$/m, 'Investigation is bounded to a concrete question. Reports contain at most five findings.')
      .replace(/^- Summarize the top five.*$/m, '- Return at most five prioritized findings with file references.');
    const text = name.startsWith('CTO') ? '---\nmodel: chosen/cto\nsteps: 100\npermission:\n  cto_*: deny\n---\n' + body : body;
    write(file(`agent/${name}.md`), text);
    originals.set(name, text);
  }
  for (const name of ['reply-style.instructions.md', 'glm-investigator.agent.md']) write(path.join(prompts, name), fs.readFileSync(path.join(root, 'copilot-chat/config/prompts', name), 'utf8'));
  for (const name of ['project-delivery','parallel-worktrees']) write(path.join(skills, name, 'SKILL.md'), '# old active skill\n');
  const before = fs.readFileSync(file('kilo.jsonc'), 'utf8');
  assert.equal(run().status, 0);
  assert.equal(fs.readFileSync(file('kilo.jsonc'), 'utf8'), before, 'dry run changed configuration');
  assert(!fs.existsSync(file('backups')));
  const applied = run('--apply'); assert.equal(applied.status, 0, applied.stderr);
  const backup = applied.stdout.match(/Backup: (.+)/)[1];
  const expected = structuredClone(config);
  for (const key of ['echo *','true',':']) delete expected.permission.bash[key];
  assert.deepEqual(JSON.parse(fs.readFileSync(file('kilo.jsonc'))), expected, 'unapproved configuration changed');
  for (const name of roles) {
    const text = fs.readFileSync(file(`agent/${name}.md`), 'utf8');
    assert.equal(text.split('---')[1], originals.get(name).split('---')[1], `${name}: model, step budget or permissions changed`);
    assert.match(text, /A budget limit is not successful completion/);
    if (name.startsWith('CTO') || name === 'glm-investigator') assert.match(text, /report every critical issue even when there are more than five/);
  }
  for (const name of fs.readdirSync(path.join(root, 'examples/commands'))) {
    const text = fs.readFileSync(file(`commands/${name}`), 'utf8');
    assert.match(text, /^agent: CTO \(Recommended\)$/m);
    assert.doesNotMatch(text, /^model:/m);
  }
  for (const name of ['project-delivery','parallel-worktrees']) {
    assert.equal(fs.readFileSync(path.join(skills,name,'SKILL.md'),'utf8'), fs.readFileSync(path.join(root,'examples/skills',name,'SKILL.md'),'utf8'));
  }
  const lean = fs.readFileSync(file('lean-execution.md'), 'utf8');
  assert.doesNotMatch(lean, /8.12 tool|If.*missing.*ask|Do not grep/);
  assert.match(lean, /CSS-only changes may need rendered checks/);
  assert.match(lean, /Continue toward the goal/);
  const style = fs.readFileSync(file('chat-response-style.md'), 'utf8');
  assert.match(style, /Reserve the following structure for final replies/);
  assert.equal(run('--check').status, 0, 'installed files differ from intended state');
  const again = run('--apply'); assert.equal(again.status, 0); assert(!again.stdout.includes('Backup:'), 'idempotent apply rewrote files');
  // Do not overwrite subsequent user edits during rollback.
  fs.appendFileSync(file('lean-execution.md'), '\nUser edit\n');
  assert.notEqual(run('--restore', backup).status, 0);
  write(file('lean-execution.md'), lean);
  const restored = run('--restore', backup); assert.equal(restored.status, 0, restored.stderr);
  assert.equal(fs.readFileSync(file('kilo.jsonc'), 'utf8'), before);
  for (const [name,text] of originals) assert.equal(fs.readFileSync(file(`agent/${name}.md`),'utf8'),text);
  assert(!fs.existsSync(file('commands/kilo-tweak.md')));
  // Explicit non-deny preferences and unrelated guards survive.
  const preferences = structuredClone(config); preferences.permission.bash['echo *'] = 'ask';
  write(file('kilo.jsonc'), JSON.stringify(preferences));
  assert.equal(run('--apply').status, 0);
  assert.equal(JSON.parse(fs.readFileSync(file('kilo.jsonc'))).permission.bash['echo *'], 'ask');
  console.log('CTO cleanup checks passed: dry run, selective permissions, models/budgets, active skills, command routing, idempotence and guarded rollback.');
} finally { fs.rmSync(temp, {recursive: true, force: true}); }
