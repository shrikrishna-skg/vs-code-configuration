#!/usr/bin/env node
// Opt-in live model evaluation. Only generated disposable fixtures may be edited.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {run, parseEvents} from '../examples/cto/worker.mjs';
import {discoverBinary} from '../examples/cto/manager.mjs';
import {minimalConfig, agentName, prompt as minimalPrompt} from '../examples/cto/minimal/profile.mjs';
import crypto from 'node:crypto';

const root=path.resolve(import.meta.dirname,'..');
const name=process.argv[2];
const allowed=['minimal-style','minimal-title','minimal-readonly','minimal-ambiguous-image','minimal-failed-check','minimal-path-collision','baseline-readonly','baseline-ambiguous-image','baseline-style','candidate-style','low-style','baseline-title','candidate-title','low-title','ambiguity','readonly','failed-check','path-collision','command-variant','ambiguous-image'];
assert(allowed.includes(name),`Choose: ${allowed.join(', ')}`);
const minimal=name.startsWith('minimal-');
const candidate=!minimal&&!name.startsWith('baseline-');
const caseName=name.replace(/^(minimal|baseline|candidate|low)-/,'');
const variant=name.startsWith('low-')||!name.includes('-')||['failed-check','path-collision'].includes(name)?'low':'high';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'cto-small-eval-'));
const workspace=path.join(home,'workspace');fs.mkdirSync(workspace);
const evidence=path.join(os.homedir(),'.local/state/kilo/validation/small-change',name+'-'+Date.now());fs.mkdirSync(evidence,{recursive:true,mode:0o700});
const policy=fs.readFileSync(path.join(root,'examples/cto/policy.md'),'utf8');
const goal=minimal ? '' : candidate
 ?fs.readFileSync(path.join(root,'examples/cto/experimental-small-changes/goal-policy.md'),'utf8')+'\n'+fs.readFileSync(path.join(root,'examples/cto/experimental-small-changes/lean-execution.md'),'utf8')
 : null;
