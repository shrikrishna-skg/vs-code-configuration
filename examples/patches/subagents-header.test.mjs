// Appended CSS blocks are order-independent: present anywhere means installed, upgrades stay in place.
// Run: node subagents-header.test.mjs
import assert from 'node:assert/strict';
import { patchCSS } from './subagents-header.mjs';
import { patch as sessionMap } from './session-map.mjs';

const later = '\n/* kilo-later-patch:v1 */\n.later{color:red}\n/* end kilo-later-patch */\n';
const native = '[data-component=agent-stack]{}[data-slot=agent-panel]{}\n';
const start = '/* legacy-agent-header:v4:start */';

const header = patchCSS(native);
assert.equal(header.split(start).length, 2, 'header block appended once');
assert.equal(patchCSS(header), header, 'idempotent');
assert.equal(patchCSS(header + later), header + later, 'block followed by a later patch is installed');
const stale = header.replace(/(legacy-agent-header:v4:start \*\/\n)/, '$1.old{}\n') + later;
assert.equal(patchCSS(stale), header + later, 'outdated block replaced in place, later block kept after it');
assert.equal(patchCSS(header + later, true), native + later, 'restore removes only this block');

const map = sessionMap(native, 'webview.css');
assert.equal(sessionMap(map + later, 'webview.css'), map + later, 'session map followed by a later patch is installed');
assert.equal(sessionMap(map + later, 'webview.css', true), native + later, 'session map restore keeps later block');
console.log('PASS subagents-header/session-map CSS blocks are order-independent');
