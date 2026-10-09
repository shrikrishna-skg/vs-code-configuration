#!/usr/bin/env node
// Local Kilo 7.8.1: keep browser activity and restart restoration from opening
// Agent Manager. Explicit commands and worktree actions remain available.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const changes = [
  {
    before: 'let post=state=>{let active2=input.contexts().active();(state.status==="starting"||state.status==="loading")&&state.projectId===active2?.id&&input.openPanel(),input.post(browserMessage(state))}',
    after: 'let post=state=>{/* kilo-manual-open: browser events never reveal the panel */input.post(browserMessage(state))}',
  },
  {
    before: 'registerWebviewPanelSerializer(AgentManagerProvider.viewType,{deserializeWebviewPanel(panel){if(restore.agentManager===!1)return panel.dispose(),Promise.resolve();',
    after: 'registerWebviewPanelSerializer(AgentManagerProvider.viewType,{deserializeWebviewPanel(panel){/* kilo-manual-open: discard restored manager tabs */return panel.dispose(),Promise.resolve();',
  },
];

export function patch(source, restore = false) {
  // Validate every anchor before applying anything, including on newer builds.
  for (const { before, after } of changes) {
    if (source.split(before).length + source.split(after).length !== 3) {
      throw new Error('Unsupported or ambiguous Kilo bundle; no changes made.');
    }
  }
  return changes.reduce((result, { before, after }) =>
    result.replace(restore ? after : before, restore ? before : after), source);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [targetArg, mode = '--apply', ...extra] = process.argv.slice(2);
  if (!targetArg || extra.length || !['--apply', '--check', '--restore'].includes(mode)) {
    throw new Error('Usage: agent-manager-manual-open.mjs <extension.js> [--apply|--check|--restore]');
  }
  const target = fs.realpathSync(targetArg);
  const source = fs.readFileSync(target, 'utf8');
  const updated = patch(source, mode === '--restore');
  if (mode === '--check') {
    if (source !== updated) throw new Error('Agent Manager manual-open patch is missing.');
    console.log('Agent Manager automatic browser opening and restart restoration are disabled.');
  } else if (source !== updated) {
    const backup = target + '.pre-agent-manager-manual-open';
    const temp = target + '.manual-open-' + process.pid + '.js';
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
    console.log(mode === '--restore' ? 'Removed the manual-open patch.' : 'Installed the Agent Manager manual-open patch. Reload VS Code to activate it.');
  } else console.log('No changes needed.');
}
