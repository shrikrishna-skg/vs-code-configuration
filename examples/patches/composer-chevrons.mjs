#!/usr/bin/env node
// Chat box "Variant A": Continue and Prompts sit 6px apart, and every composer dropdown
// (Continue, agent, model, reasoning, permissions) shows one chevron centred on its label.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const start = '/* kilo-composer-chevrons:v1 */';
const end = '/* end kilo-composer-chevrons */';
const svg = '.prompt-input-hint-selectors svg[width="10"][height="10"]'; // the stock 10px triangle
const drawn = '.quick-action-trigger::after,.kilo-permission-trigger::after'; // controls with no svg of their own
const open = ':is([data-expanded],[aria-expanded=true])';
const mask = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23000' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E") center/contain no-repeat`;
export const css = `${start}
.prompt-input-container{anchor-scope:--kilo-prompts}
.prompt-suggestion-trigger{anchor-name:--kilo-prompts}
.quick-action-launcher{right:calc(anchor(--kilo-prompts left,90px) + 6px)}
.quick-action-trigger,.prompt-suggestion-trigger,.kilo-permission-trigger{display:inline-flex;align-items:center;gap:4px}
.kilo-permission-trigger>span[aria-hidden=true]{display:none}
${drawn}{content:"";flex:none;width:12px;height:12px;background:currentColor;-webkit-mask:${mask};mask:${mask}}
${svg}{width:12px;height:12px;margin-left:-2px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
${svg} path{d:path("M4 6l4 4 4-4")}
${drawn},${svg}{opacity:.7;transition:transform .15s ease,opacity .15s ease}
:is(.quick-action-trigger,.kilo-permission-trigger):is(:hover,[aria-expanded=true])::after,.prompt-input-hint-selectors :is(button:hover,${open.slice(4, -1)}) svg[width="10"][height="10"]{opacity:1}
:is(.quick-action-trigger,.kilo-permission-trigger)[aria-expanded=true]::after,.prompt-input-hint-selectors ${open} svg[width="10"][height="10"]{transform:rotate(180deg)}
@media (prefers-reduced-motion:reduce){${drawn},${svg}{transition:none}}
@media (forced-colors:active){${drawn}{background:ButtonText}}
${end}`;
// The Continue button carried its arrow as a text character; the CSS above draws it instead.
const glyph = "aria-label='Quick actions'>Continue ▾</button>";
const plain = "aria-label='Quick actions'>Continue</button>";
const count = (s, text) => s.split(text).length - 1;

export function patch(source, kind = 'js', restore = false) {
  if (kind === 'css') {
    if (!source.includes('.prompt-input-hint-selectors') || !source.includes('.kilo-permission-trigger{')) throw Error('Unsupported composer CSS; no changes made.');
    if (source.includes(start) || source.includes(end)) {
      if (count(source, css) !== 1 || count(source, start) !== 1 || count(source, end) !== 1) throw Error('Ambiguous or modified composer chevron CSS; no changes made.');
      return restore ? source.replace('\n' + css + '\n', '') : source;
    }
    return restore ? source : source + '\n' + css + '\n';
  }
  if (count(source, glyph) + count(source, plain) !== 1) throw Error('Unsupported or ambiguous Continue button; no changes made.');
  return source.replace(restore ? plain : glyph, restore ? glyph : plain);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, mode = '--apply', ...extra] = process.argv.slice(2);
  if (!target || extra.length || !['--apply', '--check', '--restore'].includes(mode) || !/\.(js|css)$/.test(target)) throw Error('Usage: composer-chevrons.mjs <webview.js|webview.css|agent-manager.css> [--apply|--check|--restore]');
  const kind = path.extname(target).slice(1), source = fs.readFileSync(target, 'utf8'), next = patch(source, kind, mode === '--restore');
  if (mode === '--check') {
    if (source !== next) throw Error('Composer chevrons patch is missing.');
    console.log('Composer chevrons verified: ' + path.basename(target));
  } else if (source !== next) {
    const temp = target + `.composer-chevrons-${process.pid}.${kind}`;
    try {
      fs.writeFileSync(temp, next, { flag: 'wx', mode: fs.statSync(target).mode & 0o777 });
      if (kind === 'js') {
        const check = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
        if (check.status !== 0) throw Error(check.stderr || 'Syntax check failed.');
      }
      if (fs.readFileSync(target, 'utf8') !== source) throw Error('Bundle changed while patching.');
      const backup = target + '.pre-composer-chevrons';
      if (mode === '--apply' && !fs.existsSync(backup)) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
      fs.renameSync(temp, target);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    console.log(`Composer chevrons ${mode === '--restore' ? 'restored' : 'applied'}: ` + path.basename(target));
  } else console.log('No changes needed: ' + path.basename(target));
}
