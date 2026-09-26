// Hermetic check for examples/bridges/peekaboo-runner.mjs: fake peekaboo binary, stubbed Jev.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../examples/bridges/peekaboo-runner.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peekaboo-runner-test-'));
const bin = path.join(dir, 'peekaboo'), log = path.join(dir, 'log'), text = path.join(dir, 'text'), flaky = path.join(dir, 'flaky'), sheet = path.join(dir, 'sheet');
fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('fs'), a = process.argv.slice(2), out = o => process.stdout.write(JSON.stringify(o));
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
const cur = () => { try { return fs.readFileSync(${JSON.stringify(text)}, 'utf8'); } catch { return ''; } };
if (a.includes('FAIL')) { out({ success: false, error: { code: 'X', message: 'boom' } }); process.exit(1); }
if (a[0] === 'see') out({ success: true, data: { application_name: 'Fake', window_title: 'Untitled', snapshot_id: 'snap1', ui_elements: [
  { id: 'elem_2', role: 'textField', label: 'text entry area', value: cur() },
  { id: 'elem_5', role: 'textField', label: cur() || 'notes', role_description: 'notes area', value: cur() },
  { id: 'elem_9', role: 'textField', label: 'password', ax_role: 'AXSecureTextField', value: 'hunter2' } ] } });
