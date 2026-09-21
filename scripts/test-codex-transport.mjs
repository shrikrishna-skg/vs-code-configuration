import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(os.tmpdir(), 'codex-transport-test-'));
const fake = path.join(root, 'kilo');
await writeFile(fake, `#!/usr/bin/env node
let input=''; process.stdin.on('data',c=>input+=c); process.stdin.on('end',()=>{
 if(input.includes('FAIL_CLI')) {process.stderr.write('fixture CLI failure');process.exit(2);}
 if(input.includes('CANCEL_CLI')) { process.on('SIGTERM',()=>{require('fs').writeFileSync(${JSON.stringify(path.join(root,'cancelled'))},'yes');process.exit(0)}); setInterval(()=>{},1000);return; }
 console.log(JSON.stringify({type:'text',part:{text:'fixture complete'}}));
 console.log(JSON.stringify({type:'step_finish',part:{reason:'stop',tokens:{input:4,output:2}}}));
});
`, {mode:0o700});
const server = spawn(process.execPath,['examples/codex-router/router.mjs'],{env:{...process.env,CODEX_CLAUDE_ROUTER_PORT:'0',CODEX_KILO_BINARY:fake},stdio:['ignore','pipe','pipe']});
let errors=''; server.stderr.on('data',c=>errors+=c);
try {
 const address=await new Promise((resolve,reject)=>{
  let text='';server.stdout.on('data',c=>{text+=c;const match=text.match(/http:\/\/127.0.0.1:(\d+)/);if(match)resolve('http://127.0.0.1:'+match[1]);});
  server.on('error',reject);server.on('exit',code=>reject(new Error('router exited '+code+' '+errors)));
 });
 const catalog=await (await fetch(address+'/v1/models')).json();
 for(const slug of ['astra-engineering-lead','deepseek-high','glm-high','claude-opus-5']) assert.equal(catalog.models.filter(m=>m.slug===slug).length,1);
 assert.ok(catalog.models.some(m=>m.slug.startsWith('gpt-')));
 const request=(model,text,extra={})=>fetch(address+'/v1/responses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,stream:true,input:[{type:'message',role:'user',content:[{type:'input_text',text}]}],...extra})});
 for(const slug of ['astra-engineering-lead','deepseek-high','glm-high']){
  const result=await request(slug,`<cwd>${root}</cwd> success`);
  const stream=await result.text();
  assert.equal(result.status,200);
  assert.match(stream,/response.completed/);assert.match(stream,/fixture complete/);
  const events=stream.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
  assert.equal(events.at(-1).response.model,slug);
 }
 assert.equal((await request('deepseek-high','no workspace')).status,500);
 assert.equal((await request('glm-high',`<cwd>${root}</cwd>`,{reasoning:{effort:'ultra'}})).status,500);
 const failure=await (await request('deepseek-high',`<cwd>${root}</cwd> FAIL_CLI`)).text();
 assert.match(failure,/response.failed/);assert.doesNotMatch(failure,/response.completed/);
 const image=await request('glm-high','',{input:[{type:'message',role:'user',content:[{type:'input_image',image_url:'data:image/png;base64,AA=='}]}]});
 assert.equal(image.status,500);
 const abort=new AbortController();
 const pending=await fetch(address+'/v1/responses',{method:'POST',signal:abort.signal,headers:{'content-type':'application/json'},body:JSON.stringify({model:'deepseek-high',input:[{type:'message',role:'user',content:[{type:'input_text',text:`<cwd>${root}</cwd> CANCEL_CLI`}]}]})});
 await new Promise(resolve=>setTimeout(resolve,500));
 abort.abort();
 for(let attempt=0;attempt<30;attempt++){try{assert.equal(await readFile(path.join(root,'cancelled'),'utf8'),'yes');break;}catch(error){if(attempt===29)throw error;await new Promise(resolve=>setTimeout(resolve,100));}}
 console.log('Transport checks passed: catalog, all three routes, SSE completion/failure, workspace, effort, image rejection, cancellation.');
} finally { server.kill('SIGTERM'); }
