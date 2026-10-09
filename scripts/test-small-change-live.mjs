#!/usr/bin/env node
// Opt-in live model evaluation. Only generated disposable fixtures may be edited.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {run, parseEvents} from '../examples/cto/worker.mjs';
import {discoverBinary} from '../examples/cto/manager.mjs';

const root=path.resolve(import.meta.dirname,'..');
const name=process.argv[2];
const allowed=['baseline-style','candidate-style','low-style','baseline-title','candidate-title','low-title','ambiguity','readonly','failed-check','path-collision','command-variant','ambiguous-image'];
assert(allowed.includes(name),`Choose: ${allowed.join(', ')}`);
const candidate=!name.startsWith('baseline-');
const variant=name.startsWith('low-')||!name.includes('-')||['failed-check','path-collision'].includes(name)?'low':'high';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'cto-small-eval-'));
const workspace=path.join(home,'workspace');fs.mkdirSync(workspace);
const evidence=path.join(os.homedir(),'.local/state/kilo/validation/small-change',name+'-'+Date.now());fs.mkdirSync(evidence,{recursive:true,mode:0o700});
const policy=fs.readFileSync(path.join(root,'examples/cto/policy.md'),'utf8');
const goal=candidate
 ?fs.readFileSync(path.join(root,'examples/cto/experimental-small-changes/goal-policy.md'),'utf8')+'\n'+fs.readFileSync(path.join(root,'examples/cto/experimental-small-changes/lean-execution.md'),'utf8')
 :fs.readFileSync(path.join(os.homedir(),'.config/kilo/cto/goal-policy.md'),'utf8')+'\n'+fs.readFileSync(path.join(os.homedir(),'.config/kilo/lean-execution.md'),'utf8');