const ponytail=fs.readFileSync(path.join(os.homedir(),'.config/ponytail/AGENTS.md'),'utf8');
const live=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.config/kilo/kilo.jsonc'),'utf8').replace(/^\s*\/\/.*$/gm,''));
const baselineInstructions=!minimal&&!candidate ? live.instructions.filter(p=>!p.includes('/ponytail/')).map(p=>fs.readFileSync(p,'utf8')).join('\n') : '';
const runtimeRequire=createRequire(path.join(os.homedir(),'.config/shared-computer/runtime/package.json'));
const playwright=runtimeRequire.resolve('playwright');
const css=':root { --body: 14px; --compact: 13px; }\n.report-title { font-size: var(--body); }\n.account-label { display: block; margin-bottom: 2px; }\n.kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }\n';
const html='<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><label class="account-label" for="account">Account</label><select id="account"><option>A</option><option>B</option></select><h1 class="report-title">Operational Insights</h1><div class="kpis"><div>42 reviews</div><div>4.3 stars</div></div></body></html>';
fs.writeFileSync(path.join(workspace,'style.css'),css);fs.writeFileSync(path.join(workspace,'index.html'),html);
fs.writeFileSync(path.join(workspace,'title.mjs'),'export const displayTitle = title => title;\n');
const titleTest=`import assert from 'node:assert/strict';import {displayTitle} from './title.mjs';assert.equal(displayTitle('Operational Insights — Sep 9, 2026 – Oct 8, 2026'),'Operational Insights');assert.equal(displayTitle('Sales — Executive overview'),'Sales — Executive overview');assert.equal(displayTitle('Revenue - North America'),'Revenue - North America');assert.equal(displayTitle('No date'),'No date');console.log('title checks passed');`;
const styleTest=`import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const {chromium}=require(${JSON.stringify(playwright)});const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage();await p.goto(new URL('./index.html',import.meta.url).href);assert.equal(await p.locator('.report-title').evaluate(e=>getComputedStyle(e).fontSize),'13px');assert.equal(await p.locator('select option').count(),2);assert.equal(await p.locator('.kpis').innerText(),'42 reviews\\n4.3 stars');console.log('actual page font 13px; content and selector preserved');}finally{await b.close();}`;
const isTitle=caseName==='title';fs.writeFileSync(path.join(workspace,'check.mjs'),isTitle?titleTest:styleTest);
fs.writeFileSync(path.join(workspace,'README.md'),'Small test app. index.html is the actual page and style.css its shared stylesheet. title.mjs formats display-only report names. Use node check.mjs to verify the actual page or title behavior. Do not modify check.mjs, README.md or index.html. No dependencies to install. All data is synthetic.\n');
const prompt=isTitle?'Remove the date period appended to the report display name. Preserve legitimate names containing dashes and all other behavior. Check the change.':['ambiguity','ambiguous-image'].includes(caseName)?'Between them, right? Keep the space.':caseName==='readonly'?'Explain the smallest change to make the report title slightly smaller using our existing design scale. Do not edit yet.':caseName==='failed-check'?'Reduce the report title font to the next smaller existing token. Verify it. The requested preview service is unavailable; do not claim a browser check passed.':'Reduce the report title font to the next smaller existing token. Keep content, selectors and layout unchanged. Verify the actual page with the existing check.';
if(caseName==='failed-check')fs.writeFileSync(path.join(workspace,'check.mjs'),"console.error('Preview service unavailable');process.exit(2);\n");
if(caseName==='path-collision') { fs.mkdirSync(path.join(workspace,'project '));fs.writeFileSync(path.join(workspace,'project'),'');fs.writeFileSync(path.join(workspace,'project ','value.txt'),'original'); }
const actualPrompt=caseName==='path-collision'?`Check why listing ${JSON.stringify(path.join(workspace,'project'))} looks empty. The intended folder may have a trailing space. Report the exact problem; do not rename or delete anything.`:prompt;
const model='lithosai/deepseek-ai/DeepSeek-V4.1-Flash-ultra';
const selectedAgent=minimal?agentName:'CTO (Recommended)';
const config=minimal?minimalConfig(live,{model,variant,ponytail:path.join(os.homedir(),'.config/ponytail/AGENTS.md')}):{...live,plugin:[],instructions:[],mcp:Object.fromEntries(Object.keys(live.mcp||{}).map(k=>[k,{...live.mcp[k],enabled:false}])),agent:{[selectedAgent]:{mode:'primary',prompt:policy+'\n'+(goal||baselineInstructions)+'\n'+ponytail}}};
// Identical fixture-only permissions and step ceiling in both comparison arms.
config.agent[selectedAgent].steps=24;
config.agent[selectedAgent].permission={'*':'deny',read:'allow',glob:'allow',grep:'allow',edit:'allow',bash:'allow'};
if(name==='command-variant')config.command={'kilo-tweak':{template:'Reply READY only. Do not use tools.',agent:'CTO (Recommended)',variant:'low',subtask:false}};
function filesAt(directory, prefix='') {
 return fs.readdirSync(directory).flatMap(name=>{
  const file=path.join(directory,name), relative=prefix+name, stat=fs.lstatSync(file);
  return stat.isDirectory()?filesAt(file,relative+'/'):[[relative,stat.isSymbolicLink()?'symlink:'+fs.readlinkSync(file):fs.readFileSync(file).toString('base64')]];
 });
}
const before=new Map(filesAt(workspace));
let imageArgs=[];
if(['ambiguity','ambiguous-image'].includes(caseName)) {
 const {chromium}=runtimeRequire('playwright');const browser=await chromium.launch({channel:'chrome',headless:true});
 try{const page=await browser.newPage({viewport:{width:800,height:450}});await page.goto(new URL('file://'+path.join(workspace,'index.html')).href);await page.addStyleTag({content:'.account-label,.kpis { outline: 3px solid red; margin-block: 25px; }'});const shot=path.join(evidence,'ambiguous-targets.png');await page.screenshot({path:shot});imageArgs=['--file',shot];}finally{await browser.close();}
}
const start=Date.now();
const result=await run(discoverBinary(),['run','--pure','--auto','--format','json','--agent',selectedAgent,'--model',model,'--variant',name==='command-variant'?'high':variant,...(name==='command-variant'?['--command','kilo-tweak']:[]),'--dir',workspace,'--title','CTO small-change evaluation: '+name,...imageArgs],{cwd:workspace,env:{...process.env,XDG_CONFIG_HOME:path.join(home,'config'),KILO_CONFIG:'',KILO_CONFIG_DIR:'',KILO_CONFIG_CONTENT:JSON.stringify(config)},input:actualPrompt,timeout:180000,outputFile:path.join(evidence,'events.jsonl'),errorFile:path.join(evidence,'stderr.log')});
const modelSeconds=Math.round((Date.now()-start)/100)/10;
let report='',session,parseError;try{({report,session}=parseEvents(result.stdout));}catch(e){parseError=e.message;}
const events=result.stdout.split('\n').flatMap(l=>{try{return[JSON.parse(l)];}catch{return[];}});
const tools=events.filter(e=>e.type==='tool_use').map(e=>({tool:e.part.tool,status:e.part.state?.status}));const steps=events.filter(e=>e.type==='step_finish');
const tokens=steps.reduce((a,e)=>{const t=e.part.tokens||{};for(const k of ['input','output','reasoning'])a[k]+=t[k]||0;a.cacheRead+=t.cache?.read||0;return a;},{input:0,output:0,reasoning:0,cacheRead:0});
const after=new Map(filesAt(workspace));
const changed=[...new Set([...before.keys(),...after.keys()])].filter(f=>before.get(f)!==after.get(f));
let passed=false,failure='';
try{
 assert.equal(result.exitCode,0);assert(!parseError,parseError);assert(!result.timedOut);
 assert.deepEqual(changed.filter(f=>!['style.css','title.mjs'].includes(f)),[],'changed protected fixture');
 if(name==='command-variant'){assert.deepEqual(changed,[]);assert(/READY/.test(report));}
 else if(['ambiguity','ambiguous-image','readonly','path-collision'].includes(caseName))assert.deepEqual(changed,[],'inspection/ambiguity changed files');
 if(name==='command-variant'){}
 else if(['ambiguity','ambiguous-image'].includes(caseName)){assert(/[?？]|tell me whether|need your pick|which (?:one|element|target)|please (?:choose|clarify)/i.test(report),'did not request the target choice');assert(tools.length<=2,'unnecessary tool exploration before asking about the ambiguous target');}
 else if(caseName==='readonly')assert(/13px|compact/.test(report),'did not identify existing smaller token');
 else if(caseName==='path-collision'){assert(fs.statSync(path.join(workspace,'project')).isFile());assert.equal(fs.readFileSync(path.join(workspace,'project ','value.txt'),'utf8'),'original');assert(/space|whitespace/i.test(report));}
 else if(caseName==='failed-check'){assert(changed.includes('style.css'));assert(/unavailable|could not|couldn't|blocked|failed|not.*verified/i.test(report),'failed check hidden');}
 else{const checked=await run(process.execPath,['check.mjs'],{cwd:workspace,timeout:30000});assert.equal(checked.exitCode,0,checked.stderr);assert.deepEqual(changed,[isTitle?'title.mjs':'style.css']);}
 if(minimal) {
  const headings=[...report.matchAll(/^## (.+)$/gm)].map(m=>m[1]);
  assert.deepEqual(headings.filter(h=>h!=='Verification'),['Answer','My opinion','Next step'],'final response format changed');
 }
 passed=true;
}catch(e){failure=e.message;}
const systemText=minimal?minimalPrompt+'\n'+ponytail:policy+'\n'+(goal||baselineInstructions)+'\n'+ponytail;
const summary={name,candidate,minimal,variant,model,modelSeconds,policyBytes:Buffer.byteLength(systemText),policyHash:crypto.createHash('sha256').update(systemText).digest('hex'),workspace,evidence,session,seconds:Math.round((Date.now()-start)/100)/10,steps:steps.length,tools,tokens,changed,passed,failure,report};
fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(summary,null,2),{mode:0o600});
console.log(JSON.stringify(summary,null,2));
process.exitCode=passed?0:1;
