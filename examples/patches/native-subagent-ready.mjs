#!/usr/bin/env node
// Local Kilo 7.8.1 (extension 7.8.2): wait for the child viewer's client before loading it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const before = 'readyDisposable=panel.webview.onDidReceiveMessage(msg=>{if(msg.type==="webviewReady"){readyDisposable.dispose(),provider.postMessage({type:"viewSubAgentSession",sessionID}),provider.loadMessages(sessionID);try{this.connectionService.getClient().session.get({sessionID,directory:directory5},{throwOnError:!0}).then(({data:session})=>provider.registerSession(session)).catch(err2=>{console.error("[Kilo New] SubAgentViewerProvider: Failed to load session metadata:",err2)})}catch(err2){console.error("[Kilo New] SubAgentViewerProvider: Failed to load session metadata:",err2)}}}),closeDisposable=';
const after = 'readyDisposable=panel.webview.onDidReceiveMessage(async msg=>{if(msg.type==="webviewReady"){readyDisposable.dispose();try{/* kilo-native-subagent-ready: initialize before loading a child viewer */await provider.initializeConnection();if(this.panels.get(sessionID)!==panel)return;provider.postMessage({type:"viewSubAgentSession",sessionID}),provider.loadMessages(sessionID);this.connectionService.getClient().session.get({sessionID,directory:directory5},{throwOnError:!0}).then(({data:session})=>provider.registerSession(session)).catch(err2=>{console.error("[Kilo New] SubAgentViewerProvider: Failed to load session metadata:",err2)})}catch(err2){console.error("[Kilo New] SubAgentViewerProvider: Failed to load session metadata:",err2)}}}),closeDisposable=';

export function patch(source, restore = false) {
  // Exact version anchors also reject partial patches and duplicate viewer implementations.
  if (source.split(before).length + source.split(after).length !== 3) {
    throw new Error('Unsupported or ambiguous Kilo bundle; no changes made.');
  }
  return source.replace(restore ? after : before, restore ? before : after);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [targetArg, mode = '--apply', ...extra] = process.argv.slice(2);
  if (!targetArg || extra.length || !['--apply', '--check', '--restore'].includes(mode)) {
    throw new Error('Usage: native-subagent-ready.mjs <extension.js> [--apply|--check|--restore]');
  }
  const target = fs.realpathSync(targetArg);
  const source = fs.readFileSync(target, 'utf8');
  const updated = patch(source, mode === '--restore');
  if (mode === '--check') {
    if (source !== updated) throw new Error('Native sub-agent readiness patch is missing.');
    console.log('Native sub-agent viewers wait for their connection before loading.');
  } else if (source !== updated) {
    const backup = target + '.pre-native-subagent-ready';
    const temp = target + '.native-subagent-ready-' + process.pid + '.js';
    try {
      fs.writeFileSync(temp, updated, { flag: 'wx', mode: fs.statSync(target).mode & 0o777 });
      const check = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
      if (check.status !== 0) throw new Error(check.stderr || 'JavaScript syntax check failed.');
      if (fs.readFileSync(target, 'utf8') !== source) throw new Error('Bundle changed; refusing to overwrite it.');
      if (mode === '--apply' && !fs.existsSync(backup)) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
      fs.renameSync(temp, target);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    console.log(mode === '--restore' ? 'Removed the native sub-agent readiness patch.' : 'Installed the native sub-agent readiness patch. Reload VS Code to activate it.');
  } else console.log('No changes needed.');
}
