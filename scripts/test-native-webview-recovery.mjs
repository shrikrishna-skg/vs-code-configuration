import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeWebviewRecovery, nativeWebviewRecoveryClient, patchHost, patchClient } from '../examples/patches/native-webview-recovery.mjs';

function fixture() {
  let now = 1000, interval, clearCount = 0;
  const log = [], panels = [], diagnostics = [];
  const clock = { setInterval(fn) { interval = fn; return { unref() {} }; }, clearInterval() { clearCount++; } };
  const disposable = callback => { let active = true; return { dispose() { active = false; }, fire(...args) { if (active) callback(...args); } }; };
  function panel() {
    let listener, onDispose;
    const value = { viewType: 'kilo-code.new.TabPanel', title: 'CTO task', viewColumn: 2, visible: true, active: true,
      webview: { onDidReceiveMessage(fn) { listener = disposable(fn); return listener; }, postMessage(message) { log.push(message); return Promise.resolve(true); } },
      onDidDispose(fn) { onDispose = disposable(fn); return onDispose; },
      dispose() { log.push('panel disposed'); onDispose?.fire(); },
      receive(message) { listener?.fire(message); },
    }; panels.push(value); return value;
  }
  const first = panel();
  const provider = { panel: first, webview: first.webview, extensionUri: '/extension', opts: { onRecoveredPanel(old, next) { log.push(['replacement', old, next]); } }, isWebviewReady: true,
    getCurrentSessionId: () => 'original-session',
    resolveWebviewPanel(next) { this.panel = next; this.webview = next.webview; log.push('resolve same provider'); },
    initializeConnection: async () => {}, waitForReady: async () => {}, loadMessages(id) { log.push(['loadMessages', id]); }, getSessionInfo: async id => ({ id }), registerSession(session) { log.push(['registerSession', session.id]); }, postMessage(message) { log.push(message); }, dispose() { log.push('provider disposed'); },
  };
  const vscode = { window: { createOutputChannel(name, options) { assert.equal(name, 'Kilo Renderer Health'); assert.equal(options.log, true); return { info(text) { diagnostics.push(JSON.parse(text)); } }; }, createWebviewPanel(type, title, where, options) { assert.equal(where.preserveFocus, true); const next = panel(); next.viewType = type; return next; }, showWarningMessage(message) { log.push(message); } } };
  const install = vm.runInNewContext(`(${installNativeWebviewRecovery})`, { Date: { now: () => now }, console, Number, globalThis: clock });
  install(provider, first, vscode, clock);
  return { first, provider, panels, log, diagnostics, install, vscode, clock, tick(ms = 5000) { now += ms; interval(); }, get clearCount() { return clearCount; } };
}

