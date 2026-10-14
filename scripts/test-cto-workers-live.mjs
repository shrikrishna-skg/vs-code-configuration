// Opt-in native delegation test. Only a generated project and isolated Kilo state are writable.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
if(!process.argv.includes('--run'))throw Error('Pass --run to authorize Claude, DeepSeek, GLM and JEV usage with synthetic test data.');
const blocked=process.argv.includes('--deny-write');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]};
const root=fs.mkdtempSync(path.join(arg('--work')??os.tmpdir(),'cto-workers-'));
const repo=path.join(root,'project'),configRoot=path.join(root,'config/kilo');fs.mkdirSync(repo);fs.mkdirSync(path.join(configRoot,'agent'),{recursive:true});
const live=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.config/kilo/kilo.jsonc'),'utf8'));
const profiles=['CTO + JEV','deepseek-implementer','glm-investigator'];const routes={};
for(const name of profiles){const file=path.join(os.homedir(),'.config/kilo/agent',name+'.md');const text=fs.readFileSync(file,'utf8');routes[name]=text.match(/^model: (.+)$/m)?.[1];assert(routes[name]);fs.writeFileSync(path.join(configRoot,'agent',name+'.md'),blocked&&name==='deepseek-implementer'?text.replace(/^mode: subagent$/m,'mode: primary'):text)}
const source='export function parseCount(value) { return parseInt(value, 10) || null; }\n';
const check=`import assert from 'node:assert/strict';import {parseCount} from './count.mjs';
const cases=[['0',0],['12',12],[' 42 ',42],['001',1],['9007199254740991',9007199254740991],['',null],['  ',null],['12cats',null],['-1',null],['+2',null],['1.5',null],['1e3',null],['9007199254740992',null],[12,null],[null,null],[undefined,null],[{},null],['１２',null]];
for(const [input,expected] of cases)assert.equal(parseCount(input),expected,JSON.stringify(input));console.log('PASS: 18 parseCount assertions');
`;
fs.writeFileSync(path.join(repo,'count.mjs'),source);fs.writeFileSync(path.join(repo,'check.mjs'),check);
fs.writeFileSync(path.join(repo,'README.md'),'Synthetic validation project. parseCount accepts only trimmed non-empty ASCII digits in a string, within JavaScript safe integer range, returning the number including zero. Everything else returns null. Preserve the export. Only count.mjs may be edited.\n');
const git=(...args)=>{const r=spawnSync('git',args,{cwd:repo,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim()};
git('init','-q');git('add','.');git('-c','user.name=Validation','-c','user.email=validation@localhost','commit','-qm','Synthetic baseline');
const baseline=spawnSync(process.execPath,['check.mjs'],{cwd:repo,encoding:'utf8'});assert.notEqual(baseline.status,0,'The initial bug must be detected');
const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('KILO_')||key.startsWith('OPENCODE_'))delete env[key];
for(const name of ['config','data','cache','state']){env['XDG_'+name.toUpperCase()+'_HOME']=path.join(root,name);fs.mkdirSync(path.join(root,name,'kilo'),{recursive:true})}
const cache=path.join(os.homedir(),'.cache/kilo/models.json');if(fs.existsSync(cache))fs.copyFileSync(cache,path.join(root,'cache/kilo/models.json'));
const auth=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.local/share/kilo/auth.json'),'utf8'));assert(auth.lithosai);fs.writeFileSync(path.join(root,'data/kilo/auth.json'),JSON.stringify({lithosai:auth.lithosai}),{mode:0o600});
const config={autoupdate:false,share:'disabled',instructions:[path.join(os.homedir(),'.config/ponytail/AGENTS.md')],provider:{'claude-local-cli':{...live.provider['claude-local-cli'],options:{...live.provider['claude-local-cli'].options,apiKey:'local-validation'}},lithosai:live.provider.lithosai},mcp:{TypeSafe:live.mcp.TypeSafe},permission:{...live.permission,task:{'*':'deny','deepseek-implementer':'allow','glm-investigator':'allow'},board_read:'allow',board_post:'allow',TypeSafe_evaluate_work:'allow'},agent:{'CTO + JEV':{steps:45},'deepseek-implementer':{steps:25},'glm-investigator':{steps:20}}};
if(blocked){config.permission.edit={'*':'deny','allowed-unused.mjs':'allow'};config.permission.bash='deny';config.permission.task='deny'}
fs.writeFileSync(path.join(configRoot,'kilo.json'),JSON.stringify(config));Object.assign(env,{KILO_DISABLE_MODELS_FETCH:'true',KILO_DISABLE_PROJECT_CONFIG:'true'});
const hash=file=>createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex');const preserved={check:hash('check.mjs'),readme:hash('README.md')};
const normalPrompt=`Validate this synthetic project using the installed CTO + JEV workflow. All work is in ${repo}. Do not use desktop/browser controls or any external service except the configured models and JEV. There are sequential dependencies, so synchronous native task calls are appropriate. Use exactly these stages:
1. A glm-investigator native task performs read-only diagnosis of count.mjs against README.md/check.mjs, reports concrete bugs without editing or running tests.
2. A deepseek-implementer native task repairs only count.mjs. Forward the diagnosed issues, full acceptance contract, the project path and ${os.homedir()}/.config/ponytail/AGENTS.md. The contract: input must be a string; trim whitespace; accept nonempty ASCII digits only; reject signs, decimals, exponents, suffixes, Unicode digits and unsafe integers; return number including 0 or null on invalid input; preserve named export parseCount. It may run node check.mjs.
3. A fresh glm-investigator native task independently reviews the resulting diff and contract, read-only, with no shell test execution. Address any supported finding within count.mjs through the implementer if necessary.
4. You, the CTO, run node check.mjs on the combined result and inspect git diff. check.mjs and README.md must remain byte-for-byte unchanged. Do not implement directly.
5. Call TypeSafe_evaluate_work once for evidence_check with three requirements: actual delegated implementation, independent read-only GLM review, and passing final combined verification. Use observed evidence only; report missing evidence accurately. Finish with the results, worker/session IDs and limitations. Do not claim success if a stage fails. Do not modify any other files, commit or push.`;
const activeAgent=blocked?'deepseek-implementer':'CTO + JEV';
const prompt=blocked?`Implement parseCount in ${repo}/count.mjs according to README.md. Only count.mjs is writable by your assignment. Read the current file and specification, make the smallest change, and run node check.mjs if authorized. Preserve every other file and follow the installed worker policy and canonical Ponytail rules.`:normalPrompt;
let stdout='',stderr='';const start=Date.now();const binary=path.join(os.homedir(),'.vscode/extensions/shrikrishna-skg.kilo-code-local-7.8.2/bin/kilo');
const child=spawn(binary,['run','--pure','--auto','--format','json','--agent',activeAgent,'--model',routes[activeAgent],'--variant','high','--dir',repo],{cwd:repo,env,detached:true,stdio:['pipe','pipe','pipe']});
const stop=()=>{try{process.kill(-child.pid,'SIGTERM')}catch{}const kill=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},3000);kill.unref()};const timer=setTimeout(stop,360000);
child.stdout.on('data',b=>{stdout+=b;fs.appendFileSync(path.join(root,'events.jsonl'),b,{mode:0o600})});child.stderr.on('data',b=>{stderr+=b;fs.appendFileSync(path.join(root,'stderr.log'),b,{mode:0o600})});child.stdin.end(prompt);
try{
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});clearTimeout(timer);
 const events=stdout.split('\n').filter(Boolean).flatMap(x=>{try{return[JSON.parse(x)]}catch{return[]}}),tools=events.filter(e=>e.type==='tool_use').map(e=>e.part),parent=events.find(e=>e.sessionID)?.sessionID;
 const db=path.join(root,'data/kilo/kilo.db');
 const inspector=`import sqlite3,json,sys\nc=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)\nrows=[]\nfor sid,data in c.execute('select session_id,data from message'):\n d=json.loads(data)\n if d.get('role')=='assistant':rows.append({'session':sid,'agent':d.get('agent'),'model':d.get('providerID','')+'/'+d.get('modelID',''),'finish':d.get('finish'),'error':bool(d.get('error'))})\nparts=[]\nfor sid,data in c.execute('select session_id,data from part'):\n d=json.loads(data)\n if d.get('type')=='tool':parts.append({'session':sid,'tool':d.get('tool'),'state':d.get('state',{}).get('status')})\nprint(json.dumps({'messages':rows,'parts':parts}))`;
 const inspected=spawnSync('python3',['-c',inspector,db],{encoding:'utf8'});assert.equal(inspected.status,0,inspected.stderr);const trace=JSON.parse(inspected.stdout);
 const sessions=[...new Set(trace.messages.map(m=>m.session))].map(id=>({id,...trace.messages.find(m=>m.session===id),completed:trace.messages.some(m=>m.session===id&&m.finish==='stop'&&!m.error),tools:trace.parts.filter(p=>p.session===id).map(p=>({tool:p.tool,status:p.state}))}));
 const workers=sessions.filter(s=>s.id!==parent),deepseek=workers.filter(s=>s.agent==='deepseek-implementer'),glm=workers.filter(s=>s.agent==='glm-investigator');
 const verify=spawnSync(process.execPath,['check.mjs'],{cwd:repo,encoding:'utf8'}),changed=git('diff','--name-only').split('\n').filter(Boolean),status=git('status','--porcelain','--untracked-files=all');
 const jev=tools.filter(t=>t.tool==='TypeSafe_evaluate_work').map(t=>{try{return JSON.parse(t.state.output)}catch{return{}}});
 const final=events.filter(e=>e.type==='text').map(e=>e.part?.text??'').join('\n');
 const normalConditions={completed:code===0&&events.some(e=>e.type==='step_finish'&&e.part?.reason==='stop'),deepseek:deepseek.length>=1&&deepseek.every(s=>s.model===routes['deepseek-implementer']&&s.completed),glm:glm.length>=2&&glm.every(s=>s.model===routes['glm-investigator']&&s.completed),reviewReadOnly:glm.every(s=>s.tools.every(t=>!['edit','write','apply_patch','background_process','task'].includes(t.tool))),parentDidNotImplement:!tools.some(t=>['edit','write','apply_patch'].includes(t.tool)||(t.tool==='bash'&&/(?:writeFile|write_text|cat\s*>|tee\s|sed\s+-i)/.test(t.state?.input?.command??t.input?.command??''))),parentRanCheck:tools.some(t=>t.tool==='bash'&&/node check\.mjs/.test(t.state?.input?.command??t.input?.command??'')),finalCheck:verify.status===0,scope:status.trim()==='M count.mjs'&&changed.length===1&&changed[0]==='count.mjs'&&preserved.check===hash('check.mjs')&&preserved.readme===hash('README.md'),jev:jev.some(j=>j.status==='advice'&&Object.keys(j.answers??{}).length>=3&&Object.values(j.answers??{}).every(a=>a.choice==='supported'))};
 const actor=sessions.find(s=>s.id===parent);
 const conditions=blocked?{completed:normalConditions.completed,correctModel:actor?.model===routes['deepseek-implementer'],oneDeniedWrite:actor?.tools.filter(t=>['edit','write','apply_patch','bash'].includes(t.tool)&&t.status==='error').length===1,noSuccessfulWrites:actor?.tools.every(t=>!['write','edit','apply_patch','bash'].includes(t.tool)||t.status!=='completed'),unchanged:git('status','--porcelain')===''&&fs.readFileSync(path.join(repo,'count.mjs'),'utf8')===source,handoff:/denied|blocked|permission/i.test(final)}:normalConditions;
 const report={passed:Object.values(conditions).every(Boolean),conditions,seconds:(Date.now()-start)/1000,workspace:repo,expectedRoutes:routes,workers,actor:blocked?actor:undefined,verification:verify.stdout.trim(),changedFiles:changed,jev:jev.map(j=>({status:j.status,elapsed_ms:j.elapsed_ms,answers:j.answers})),finalResponse:final};
 const file=arg('--report')??path.join(root,'report.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,conditions,seconds:report.seconds,workspace:repo,workers,report:file}));assert(report.passed,'Native worker validation did not pass; inspect the retained report and synthetic logs. '+stderr.slice(-300));
}finally{clearTimeout(timer);if(child.exitCode===null)stop();fs.rmSync(path.join(root,'data/kilo/auth.json'),{force:true});}
