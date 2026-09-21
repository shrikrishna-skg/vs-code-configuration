import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(os.tmpdir(), 'codex-transport-test-'));
const attachmentDirsBefore = new Set((await readdir(os.tmpdir())).filter(name=>name.startsWith('codex-router-images-')));
const upstream=http.createServer(async(request,response)=>{
 const chunks=[];for await(const chunk of request)chunks.push(chunk);
 const body=JSON.parse(Buffer.concat(chunks));
 const original={id:'resp_native',object:'response',status:'completed',model:body.model,output:[],usage:{input_tokens:5,output_tokens:20,total_tokens:25}};
 response.writeHead(200,{'content-type':'text/event-stream'});
 response.write('event: response.created\ndata: '+JSON.stringify({type:'response.created',response:{...original,status:'in_progress',output:[],usage:null},sequence_number:0})+'\n\n');
 response.end('event: response.completed\ndata: '+JSON.stringify({type:'response.completed',response:original,sequence_number:1})+'\n\n');
});
await new Promise((resolve,reject)=>{upstream.once('error',reject);upstream.listen(0,'127.0.0.1',resolve);});
const upstreamUrl=`http://127.0.0.1:${upstream.address().port}/responses`;
const fake = path.join(root, 'kilo');
await writeFile(fake, `#!/usr/bin/env node
let input=''; process.stdin.on('data',c=>input+=c); process.stdin.on('end',()=>{
 if(input.includes('FAIL_CLI')) {process.stderr.write('fixture CLI failure');process.exit(2);}
 if(input.includes('CANCEL_CLI')) { process.on('SIGTERM',()=>{require('fs').writeFileSync(${JSON.stringify(path.join(root,'cancelled'))},'yes');process.exit(0)}); setInterval(()=>{},1000);return; }
 const fileIndex=process.argv.indexOf('--file');
 if(fileIndex>=0&&!require('fs').statSync(process.argv[fileIndex+1]).isFile()) process.exit(3);
 console.log(JSON.stringify({type:'text',part:{text:fileIndex>=0?'fixture image complete':'fixture complete'}}));
 console.log(JSON.stringify({type:'step_finish',part:{reason:'stop',tokens:{input:4,output:2}}}));
});
`, {mode:0o700});
const server = spawn(process.execPath,['examples/codex-router/router.mjs'],{env:{...process.env,CODEX_CLAUDE_ROUTER_PORT:'0',CODEX_KILO_BINARY:fake,CODEX_OPENAI_RESPONSES_URL:upstreamUrl},stdio:['ignore','pipe','pipe']});
let errors=''; server.stderr.on('data',c=>errors+=c);
let serverOutput=''; server.stdout.on('data',c=>serverOutput+=c);
try {
 const address=await new Promise((resolve,reject)=>{
   let text='';server.stdout.on('data',c=>{text+=c;const match=text.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match)resolve('http://127.0.0.1:'+match[1]);});
  server.on('error',reject);server.on('exit',code=>reject(new Error('router exited '+code+' '+errors)));
 });
 const catalog=await (await fetch(address+'/v1/models')).json();
 for(const slug of ['astra-engineering-lead','deepseek-high','glm-high','claude-opus-5']) assert.equal(catalog.models.filter(m=>m.slug===slug).length,1);
 for(const slug of ['astra-engineering-lead','deepseek-high','glm-high']) assert.deepEqual(catalog.models.find(m=>m.slug===slug).input_modalities,['text','image']);
 assert.ok(catalog.models.some(m=>m.slug.startsWith('gpt-')));
 const request=(model,text,extra={})=>fetch(address+'/v1/responses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,stream:true,input:[{type:'message',role:'user',content:[{type:'input_text',text}]}],...extra})});
 for(const slug of ['astra-engineering-lead','deepseek-high','glm-high']){
  const result=await request(slug,`<cwd>${root}</cwd> success`);
  const stream=await result.text();
  assert.equal(result.status,200);
  assert.match(stream,/response.completed/);assert.match(stream,/fixture complete/);
  assert.match(stream,/⚡ \*\*\d+\.\d tok\/s\*\* · 2 output tokens · \d+\.\ds/);
  const events=stream.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
  assert.equal(events.at(-1).response.model,slug);
 }
 for(const slug of ['astra-engineering-lead','deepseek-high','glm-high']) assert.match(serverOutput,new RegExp(`route=${slug} output_tokens=2 elapsed=\\d+\\.\\ds tok/s=`));
 const native=await request('gpt-5.6-sol','native success');
 const nativeStream=await native.text();
 assert.equal(native.status,200);assert.match(nativeStream,/⚡ \*\*\d+\.\d tok\/s\*\* · 20 output tokens · \d+\.\ds/);
 const nativeEvents=nativeStream.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
 assert.equal(nativeEvents.at(-1).type,'response.completed');
 assert.equal(nativeEvents.at(-1).response.output.at(-1).content[0].text.includes('tok/s'),true);
 assert.match(serverOutput,/route=gpt-5\.6-sol output_tokens=20 elapsed=\d+\.\ds tok\/s=/);
 assert.equal((await request('deepseek-high','no workspace')).status,500);
 assert.equal((await request('glm-high',`<cwd>${root}</cwd>`,{reasoning:{effort:'ultra'}})).status,500);
 const failure=await (await request('deepseek-high',`<cwd>${root}</cwd> FAIL_CLI`)).text();
 assert.match(failure,/response.failed/);assert.doesNotMatch(failure,/response.completed/);
 const image=await request('deepseek-high','',{input:[{type:'message',role:'user',content:[{type:'input_text',text:`<cwd>${root}</cwd> inspect image`},{type:'input_image',image_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='}]}]});
 const imageStream=await image.text();
 assert.equal(image.status,200);assert.match(imageStream,/fixture image complete/);assert.match(imageStream,/response.completed/);
 const unsupported=await request('deepseek-high','',{input:[{type:'message',role:'user',content:[{type:'input_text',text:`<cwd>${root}</cwd>`},{type:'input_image',image_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='},{type:'input_image',image_url:'data:image/svg+xml;base64,AA=='}]}]});
 assert.equal(unsupported.status,500);
 assert.deepEqual((await readdir(os.tmpdir())).filter(name=>name.startsWith('codex-router-images-')&&!attachmentDirsBefore.has(name)),[]);
 const abort=new AbortController();
 const pending=await fetch(address+'/v1/responses',{method:'POST',signal:abort.signal,headers:{'content-type':'application/json'},body:JSON.stringify({model:'deepseek-high',input:[{type:'message',role:'user',content:[{type:'input_text',text:`<cwd>${root}</cwd> CANCEL_CLI`}]}]})});
 await new Promise(resolve=>setTimeout(resolve,500));
 abort.abort();
 for(let attempt=0;attempt<30;attempt++){try{assert.equal(await readFile(path.join(root,'cancelled'),'utf8'),'yes');break;}catch(error){if(attempt===29)throw error;await new Promise(resolve=>setTimeout(resolve,100));}}
 console.log('Transport checks passed: catalog, native and local TPS, all three routes, SSE completion/failure, workspace, effort, image attachment, cancellation.');
} finally { server.kill('SIGTERM');upstream.close(); }
