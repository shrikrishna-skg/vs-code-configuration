import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluate } from '../examples/bridges/typesafe-mcp.mjs';
import { orderAgents, patch, installedTarget, legacyOrder, previousOrder } from '../examples/patches/jev-agent-order.mjs';
const agents=['Astra + Jev Engineering Lead','astra-engineering-lead','Fable Engineering Lead','Other'].map(name=>({name}));
assert.deepEqual(orderAgents(agents).map(a=>a.name),['astra-engineering-lead','Fable Engineering Lead','Astra + Jev Engineering Lead','Other']);
assert.equal(agents[0].name,'Astra + Jev Engineering Lead');
assert.deepEqual(orderAgents([{name:'Other'}]),[{name:'Other'}]);
assert.deepEqual(orderAgents(['Astra + Jev Engineering Lead','Opus + Jev Engineering Lead','Fable + Jev Engineering Lead','astra-engineering-lead','Fable Engineering Lead','Other'].map(name=>({name}))).map(a=>a.name),
  ['astra-engineering-lead','Fable Engineering Lead','Fable + Jev Engineering Lead','Opus + Jev Engineering Lead','Astra + Jev Engineering Lead','Other']);
// Only the Jev leads may allow the globally denied TypeSafe tools.
const allowed=fs.readdirSync('examples/agent').filter(f=>/^\s*TypeSafe_[\w*]*:\s*allow\b/m.test(fs.readFileSync(path.join('examples/agent',f),'utf8'))).sort();
assert.deepEqual(allowed,['Astra + Jev Engineering Lead.md','Fable + Jev Engineering Lead.md','Opus + Jev Engineering Lead.md']);
const kilo=JSON.parse(fs.readFileSync('examples/kilo.jsonc','utf8').replace(/^\s*\/\/.*$/gm,''));
assert.equal(kilo.permission['TypeSafe_*'],'deny');assert.equal(kilo.mcp.TypeSafe.enabled,true);
assert.throws(()=>patch('unknown bundle'));
const anchor='if(ne.type!=="agentsLoaded")return;et(ne.agents),He(ne.allAgents??ne.agents)';
assert.equal(patch(patch(anchor)),patch(anchor));
assert.equal(patch('/* other change */'+patch(anchor),true),'/* other change */'+anchor);
assert.throws(()=>patch(anchor+anchor));
assert.throws(()=>patch(patch(anchor)+anchor));
const legacy=`if(ne.type!=="agentsLoaded")return;et((${legacyOrder})(ne.agents)),He(ne.allAgents??ne.agents)`;
assert.equal(patch(legacy),patch(anchor));
assert.equal(patch(legacy,true),anchor);
// The previous (Fable + Jev, Astra + Jev) order, as installed in 7.7.9, migrates and restores.
const previous=`if(ne.type!=="agentsLoaded")return;et((${previousOrder})(ne.agents)),qe(ne.allAgents??ne.agents)`;
const current=patch('if(ne.type!=="agentsLoaded")return;et(ne.agents),qe(ne.allAgents??ne.agents)');
assert.notEqual(previous,current);assert.ok(current.includes('Opus + Jev Engineering Lead'));
assert.equal(patch(previous),current);
assert.equal(patch(previous,true),'if(ne.type!=="agentsLoaded")return;et(ne.agents),qe(ne.allAgents??ne.agents)');
for(const [m,set,all] of [['re','de','we'],['ne','ae','Ne'],['ne','et','He'],['ne','et','qe']]) {
  const original=`if(${m}.type!=="agentsLoaded")return;${set}(${m}.agents),${all}(${m}.allAgents??${m}.agents)`;
  assert.equal(patch(patch(original),true),original);
}
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'kilo-order-test-'));
try {
  const root=path.join(scratch,'extensions'),folder=path.join(root,'kilocode.kilo-code-9.0.0'),target=path.join(folder,'dist','webview.js');
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,anchor,{mode:0o640});
  fs.writeFileSync(path.join(folder,'package.json'),JSON.stringify({publisher:'kilocode',name:'kilo-code',version:'9.0.0'}));
  // A stale/newer-looking directory must not replace the registry's selection.
  fs.mkdirSync(path.join(root,'kilocode.kilo-code-99.0.0'));
  const entry={identifier:{id:'kilocode.kilo-code'},version:'9.0.0',location:{scheme:'file',path:folder}};
  const registry=path.join(root,'extensions.json');
  fs.writeFileSync(registry,JSON.stringify([entry]));
  assert.equal(installedTarget(root),fs.realpathSync(target));
  const run=flag=>spawnSync(process.execPath,['examples/patches/jev-agent-order.mjs',target,flag],{encoding:'utf8'});
  assert.notEqual(run('--check').status,0);
  assert.equal(fs.readFileSync(target,'utf8'),anchor);
  assert.equal(run('--apply').status,0);
  assert.equal(run('--check').status,0);
  assert.equal(fs.statSync(target).mode & 0o777,0o640);
  assert.equal(fs.readFileSync(target+'.pre-jev-order','utf8'),anchor);
  const patched=fs.readFileSync(target,'utf8');
  assert.equal(run('--apply').status,0);
  assert.equal(fs.readFileSync(target,'utf8'),patched);
  fs.writeFileSync(target,'/* later unrelated patch */'+patched);
  assert.equal(run('--restore').status,0);
  assert.equal(fs.readFileSync(target,'utf8'),'/* later unrelated patch */'+anchor);
  assert.equal(run('--restore').status,0);
  fs.writeFileSync(target,'unrecognized update');
  assert.notEqual(run('--apply').status,0);
  assert.equal(fs.readFileSync(target,'utf8'),'unrecognized update');
  fs.writeFileSync(registry,JSON.stringify([entry,entry]));
  assert.throws(()=>installedTarget(root));
  fs.writeFileSync(registry,JSON.stringify([{...entry,version:'different'}]));
  assert.throws(()=>installedTarget(root));
  fs.writeFileSync(registry,JSON.stringify([{...entry,location:{scheme:'file',path:scratch}}]));
  assert.throws(()=>installedTarget(root));
} finally { fs.rmSync(scratch,{recursive:true,force:true}); }
console.log('Jev maintenance: discovery, update repair, idempotency, backup, surgical restore and refusal checks passed.');