const healthy = fixture();
for (let i = 0; i < 30; i++) { healthy.tick(); const ping = healthy.log.at(-1); healthy.first.receive({ type: '__nativeWebviewPong', sequence: ping.sequence }); }
assert.equal(healthy.panels.length, 1);
const hidden = fixture(); hidden.first.visible = false;
for (let i = 0; i < 30; i++) hidden.tick();
assert.equal(hidden.panels.length, 1); assert.equal(hidden.log.length, 0);
hidden.first.visible = true; hidden.tick(); assert.equal(hidden.panels.length, 1);
const slept = fixture(); for (let i = 0; i < 10; i++) slept.tick(60000); assert.equal(slept.panels.length, 1);
const initial = fixture(); for (let i = 0; i < 11; i++) initial.tick(); assert.equal(initial.panels.length, 1);
const dead = fixture(); dead.first.receive({ type: '__nativeWebviewSnapshot', snapshot: { state: { draft: 'keep' }, drafts: { version: 1, maps: { images: [] } } } });
for (let i = 0; i < 13; i++) dead.tick();
await new Promise(resolve => setImmediate(resolve));
assert.equal(dead.panels.length, 2);
assert.equal(dead.provider.panel, dead.panels[1]);
assert(dead.log.some(value => value.type === 'openSession' && value.sessionID === 'original-session'));
assert.equal(dead.provider.nativeWebviewRecoveryState.snapshot.state.draft, 'keep');
assert(!dead.log.includes('provider disposed'));
assert(!dead.log.some(value => ['sendMessage', 'createSession', 'abort'].includes(value?.type)));
assert(dead.clearCount > 0);
assert.deepEqual(dead.diagnostics.map(item => item.event), ['unresponsive', 'replacement-ready', 'recovery-dispatched']);
assert.equal(dead.diagnostics[0].pendingMs, 55000);
assert(!JSON.stringify(dead.diagnostics).includes('original-session'));
assert.equal(healthy.diagnostics.length, 0, 'Healthy heartbeats must not create diagnostic traffic');
const upgrade = patchHost(`/* native-webview-recovery:v2 */\n${installNativeWebviewRecovery.toString()}\nconst preserveOtherPatches = true;`);
assert(upgrade.startsWith('/* native-webview-recovery:v3 */'));
assert(upgrade.endsWith('const preserveOtherPatches = true;'));
assert.equal(patchHost(upgrade), upgrade);
const noLog = fixture(); noLog.vscode.window.createOutputChannel = () => { throw new Error('Output unavailable'); };
for (let i = 0; i < 13; i++) noLog.tick();
await new Promise(resolve => setImmediate(resolve));
assert.equal(noLog.panels.length, 2, 'Unavailable diagnostics must not block renderer recovery');
const closed = fixture(); closed.first.dispose(); for (let i = 0; i < 15; i++) closed.tick(); assert.equal(closed.panels.length, 1);
assert.throws(() => patchClient('unsupported bundle'), /anchor/);
assert.throws(() => patchHost('unsupported bundle'), /anchor/);
console.log('Native webview recovery checks passed: healthy/hidden/sleep/startup/disposed cases, renderer timeout, same-provider/session restore, no model submission.');
const images = fixture();
images.first.receive({ type: '__nativeWebviewSnapshot', snapshot: { drafts: { version: 1, maps: { images: [['prompt', [{ id: 'image', dataUrl: 'data:image/png;base64,AA==' }]]] } } } });
images.first.receive({ type: '__nativeWebviewSnapshot', snapshot: { drafts: { version: 1, maps: { text: [['prompt', 'changed text']] } } } });
assert.equal(images.provider.nativeWebviewRecoveryState.snapshot.drafts.maps.images[0][1][0].id, 'image');
images.first.receive({ type: '__nativeWebviewSnapshot', snapshot: { drafts: { version: 1, maps: { images: [] } } } });
assert.deepEqual(images.provider.nativeWebviewRecoveryState.snapshot.drafts.maps.images, []);
const late = fixture(); late.tick(); late.first.receive({ type: '__nativeWebviewPong', sequence: 1 });
for (let i = 0; i < 13; i++) { late.tick(); late.first.receive({ type: '__nativeWebviewPong', sequence: 1 }); }
await new Promise(resolve => setImmediate(resolve));
assert.equal(late.panels.length, 2, 'Repeated stale acknowledgements must not hide a dead view');
for (let round = 0; round < 2; round++) {
  dead.install(dead.provider, dead.provider.panel, dead.vscode, dead.clock);
  for (let i = 0; i < 13; i++) dead.tick();
  await new Promise(resolve => setImmediate(resolve));
}
assert.equal(dead.panels.length, 3, 'Only two automatic recoveries are allowed within five minutes');
assert(dead.log.some(value => typeof value === 'string' && value.includes('two recovery attempts')));
console.log('Additional checks passed: attachment delta merge/removal, stale acknowledgements, repeated recovery cap.');

const inactive = fixture(); inactive.first.active = false; for (let i = 0; i < 13; i++) inactive.tick(); await new Promise(resolve => setImmediate(resolve)); assert.equal(inactive.panels.length, 2, "Visible panes recover without stealing keyboard focus");

