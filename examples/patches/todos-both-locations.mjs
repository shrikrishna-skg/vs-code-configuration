#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function todoState(signal, session) {
  const [revision, bump] = signal(0), memory = new Map();
  const key = () => 'kilo.todo.expanded.v2:' + (session() || 'new');
  const get = () => {
    revision();const id=key();
    if(memory.has(id))return memory.get(id);
    try{return globalThis.localStorage?.getItem(id)==='true';}catch{return false;}
  };
  return [get, value => {
    const id=key(),next=typeof value==='function'?!!value(get()):!!value;
    memory.set(id,next);try{globalThis.localStorage?.setItem(id,String(next));}catch{}
    bump(n=>n+1);return next;
  }];
}
const helper='\n/* todo-state:v2:start */\nglobalThis.__kiloTodoState='+todoState.toString()+';\n/* todo-state:v2:end */';
const specs = [
  [
    ['let ZIn=()=>{let ne=o();return ne?Mt.todos[ne]||[]:[]}', 'let ZIn=()=>{let ne=o();/* todos-both-locations:v1 */return ne?Mt.todos[ne]??Tnt({messages:Mt.messages[ne]??[],parts:It=>Mt.parts[It]??me.peek(It),revert:Mt.sessions[ne]?.revert}):[]}'],
    ['[D,R]=ye(!1),[F,z]=ye(),P=()=>{if(e.readonly)return;', '[D,R]=globalThis.__kiloTodoState(ye,()=>t.currentSessionID()),[F,z]=ye(),P=()=>{if(e.readonly)return;'],
  ],
  [
    ['let QY=()=>{let te=o();return te?Qt.todos[te]||[]:[]}', 'let QY=()=>{let te=o();/* todos-both-locations:v1 */return te?Qt.todos[te]??nbn({messages:Qt.messages[te]??[],parts:Tt=>Qt.parts[Tt]??ge.peek(Tt),revert:Qt.sessions[te]?.revert}):[]}'],
    ['[I,D]=ie(!1),[R,$]=ie(),Q=()=>{if(e.readonly)return;', '[I,D]=globalThis.__kiloTodoState(ie,()=>t.currentSessionID()),[R,$]=ie(),Q=()=>{if(e.readonly)return;'],
  ],
];
export function patch(source, restore = false) {
  const matches = specs.filter(spec => spec.some(pair => pair.some(text => source.includes(text))));
  if (matches.length !== 1) throw Error('Unsupported or ambiguous to-do view; no changes made.');
  let next = source.replace(/\n\/\* todo-state:v2:start \*\/[\s\S]*?\/\* todo-state:v2:end \*\//,'');
  next=next.replace('[D,R]=ye(/* todos-header-expanded:v1 */!0)', '[D,R]=ye(!1)').replace('[I,D]=ie(/* todos-header-expanded:v1 */!0)', '[I,D]=ie(!1)');
  for (const [before, after] of matches[0]) {
    const count = text => next.split(text).length - 1;
    if (count(before) + count(after) !== 1) throw Error('Unsupported or ambiguous to-do anchor; no changes made.');
    next = next.replace(count(after) ? after : before, restore ? before : after);
  }
  if(restore)return next;
  const anchor=next.includes('function Rnt(e)')?'function Rnt(e)':next.includes('function abn(e)')?'function abn(e)':null;
  return anchor?next.replace(anchor,helper+anchor):helper+next;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, mode = '--apply', ...extra] = process.argv.slice(2);
  if (!target || extra.length || !['--apply', '--check', '--restore'].includes(mode)) throw Error('Usage: todos-both-locations.mjs <bundle.js> [--apply|--check|--restore]');
  const source = fs.readFileSync(target, 'utf8'), next = patch(source, mode === '--restore');
  if (mode === '--check') {
    if (source !== next) throw Error('To-do header patch is missing.');
    console.log('To-dos in both locations verified.');
  } else if (source !== next) {
    const temp = target + '.todos-tmp.js';
    try {
      fs.writeFileSync(temp, next, {flag:'wx', mode:fs.statSync(target).mode & 0o777});
      const check = spawnSync(process.execPath, ['--check', temp], {encoding:'utf8'});
      if (check.status !== 0) throw Error(check.stderr || 'Syntax check failed.');
      if (fs.readFileSync(target,'utf8') !== source) throw Error('Bundle changed while patching.');
      const backup = target + '.pre-todos-both-locations';
      if (mode === '--apply' && !fs.existsSync(backup)) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
      fs.renameSync(temp, target);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    console.log('To-do header updated. Reopen the Kilo view to load the bundle.');
  } else console.log('No changes needed.');
}
