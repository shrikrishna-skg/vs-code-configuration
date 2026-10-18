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
export function todoHeader(signal,effect,cleanup,session,todos) {
  const el=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ul');
  el.dataset.component='task-header-todos';el.style.cssText='padding:4px 12px;font-size:12px';el.append(summary,list);
  const [get,set]=globalThis.__kiloTodoState(signal,session);
  const toggle=()=>{if(el.open!==get())set(el.open);};el.addEventListener('toggle',toggle);cleanup(()=>el.removeEventListener('toggle',toggle));
  effect(()=>{const items=todos();el.hidden=!items.length;el.open=get();summary.textContent=`To-dos (${items.filter(x=>x.status==='completed').length}/${items.length})`;list.replaceChildren(...items.map(item=>{const li=document.createElement('li');li.textContent=(item.status==='completed'?'✓ ':item.status==='in_progress'?'→ ':'○ ')+item.content;return li;}));});
  return el;
}
const helper='\n/* todo-state:v2:start */\nglobalThis.__kiloTodoState='+todoState.toString()+';globalThis.__kiloTodoHeader='+todoHeader.toString()+';\n/* todo-state:v2:end */';
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
const stableSpecs=[
  [
    ['let eYn=()=>{let ae=s();return ae?jt.todos[ae]||[]:[]}', 'let eYn=()=>{let ae=s();/* todos-both-locations:v3 */return ae?jt.todos[ae]??mgt({messages:jt.messages[ae]??[],parts:Et=>jt.parts[Et]??Oe.peek(Et),revert:jt.sessions[ae]?.revert}):[]}'],
    ['R&&t.currentSession()?.id!==R.id&&D(void 0)}),C(le,{get when(){return o()},get children(){return[(()=>{var R=bXa()', 'R&&t.currentSession()?.id!==R.id&&D(void 0)}),C(le,{get when(){return o()},get children(){return[globalThis.__kiloTodoHeader(Ae,Ue,Xe,()=>t.currentSessionID(),()=>t.todos()),(()=>{var R=bXa()'],
  ],
  [
    ['let Vmr=()=>{let me=s();return me?Vt.todos[me]||[]:[]}', 'let Vmr=()=>{let me=s();/* todos-both-locations:v3 */return me?Vt.todos[me]??C_n({messages:Vt.messages[me]??[],parts:Qt=>Vt.parts[Qt]??Be.peek(Qt),revert:Vt.sessions[me]?.revert}):[]}'],
    ['T&&t.currentSession()?.id!==T.id&&R(void 0)}),w(Y,{get when(){return o()},get children(){return[(()=>{var T=XFa()', 'T&&t.currentSession()?.id!==T.id&&R(void 0)}),w(Y,{get when(){return o()},get children(){return[globalThis.__kiloTodoHeader(ie,Pe,qe,()=>t.currentSessionID(),()=>t.todos()),(()=>{var T=XFa()'],
  ],
];
export function patch(source, restore = false) {
  const matches = [...specs,...stableSpecs].filter(spec => spec.some(pair => pair.some(text => source.includes(text))));
  if (matches.length !== 1) throw Error('Unsupported or ambiguous to-do view; no changes made.');
  let next = source.replace(/\n\/\* todo-state:v2:start \*\/[\s\S]*?\/\* todo-state:v2:end \*\//,'');
  next=next.replace('[D,R]=ye(/* todos-header-expanded:v1 */!0)', '[D,R]=ye(!1)').replace('[I,D]=ie(/* todos-header-expanded:v1 */!0)', '[I,D]=ie(!1)');
  for (const [before, after] of matches[0]) {
    const count = text => next.split(text).length - 1;
    if (count(before) + count(after) !== 1) throw Error('Unsupported or ambiguous to-do anchor; no changes made.');
    next = next.replace(count(after) ? after : before, restore ? before : after);
  }
  if(restore)return next;
  const anchor=next.includes('function fgt(e)')?'function fgt(e)':next.includes('function E_n(e)')?'function E_n(e)':next.includes('function Rnt(e)')?'function Rnt(e)':next.includes('function abn(e)')?'function abn(e)':null;
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
