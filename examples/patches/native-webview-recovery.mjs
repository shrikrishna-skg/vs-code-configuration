#!/usr/bin/env node
// Kilo local 7.8.2: recover a dead UI renderer without restarting its model/backend.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { patchDraftClient } from './native-webview-draft-recovery.mjs';

export function installNativeWebviewRecovery(provider, panel, vscode, clock = globalThis) {
  provider.nativeWebviewRecovery?.dispose();
  if (!['kilo-code.new.TabPanel', 'kilo-code.new.SubAgentViewerPanel'].includes(panel.viewType)) return;
  let closed = false, sequence = 0, acknowledged = 0, pendingSince = 0, previousTick = Date.now();
  const started = previousTick;
  const state = provider.nativeWebviewRecoveryState ??= { attempts: [], snapshot: null };
  // Persist failure timing, never prompts, attachment data, paths, or session IDs.
  const log = (event, details = {}) => {
    try {
      const output = installNativeWebviewRecovery.output ??= vscode.window.createOutputChannel('Kilo Renderer Health', { log: true });
      output.info(JSON.stringify({ event, view: panel.viewType, ...details }));
    } catch { /* Diagnostics must not prevent recovery. */ }
  };
  const listener = panel.webview.onDidReceiveMessage(message => {
    if (message.type === '__nativeWebviewPong' && Number.isInteger(message.sequence) && message.sequence > acknowledged && message.sequence <= sequence) { acknowledged = message.sequence; pendingSince = 0; }
    if (message.type === '__nativeWebviewSnapshot' && message.snapshot?.drafts?.version === 1) {
      const snapshot = message.snapshot;
      state.snapshot = { ...snapshot, drafts: { ...snapshot.drafts, maps: { ...snapshot.drafts.maps, images: snapshot.drafts.maps.images ?? state.snapshot?.drafts?.maps?.images ?? [] } } };
    }
  });
  async function recover() {
    const now = Date.now();
    state.attempts = state.attempts.filter(time => now - time < 300000);
    if (state.attempts.length >= 2) {
      pendingSince = now;
      if (!state.warned) { state.warned = true; log('recovery-limit', { attempts: state.attempts.length }); vscode.window.showWarningMessage('Kilo’s chat renderer is not responding after two recovery attempts. Model tasks remain running; reopen this chat to recover its view.'); }
      return;
    }
    log('unresponsive', { pendingMs: now - pendingSince, ready: Boolean(provider.isWebviewReady), visible: panel.visible, acknowledged, sequence });
    state.attempts.push(now);
    const sessionID = provider.getCurrentSessionId() ?? provider.opts.nativeRecoverySessionID;
    const next = vscode.window.createWebviewPanel(panel.viewType, panel.title, { viewColumn: panel.viewColumn, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [provider.extensionUri] });
    closed = true;
    clock.clearInterval(timer); listener.dispose(); disposal.dispose();
    next.iconPath = panel.iconPath;
    provider.opts.onRecoveredPanel?.(panel, next);
    provider.opts.tabTitle = title => { next.title = title; };
    provider.resolveWebviewPanel(next);
    next.onDidDispose(() => { if (provider.panel === next) { provider.opts.onRecoveredPanel?.(next, null); provider.dispose(); } });
    panel.dispose();
    console.warn('[Kilo Webview Recovery] Recreated an unresponsive chat view; backend preserved.');
    await provider.waitForReady();
    if (provider.panel !== next || provider.webview !== next.webview) return;
    log('replacement-ready', { elapsedMs: Date.now() - now });
    const pendingDraft = next.viewType === 'kilo-code.new.TabPanel' && state.snapshot?.drafts?.tabs?.active?.startsWith('sidebar-pending:');
    if (sessionID && !pendingDraft) {
      const child = next.viewType === 'kilo-code.new.SubAgentViewerPanel';
      if (child) { await provider.initializeConnection(); if (provider.panel !== next || provider.webview !== next.webview) return; }
      provider.postMessage({ type: child ? 'viewSubAgentSession' : 'openSession', sessionID });
      if (child) {
        await provider.loadMessages(sessionID);
        if (provider.panel !== next || provider.webview !== next.webview) return;
        const session = await provider.getSessionInfo(sessionID);
        if (session && provider.panel === next && provider.webview === next.webview) provider.registerSession(session);
      }
    }
    log('recovery-dispatched', { elapsedMs: Date.now() - now });
  }
  const timer = clock.setInterval(() => {
    if (closed || provider.panel !== panel) return;
    const now = Date.now(), slept = now - previousTick > 20000;
    previousTick = now;
    if (!panel.visible || slept) { pendingSince = 0; return; }
    if (pendingSince && now - pendingSince >= (provider.isWebviewReady ? 30000 : 60000) && now - started >= 60000) { recover().catch(error => { pendingSince = Date.now(); log('recovery-failed'); console.error('[Kilo Webview Recovery]', error); vscode.window.showWarningMessage('Kilo could not recover its chat view. Model tasks have not been restarted. Reopen the chat.'); }); return; }
    if (!pendingSince) pendingSince = now;
    panel.webview.postMessage({ type: '__nativeWebviewPing', sequence: ++sequence }).then(undefined, () => {});
  }, 5000);
  timer.unref?.();
  const disposal = panel.onDidDispose(() => { closed = true; clock.clearInterval(timer); listener.dispose(); });
  provider.nativeWebviewRecovery = { dispose() { closed = true; clock.clearInterval(timer); listener.dispose(); disposal.dispose(); } };
}

