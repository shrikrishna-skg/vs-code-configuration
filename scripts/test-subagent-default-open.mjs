import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { patch } from '../examples/patches/subagent-default-open.mjs';

const fixtures = [
  ['CSn', '_Sn'], // Editor view.
  ['Hbn', 'Ubn'], // Agent Manager view.
];
for (const [name, auto] of fixtures) {
  // Exact task-card policy functions from the installed local Kilo bundle.
  const source = `function ${name}(e,t){return e==="running"&&!t}function ${auto}(e,t,n){if(!n){if(e)return!0;if(t)return!1}}`;
  const changed = patch(source);
  assert.equal(patch(changed), changed);
  assert.equal(patch(changed, true), source);
  assert.throws(() => patch(source + source), /ambiguous/);
  const policy = vm.runInNewContext(`${changed};({initial:${name},update:${auto}})`);
  for (const status of ['pending', 'running', 'completed', 'error']) for (const background of [false, true]) {
    assert.equal(policy.initial(status, background), true, `${status}, background=${background}: must open by default`);
    assert.equal(policy.update(policy.initial(status, background), background, false), true, 'Untouched cards stay open across updates');
    assert.equal(policy.update(policy.initial(status, background), background, true), undefined, 'Manual collapse/reopen must not be overridden');
  }
}
assert.throws(() => patch('unknown bundle'), /Unsupported/);
assert.throws(() => patch(fixtures.map(([name]) => `function ${name}(e,t){return e==="running"&&!t}`).join('')), /ambiguous/);

// Optionally check the real installed bundles, not just fixtures.
for (const file of process.argv.slice(2)) {
  const source = fs.readFileSync(file, 'utf8');
  assert.equal(patch(source), source, `${file}: installed patch missing`);
  const [name, auto] = fixtures.find(([name]) => source.includes(`function ${name}(e,t){/* subagent-default-open:v1 */`));
  const defaults = source.match(new RegExp(`function ${name}\\(e,t\\)\\{[^}]+\\}`))[0];
  const updates = source.match(new RegExp(`function ${auto}\\(e,t,n\\)\\{if\\(!n\\)\\{if\\(e\\)return!0;if\\(t\\)return!1\\}\\}`))[0];
  const policy = vm.runInNewContext(`${defaults}${updates};({initial:${name},update:${auto}})`);
  assert.equal(policy.initial('completed', true), true);
  assert.equal(policy.update(true, true, true), undefined);
}
console.log('Subagent cards: both views default open, background/completed cards stay open, manual toggles preserved, patch idempotent and reversible.');
