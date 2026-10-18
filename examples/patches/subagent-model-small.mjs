#!/usr/bin/env node
// Background-agent strip: collapsed chips show only the title on one line (the agent · model · provider
// line is hidden; the button title/aria-label tooltip already carries agent, model and provider), and the
// expanded list shows that line at 9px under a 12px title. Each label is one span "title\nagent · model · provider"
// (agent-identity CSS), so CSS sizes the span and restores ::first-line; font-size:0 also drops the hidden
// line's glyph widths. ponytail: Chromium sizes the chip from every line at ::first-line size, so a short-title
// chip still reserves up to max-width; rendering only the title (legacy-agent-header.mjs chip label) is the upgrade path.
// Fails closed without that layout.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const start = '/* kilo-subagent-model-small:v2 */';
const end = '/* end kilo-subagent-model-small */';
const strip = '[data-component=task-header-agents] ', title = 'font-size:var(--kilo-font-size-12,12px)';
const anchors = [strip + '[data-slot=task-header-agents-item]>span{white-space:pre;', strip + '[data-slot=task-header-agent-label]{white-space:pre-line;'];
const chip = strip + '[data-slot=task-header-agents-item]>span[dir=auto]', row = strip + '[data-slot=task-header-agent-main]>[data-slot=task-header-agent-label]';
// Selectors outrank the agent-identity rules by specificity, so block order in the bundle does not matter.
const content = strip + '[data-slot=task-header-agents-toolbar]>[data-slot=task-header-agents-content]', item = strip + '[data-slot=task-header-agents-preview]>[data-slot=task-header-agents-item]';
export const css = `${start}
${content},${item}{height:24px}
${chip}{font-size:0;line-height:0;max-width:180px;overflow:hidden;text-overflow:ellipsis}
${chip}::first-line{${title};line-height:16px}
${row}{white-space:pre;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:9px}
${row}::first-line{${title}}
${end}`;
// v1 shrank the chip's second line instead of hiding it; upgrade it in place.
const v1 = `/* kilo-subagent-model-small:v1 */
${chip}{font-size:9px}
${chip}::first-line{${title}}
${end}`;
const count = (s, text) => s.split(text).length - 1;

export function patch(source, restore = false) {
  if (anchors.some(a => count(source, a) !== 1)) throw Error('Unsupported agent strip CSS (two-line card label not found); no changes made.');
  if (count(source, v1) === 1 && !source.includes(start)) source = source.replace('\n' + v1 + '\n', restore ? '' : '\n' + css + '\n');
  if (source.includes(start) || source.includes(end)) {
    if (count(source, css) !== 1 || count(source, start) !== 1 || count(source, end) !== 1) throw Error('Ambiguous or modified subagent model CSS; no changes made.');
    return restore ? source.replace('\n' + css + '\n', '') : source;
  }
  return restore ? source : source + '\n' + css + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), mode = args.at(-1)?.startsWith('--') ? args.pop() : '--apply';
  if (!args.length || !['--apply', '--check', '--restore'].includes(mode) || args.some(t => !t.endsWith('.css'))) throw Error('Usage: subagent-model-small.mjs <webview.css|agent-manager.css>... [--apply|--check|--restore]');
  // Validate every target before writing any, so a missing anchor changes nothing.
  const jobs = args.map(target => { const source = fs.readFileSync(target, 'utf8'); return [target, source, patch(source, mode === '--restore')]; });
  for (const [target, source, next] of jobs) {
    if (mode === '--check') {
      if (source !== next) throw Error('Subagent model small patch is missing.');
      console.log('Subagent model small verified: ' + path.basename(target));
    } else if (source !== next) {
      const temp = target + `.subagent-model-small-${process.pid}.css`;
      try {
        fs.writeFileSync(temp, next, { flag: 'wx', mode: fs.statSync(target).mode & 0o777 });
        if (fs.readFileSync(target, 'utf8') !== source) throw Error('Bundle changed while patching.');
        const backup = target + '.pre-subagent-model-small';
        if (mode === '--apply' && !fs.existsSync(backup)) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
        fs.renameSync(temp, target);
      } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
      console.log(`Subagent model small ${mode === '--restore' ? 'restored' : 'applied'}: ` + path.basename(target));
    } else console.log('No changes needed: ' + path.basename(target));
  }
}
