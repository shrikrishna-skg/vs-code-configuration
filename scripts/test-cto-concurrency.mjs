import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cto-capacity-')));
Object.assign(process.env,{CTO_STATE_DIR:path.join(temp,'state'),CTO_AGENT_DIR:path.join(temp,'agents'),CTO_CONFIG:path.join(temp,'config.json'),CTO_KILO_BINARY:path.join(temp,'fake-kilo'),CTO_TEST_GATE:path.join(temp,'release')});
fs.mkdirSync(process.env.CTO_AGENT_DIR);
for(const name of ['deepseek-implementer','glm-investigator','luna-utility'])fs.writeFileSync(path.join(process.env.CTO_AGENT_DIR,name+'.md'),'---\nmodel: test/model\n---\n');
fs.writeFileSync(process.env.CTO_CONFIG,'{}');
fs.writeFileSync(process.env.CTO_KILO_BINARY,`#!/usr/bin/env node
const fs=require('fs');process.stdin.resume();const interval=setInterval(()=>{if(!fs.existsSync(process.env.CTO_TEST_GATE))return;clearInterval(interval);console.log(JSON.stringify({type:'step_start'}));console.log(JSON.stringify({type:'text',part:{text:'Read-only test result.'}}));console.log(JSON.stringify({type:'step_finish',part:{reason:'stop'}}));},100);`,{mode:0o755});
const m=await import('../examples/cto/manager.mjs');
const manager=new URL('../examples/cto/manager.mjs',import.meta.url).href;
const server=new URL('../examples/cto/server.mjs',import.meta.url).pathname;
const repo=path.join(temp,'repo');fs.mkdirSync(repo);m.git(repo,['init']);m.git(repo,['config','user.email','test@localhost']);m.git(repo,['config','user.name','Test']);fs.writeFileSync(path.join(repo,'README.md'),'fixture\n');m.git(repo,['add','.']);m.git(repo,['commit','-m','initial']);
function execJS(code){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',code],{env:process.env});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',c=>c===0?resolve(JSON.parse(out)):reject(Error(err)));});}
async function until(fn){const end=Date.now()+30000;for(;;){const result=await fn();if(result)return result;if(Date.now()>end)throw Error('Timed out waiting for capacity test');await new Promise(r=>setTimeout(r,80));}}
function db(){return JSON.parse(fs.readFileSync(m.registryFile,'utf8'));}
async function restartStatus(){const p=spawn(process.execPath,[server],{env:process.env,stdio:['pipe','pipe','pipe']});try{return await new Promise((resolve,reject)=>{let out='';const timeout=setTimeout(()=>reject(Error('MCP restart timed out')),5000);p.stdout.on('data',x=>{out+=x;for(const line of out.split('\n').filter(Boolean)){try{const r=JSON.parse(line);if(r.id===2){clearTimeout(timeout);resolve(JSON.parse(r.result.content[0].text));}}catch{}}});p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'status',arguments:{}}})+'\n');});}finally{p.kill();}}
try{
 const roles=[...Array(6).fill('implementer'),...Array(2).fill('tester'),...Array(8).fill('investigator'),...Array(5).fill('reviewer')];
 await Promise.all(roles.map((role,i)=>execJS(`const m=await import(${JSON.stringify(manager)});console.log(JSON.stringify(await m.submit(${JSON.stringify({workspace:repo,role,title:'capacity '+i,task:'Wait for test gate; no changes.',acceptance:'Bounded worker lifecycle completes',scopes:['file-'+i],checks:role==='implementer'||role==='tester'?[[process.execPath,'-e','process.exit(0)']]:[]})})));`)));
 await until(()=>{const tasks=db().tasks;return tasks.filter(m.active).length===14&&tasks.filter(m.active).every(t=>t.childPid);});
 let state=await m.status();assert.equal(state.activeWorkers,14);assert.equal(state.activeWriters,6);assert.equal(state.tasks.filter(t=>t.state==='queued').length,7);
 for(const [role,spec]of Object.entries(m.roles))assert(db().tasks.filter(t=>m.active(t)&&t.role===role).length<=spec.max);
 const restarted=await restartStatus();assert.equal(restarted.activeWorkers,14);assert.equal(restarted.activeWriters,6);
 // A dead supervisor must not free its still-running child's capacity slot.
 const victim=db().tasks.find(t=>m.active(t)&&!t.writer);
 process.kill(victim.pid,'SIGKILL');await until(()=>!m.alive(victim.pid));await m.update(victim.id,{startedAt:Date.now()-20000});
 state=await m.status();assert.equal(state.activeWorkers,14);assert.equal(state.tasks.find(t=>t.id===victim.id).state,'running');assert(m.alive(victim.childPid));
 process.kill(-victim.pid,'SIGKILL');await until(()=>!m.alive(victim.childPid));
 state=await m.status();assert.equal(state.tasks.find(t=>t.id===victim.id).state,'failed');assert.equal(state.activeWorkers,14,'Queued work should fill the newly released slot');
 fs.writeFileSync(process.env.CTO_TEST_GATE,'release');
 await until(async()=>{const s=await m.status();assert(s.activeWorkers<=14);assert(s.activeWriters<=6);return s.activeWorkers===0&&s.tasks.every(t=>['ready','failed'].includes(t.state));});
 const finished=await m.status();assert.equal(finished.tasks.filter(t=>t.state==='ready').length,20);assert.equal(finished.tasks.filter(t=>t.state==='failed').length,1);
 console.log('CTO concurrency checks passed: 21 independent submitter processes, 14 active workers, 6 writers, role caps, queue draining, MCP restart and crashed-supervisor recovery.');
}finally{
 const tasks=db().tasks;
 for(const j of tasks)if(m.active(j)||j.state==='queued')await m.cancel(j.id);
 fs.writeFileSync(process.env.CTO_TEST_GATE,'release');
 await until(async()=>!(await m.status()).activeWorkers).catch(()=>{});
 for(const j of db().tasks)if(m.alive(j.pid)||m.alive(j.childPid)){try{process.kill(-j.pid,'SIGKILL');}catch{}}
 fs.rmSync(temp,{recursive:true,force:true});
}
