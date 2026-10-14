import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { patch } from './predict-next.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

// --- patch() unit: extension.js ---
const extBase = 'function x(){switch(a.type){case"requestChatCompletion":{break}case"enhancePrompt":{let sdkClient=this.client;break}}}';
const extPatched = patch(extBase, 'extension.js');
assert.notEqual(extPatched, extBase, 'extension patch must change source');
assert.ok(extPatched.includes('case"requestNextPrompt":{'), 'host case inserted');
assert.ok(extPatched.includes('predict-next.cjs'), 'host helper required');
assert.ok(extPatched.includes('this.getSessionDirectory(message6.sessionID)'), 'directory argument');
assert.equal(patch(extPatched, 'extension.js'), extPatched, 'extension patch idempotent');
assert.equal(patch(extPatched, 'extension.js', true), extBase, 'extension restore exact');

// --- patch() unit: webview.js ---
const webBase = 'aaa;/* clarify-goal-patch:v1 */\n/* clarify-goal-ui:v1 */\n(()=>{})();\n\n"use strict";let x=1,let Be=dBn(p,U,()=>r.isConnected()),Ve=uBn();zzz';
const webPatched = patch(webBase, 'webview.js');
assert.notEqual(webPatched, webBase, 'webview patch must change source');
assert.ok(webPatched.indexOf('/* predict-next-ui:v2 */') >= 0 && webPatched.indexOf('/* predict-next-ui:v2 */') < webPatched.indexOf('/* clarify-goal-patch:v1 */'), 'helper block before clarify marker');
assert.ok(webPatched.includes('globalThis.__kiloNext.attach('), 'call site inserted');
assert.ok(webPatched.includes('__kiloNextStop.sync()'), 'session-change sync wired');
assert.equal(patch(webPatched, 'webview.js'), webPatched, 'webview patch idempotent');
assert.equal(patch(webPatched, 'webview.js', true), webBase, 'webview restore exact');

// --- an installed older version is upgraded in place and restores cleanly ---
const webOld = webBase.replace('/* clarify-goal-patch:v1 */', '/* predict-next-ui:v1 */\nOLD();\n/* clarify-goal-patch:v1 */').replace('let Be=dBn(', '/* predict-next-call:v1 */OLDCALL();let Be=dBn(');
assert.equal(patch(webOld, 'webview.js'), webPatched, 'old version upgraded');
assert.equal(patch(webOld, 'webview.js', true), webBase, 'old version restored');

// --- anchor mismatch throws, changes nothing ---
assert.throws(() => patch('nothing here', 'extension.js'), /no changes made/);
assert.throws(() => patch('nothing here', 'webview.js'), /no changes made/);

// --- predict-next-ui.js attach() behaviour ---
const sandbox = { globalThis: null };
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(root, 'predict-next-ui.js'), 'utf8'), sandbox);

function makeInput() {
  const listeners = {};
  return {
    value: '', placeholder: 'original',
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { const a = listeners[type] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    fire(type, event = {}) { for (const fn of (listeners[type] || []).slice()) fn(event); },
    listenerCount(type) { return (listeners[type] || []).length; },
  };
}
const key = (k) => ({ key: k, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });

const input = makeInput();
const sent = [];
let receive, sessionID = 's1';
const stop = sandbox.__kiloNext.attach({
  input: () => input,
  post: (m) => sent.push(m),
  on: (fn) => { receive = fn; return () => { receive = null; }; },
  session: () => sessionID,
  apply: (value) => { input.value = value; },
});
const view = (id) => { sessionID = id; stop.sync(); };
const closed = (id, extra = {}) => receive({ type: 'sessionTurnClosed', sessionID: id, reason: 'completed', ...extra });
const result = (id, text, requestId = sent.at(-1).requestId) => receive({ type: 'nextPromptResult', text, requestId, sessionID: id });
assert.equal(input.listenerCount('keydown'), 1, 'keydown attached');

// a session this view has never shown (for example a temporary one) never triggers a request
closed('temporary');
assert.equal(sent.length, 0, 'unknown session ignored');

// completed turn -> one request; subagent, interrupted and duplicate events are ignored
closed('s1', { eventID: 'e1' });
assert.equal(sent.length, 1);
assert.equal(sent[0].type, 'requestNextPrompt');
assert.equal(sent[0].sessionID, 's1');
assert.match(sent[0].requestId, /^next-s1-\d+$/);
closed('s1', { eventID: 'e1' });
closed('s1', { parentID: 'p' });
receive({ type: 'sessionTurnClosed', sessionID: 's1', reason: 'interrupted' });
assert.equal(sent.length, 1, 'duplicate, subagent and interrupted events ignored');

// matching result shows; stale result is dropped
result('s1', 'hello world');
assert.equal(input.placeholder, 'hello world');
result('s1', 'stale', 'next-s1-0');
assert.equal(input.placeholder, 'hello world', 'stale requestId ignored');

// typed text keeps the suggestion stored but Tab must not overwrite the draft
input.value = 'typed';
const blocked = key('Tab');
input.fire('keydown', blocked);
assert.ok(!blocked.prevented, 'Tab untouched while the input has text');
assert.equal(input.value, 'typed');
input.value = '';

// Tab accepts: preventDefault, applies, restores the placeholder
const tab = key('Tab');
input.fire('keydown', tab);
assert.ok(tab.prevented && tab.stopped, 'Tab preventDefault + stopPropagation');
assert.equal(input.value, 'hello world');
assert.equal(input.placeholder, 'original');
input.value = '';

// a turn that finishes while another session is on screen is predicted and shown on return
view('s2');
closed('s1', { eventID: 'e2' });
assert.equal(sent.length, 2, 'background session still requested');
result('s1', 'for s1');
assert.equal(input.placeholder, 'original', 'not shown in the other session');
view('s1');
assert.equal(input.placeholder, 'for s1', 'shown when its session is on screen again');
view('s2');
assert.equal(input.placeholder, 'original', 'hidden again after switching away');
view('s1');

// Escape dismisses
const esc = key('Escape');
input.fire('keydown', esc);
assert.ok(esc.stopped);
assert.equal(input.placeholder, 'original');
view('s2'); view('s1');
assert.equal(input.placeholder, 'original', 'dismissed suggestion does not come back');

// a new turn (busy) drops the suggestion, also when a late result arrives
closed('s1', { eventID: 'e3' });
result('s1', 'third');
assert.equal(input.placeholder, 'third');
receive({ type: 'sessionStatus', sessionID: 's1', status: 'busy' });
assert.equal(input.placeholder, 'original');
result('s1', 'late', sent.at(-1).requestId);
assert.equal(input.placeholder, 'original', 'late result after a new turn ignored');

// dispose restores and unsubscribes
closed('s1', { eventID: 'e4' });
result('s1', 'fourth');
assert.equal(input.placeholder, 'fourth');
stop();
assert.equal(input.placeholder, 'original');
assert.equal(input.listenerCount('keydown'), 0);

console.log('PASS: predict-next patch apply/idempotent/upgrade/restore/mismatch and UI request/show/background/accept/dismiss.');
