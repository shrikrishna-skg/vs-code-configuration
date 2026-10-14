#!/usr/bin/env node
// Hanken Grotesk for the Kilo chat and Agent Manager webviews; code and terminal text stay monospace.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const font = 'hanken-grotesk-variable.woff2';
const start = '/* kilo-chat-font:v3 */';
const end = '/* end kilo-chat-font */';
export const css = `${start}
@font-face{font-family:"Hanken Grotesk";src:url("./${font}") format("woff2");font-weight:100 900;font-style:normal;font-display:swap}
:root{--font-family-sans:"Hanken Grotesk",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--vscode-font-family:"Hanken Grotesk",-apple-system,BlinkMacSystemFont,sans-serif!important}
${end}`;
const count = (s, text) => s.split(text).length - 1;

export function patch(source, restore = false) {
  if (!source.includes('--font-family-sans:')) throw Error('Unsupported chat CSS; no changes made.');
  if (source.includes(start) || source.includes(end)) {
    if (count(source, css) !== 1 || count(source, start) !== 1 || count(source, end) !== 1) throw Error('Ambiguous or modified chat font CSS; no changes made.');
    return restore ? source.replace('\n' + css + '\n', '') : source;
  }
  return restore ? source : source + '\n' + css + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, mode = '--apply', ...extra] = process.argv.slice(2);
  if (!target || extra.length || !['--apply', '--check', '--restore'].includes(mode) || !target.endsWith('.css')) throw Error('Usage: chat-font.mjs <webview.css|agent-manager.css> [--apply|--check|--restore]');
  const source = fs.readFileSync(target, 'utf8'), next = patch(source, mode === '--restore');
  const from = path.join(root, font), to = path.join(path.dirname(target), font);
  if (mode === '--check') {
    if (source !== next) throw Error('Chat font patch is missing.');
    if (!fs.existsSync(to) || !fs.readFileSync(from).equals(fs.readFileSync(to))) throw Error('Chat font file missing or outdated.');
    console.log('Chat font verified: ' + path.basename(target));
  } else {
    if (mode === '--apply') fs.copyFileSync(from, to);
    if (source !== next) {
      const temp = target + `.chat-font-${process.pid}.css`;
      try {
        fs.writeFileSync(temp, next, { flag: 'wx', mode: fs.statSync(target).mode & 0o777 });
        if (fs.readFileSync(target, 'utf8') !== source) throw Error('Bundle changed while patching.');
        const backup = target + '.pre-chat-font';
        if (mode === '--apply' && !fs.existsSync(backup)) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
        fs.renameSync(temp, target);
      } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
      console.log(`Chat font ${mode === '--restore' ? 'restored' : 'applied'}: ` + path.basename(target));
    } else console.log('No changes needed: ' + path.basename(target));
  }
}
