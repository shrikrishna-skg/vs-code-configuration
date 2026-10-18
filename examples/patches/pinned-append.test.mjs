// Run: node ~/.config/kilo/patches/pinned-append.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { patch } from './pinned-append.mjs';

const helper = fs.readFileSync(new URL('./pinned-append-ui.js', import.meta.url), 'utf8');
const store = new Map();
const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
const pin = vm.runInNewContext(helper, { localStorage, globalThis: {} });

store.set('kilo.promptSuggestions.v6', JSON.stringify([
  { id: 'tests', label: 'Run tests', prompt: 'Run the tests.', pinned: 7 },
  { id: 'multi', label: 'Use multiple agents', prompt: 'Use multiple agents.', pinned: 3 },
  { id: 'review', label: 'Review', prompt: 'Review changes.' },
  { id: 'legacy', label: 'Legacy', prompt: 'Legacy pin.', pinned: true }
]));
assert.equal(pin.append('Fix the bug.'), 'Fix the bug.', 'off by default');
store.set('kilo.composer.appendPinned', '1');
assert.equal(pin.append('Fix the bug.'), 'Fix the bug.\n\nUse multiple agents.\nRun the tests.\nLegacy pin.', 'pin order, blank line, one per line');
assert.equal(pin.append('Fix it.\n\nUse multiple agents.'), 'Fix it.\n\nUse multiple agents.\n\nRun the tests.\nLegacy pin.', 'already-included prompt not repeated');
assert.equal(pin.append(''), '', 'empty message stays empty');
store.set('kilo.promptSuggestions.v6', 'not json');
assert.equal(pin.append('Hi'), 'Hi', 'bad storage is ignored');

const src = [
  { id: 'a', label: 'A', prompt: 'A.', other: 1 },
  { id: 'b', label: 'B', prompt: 'B.', pinned: 2 },
  { id: 'c', label: 'C', prompt: 'C.' }
];
const out = pin.applyPins(src, ['c', 'a']);
assert.deepEqual(out.map(i => i.id), ['a', 'b', 'c'], 'array order preserved');
assert.equal(out[0].pinned, 2, 'checked row gets its display rank');
assert.equal(out[2].pinned, 1, 'checked row gets its display rank');
assert.equal('pinned' in out[1], false, 'unchecked row loses pinned');
assert.equal(out[0].other, 1, 'other fields preserved');
assert.equal(src[1].pinned, 2, 'input array not mutated');
assert.notEqual(out[0], src[0], 'new objects returned');
assert.deepEqual(pin.applyPins(src, ['missing']).map(i => 'pinned' in i), [false, false, false], 'unknown ids ignored');
assert.equal(pin.applyPins(null, ['a']).length, 0, 'non-array input yields empty array');

const source = 'a;ei=[fo,q0,Xo,ur,ze].filter(Boolean).join(x);b;Q(fo,E(()=>globalThis.__kiloPermissionMenu(p,nt,()=>1),{}),null);c';
const patched = patch(source);
assert.ok(patched.includes('globalThis.__kiloPin?.append(ze)??ze') && patched.includes('.button(ze,zr,nt)'));
assert.equal(patch(patched), patched, 'apply is idempotent');
assert.equal(patch(patched, true), source, 'restore returns the original');
assert.throws(() => patch('nothing here'), /anchor/);

const panel = 'const promptSuggestionsSave=()=>{try{localStorage.setItem(promptSuggestionsStorageKey,JSON.stringify(promptSuggestionsItems))}catch{}},closePromptSuggestions=1;';
const withPanel = patch(source + panel);
assert.ok(withPanel.includes('promptSuggestionsReload=/* pinned-append-reload:v1 */'), 'Prompts panel reload hook added');
new Function(withPanel.slice(withPanel.indexOf('const promptSuggestionsSave')));
assert.equal(patch(withPanel), withPanel, 'reload hook idempotent');
assert.equal(patch(withPanel, true), source + panel, 'restore removes reload hook');
console.log('pinned-append: all checks passed');
