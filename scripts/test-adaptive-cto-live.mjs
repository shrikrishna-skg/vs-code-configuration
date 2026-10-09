#!/usr/bin/env node
// Opt-in real model calls. Only disposable Git fixtures may be modified.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adaptive-cto-live-')));
process.env.CTO_STATE_DIR = path.join(temp, 'state');
const m = await import('../examples/cto/manager.mjs');
const { createRoutine, release } = await import('../examples/cto/adaptive/session.mjs');
const { adaptiveConfig, names, specialistModel } = await import('../examples/cto/adaptive/profile.mjs');
const { run, parseEvents } = await import('../examples/cto/worker.mjs');
const configPath = path.join(os.homedir(), '.config/kilo/kilo.jsonc');
process.env.CTO_CONFIG = configPath;
const live = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const ponytail = path.join(os.homedir(), '.config/ponytail/AGENTS.md');
const premiumModel = live.model;
const mode = process.argv[2] || 'routine';
assert(['routine', 'utility', 'image', 'coordinated', 'five'].includes(mode));
const evidence = path.join(os.homedir(), '.local/state/kilo/validation/adaptive', mode + '-' + Date.now());
fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
const repo = path.join(temp, 'repo'); fs.mkdirSync(repo);
m.git(repo, ['init']); m.git(repo, ['config', 'user.name', 'Validation']); m.git(repo, ['config', 'user.email', 'validation@localhost']);
fs.writeFileSync(path.join(repo, 'label.txt'), 'Alpha\n');
fs.writeFileSync(path.join(repo, 'count.mjs'), 'export const count = n => 0;\n');
fs.writeFileSync(path.join(repo, 'label-check.mjs'), `import assert from 'node:assert/strict';import fs from 'node:fs';assert(/^(Alpha|Beta|Gamma)\\n$/.test(fs.readFileSync('label.txt','utf8')));console.log('label format passed');\n`);
fs.writeFileSync(path.join(repo, 'count-check.mjs'), `import assert from 'node:assert/strict';import {count} from './count.mjs';assert.equal(count(3),6);assert.equal(count(0),0);console.log('count behavior passed');\n`);
let imageFile;
if (mode === 'image') {
  fs.writeFileSync(path.join(repo, 'style.css'), ':root { --body: 14px; --compact: 13px; }\n.report-title { font-size: var(--body); }\n.account-label { display:block; margin-bottom:2px; }\n.kpis { display:grid; grid-template-columns:1fr 1fr; gap:0; }\n');
  fs.writeFileSync(path.join(repo, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><label class="account-label" for="account">Account</label><select id="account"><option>A</option><option>B</option></select><h1 class="report-title">Operational Insights</h1><div class="kpis"><div>42 reviews</div><div>4.3 stars</div></div></body></html>');
  const require = createRequire(path.join(os.homedir(), '.config/shared-computer/runtime/package.json'));
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
    await page.goto(new URL('file://' + path.join(repo, 'index.html')).href);
    await page.addStyleTag({ content: '.account-label,.kpis { outline:3px solid red; margin-block:25px; }' });
    imageFile = path.join(evidence, 'ambiguous-targets.png');
    await page.screenshot({ path: imageFile });
    fs.copyFileSync(imageFile, path.join(repo, 'reference.png'));
  } finally { await browser.close(); }
}
m.git(repo, ['add', '.']); m.git(repo, ['commit', '-m', 'Synthetic baseline']);
const turns = [];
let job, session;
try {
  let config, cwd = repo, agent, model;
  if (mode === 'routine' || mode === 'utility' || mode === 'image') {
    model = specialistModel(mode === 'utility' ? 'utility' : 'routine', path.join(os.homedir(), '.config/kilo/agent'));
    job = await createRoutine({ workspace: repo, role: mode === 'utility' ? 'utility' : 'implementer', title: 'Routine regression test', task: mode === 'image' ? 'Scoped visual adjustments after the target is clear' : 'Exact label replacements only', acceptance: 'Preserve unrelated behavior', scopes: [mode === 'image' ? 'style.css' : 'label.txt'], checks: [[process.execPath, 'label-check.mjs']] }, model);
    const sessionFile = path.join(temp, 'session.json');
    fs.writeFileSync(sessionFile, JSON.stringify({ id: job.id, premiumModel, variant: 'high', configPath }));
    cwd = job.worktree; agent = mode === 'utility' ? names.utility : names.routine;
    if (imageFile) imageFile = path.join(cwd, 'reference.png');
    config = adaptiveConfig(live, { mode: mode === 'utility' ? 'utility' : 'routine', model, variant: 'high', ponytail, sessionFile, contract: { ...job, intent: mode === 'image' ? 'Visual changes requested in this session, after identifying the exact target. Preserve unrelated layout, typography and controls.' : 'Exact label replacements only; no inferred typography or layout changes.' } });
  } else {
    model = premiumModel; agent = names.cto;
    config = adaptiveConfig(live, { mode: 'cto', model, variant: 'high', ponytail });
  }
  const prompts = mode === 'image' ? ['Between them, right? Keep the space.'] : ['routine', 'utility'].includes(mode) ? [
    'Replace Alpha with Beta in label.txt. Keep the newline and other files unchanged. Publish the verified change.',
    'Now replace Beta with Gamma in label.txt. Keep everything else unchanged and publish the verified change.',
    'Make it better. Do not guess what I mean; ask me to identify the change before editing.',
    'Call routine_consult to ask the premium CTO whether it is appropriate to infer a new label from my previous vague request. Do not change any files.',
  ] : [mode === 'coordinated' ?
    `Use exactly two service workers: one implementer to change count.mjs so count(n) returns n*2, verified by [${JSON.stringify(process.execPath)},"count-check.mjs"], and one read-only GLM reviewer for its ready worktree. Wait for the implementer, review its diff, get the independent review, accept the result only if correct, and run count-check.mjs on the destination. Do not edit directly. Keep other files intact.`
    : `Use four service workers: implementer A changes count.mjs so count(n) returns n*2, checks [${JSON.stringify(process.execPath)},"count-check.mjs"]; implementer B changes label.txt from Alpha to Beta, checks [${JSON.stringify(process.execPath)},"label-check.mjs"]; test author writes regression-check.mjs covering count(3)=6, count(0)=0 and label Beta after both implementers are accepted; independent GLM reviewer examines the combined result. The two implementers have independent scopes and should run together. Do not edit directly. Wait, inspect, accept valid patches, then run both original checks and regression-check.mjs. No other files may change.`];
  for (const [index, prompt] of prompts.entries()) {
    if (mode === 'utility' && index > 0) break;
    const start = Date.now();
    const result = await run(m.discoverBinary(), ['run', '--pure', '--auto', '--format', 'json', '--agent', agent, '--model', model, '--variant', 'high', '--dir', cwd, ...(imageFile ? ['--file', imageFile] : []), ...(session ? ['--session', session] : [])], {
      cwd, env: { ...process.env, XDG_CONFIG_HOME: path.join(temp, 'config'), KILO_CONFIG: '', KILO_CONFIG_DIR: '', KILO_CONFIG_CONTENT: JSON.stringify(config) },
      input: prompt, timeout: mode === 'routine' ? 240000 : 600000, outputFile: path.join(evidence, `turn-${index}.jsonl`), errorFile: path.join(evidence, `turn-${index}.stderr`),
    });
    assert.equal(result.exitCode, 0, result.stderr.slice(-800)); assert(!result.timedOut);
    const parsed = parseEvents(result.stdout); session ||= parsed.session;
    const events = result.stdout.split('\n').flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
    const tools = events.filter(e => e.type === 'tool_use').map(e => e.part.tool);
    const tokens = events.filter(e => e.type === 'step_finish').map(e => e.part.tokens);
    const row = { index, seconds: (Date.now() - start) / 1000, tools, tokens, report: parsed.report };
    turns.push(row); console.log(JSON.stringify({ index, seconds: row.seconds, tools }));
    assert.deepEqual([...parsed.report.matchAll(/^## (.+)$/gm)].map(match => match[1]).filter(h => h !== 'Verification'), ['Answer', 'My opinion', 'Next step'], 'final response headings');
    if (mode === 'image') {
      assert.equal(m.git(repo, ['diff', '--name-only']), '', 'ambiguous image changed original files');
      assert.equal(m.git(job.worktree, ['status', '--porcelain']), '', 'ambiguous image changed isolated files');
      assert(!tools.includes('routine_publish'), 'ambiguous image attempted publication');
      assert(/[?]|which|clarif|specify/i.test(parsed.report), 'ambiguous image was not clarified');
    }
    if (mode === 'routine' || mode === 'utility') {
      assert.equal(fs.readFileSync(path.join(repo, 'label.txt'), 'utf8'), (index === 0 ? 'Beta' : 'Gamma') + '\n');
      if (index < 2) assert(tools.includes('routine_publish'), 'routine never published its change');
      if (index < 3) assert(!tools.includes('routine_consult'), 'routine unnecessarily invoked premium CTO');
      if (index === 2) assert(/[?]|which|clarif|(?:specify|describe|provide|reply with|tell me|give)[\s\S]{0,100}(?:exact|change|target|want|text|value|content)/i.test(parsed.report), 'ambiguous request was not clarified');
      if (index === 3) assert(tools.includes('routine_consult'), 'premium consultation was not exercised');
    }
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ mode, model, premiumModel, turns }, null, 2));
  }
  if (mode === 'coordinated' || mode === 'five') {
    assert.equal((await run(process.execPath, ['count-check.mjs'], { cwd: repo })).exitCode, 0);
    const jobs = (await m.status()).tasks;
    assert.equal(jobs.length, mode === 'five' ? 4 : 2, 'unexpected worker count');
    assert(jobs.every(j => j.state === 'accepted'), 'unaccepted worker result');
    if (mode === 'five') {
      assert.equal(fs.readFileSync(path.join(repo, 'label.txt'), 'utf8'), 'Beta\n');
      assert.equal((await run(process.execPath, ['regression-check.mjs'], { cwd: repo })).exitCode, 0);
    }
  }
  fs.writeFileSync(path.join(evidence, 'passed.json'), JSON.stringify({ mode, session, evidence, turns }, null, 2));
  console.log(JSON.stringify({ passed: true, mode, evidence }));
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'failure.txt'), error.stack);
  console.error(JSON.stringify({ passed: false, evidence, error: error.message })); process.exitCode = 1;
} finally {
  if (job) await release(job.id);
  for (const task of (await m.status()).tasks) if (['running', 'queued', 'starting', 'checking'].includes(task.state)) await m.cancel(task.id);
}
