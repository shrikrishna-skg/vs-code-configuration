import assert from 'node:assert';
import { patch, css, shortLabel } from './composer-one-line.mjs';

// CSS: appended once, idempotent, restorable, refuses unknown or doubled input.
const base = '.prompt-input-hint-selectors{display:flex}.model-selector-trigger-label{overflow:hidden}';
const once = patch(base, 'css');
assert.ok(once.startsWith(base) && once.includes(css) && css.includes('flex-wrap:nowrap'));
assert.strictEqual(patch(once, 'css'), once);
assert.strictEqual(patch(once, 'css', true), base);
assert.throws(() => patch('body{}', 'css'), /no changes made/);
assert.throws(() => patch(once + css, 'css'), /no changes made/);
assert.ok(css.split('{').length === css.split('}').length);

// JS: tooltip switches from the model id to the displayed label, once, and restores.
const js = 'el=X("<span class=model-selector-trigger-label>");fn=x=>(()=>{var n=el();return P(n,x),n})();Wt=()=>uat(m()?.name,m()?.providerID,e.value);E(Pn,{get value(){return m()?.id??""},placement:"top",openDelay:0,get inactive(){return!m()}})';
const done = patch(js);
assert.ok(done.includes('get value(){return Wt()},placement') && !done.includes('m()?.id??'));
assert.strictEqual(patch(done), done);
assert.strictEqual(patch(done, 'js', true), js);
assert.throws(() => patch('var a=1'), /no changes made/);
assert.throws(() => patch(js + ';' + js), /no changes made/);

assert.equal(shortLabel('Small model'), 'Small model');
assert.equal(Array.from(shortLabel('😀'.repeat(40))).length, 28);
assert.ok(shortLabel('x'.repeat(29)).endsWith('…'));
assert.ok(done.includes('/* kilo-model-label:28 */'));
assert.ok(css.includes('.prompt-action:not([data-folded]){max-width:none;overflow:visible'));
assert.ok(css.includes('.prompt-selectors .model-selector-trigger-label'));
console.log('composer-one-line: all checks passed');
