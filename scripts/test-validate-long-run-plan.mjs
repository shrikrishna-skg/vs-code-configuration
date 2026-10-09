// Focused check for scripts/validate-long-run-plan.mjs. Standard library only: node scripts/test-validate-long-run-plan.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlan } from './validate-long-run-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'scripts/validate-long-run-plan.mjs');
const fixtures = path.join(root, 'examples/long-run-plan');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const valid = JSON.parse(fs.readFileSync(path.join(fixtures, 'valid.json'), 'utf8'));
const variant = edit => { const plan = structuredClone(valid); edit(plan); return validatePlan(plan); };
const has = (errors, pattern) => assert.ok(errors.some(e => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(errors)}`);
const tasks = (state, n, prefix = state) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, state }));

// Valid plan: API and CLI.
assert.deepEqual(validatePlan(valid), []);
let result = run(path.join(fixtures, 'valid.json'));
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /^valid: /);

// Invalid fixture: all eight errors are reported together, nonzero exit.
result = run(path.join(fixtures, 'invalid.json'));
assert.equal(result.status, 1);
assert.equal(result.stderr.split('\n').filter(line => line.startsWith('- ')).length, 8, result.stderr);
assert.match(result.stderr, /\(8 errors\)/);

// Usage: exactly one path.
assert.equal(run().status, 2);
assert.equal(run('a.json', 'b.json').status, 2);

// Malformed JSON and unreadable file.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'long-run-plan-test-'));
try {
  const bad = path.join(scratch, 'bad.json');
  fs.writeFileSync(bad, '{"objective": ');
  result = run(bad);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /malformed JSON/);
  result = run(path.join(scratch, 'missing.json'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot read file/);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

// Non-object plan and empty objective.
assert.deepEqual(validatePlan([]), ['plan: must be a JSON object']);
has(variant(p => { p.objective = ''; }), /^objective: must be a non-empty string/);

// Missing requirements: reported, and references then become unknown.
let errors = variant(p => { delete p.requirements; });
has(errors, /^requirements: must be a non-empty array/);
has(errors, /unknown requirement "R1"/);
has(variant(p => { p.requirements = []; }), /^requirements: must be a non-empty array/);

// Ceilings: 8 active + 12 queued is the boundary; one more of either fails.
assert.deepEqual(variant(p => { p.tasks = [...tasks('active', 8), ...tasks('queued', 12)]; }), []);
errors = variant(p => { p.tasks = [...tasks('active', 9), ...tasks('queued', 2)]; });
has(errors, /9 active tasks exceed the limit of 8/);
errors = variant(p => { p.tasks = [...tasks('active', 8), ...tasks('queued', 13), ...tasks('completed', 5)]; });
has(errors, /21 active\+queued tasks exceed the limit of 20/);
assert.equal(errors.length, 1, JSON.stringify(errors));

// Duplicate IDs.
has(variant(p => { p.requirements[1].id = 'R1'; }), /duplicate requirement ID "R1"/);
has(variant(p => { p.tasks[1].id = 'T1'; }), /tasks\[1\]\.id: duplicate task ID "T1"/);

// Writer scopes: active/waiting writers may not share; completed writers may.
has(variant(p => { p.tasks[1].exclusiveScopes = [...p.tasks[0].exclusiveScopes]; }), /already held by active\/waiting writer T1/);
assert.deepEqual(variant(p => { p.tasks[1].state = 'completed'; p.tasks[1].exclusiveScopes = [...p.tasks[0].exclusiveScopes]; }), []);
has(variant(p => { p.tasks[0].owner = ' '; }), /tasks\[0\]\.owner: writer tasks need a non-empty owner/);
has(variant(p => { delete p.tasks[0].exclusiveScopes; }), /tasks\[0\]\.exclusiveScopes: writer tasks need/);
has(variant(p => { p.tasks[0].writer = 'yes'; }), /tasks\[0\]\.writer: must be a boolean/);

// Invalid state and unknown requirement reference.
has(variant(p => { p.tasks[0].state = 'running'; }), /tasks\[0\]\.state: must be one of queued\/active\/waiting\/completed\/failed\/cancelled/);
has(variant(p => { p.tasks[2].requirements.push('R9'); }), /tasks\[2\]\.requirements: unknown requirement "R9"/);

console.log('validate-long-run-plan tests passed.');
