#!/usr/bin/env node
// Cap the model label, preserve its full tooltip, and keep custom actions unclipped.
// Narrow composers wrap the action group together instead of overlapping controls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const legacyStart = '/* kilo-composer-one-line:v1 */';
const previousStart = '/* kilo-composer-one-line:v2 */';
const start = '/* kilo-composer-one-line:v3 */';
const end = '/* end kilo-composer-one-line */';
const row = '.prompt-input-hint-selectors';
const legacyCss = `${legacyStart}
${row}{flex-wrap:nowrap!important;min-width:0}
${row}>*{flex-shrink:0}
${row}>:has(.model-selector-trigger-label),${row} :has(.model-selector-trigger-label){flex-shrink:1;min-width:0;max-width:100%}
${row} .model-selector-trigger-label{flex:0 1 auto;min-width:0;max-width:180px}
${end}`;
const previousCss = `${previousStart}
.prompt-input-hint{align-items:center;flex-wrap:wrap;row-gap:6px}
.prompt-input-hint-actions,.prompt-input-hint-pinned{align-items:center}
.prompt-input-hint-actions{max-width:100%}
.prompt-selectors{flex:0 0 auto;max-width:100%}
.prompt-selectors .prompt-selector[data-part="model"]{min-width:0;max-width:calc(24ch + 14px)}
.prompt-selectors .model-selector-trigger-label{max-width:24ch}
.prompt-action:not([data-folded]){max-width:none;overflow:visible;align-items:center;gap:4px}
${row}{flex-wrap:nowrap!important;min-width:0}
${row}>*{flex-shrink:0}
${row}>:has(.model-selector-trigger-label),${row} :has(.model-selector-trigger-label){flex-shrink:1;min-width:0;max-width:100%}
${row} .model-selector-trigger-label{flex:0 1 auto;min-width:0;max-width:24ch}
${end}`;
export const css = previousCss.replace(previousStart, start).replace(end,
  '@media (forced-colors:none){[data-component="prompt-input-form"]:focus-within,.prompt-input-container:focus-within{border-color:var(--border-weak-base,var(--vscode-input-border,#3c3c3c));box-shadow:none}}\n' + end);
export function shortLabel(value) {
  const chars = Array.from(value);
  return chars.length > 28 ? chars.slice(0, 27).join('') + '…' : value;
}
const cap = value => '/* kilo-model-label:28 */(' + shortLabel.toString() + ')(' + value + ')';
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The trigger tooltip: swap the model id for the same label function the button displays.
const tip = (name, model = 'm') => `get value(){return ${name}},placement:"top",openDelay:0,get inactive(){return!${model}()}`;

const count = (s, text) => s.split(text).length - 1;

export function patch(source, kind = 'js', restore = false) {
  if (kind === 'css') {
    if (!source.includes(row + '{') || !source.includes('.model-selector-trigger-label{')) throw Error('Unsupported composer CSS; no changes made.');
    for (const block of [legacyCss, previousCss, css]) {
      const marker = block.split("\n", 1)[0];
      if (!source.includes(marker)) continue;
      if (count(source, block) !== 1 || count(source, end) !== 1) throw Error('Ambiguous or modified composer one-line CSS; no changes made.');
      if (block === css && !restore) return source;
      source = source.replace('\n' + block + '\n', '');
    }
    if (source.includes('/* kilo-composer-one-line:') || source.includes(end)) throw Error('Unknown composer CSS version; no changes made.');
    return restore ? source : source + '\n' + css + '\n';
  }

  const labels = [...source.matchAll(/([\w$]+)=\(\)=>[\w$]+\(([\w$]+)\(\)\?\.name,\2\(\)\?\.providerID,/g)];
  if (labels.length !== 1) throw Error('Unsupported or ambiguous model label; no changes made.');
  const model = labels[0][2], stock = tip(model + '()?.id??""', model), full = tip(labels[0][1] + '()', model);
  if (count(source, stock) + count(source, full) !== 1) throw Error('Unsupported or ambiguous model tooltip; no changes made.');
  source = source.replace(restore ? full : stock, restore ? stock : full);
  const caps = new RegExp(escape(cap('VALUE')).replace('VALUE', '([\\w$]+)'), 'g');
  const marked = [...source.matchAll(caps)];
  if (source.includes('/* kilo-model-label:28 */') && marked.length !== 1) throw Error('Modified model label cap; no changes made.');
  source = source.replace(caps, '$1');
  const templates = [...source.matchAll(/([\w$]+)=[\w$]+\("<span class=model-selector-trigger-label>"\)/g)];
  if (templates.length !== 1) throw Error('Unsupported model label template; no changes made.');
  const insertion = new RegExp('(var ([\\w$]+)=' + escape(templates[0][1]) + '\\(\\);return [\\w$]+\\(\\2,)([\\w$]+)(\\),\\2\\})', 'g');
  if ([...source.matchAll(insertion)].length !== 1) throw Error('Unsupported model label insertion; no changes made.');
  return restore ? source : source.replace(insertion, (_, before, node, label, after) => before + cap(label) + after);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, mode = '--apply', ...extra] = process.argv.slice(2);
  if (!target || extra.length || !['--apply', '--check', '--restore'].includes(mode) || !/\.(js|css)$/.test(target)) throw Error('Usage: composer-one-line.mjs <webview|agent-manager>.<js|css> [--apply|--check|--restore]');
  const kind = path.extname(target).slice(1), source = fs.readFileSync(target, 'utf8'), next = patch(source, kind, mode === '--restore');
  if (mode === '--check') {
    if (source !== next) throw Error('Composer one-line patch is missing.');
    console.log('Composer one-line verified: ' + path.basename(target));
  } else if (source !== next) {
    const temp = target + `.composer-one-line-${process.pid}.${kind}`;
    try {
      fs.writeFileSync(temp, next, { flag: 'wx', mode: fs.statSync(target).mode & 0o777 });
      if (kind === 'js') {
        const check = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
        if (check.status !== 0) throw Error(check.stderr || 'Syntax check failed.');
      }
      if (fs.readFileSync(target, 'utf8') !== source) throw Error('Bundle changed while patching.');
      const backup = target + '.pre-composer-one-line';
      if (mode === '--apply' && !fs.existsSync(backup)) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
      fs.renameSync(temp, target);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    console.log(`Composer one-line ${mode === '--restore' ? 'restored' : 'applied'}: ` + path.basename(target));
  } else console.log('No changes needed: ' + path.basename(target));
}