// ponytail: coalescing leaves a normal 250 ms uncaptured-edit window; tighter
// durability needs immediate incremental draft messages instead of full snapshots.
export function nativeWebviewRecoveryClient() {
  const acquire = window.acquireVsCodeApi;
  let api, queued = false, dirty = true;
  function schedule() {
    dirty = true;
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; snapshot(); }, 250);
  }
  window.acquireVsCodeApi = () => {
    if (!api) {
      const native = acquire();
      api = { getState: () => native.getState(), postMessage: message => native.postMessage(message), setState(state) { const result = native.setState(state); schedule(); return result; } };
      if (window.__nativeWebviewInitial?.state) api.setState(window.__nativeWebviewInitial.state);
    }
    return api;
  };
  function snapshot() {
    if (!api || !dirty) return;
    dirty = false;
    api.postMessage({ type: '__nativeWebviewSnapshot', snapshot: { state: api.getState(), drafts: window.__nativeGetDraftSnapshot?.() } });
  }
  window.addEventListener('__nativeDraftChanged', schedule);
  window.addEventListener('message', event => {
    const message = event.data;
    if (message?.type === '__nativeWebviewPing') {
      if (document.getElementById('root')?.childElementCount) api?.postMessage({ type: '__nativeWebviewPong', sequence: message.sequence });
      snapshot();
    }
  });
}

