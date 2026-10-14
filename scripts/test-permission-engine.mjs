// Exercises the installed Kilo engine with a local fake model in an isolated workspace.
// No provider credentials, live chats or live permission settings are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createPermissionController}=require('../examples/patches/permission-modes.cjs');
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'kilo-permissions-'))),cwd=path.join(root,'workspace');
await fs.mkdir(cwd);execFileSync('git',['init','-q'],{cwd});
const outside=path.join(root,'outside.txt'),marker=path.join(cwd,'denied-marker');
const protectedFile=path.join(root,'config/kilo/patches/permission-probe.txt');
await fs.writeFile(outside,'outside fixture');
const fake=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 requestCount++;const body=JSON.parse(raw),text=JSON.stringify(body.messages),kind=['protected-edit','protected-shell','outside-shell','ordinary','outside','denied'].find(x=>text.includes('permission-case:'+x));
 const already=body.messages.some(x=>x.role==='tool');
 const call={id:'call_'+kind,type:'function',function:kind==='protected-edit'?{name:'edit',arguments:JSON.stringify({filePath:protectedFile,oldString:'before',newString:'after'})}:kind==='outside'?{name:'read',arguments:JSON.stringify({filePath:outside})}:{name:'bash',arguments:JSON.stringify({command:kind==='denied'?`touch '${marker}'`:kind==='protected-shell'?`cd '${path.dirname(protectedFile)}' && cat permission-probe.txt`:kind==='outside-shell'?`cd '${root}' && ls -d workspace/ && printf permission-probe`:'printf permission-probe',description:'Isolated permission check'})}};
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const send=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason}]})}\n\n`);
 send(already?{content:'DONE'}:{tool_calls:[{index:0,...call}]});send({},already?'stop':'tool_calls');res.end('data: [DONE]\n\n');
});
await new Promise(r=>fake.listen(0,'127.0.0.1',r));
for(const k of ['config','data','cache','state'])await fs.mkdir(path.join(root,k,'kilo'),{recursive:true});
await fs.mkdir(path.dirname(protectedFile));
await fs.copyFile(path.join(os.homedir(),'.cache/kilo/models.json'),path.join(root,'cache/kilo/models.json'));
await fs.writeFile(path.join(root,'config/kilo/kilo.json'),JSON.stringify({autoupdate:false,share:'disabled',instructions:[],mcp:{},enabled_providers:['permission-test'],default_agent:'test',permission:{read:'allow',external_directory:{'*':'ask',[path.dirname(protectedFile)+'/*']:'allow'},bash:{'*':'ask','touch *':'deny'}},agent:{test:{mode:'primary',prompt:'Follow the requested check.'}},provider:{'permission-test':{npm:'@ai-sdk/openai-compatible',options:{baseURL:`http://127.0.0.1:${fake.address().port}/v1`},models:{test:{name:'Test',limit:{context:200000,output:8192},tool_call:true}}}}}));
const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('KILO_')||k.startsWith('OPENCODE_'))delete env[k];
for(const k of ['config','data','cache','state'])env['XDG_'+k.toUpperCase()+'_HOME']=path.join(root,k);
Object.assign(env,{KILO_DISABLE_MODELS_FETCH:'true',KILO_DISABLE_CLAUDE_CODE:'true',KILO_DISABLE_PROJECT_CONFIG:'true'});
const extensions=path.join(os.homedir(),'.vscode/extensions');
const installed=(await fs.readdir(extensions)).filter(x=>x.startsWith('shrikrishna-skg.kilo-code-local-')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
const bin=process.env.KILO_BINARY??path.join(extensions,installed.at(-1)??'missing-kilo','bin/kilo');
const kilo=spawn(bin,['serve','--hostname','127.0.0.1','--port','0'],{cwd,env,stdio:['ignore','pipe','pipe']});
let output='',port;kilo.stdout.on('data',b=>{output+=b;port=Number(output.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[1]);});kilo.stderr.on('data',b=>output+=b);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let base,approvals=0,lastMessages,lastPending,requestCount=0;
async function api(route,body){const r=await fetch(base+route+(route.includes('?')?'&':'?')+'directory='+encodeURIComponent(cwd),{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert(r.ok,route+': '+r.status+' '+await (r.ok?Promise.resolve(''):r.text()));const text=await r.text();return text?JSON.parse(text):null;}
try{
 for(let i=0;i<100&&!port;i++)await sleep(100);assert(port,output);base=`http://127.0.0.1:${port}`;
 let active=false;
 const sdk={permission:{list:async()=>({data:await api('/permission')})}};
 const ctrl=createPermissionController({context:{subscriptions:[]},readActive:()=>active,writeActive:async v=>active=v,onConfiguration:()=>({dispose(){}}),registerCommand:()=>({dispose(){}}),client:()=>sdk,directories:()=>[cwd],resolve:()=>cwd,retry:fn=>fn(),showError:m=>{throw Error(m);},replyOnce:async(_,id,dir,guard)=>{if(!guard())return false;await api('/permission/'+id+'/reply',{reply:'once'});approvals++;return true;}});
 async function scenario(mode,kind,expected,switchToFull=false){
  await fs.writeFile(protectedFile,'before');
  const session=await api('/session',{title:mode+' '+kind});await ctrl.select(mode,session.id);
  await api('/session/'+session.id+'/prompt_async',{agent:'test',model:{providerID:'permission-test',modelID:'test'},parts:[{type:'text',text:'permission-case:'+kind}]});
  let handled=false,done=false,requestKind,sawProtected=false;
  for(let i=0;i<160;i++){
   const pending=(lastPending=await api('/permission')).filter(p=>p.sessionID===session.id);
   if(pending.length){const p=pending[0];requestKind=p.permission;sawProtected ||= p.metadata?.configProtected===true;handled=await ctrl.approve({properties:p},cwd);
    if(switchToFull){
     assert.equal(handled,false,'Auto must wait before accessing a folder outside the project');
     assert.equal(requestKind,'external_directory');
     const before=approvals;await ctrl.select('full',session.id);
     for(let j=0;j<50&&approvals===before;j++)await sleep(20);
     assert.equal(approvals,before+1,'Selecting Full access must resume the existing request without resending the prompt');
     handled=true;switchToFull=false;
    }
    if(expected==='ask'){assert.equal(handled,false);await sleep(150);assert((await api('/permission')).some(x=>x.id===p.id),'Request must remain pending for human approval');await api('/permission/'+p.id+'/reply',{reply:'reject'});handled=true;}
   }
   const messages=lastMessages=await api('/session/'+session.id+'/message');
   if(messages.some(m=>m.info.role==='assistant'&&(m.info.finish==='stop'||(expected!=='approve'&&m.info.time?.completed&&m.parts.some(p=>p.type==='tool'&&p.state?.status==='error'))))){done=true;break;}
   await sleep(100);
  }
  assert(done,mode+' '+kind+' did not finish. '+JSON.stringify({requestCount,lastPending,lastMessages}).slice(-6000)+' '+output.slice(-500));
  assert.equal(switchToFull,false,'The pending outside-folder request must exercise the mode change');
  if(expected!=='deny')assert(handled,mode+' '+kind+' missing expected approval request');
  if(kind.startsWith('protected-'))assert(sawProtected,'The real engine must flag the protected config request');
  if(expected==='approve')assert(lastMessages.flatMap(m=>m.parts).filter(p=>p.type==='tool').every(p=>p.state.status==='completed'),'Approved tools must actually complete');
  if(kind==='protected-edit')assert.equal(await fs.readFile(protectedFile,'utf8'),expected==='approve'?'after':'before');
  if(expected==='deny'){assert.equal(requestKind,undefined);await assert.rejects(fs.access(marker));}
  console.log('PASS native engine:',mode,kind,expected,requestKind??'no approval request');
 }
 await scenario('ask','ordinary','ask');
 await scenario('auto','ordinary','approve');
 await scenario('auto','outside','ask');
 await scenario('full','outside','approve');
 await scenario('auto','outside-shell','approve',true);
 await scenario('ask','protected-edit','ask');
 await scenario('auto','protected-edit','ask');
 await scenario('full','protected-edit','approve');
 await scenario('full','protected-shell','approve');
 await scenario('full','denied','deny');
 console.log('Native Kilo permissions verified with local simulated model; no live provider calls.');
}finally{
 if(kilo.exitCode===null){kilo.kill('SIGTERM');const timer=setTimeout(()=>kilo.kill('SIGKILL'),5000);await new Promise(r=>kilo.once('close',r));clearTimeout(timer);}
 fake.closeAllConnections();await new Promise(r=>fake.close(r));await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
