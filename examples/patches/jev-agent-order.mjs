#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function orderAgents(agents) {
  const fable = agents.find(a => a.name === 'Fable Engineering Lead');
  const moved = ['Fable + Jev Engineering Lead', 'Opus + Jev Engineering Lead', 'Astra + Jev Engineering Lead'].map(n => agents.find(a => a.name === n)).filter(Boolean);
  if (!fable || !moved.length) return agents;
  const result = agents.filter(a => !moved.includes(a));
  result.splice(result.indexOf(fable) + 1, 0, ...moved);
  return result;
}

// Exact earlier (Astra + Jev only) ordering function; --apply migrates it, --restore removes it.
export const legacyOrder = `function orderAgents(agents) {
  const target = agents.find(a => a.name === 'Astra + Jev Engineering Lead');
  if (!target || !agents.some(a => a.name === 'Fable Engineering Lead')) return agents;
  const result = agents.filter(a => a !== target);
  result.splice(result.findIndex(a => a.name === 'Fable Engineering Lead') + 1, 0, target);
  return result;
}`;

// Exact previous (Fable + Jev, Astra + Jev) ordering function; --apply migrates it, --restore removes it.
export const previousOrder = `function orderAgents(agents) {
  const fable = agents.find(a => a.name === 'Fable Engineering Lead');
  const moved = ['Fable + Jev Engineering Lead', 'Astra + Jev Engineering Lead'].map(n => agents.find(a => a.name === n)).filter(Boolean);
  if (!fable || !moved.length) return agents;
  const result = agents.filter(a => !moved.includes(a));
  result.splice(result.indexOf(fable) + 1, 0, ...moved);
  return result;
}`;

// Verified installed 7.7.2/7.7.5/7.7.6/7.7.7/7.7.9/7.8.1 anchors: display only, not default selection.
const anchors = [
  ['re','de','we'], ['ne','ae','Ne'], ['ne','et','He'], ['ne','et','qe'],
].map(([m,set,all])=>{
  const wrap=fn=>`if(${m}.type!=="agentsLoaded")return;${set}((${fn})(${m}.agents)),${all}(${m}.allAgents??${m}.agents)`;
  return { before:`if(${m}.type!=="agentsLoaded")return;${set}(${m}.agents),${all}(${m}.allAgents??${m}.agents)`, after:wrap(orderAgents.toString()), legacy:wrap(legacyOrder), previous:wrap(previousOrder) };
});
export function patch(source, restore = false) {
  const matches = anchors.flatMap(a => ['before', 'after', 'legacy', 'previous'].flatMap(state =>
    Array.from({ length: source.split(a[state]).length - 1 }, () => ({ a, state }))));
  if (matches.length !== 1) throw new Error('Unsupported or ambiguous Kilo bundle: expected exactly one known agent-list anchor; no changes made.');
  const { a, state } = matches[0];
  const desired = restore ? 'before' : 'after';
  return state === desired ? source : source.replace(a[state], a[desired]);
}

export function installedTarget(root = path.join(os.homedir(), '.vscode', 'extensions')) {
  root = fs.realpathSync(root);
  const entries = JSON.parse(fs.readFileSync(path.join(root, 'extensions.json'), 'utf8'))
    .filter(e => e.identifier?.id === 'kilocode.kilo-code');
  if (entries.length !== 1) throw new Error('Expected one registered Kilo extension. Supply its exact webview.js path instead.');
  const entry = entries[0];
  if (entry.location?.scheme !== 'file' || typeof entry.location?.path !== 'string') throw new Error('Unsupported extension location.');
  const directory = fs.realpathSync(entry.location.path);
  const target = fs.realpathSync(path.join(directory, 'dist', 'webview.js'));
  for (const candidate of [directory, target]) {
    const relative = path.relative(root, candidate);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Extension target is outside the registered extensions directory.');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  if (manifest.publisher !== 'kilocode' || manifest.name !== 'kilo-code' || manifest.version !== entry.version) throw new Error('Registered Kilo extension does not match its manifest.');
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2), flags=args.filter(a=>a.startsWith('--')), paths=args.filter(a=>!a.startsWith('--'));
  if(flags.length>1 || paths.length>1 || flags.some(a=>!['--check','--apply','--restore'].includes(a))) throw new Error('Usage: node jev-agent-order.mjs [webview.js] [--check|--apply|--restore]');
  const mode=flags[0] ?? (paths.length ? '--apply' : '--check');
  const target=paths[0] ? fs.realpathSync(paths[0]) : installedTarget();
  const source=fs.readFileSync(target,'utf8'),updated=patch(source,mode==='--restore');
  console.log(`Target: ${target}`);
  if(mode==='--check') { if(updated!==source) throw new Error('Jev ordering patch is missing; run this command with --apply.'); console.log('Jev ordering patch verified.'); }
  else if(updated!==source){
    const backup=target+'.pre-jev-order';
    if(mode==='--apply' && !fs.existsSync(backup))fs.copyFileSync(target,backup,fs.constants.COPYFILE_EXCL);
    const temp=target+'.jev-order-'+process.pid;
    try {
      fs.writeFileSync(temp,updated,{flag:'wx',mode:fs.statSync(target).mode & 0o777});
      if(fs.readFileSync(target,'utf8')!==source)throw new Error('Bundle changed during maintenance; refusing to overwrite it.');
      fs.renameSync(temp,target);
    } finally { if(fs.existsSync(temp))fs.unlinkSync(temp); }
    console.log(mode==='--restore' ? 'Removed only the Jev ordering change; other bundle changes preserved.' : 'Installed Jev picker ordering patch.');
    console.log('Run Developer: Reload Webviews in VS Code when convenient.');
  }else if(mode==='--restore'){
    console.log('Jev ordering patch is already absent.');
  }else console.log('Jev ordering patch already installed.');
}