const pending = fixture(); pending.first.receive({ type: '__nativeWebviewSnapshot', snapshot: { drafts: { version: 1, maps: {}, tabs: { ids: ['sidebar-pending:saved'], active: 'sidebar-pending:saved' } } } });
for (let i = 0; i < 13; i++) pending.tick(); await new Promise(resolve => setImmediate(resolve));
assert.equal(pending.panels.length, 2); assert(!pending.log.some(value => value?.type === 'openSession'), 'An unsent pending draft must not be replaced by the last submitted session');
const child = fixture(); child.first.viewType = 'kilo-code.new.SubAgentViewerPanel'; child.provider.getCurrentSessionId = () => undefined; child.provider.opts.nativeRecoverySessionID = 'child-session'; child.first.receive({ type: '__nativeWebviewSnapshot', snapshot: { drafts: { version: 1, maps: {}, tabs: { active: 'sidebar-pending:unused-child-tab' } } } });
for (let i = 0; i < 13; i++) child.tick(); await new Promise(resolve => setImmediate(resolve));
assert(child.log.some(value => value?.type === 'viewSubAgentSession' && value.sessionID === 'child-session'));
assert(child.log.some(value => value?.[0] === 'loadMessages' && value[1] === 'child-session'));
assert(child.log.some(value => value?.[0] === 'registerSession' && value[1] === 'child-session'));

let state = { tabs: ['old'] }, timer, rootChildren = 1;
const messages = [], listeners = {};
const nativeApi = Object.freeze({ getState: () => state, setState: value => state = value, postMessage: message => messages.push(message) });
const window = { acquireVsCodeApi: () => nativeApi, addEventListener: (name, listener) => listeners[name] = listener, __nativeGetDraftSnapshot: () => ({ version: 1, maps: {} }) };
vm.runInNewContext(`(${nativeWebviewRecoveryClient})();`, { window, document: { getElementById: () => ({ childElementCount: rootChildren }) }, setTimeout: fn => timer = fn });
const api = window.acquireVsCodeApi();
listeners.message({ data: { type: '__nativeWebviewPing', sequence: 1 } });
assert.equal(messages.at(-1).snapshot.state.tabs[0], 'old');
api.setState({ tabs: ['new'] }); timer();
assert.equal(messages.at(-1).snapshot.state.tabs[0], 'new', 'Delayed VS Code tab persistence must refresh the host snapshot even without a draft edit');
rootChildren = 0; const before = messages.length;
listeners.message({ data: { type: '__nativeWebviewPing', sequence: 2 } });
assert.equal(messages.length, before, 'An empty application root must not report healthy');
console.log('Client and routing checks passed: frozen API, delayed tab persistence, empty-root liveness, pending draft identity, child startup recovery.');

const reconnecting = fixture(); reconnecting.first.viewType = 'kilo-code.new.SubAgentViewerPanel';
let finishConnection;
reconnecting.provider.initializeConnection = () => new Promise(resolve => finishConnection = resolve);
for (let i = 0; i < 13; i++) reconnecting.tick(); await new Promise(resolve => setImmediate(resolve));
assert(!reconnecting.log.some(value => value?.[0] === 'loadMessages'), 'Reconnecting child must wait for its backend before loading');
finishConnection(); await new Promise(resolve => setImmediate(resolve));
assert(reconnecting.log.some(value => value?.[0] === 'loadMessages'));
const closedChild = fixture(); closedChild.first.viewType = 'kilo-code.new.SubAgentViewerPanel';
let finishMetadata;
closedChild.provider.getSessionInfo = () => new Promise(resolve => finishMetadata = resolve);
for (let i = 0; i < 13; i++) closedChild.tick(); await new Promise(resolve => setImmediate(resolve));
closedChild.provider.webview = null; finishMetadata({ id: 'original-session' }); await new Promise(resolve => setImmediate(resolve));
assert(!closedChild.log.some(value => value?.[0] === 'registerSession'), 'Closing a recovered child must cancel late metadata delivery');
console.log('Child lifecycle checks passed: backend initialization precedes data load, late metadata is ignored after close.');
for (const stage of ['waitForReady', 'initializeConnection', 'loadMessages']) {
  const race = fixture(); race.first.viewType = 'kilo-code.new.SubAgentViewerPanel'; let resume;
  race.provider[stage] = () => new Promise(resolve => resume = resolve);
  for (let i = 0; i < 13; i++) race.tick(); await new Promise(resolve => setImmediate(resolve));
  race.provider.webview = null; resume(); await new Promise(resolve => setImmediate(resolve));
  assert(!race.log.some(value => value?.[0] === 'registerSession'), `Closing during ${stage} must prevent registration`);
  if (stage !== 'loadMessages') assert(!race.log.some(value => value?.[0] === 'loadMessages'), `Closing during ${stage} must prevent load`);
}
console.log('Close-during-await races passed for readiness, connection, and message load.');