else if (a[0] === 'window' && a[1] === 'close') { fs.writeFileSync(${JSON.stringify(sheet)}, '1'); out({ success: false, effect: 'suspected_noop', error: { message: 'window remained' } }); process.exit(1); }
else if (a[0] === 'dialog' && a[1] === 'list') { if (fs.existsSync(${JSON.stringify(sheet)})) out({ success: true, data: { buttons: ['Delete', 'Cancel', 'Save'] } }); else { out({ success: false, error: { code: 'INTERACTION_FAILED', message: 'No dialog matched the selected target.' } }); process.exit(1); } }
else if (a[0] === 'dialog' && a[1] === 'click') { fs.rmSync(${JSON.stringify(sheet)}, { force: true }); out({ success: true, effect: 'confirmed', data: {} }); }
else if (a[0] === 'verify') {
  let ok = a.includes('FLAKY') ? fs.existsSync(${JSON.stringify(flaky)}) : cur() === a[a.indexOf('--value-equals') + 1];
  if (a.includes('FLAKY')) fs.writeFileSync(${JSON.stringify(flaky)}, '1');
  out({ success: true, data: { status: ok ? 'satisfied' : 'unknown' } }); process.exit(ok ? 0 : 2);
} else { if (a[0] === 'set-value') fs.writeFileSync(${JSON.stringify(text)}, a[1]); out({ success: true, effect: 'confirmed', data: {} }); }
`, { mode: 0o755 });
const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const reset = () => { for (const f of [log, text, flaky, sheet]) fs.rmSync(f, { force: true }); };
const waits = [], wait = async ms => { waits.push(ms); };
const jevCalls = [], jevSays = answer => async input => { jevCalls.push(input); return answer; };
const supported = jevSays({ status: 'advice', answers: { r1: { choice: 'supported', confidence: 0.97 } } });
const set = v => ['set-value', v, '--on', 'text entry area', '--app', 'Fake'];
const opts = extra => ({ bin, wait, jev: supported, ...extra });

try {
  // Happy path: set value, native expect, snapshot reuse, verify argv, Jev semantic check.
  reset();
  let r = await run({ app: 'Fake', steps: [
    { id: 's1', do: set('hi'), expect: { on: 'text entry area', value: 'hi' } },
    { id: 's2', see: true },
    { id: 's3', do: ['type', 'x', '--snapshot', '$snapshot'], expect: ['verify', '--on', 'elem_2', '--value-equals', 'hi'] },
    { id: 's4', see: true, expect_text: 'The text area contains hi' },
  ] }, opts());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.steps.map(s => s.status), ['passed', 'passed', 'passed', 'passed']);
  assert.ok(calls().every(c => c.at(-1) === '--json'));
  assert.deepEqual(calls().find(c => c[0] === 'type'), ['type', 'x', '--snapshot', 'snap1', '--json']);
  const evidence = jevCalls.at(-1).evidence;
  assert.equal(jevCalls.at(-1).purpose, 'evidence_check');
  assert.ok(evidence.includes('"text entry area" = hi') && evidence.includes('[secure]') && !evidence.includes('hunter2'));
  assert.deepEqual(waits, []);
  // A field relabelled with its contents is still found by its role description.
  r = await run({ app: 'Fake', steps: [{ id: 'a', see: true, expect: { on: 'textField:notes area', value: 'hi' } }] }, opts());
  assert.equal(r.ok, true, JSON.stringify(r));

  // Failed expect: one retry after a short wait, then stop with failed_step; later steps never run.
  reset();
  r = await run({ app: 'Fake', steps: [{ id: 'a', do: set('hi'), expect: { on: 'text entry area', value: 'nope' } }, { id: 'b', do: set('later') }] }, opts());
  assert.equal(r.ok, false); assert.equal(r.failed_step, 'a');
  assert.deepEqual(r.steps.map(s => s.status), ['failed', 'skipped']);
  assert.match(r.steps[0].error, /value mismatch/);
  assert.ok(!calls().some(c => c[1] === 'later'));
  assert.ok(r.last_see_summary.includes('text entry area') && !r.last_see_summary.includes('hunter2'));
  assert.deepEqual(waits, [300]);

  // Failed command and unknown verify both fail deterministically.
  reset();
  r = await run({ app: 'Fake', steps: [{ id: 'a', do: ['click', 'FAIL'] }] }, opts());
  assert.equal(r.failed_step, 'a'); assert.equal(r.steps[0].error, 'boom');
  reset();
  r = await run({ app: 'Fake', steps: [{ id: 'a', do: set('hi'), expect: ['verify', '--value-equals', 'other'] }] }, opts());
  assert.equal(r.steps[0].error, 'verify unknown');

  // Retry then pass.
  reset(); waits.length = 0;
  r = await run({ app: 'Fake', steps: [{ id: 'a', do: set('hi'), expect: ['verify', 'FLAKY'] }] }, opts());
  assert.equal(r.ok, true); assert.deepEqual(waits, [300]);

  // Disallowed commands and malformed plans are rejected before anything runs.
  reset();
  for (const bad of [
    { app: 'Fake', steps: [{ id: 'a', do: ['agent', 'do stuff'] }] },
    { app: 'Fake', steps: [{ id: 'a', do: ['see'], expect: ['browser', 'x'] }] },
    { app: 'Fake', steps: [{ id: 'a', do: ['daemon', 'stop'] }] },
    { app: 'Fake', steps: [{ id: 'a', do: ['see'], extra: 1 }] },
    { app: 'Fake', steps: [{ id: 'a', do: ['see'] }, { id: 'a', do: ['see'] }] },
    { app: 'Fake', steps: Array.from({ length: 101 }, (_, i) => ({ id: `s${i}`, see: true })) },
    { app: 'Fake', steps: [], shell: 'rm -rf /' },
  ]) {
    r = await run(bad, opts());
    assert.equal(r.ok, false); assert.ok(r.error, JSON.stringify(bad).slice(0, 80));
  }
  assert.deepEqual(calls(), []);
  r = await run({ app: 'Fake', steps: [{ id: 'a', do: ['type', 'x', '--snapshot', '$snapshot'] }] }, opts());
  assert.equal(r.steps[0].error, '$snapshot used before any see');

  // Confirm steps stop before executing unless explicitly confirmed by id.
  reset();
  const pay = { app: 'Fake', steps: [{ id: 'fill', do: set('hi') }, { id: 'send', do: set('sent'), confirm: true }] };
  r = await run(pay, opts());
  assert.equal(r.ok, false); assert.equal(r.failed_step, 'send');
  assert.deepEqual(r.steps.map(s => s.status), ['passed', 'needs_user_confirmation']);
  assert.ok(!calls().some(c => c[1] === 'sent'));
  r = await run(pay, opts({ confirmed: ['other'] }));
  assert.equal(r.steps[1].status, 'needs_user_confirmation');
  r = await run(pay, opts({ confirmed: ['send'] }));
  assert.equal(r.ok, true); assert.ok(calls().some(c => c[1] === 'sent'));

  // Sheets: `window close` reports suspected_noop but the dialog expect decides; destructive
  // dialog buttons are forced through the confirm gate even without `confirm: true`.
  reset();
  const discard = { app: 'Fake', steps: [
    { id: 'close', do: ['window', 'close', '--app', 'Fake'], expect: { dialog: true, button: 'delete' } },
    { id: 'discard', do: ['dialog', 'click', '--button', 'Delete', '--app', 'Fake'], expect: { dialog: false } },
  ] };
  r = await run(discard, opts());
  assert.deepEqual(r.steps.map(s => s.status), ['passed', 'needs_user_confirmation']);
  assert.ok(!calls().some(c => c[0] === 'dialog' && c[1] === 'click'));
  r = await run(discard, opts({ confirmed: ['discard'] }));
  assert.equal(r.ok, true, JSON.stringify(r));
  r = await run({ app: 'Fake', steps: [{ id: 'a', do: ['window', 'close', '--app', 'Fake'] }] }, opts());
  assert.equal(r.steps[0].error, 'window remained');
  reset();
  r = await run({ app: 'Fake', steps: [{ id: 'a', do: ['dialog', 'click', '--button', 'Cancel'], expect: { dialog: true } }] }, opts());
  assert.equal(r.steps[0].error, 'no dialog');
  for (const d of [['dialog', 'click', "--button=don't save"], ['click', 'Send'], ['dialog', 'click', '--button', 'Move to Trash']]) {
    r = await run({ app: 'Fake', steps: [{ id: 'a', do: d }] }, opts());
    assert.equal(r.steps[0].status, 'needs_user_confirmation', d.join(' '));
  }
  for (const bad of [{ dialog: false, button: 'Delete' }, { dialog: 'yes' }, { dialog: true, on: 'x' }]) {
    r = await run({ app: 'Fake', steps: [{ id: 'a', do: ['see'], expect: bad }] }, opts());
    assert.ok(r.error, JSON.stringify(bad));
  }

  // Jev unavailable -> unverified and stop; Jev unsure or contradicting -> failed.
  const semantic = { app: 'Fake', steps: [{ id: 'a', do: set('hi'), expect_text: 'hi is shown' }, { id: 'b', do: set('later') }] };
  r = await run(semantic, opts({ jev: jevSays({ status: 'unavailable', reason: 'missing_credential' }) }));
  assert.equal(r.ok, false); assert.deepEqual(r.steps.map(s => s.status), ['unverified', 'skipped']);
  assert.equal(r.steps[0].error, 'jev missing_credential');
  r = await run(semantic, opts({ jev: jevSays({ status: 'advice', answers: { r1: { choice: 'supported', confidence: 0.8 } } }) }));
  assert.equal(r.steps[0].status, 'failed');
  r = await run(semantic, opts({ jev: jevSays({ status: 'advice', answers: { r1: { choice: 'contradicted', confidence: 0.99 } } }) }));
  assert.equal(r.steps[0].status, 'failed');

  // Recipes via the CLI: save only on success, load by name, reject bad names.
  const recipes = path.join(dir, 'recipes'), planFile = path.join(dir, 'plan.json');
  const cli = (...args) => {
    const p = spawnSync(process.execPath, ['examples/bridges/peekaboo-runner.mjs', ...args], { encoding: 'utf8', env: { ...process.env, PEEKABOO_BIN: bin, PEEKABOO_RECIPES_DIR: recipes } });
    return { status: p.status, report: JSON.parse(p.stdout) };
  };
  fs.writeFileSync(planFile, JSON.stringify({ app: 'Fake', steps: [{ id: 'a', do: set('hi'), expect: { on: 'text entry area', value: 'hi' } }] }));
  let c = cli(planFile, '--save', 'demo-1');
  assert.equal(c.status, 0); assert.equal(c.report.saved, 'demo-1');
  assert.ok(fs.existsSync(path.join(recipes, 'demo-1.json')));
  c = cli('--recipe', 'demo-1');
  assert.equal(c.status, 0); assert.equal(c.report.ok, true);
  for (const bad of ['../evil', 'Bad_Name', 'x'.repeat(41), '']) {
    c = cli('--recipe', bad); assert.equal(c.status, 1); assert.match(c.report.error, /recipe name/);
  }
  fs.writeFileSync(planFile, JSON.stringify({ app: 'Fake', steps: [{ id: 'a', do: ['click', 'FAIL'] }] }));
  c = cli(planFile, '--save', 'broken');
  assert.equal(c.status, 1); assert.ok(!fs.existsSync(path.join(recipes, 'broken.json')));
  c = cli(planFile, '--recipe', 'demo-1'); assert.equal(c.status, 1);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('peekaboo-runner checks passed.');
