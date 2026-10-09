#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { patch } from '../examples/patches/clarify-goal.mjs';

const root=path.resolve(import.meta.dirname,'..'),home=process.env.CLARIFY_GOAL_HOME||os.homedir();
const args=process.argv.slice(2),hash=data=>crypto.createHash('sha256').update(data).digest('hex');
if(args[0]==='--restore') {
  const folder=args[1],manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
  for(const f of manifest.files)if(!fs.existsSync(f.path)||hash(fs.readFileSync(f.path))!==f.hash)throw Error('Changed after install; inspect before restoring: '+f.path);
  for(const f of manifest.files)if(f.backup)fs.copyFileSync(path.join(folder,f.backup),f.path);else fs.unlinkSync(f.path);
  console.log('Clarify goal restored. Reload the affected VS Code window when idle.');process.exit(0);
}
if(args.some(a=>a!=='--apply'))throw Error('Usage: install-clarify-goal.mjs [--apply | --restore BACKUP_DIRECTORY]');
const extensions=path.join(home,'.vscode/extensions');
const version=fs.readdirSync(extensions).filter(n=>/^shrikrishna-skg\.kilo-code-local-/.test(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).at(-1);
if(!version)throw Error('Local Kilo extension not found.');
const dist=path.join(extensions,version,'dist'),configPath=path.join(home,'.config/kilo/kilo.jsonc');
const config=JSON.parse(fs.readFileSync(configPath,'utf8').replace(/^\s*\/\/.*$/gm,''));
if(!fs.existsSync(path.join(home,'.config/ponytail/AGENTS.md')))throw Error('Canonical Ponytail policy is missing.');
const writes=new Map(),originals=new Map();
for(const name of ['extension.js','webview.js','agent-manager.js'])writes.set(path.join(dist,name),Buffer.from(patch(fs.readFileSync(path.join(dist,name),'utf8'),name)));
for(const name of ['clarify-goal.cjs','clarify-goal.mjs','clarify-goal-ui.js']) {
  writes.set(path.join(home,'.config/kilo/patches',name),fs.readFileSync(path.join(root,'examples/patches',name)));
}
writes.set(path.join(dist,'clarify-goal.cjs'),fs.readFileSync(path.join(root,'examples/patches/clarify-goal.cjs')));
config.agent ||= {};
config.agent['goal-clarifier']={hidden:true,mode:'subagent',description:'Read-only prompt clarification',steps:2,
  prompt:'Follow the clarification system instruction. Return only a faithful rewritten prompt or one essential clarification question. Never execute the user task.',permission:{'*':'deny'}};
writes.set(configPath,Buffer.from(JSON.stringify(config,null,2)+'\n'));
writes.set(path.join(home,'.config/kilo/patches/reapply-kilo-patches.sh'),fs.readFileSync(path.join(root,'scripts/reapply-kilo-patches.sh')));
for(const [file,data] of writes) {
  const before=fs.existsSync(file)?fs.readFileSync(file):null;
  originals.set(file,before);
  if(before?.equals(data))writes.delete(file);
}
console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'dry-run',extension:version,files:[...writes.keys()]},null,2));
if(!args.includes('--apply')||!writes.size)process.exit(0);
const backup=path.join(home,'.config/kilo/backups','clarify-goal-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(backup,{recursive:true,mode:0o700});
const manifest={files:[]};
for(const [file,data] of writes) {
  const before=originals.get(file),entry={path:file,hash:hash(data)};
  if(before){entry.backup=manifest.files.length+'.bak';fs.writeFileSync(path.join(backup,entry.backup),before,{mode:0o600});}
  manifest.files.push(entry);
}
fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
const staged=[];
try {
  for(const [file,data] of writes) {
    const before=originals.get(file),now=fs.existsSync(file)?fs.readFileSync(file):null;
    if(before?!now?.equals(before):now!==null)throw Error('File changed while preparing install: '+file);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const temp=file+'.clarify-install'+(/\.(?:c?js|mjs)$/.test(file)?path.extname(file):'');
    fs.writeFileSync(temp,data,{flag:'wx',mode:0o600});staged.push([temp,file]);
    if(/\.(?:c?js|mjs)$/.test(file)){const r=spawnSync(process.execPath,['--check',temp],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);}
  }
  for(const [temp,file] of staged)fs.renameSync(temp,file);
} catch(error) {
  for(const [temp] of staged)if(fs.existsSync(temp))fs.unlinkSync(temp);
  for(const f of manifest.files)if(f.backup)fs.copyFileSync(path.join(backup,f.backup),f.path);else if(fs.existsSync(f.path))fs.unlinkSync(f.path);
  throw error;
}
console.log('Backup: '+backup+'\nInstalled. Newly opened VS Code windows load the change; reload existing windows when idle.');
