import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patch } from '../examples/patches/native-subagent-ready.mjs';

// The supported bundle's actual listener, kept as a runnable fixture rather than a replica.
const original = 'function install(){let readyDisposable=panel.webview.onDidReceiveMessage(msg=>{if(msg.type==="webviewReady"){readyDisposable.dispose(),provider.postMessage({type:"viewSubAgentSession",sessionID}),provider.loadMessages(sessionID);try{this.connectionService.getClient().session.get({sessionID,directory:directory5},{throwOnError:!0}).then(({data:session})=>provider.registerSession(session)).catch(err2=>{console.error("[Kilo New] SubAgentViewerProvider: Failed to load session metadata:",err2)})}catch(err2){console.error("[Kilo New] SubAgentViewerProvider: Failed to load session metadata:",err2)}}}),closeDisposable=null;}';
const patched = patch(original);
assert.equal(patch(patched), patched);
assert.equal(patch(patched, true), original);
assert.equal(patch(original, true), original);
for (const source of ['unknown bundle', original + original, original + patched]) assert.throws(() => patch(source));

function viewer(source, initiallyReady = false) {
  const calls = [], errors = [];
  let listener, connected = initiallyReady, resolveConnection, rejectConnection;
  const connection = new Promise((resolve, reject) => { resolveConnection = resolve; rejectConnection = reject; });
  const sessionID = 'fixture-child', directory5 = '/fixture';
  const panel = { webview: { onDidReceiveMessage(callback) {
    listener = callback;
    return { dispose() { calls.push('dispose'); listener = undefined; } };
  } } };
  const owner = {
    panels: new Map([[sessionID, panel]]),
    connectionService: { getClient() {
      calls.push('getClient');
      if (!connected) throw new Error('Not connected — call connect() first');
      return { session: { get: async () => { calls.push('metadata'); return { data: { id: sessionID } }; } } };
    } },
  };
  const provider = {
    async initializeConnection() { calls.push('initialize'); if (!connected) await connection; },
    postMessage(message) { calls.push(message.type); },
    loadMessages(id) { assert.equal(id, sessionID); calls.push(connected ? 'loadMessages' : 'loadMessages-before-connect'); },
    registerSession(session) { assert.equal(session.id, sessionID); calls.push('registerSession'); },
  };
  vm.runInNewContext(source + ';install.call(owner)', {
    owner, panel, provider, sessionID, directory5,
    console: { error: (...args) => errors.push(args.map(String).join(' ')) },
  });
  return {
    calls, errors,
    fire: type => listener?.({ type }),
    connect() { connected = true; resolveConnection(); },
    fail() { rejectConnection(new Error('Connection failed')); },
    close() { owner.panels.delete(sessionID); },
    replace() { owner.panels.set(sessionID, {}); },
  };
}

const race = viewer(original);
race.fire('webviewReady');
assert(race.calls.includes('loadMessages-before-connect'));
assert(race.errors.some(error => error.includes('Not connected')));

const deferred = viewer(patched);
await deferred.fire('unrelated');
assert.deepEqual(deferred.calls, []);
const loading = deferred.fire('webviewReady');
assert.deepEqual(deferred.calls, ['dispose', 'initialize']);
await deferred.fire('webviewReady');
assert.deepEqual(deferred.calls, ['dispose', 'initialize'], 'Disposed readiness listener must not initialize twice');
deferred.connect();
await loading;
assert.deepEqual(deferred.calls, ['dispose', 'initialize', 'viewSubAgentSession', 'loadMessages', 'getClient', 'metadata', 'registerSession']);
assert.deepEqual(deferred.errors, []);

const ready = viewer(patched, true);
await ready.fire('webviewReady');
assert.deepEqual(ready.calls, deferred.calls);
assert.deepEqual(ready.errors, []);

for (const operation of ['close', 'replace']) {
  const closed = viewer(patched);
  const pending = closed.fire('webviewReady');
  closed[operation]();
  closed.connect();
  await pending;
  assert.deepEqual(closed.calls, ['dispose', 'initialize'], 'A closed or replaced panel must not load late');
  assert.deepEqual(closed.errors, []);
}
const failed = viewer(patched);
const pending = failed.fire('webviewReady');
failed.fail();
await pending;
assert.deepEqual(failed.calls, ['dispose', 'initialize']);
assert.equal(failed.errors.length, 1, 'Initialization failure must be caught');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-subagent-ready-'));
try {
  const target = path.join(temp, 'extension.js');
  const cli = fileURLToPath(new URL('../examples/patches/native-subagent-ready.mjs', import.meta.url));
  const run = mode => spawnSync(process.execPath, [cli, target, mode], { encoding: 'utf8' });
  fs.writeFileSync(target, original);
  assert.notEqual(run('--check').status, 0);
  assert.equal(run('--apply').status, 0);
  assert.equal(fs.readFileSync(target, 'utf8'), patched);
  assert.equal(fs.readFileSync(target + '.pre-native-subagent-ready', 'utf8'), original);
  assert.equal(run('--check').status, 0);
  assert.equal(run('--apply').status, 0);
  assert.equal(run('--restore').status, 0);
  assert.equal(fs.readFileSync(target, 'utf8'), original);
  fs.writeFileSync(target, original + '\ninvalid syntax!');
  assert.notEqual(run('--apply').status, 0);
  assert.equal(fs.readFileSync(target, 'utf8'), original + '\ninvalid syntax!');
  fs.writeFileSync(target, 'unknown bundle');
  assert.notEqual(run('--apply').status, 0);
  assert.equal(fs.readFileSync(target, 'utf8'), 'unknown bundle');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('Native sub-agent readiness checks passed: original race, deferred and ready clients, closed/replaced panels, one-shot readiness, caught failure, and safe CLI apply/check/restore.');
