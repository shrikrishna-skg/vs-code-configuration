// Opt-in integration check: one isolated CTO + JEV turn, synthetic evidence only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
if(!process.argv.includes('--run'))throw Error('Pass --run for a real Claude + JEV integration test.');
const reportIndex=process.argv.indexOf('--report'),reportFile=reportIndex<0?null:path.resolve(process.argv[reportIndex+1]);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cto-jev-live-'));
const live=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.config/kilo/kilo.jsonc'),'utf8'));
const agentFile=path.join(os.homedir(),'.config/kilo/agent/CTO + JEV.md');
const agent=fs.readFileSync(agentFile,'utf8'),model=agent.match(/^model: (.+)$/m)?.[1];assert(model?.startsWith('claude-local-cli/'));
const config={provider:{'claude-local-cli':{...live.provider['claude-local-cli'],options:{...live.provider['claude-local-cli'].options,apiKey:'local-validation'}}},mcp:{TypeSafe:live.mcp.TypeSafe},permission:{'*':'deny',TypeSafe_evaluate_work:'allow'},agent:{'CTO + JEV':{steps:6}},instructions:[]};
const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('KILO_')||key.startsWith('OPENCODE_'))delete env[key];
for(const name of ['config','data','cache','state']){env['XDG_'+name.toUpperCase()+'_HOME']=path.join(root,name);fs.mkdirSync(path.join(root,name,'kilo'),{recursive:true})}
fs.mkdirSync(path.join(root,'config/kilo/agent'));fs.copyFileSync(agentFile,path.join(root,'config/kilo/agent/CTO + JEV.md'));
fs.writeFileSync(path.join(root,'config/kilo/kilo.json'),JSON.stringify(config));
const cache=path.join(os.homedir(),'.cache/kilo/models.json');if(fs.existsSync(cache))fs.copyFileSync(cache,path.join(root,'cache/kilo/models.json'));
Object.assign(env,{KILO_DISABLE_MODELS_FETCH:'true',KILO_DISABLE_PROJECT_CONFIG:'true'});
const prompt='This is a bounded integration test with synthetic data. Do not read files, edit, browse, delegate, or run shell commands. Use TypeSafe_evaluate_work exactly once with purpose evidence_check. Task: assess synthetic search widget. Observed evidence: input label is Search; pressing Escape left the query unchanged; cancellation was not tested. Requirements: label must be Search (id label); Escape must clear the query (id escape); cancellation must work (id cancel). Claims: worker says all three pass. Then report the actual returned classifications, distinguish missing evidence from a failure, and say the implementation is not fully verified. Stop after that answer.';
let stdout='',stderr='';const started=Date.now();
const binary=path.join(os.homedir(),'.vscode/extensions/shrikrishna-skg.kilo-code-local-7.8.2/bin/kilo');
const child=spawn(binary,['run','--pure','--format','json','--agent','CTO + JEV','--model',model,'--variant','high','--dir',root],{cwd:root,env,stdio:['pipe','pipe','pipe']});
child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.end(prompt);
const timer=setTimeout(()=>child.kill('SIGTERM'),120000);
try{
 const exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});clearTimeout(timer);
 const events=stdout.split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}});
 const tools=events.filter(e=>e.type==='tool_use').map(e=>e.part);
 const jev=tools.filter(t=>t?.tool==='TypeSafe_evaluate_work');
 const output=jev.map(t=>{try{return JSON.parse(t.state?.output??'{}')}catch{return {}}}).find(r=>r.status==='advice');
 const final=events.filter(e=>e.type==='text').map(e=>e.part?.text??'').join('\n');
 const expected={label:'supported',escape:'contradicted',cancel:'insufficient'};
 const answers=Object.fromEntries(Object.entries(output?.answers??{}).map(([k,v])=>[k,v.choice]));
 const passed=exitCode===0&&jev.length===1&&tools.length===1&&Object.entries(expected).every(([k,v])=>answers[k]===v)&&events.some(e=>e.type==='step_finish'&&e.part?.reason==='stop')&&/not|incomplete|unverified|insufficient/i.test(final);
 const report={passed,model,seconds:(Date.now()-started)/1000,exit_code:exitCode,tools:tools.map(t=>t.tool),jev_status:output?.status,jev_api_ms:output?.elapsed_ms,answers,final_response:final};
 if(reportFile){fs.mkdirSync(path.dirname(reportFile),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n')}
 console.log(JSON.stringify(report));assert(passed,'CTO + JEV integration failed; see the synthetic report. '+stderr.slice(-500));
}finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGTERM');fs.rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:100})}
