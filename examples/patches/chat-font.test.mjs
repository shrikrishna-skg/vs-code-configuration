import assert from 'node:assert';
import { patch, css } from './chat-font.mjs';

const base = '@layer theme{:root{--font-family-sans: system-ui}}';
const once = patch(base);
assert.ok(once.startsWith(base) && once.includes(css));
assert.strictEqual(patch(once), once);
assert.strictEqual(patch(once, true), base);
assert.strictEqual(patch(base, true), base);
assert.throws(() => patch('body{}'), /no changes made/);
assert.throws(() => patch(once + css), /no changes made/);
console.log('chat-font: all checks passed');