const input = { purpose: 'evidence_check', task: 'Verify indicator behavior', evidence: 'Completion passed; cancellation not tested.', requirements: [{ id: 'cancel', text: 'Indicator stops on cancellation.' }] };
const key = 'unit-test-credential';
const payload = { model: 'jev-1.13.0', answers: { cancel: { type: 'choice', choice: 'insufficient', confidence: .95, probabilities: { supported: 0, contradicted: 0, insufficient: 1 } } }, usage: { input_tokens: 100, output_tokens: 25 } };
let calls = 0;
const options = { key, fetcher: async (url, init) => {
  calls++; assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, `Bearer ${key}`);
  assert.equal(JSON.parse(init.body).questions.cancel.type, 'choice');
  return Response.json(payload);
} };
let r = await evaluate(input, options);
assert.equal(r.status, 'advice'); assert.equal(r.answers.cancel.choice, 'insufficient'); assert.equal(r.advisory_only, true);
assert.equal(calls, 1); assert.ok(!JSON.stringify(r).includes(key));
for (const bad of [null, {}, {...input,extra:true}, {...input,task:''}, {...input,evidence:'x'.repeat(25000)}, {...input,requirements:[]}, {...input,requirements:[...input.requirements,...input.requirements]}, {...input,no_delegation:'true'}, {...input,requirements:[{id:'__proto__',text:'x'}]}]) {
  assert.equal((await evaluate(bad, options)).reason, 'invalid_input');
}
assert.equal(calls,1);
assert.equal((await evaluate({...input,claims:key},options)).reason,'sensitive_input');
assert.equal((await evaluate(input)).reason,'missing_credential');
r=await evaluate({purpose:'next_step',task:'Implement this yourself',evidence:'',no_delegation:true},options);
assert.equal(r.status,'constraint');assert.equal(r.api_called,false);assert.equal(calls,1);
for(const status of [401,429,500,529]) assert.equal((await evaluate(input,{key,fetcher:async()=>new Response('secret error',{status})})).reason,`http_${status}`);
for(const mutate of [p=>{p.answers={}},p=>{p.answers.cancel.choice='approved'},p=>{p.answers.cancel.confidence=2},p=>{p.answers.cancel.probabilities.insufficient=.2},p=>{p.model='unknown'},p=>{delete p.usage},p=>{p.answers.extra=p.answers.cancel}]) {
  const p=structuredClone(payload);mutate(p);
  assert.equal((await evaluate(input,{key,fetcher:async()=>Response.json(p)})).reason,'invalid_response');
}
assert.equal((await evaluate(input,{key,fetcher:async()=>new Response('x'.repeat(65000))})).reason,'invalid_response');
assert.equal((await evaluate(input,{key,fetcher:async()=>new Response('not JSON')})).status,'unavailable');
r=await evaluate(input,{key,timeoutMs:15,fetcher:async(_u,{signal})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve(Response.json(payload)),1000);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason)},{once:true});})});
assert.equal(r.reason,'timeout_or_cancelled');assert.ok(r.elapsed_ms<500);
const controller=new AbortController();controller.abort();
r=await evaluate(input,{key,signal:controller.signal,fetcher:async(_u,{signal})=>{signal.throwIfAborted();}});
assert.equal(r.reason,'timeout_or_cancelled');
const messages=[
 {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},
 {jsonrpc:'2.0',id:2,method:'tools/list'},
 {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'evaluate_work',arguments:{purpose:'next_step',task:'No delegation',evidence:'',no_delegation:true}}},
 {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'bad'}},
];
const proc=spawnSync(process.execPath,['examples/bridges/typesafe-mcp.mjs'],{input:messages.map(m=>JSON.stringify(m)).join('\n')+'\n',encoding:'utf8',env:{...process.env,TYPESAFE_API_KEY:key},timeout:5000});
assert.equal(proc.status,0,proc.stderr);const rows=proc.stdout.trim().split('\n').map(JSON.parse);
assert.equal(rows.length,4);assert.equal(rows.find(r=>r.id===2).result.tools[0].name,'evaluate_work');
assert.equal(JSON.parse(rows.find(r=>r.id===3).result.content[0].text).status,'constraint');
assert.equal(rows.find(r=>r.id===4).error.code,-32602);assert.ok(!proc.stdout.includes(key));
console.log('TypeSafe: input/response validation, privacy, constraints, HTTP errors, timeout, cancellation and MCP checks passed.');