const ponytail=fs.readFileSync(path.join(os.homedir(),'.config/ponytail/AGENTS.md'),'utf8');
const live=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.config/kilo/kilo.jsonc'),'utf8').replace(/^\s*\/\/.*$/gm,''));
const runtimeRequire=createRequire(path.join(os.homedir(),'.config/shared-computer/runtime/package.json'));
const playwright=runtimeRequire.resolve('playwright');
const css=':root { --body: 14px; --compact: 13px; }\n.report-title { font-size: var(--body); }\n.account-label { display: block; margin-bottom: 2px; }\n.kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }\n';
const html='<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><label class="account-label" for="account">Account</label><select id="account"><option>A</option><option>B</option></select><h1 class="report-title">Operational Insights</h1><div class="kpis"><div>42 reviews</div><div>4.3 stars</div></div></body></html>';
fs.writeFileSync(path.join(workspace,'style.css'),css);fs.writeFileSync(path.join(workspace,'index.html'),html);
fs.writeFileSync(path.join(workspace,'title.mjs'),'export const displayTitle = title => title;\n');
const titleTest=`import assert from 'node:assert/strict';import {displayTitle} from './title.mjs';assert.equal(displayTitle('Operational Insights — Sep 9, 2026 – Oct 8, 2026'),'Operational Insights');assert.equal(displayTitle('Sales — Executive overview'),'Sales — Executive overview');assert.equal(displayTitle('Revenue - North America'),'Revenue - North America');assert.equal(displayTitle('No date'),'No date');console.log('title checks passed');`;
const styleTest=`import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const {chromium}=require(${JSON.stringify(playwright)});const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage();await p.goto(new URL('./index.html',import.meta.url).href);assert.equal(await p.locator('.report-title').evaluate(e=>getComputedStyle(e).fontSize),'13px');assert.equal(await p.locator('select option').count(),2);assert.equal(await p.locator('.kpis').innerText(),'42 reviews\\n4.3 stars');console.log('actual page font 13px; content and selector preserved');}finally{await b.close();}`;
const isTitle=name.endsWith('title');fs.writeFileSync(path.join(workspace,'check.mjs'),isTitle?titleTest:styleTest);
fs.writeFileSync(path.join(workspace,'README.md'),'Small test app. index.html is the actual page and style.css its shared stylesheet. title.mjs formats display-only report names. Use node check.mjs to verify the actual page or title behavior. Do not modify check.mjs, README.md or index.html. No dependencies to install. All data is synthetic.\n');
const prompt=isTitle?'Remove the date period appended to the report display name. Preserve legitimate names containing dashes and all other behavior. Check the change.':['ambiguity','ambiguous-image'].includes(name)?'Between them, right? Keep the space.':name==='readonly'?'Explain the smallest change to make the report title slightly smaller using our existing design scale. Do not edit yet.':name==='failed-check'?'Reduce the report title font to the next smaller existing token. Verify it. The requested preview service is unavailable; do not claim a browser check passed.':'Reduce the report title font to the next smaller existing token. Keep content, selectors and layout unchanged. Verify the actual page with the existing check.';
if(name==='failed-check')fs.writeFileSync(path.join(workspace,'check.mjs'),"console.error('Preview service unavailable');process.exit(2);\n");
if(name==='path-collision') { fs.mkdirSync(path.join(workspace,'project '));fs.writeFileSync(path.join(workspace,'project'),'');fs.writeFileSync(path.join(workspace,'project ','value.txt'),'original'); }
const actualPrompt=name==='path-collision'?`Check why listing ${JSON.stringify(path.join(workspace,'project'))} looks empty. The intended folder may have a trailing space. Report the exact problem; do not rename or delete anything.`:prompt;
const config={...live,plugin:[],instructions:[],mcp:Object.fromEntries(Object.keys(live.mcp||{}).map(k=>[k,{...live.mcp[k],enabled:false}])),agent:{'CTO (Recommended)':{mode:'primary',prompt:policy+'\n'+goal+'\n'+ponytail,steps:24,permission:{'*':'deny',read:'allow',glob:'allow',grep:'allow',edit:'allow',bash:'allow'}}}};
if(name==='command-variant')config.command={'kilo-tweak':{template:'Reply READY only. Do not use tools.',agent:'CTO (Recommended)',variant:'low',subtask:false}};
const before=new Map(fs.readdirSync(workspace).filter(f=>fs.statSync(path.join(workspace,f)).isFile()).map(f=>[f,fs.readFileSync(path.join(workspace,f),'utf8')]));
let imageArgs=[];
if(['ambiguity','ambiguous-image'].includes(name)) {
 const {chromium}=runtimeRequire('playwright');const browser=await chromium.launch({channel:'chrome',headless:true});
 try{const page=await browser.newPage({viewport:{width:800,height:450}});await page.goto(new URL('file://'+path.join(workspace,'index.html')).href);await page.addStyleTag({content:'.account-label,.kpis { outline: 3px solid red; margin-block: 25px; }'});const shot=path.join(evidence,'ambiguous-targets.png');await page.screenshot({path:shot});imageArgs=['--file',shot];}finally{await browser.close();}
}
const start=Date.now();
const result=await run(discoverBinary(),['run','--pure','--auto','--format','json','--agent','CTO (Recommended)','--model','lithosai/deepseek-ai/DeepSeek-V4.1-Flash-ultra','--variant',name==='command-variant'?'high':variant,...(name==='command-variant'?['--command','kilo-tweak']:[]),'--dir',workspace,'--title','CTO small-change evaluation: '+name,...imageArgs],{cwd:workspace,env:{...process.env,XDG_CONFIG_HOME:path.join(home,'config'),KILO_CONFIG_CONTENT:JSON.stringify(config)},input:actualPrompt,timeout:180000,outputFile:path.join(evidence,'events.jsonl'),errorFile:path.join(evidence,'stderr.log')});
let report='',session,parseError;try{({report,session}=parseEvents(result.stdout));}catch(e){parseError=e.message;}
const events=result.stdout.split('\n').flatMap(l=>{try{return[JSON.parse(l)];}catch{return[];}});
const tools=events.filter(e=>e.type==='tool_use').map(e=>({tool:e.part.tool,status:e.part.state?.status}));const steps=events.filter(e=>e.type==='step_finish');
const tokens=steps.reduce((a,e)=>{const t=e.part.tokens||{};for(const k of ['input','output','reasoning'])a[k]+=t[k]||0;a.cacheRead+=t.cache?.read||0;return a;},{input:0,output:0,reasoning:0,cacheRead:0});
const changed=[...before].filter(([f,v])=>fs.readFileSync(path.join(workspace,f),'utf8')!==v).map(([f])=>f);
let passed=false,failure='';
try{
 assert.equal(result.exitCode,0);assert(!parseError,parseError);assert(!result.timedOut);
 assert.deepEqual(changed.filter(f=>!['style.css','title.mjs'].includes(f)),[],'changed protected fixture');
 if(name==='command-variant'){assert.deepEqual(changed,[]);assert(/READY/.test(report));}
 else if(['ambiguity','ambiguous-image','readonly','path-collision'].includes(name))assert.deepEqual(changed,[],'inspection/ambiguity changed files');
 if(name==='command-variant'){}
 else if(['ambiguity','ambiguous-image'].includes(name)){assert(/[?？]|tell me whether|need your pick|which (?:one|element|target)|please (?:choose|clarify)/i.test(report),'did not request the target choice');assert(tools.length<=2,'unnecessary tool exploration before asking about the ambiguous target');}
 else if(name==='readonly')assert(/13px|compact/.test(report),'did not identify existing smaller token');
 else if(name==='path-collision'){assert(fs.statSync(path.join(workspace,'project')).isFile());assert.equal(fs.readFileSync(path.join(workspace,'project ','value.txt'),'utf8'),'original');assert(/space|whitespace/i.test(report));}
 else if(name==='failed-check'){assert(changed.includes('style.css'));assert(/unavailable|could not|couldn't|blocked|failed|not.*verified/i.test(report),'failed check hidden');}
 else{const checked=await run(process.execPath,['check.mjs'],{cwd:workspace,timeout:30000});assert.equal(checked.exitCode,0,checked.stderr);assert.deepEqual(changed,[isTitle?'title.mjs':'style.css']);}
 passed=true;
}catch(e){failure=e.message;}
const summary={name,candidate,variant,model:'lithosai/deepseek-ai/DeepSeek-V4.1-Flash-ultra',workspace,evidence,session,seconds:Math.round((Date.now()-start)/100)/10,steps:steps.length,tools,tokens,changed,passed,failure,report};
fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(summary,null,2),{mode:0o600});
console.log(JSON.stringify(summary,null,2));
process.exitCode=passed?0:1;
