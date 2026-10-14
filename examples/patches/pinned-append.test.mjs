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

const source = 'a;ei=[fo,q0,Xo,ur,ze].filter(Boolean).join(x);b;Q(fo,E(()=>globalThis.__kiloPermissionMenu(p,nt,()=>1),{}),null);c';
const patched = patch(source);
assert.ok(patched.includes('globalThis.__kiloPin?.append(ze)??ze') && patched.includes('.button(ze,zr,nt)'));
assert.equal(patch(patched), patched, 'apply is idempotent');
assert.equal(patch(patched, true), source, 'restore returns the original');
assert.throws(() => patch('nothing here'), /anchor/);
console.log('pinned-append: all checks passed');