const hostMarker = '/* native-webview-recovery:v3 */';
const clientMarker = '/* native-webview-recovery-client:v2 */';
const edits = [
  ['return buildWebviewHtml(webview,{sidebar:sidebar?', 'return buildWebviewHtml(webview,{nativeRecovery:this.nativeWebviewRecoveryState?.snapshot,sidebar:sidebar?'],
  ['<script nonce="${nonce}">window.ICONS_BASE_URI = ', '<script nonce="${nonce}">window.__nativeWebviewInitial = ${JSON.stringify(opts.nativeRecovery??null).replace(/</g,"\\\\u003c")}; window.ICONS_BASE_URI = '],
  ['this.initializeConnection()}registerSession(session,activate2=!1)', 'this.initializeConnection(),installNativeWebviewRecovery(this,panel,vscode41)}registerSession(session,activate2=!1)'],
  ['dispose(){this.opts.onHidden?.()', 'dispose(){this.nativeWebviewRecovery?.dispose(),this.opts.onHidden?.()'],
  ['tabTitle:panelTitleHandler(panel),topBarSurface:"tab"', 'tabTitle:panelTitleHandler(panel),onRecoveredPanel:(old,next)=>{tabPanels.delete(old);next&&tabPanels.set(next,tabProvider)},topBarSurface:"tab"'],
  ['tabPanels.delete(panel),tabProvider.dispose()', 'tabPanels.delete(panel),tabProvider.panel===panel&&tabProvider.dispose()'],
  ['tabLabel:label3});directory5&&provider', 'tabLabel:label3,nativeRecoverySessionID:sessionID,onRecoveredPanel:(old,next)=>{next?this.panels.set(sessionID,next):(this.panels.delete(sessionID),this.providers.delete(sessionID))}});directory5&&provider'],
  ['closeDisposable.dispose(),provider.dispose(),this.panels.delete(sessionID),this.providers.delete(sessionID)', 'closeDisposable.dispose(),provider.panel===panel&&(provider.dispose(),this.panels.delete(sessionID),this.providers.delete(sessionID))'],
];
export function patchHost(source) {
  if (source.includes(hostMarker)) return source;
  const previous = '/* native-webview-recovery:v2 */\nfunction installNativeWebviewRecovery(';
  if (source.startsWith(previous)) {
    const end = source.indexOf('\n}\n', previous.length);
    if (end < 0) throw new Error('Unsupported existing recovery helper.');
    return `${hostMarker}\n${installNativeWebviewRecovery.toString()}\n${source.slice(end + 3)}`;
  }
  for (const [before, after] of edits) {
    const count = source.split(before).length - 1;
    if (count !== (before === 'tabPanels.delete(panel),tabProvider.dispose()' ? 2 : 1)) throw new Error(`Unsupported Kilo bundle: recovery anchor count ${count}.`);
    source = source.split(before).join(after);
  }
  return `${hostMarker}\n${installNativeWebviewRecovery.toString()}\n${source}`;
}
export function patchClient(source) {
  if (source.includes(clientMarker)) return source;
  return `${clientMarker}\n;(${nativeWebviewRecoveryClient.toString()})();\n${patchDraftClient(source)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [directory, mode = '--apply'] = process.argv.slice(2);
  if (!directory || !['--apply', '--check'].includes(mode)) throw new Error('Usage: native-webview-recovery.mjs <extension dist directory> [--apply|--check]');
  const files = [['extension.js', patchHost], ['webview.js', patchClient]].map(([name, patch]) => {
    const target = path.join(directory, name), source = fs.readFileSync(target, 'utf8');
    return { target, source, updated: patch(source) };
  });
  if (mode === '--apply') for (const { source, updated } of files) {
    if (source !== updated) {
      const check = spawnSync(process.execPath, ['--check'], { input: updated, encoding: 'utf8' });
      if (check.status) throw new Error(check.stderr || 'JavaScript syntax check failed.');
    }
  }
  for (const { target, source, updated } of files) {
    if (mode === '--check') { if (source !== updated) throw new Error(`Recovery patch missing: ${target}`); continue; }
    if (source === updated) continue;
    const temporary = target + '.native-recovery-' + process.pid + '.js';
    try {
      fs.writeFileSync(temporary, updated);
      const check = spawnSync(process.execPath, ['--check', temporary], { encoding: 'utf8' });
      if (check.status) throw new Error(check.stderr);
      if (fs.readFileSync(target, 'utf8') !== source) throw new Error('Bundle changed during patch.');
      if (!fs.existsSync(target + '.pre-native-recovery')) fs.copyFileSync(target, target + '.pre-native-recovery');
      fs.renameSync(temporary, target);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  console.log(mode === '--check' ? 'Native webview recovery is installed.' : 'Native webview recovery installed; reload required to activate.');
}
