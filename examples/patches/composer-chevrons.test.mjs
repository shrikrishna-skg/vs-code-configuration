import assert from 'node:assert';
import { patch, css } from './composer-chevrons.mjs';

// CSS: appended once, idempotent, restorable, and refuses unknown or doubled input.
const base = '.prompt-input-hint-selectors{display:flex}.kilo-permission-trigger{height:28px}';
const once = patch(base, 'css');
assert.ok(once.startsWith(base) && once.includes(css));
assert.strictEqual(patch(once, 'css'), once);
assert.strictEqual(patch(once, 'css', true), base);
assert.strictEqual(patch(base, 'css', true), base);
assert.throws(() => patch('body{}', 'css'), /no changes made/);
assert.throws(() => patch(once + css, 'css'), /no changes made/);
assert.ok(!css.includes('undefined') && css.split('{').length === css.split('}').length);

// JS: the Continue button loses its text arrow exactly once, and restore puts it back.
const button = "<button class=quick-action-trigger aria-label='Quick actions'>Continue ▾</button>";
const clean = patch(button);
assert.ok(!clean.includes('▾') && clean.includes('>Continue</button>'));
assert.strictEqual(patch(clean), clean);
assert.strictEqual(patch(clean, 'js', true), button);
assert.throws(() => patch('var a=1'), /no changes made/);
assert.throws(() => patch(button + button), /no changes made/);
console.log('composer-chevrons: all checks passed');
