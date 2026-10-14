// Opt-in: sends synthetic test packets to the real JEV service through the installed MCP bridge.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
if(!process.argv.includes('--run'))throw Error('Pass --run to authorize real JEV test requests. No private project data is sent.');
const reportFlag=process.argv.indexOf('--report');
const reportFile=reportFlag<0?null:path.resolve(process.argv[reportFlag+1]);
const bridge=path.join(os.homedir(),'.config/kilo/bridges/typesafe-mcp.mjs');
const samples=[
 {name:'mixed-evidence',input:{purpose:'evidence_check',task:'Assess the synthetic search widget test.',evidence:'Observed: the input is labelled Search. Pressing Escape left the query unchanged. No cancellation test was performed.',claims:'The developer claims that Escape clears the query and cancellation works.',requirements:[{id:'label',text:'The input label is Search.'},{id:'escape',text:'Escape clears the query.'},{id:'cancel',text:'Cancellation works.'}]},expected:{label:'supported',escape:'contradicted',cancel:'insufficient'}},
 {name:'worker-claims',input:{purpose:'evidence_check',task:'Assess a synthetic parser change.',evidence:'The only observed test is parse("12") returning 12. No empty-input or Unicode test was run.',claims:'The worker says empty input and Unicode are correct.',requirements:[{id:'number',text:'parse("12") returns 12.'},{id:'empty',text:'Empty input is handled correctly.'},{id:'unicode',text:'Unicode input is handled correctly.'}]},expected:{number:'supported',empty:'insufficient',unicode:'insufficient'}},
 {name:'eight-requirements',input:{purpose:'evidence_check',task:'Assess eight independent synthetic UI requirements.',evidence:'Observed test results: the title is Overview; the Save button is visible; Tab moves keyboard focus to Save; Save retains data after reload. The Cancel button is absent. The layout overflows horizontally at 390 pixels. No screen-reader test or offline test has been run.',requirements:[{id:'title',text:'The title is Overview.'},{id:'save',text:'Save is visible.'},{id:'keyboard',text:'Tab reaches Save.'},{id:'persist',text:'Saved data survives reload.'},{id:'cancel',text:'Cancel is visible.'},{id:'mobile',text:'The layout has no horizontal overflow at 390 pixels.'},{id:'reader',text:'The screen-reader flow works.'},{id:'offline',text:'The offline flow works.'}]},expected:{title:'supported',save:'supported',keyboard:'supported',persist:'supported',cancel:'contradicted',mobile:'contradicted',reader:'insufficient',offline:'insufficient'}},
 {name:'tiny-direct-task',input:{purpose:'next_step',task:'Explain what the existing Save button does. No edits or extra investigation are requested.',evidence:'The button writes the current draft to local storage and shows Saved. This behavior is established in the supplied code and test.',constraints:'Answer directly; no implementation or additional workers needed.'},expected:{next_step:'direct'}},
];
const child=spawn(process.execPath,[bridge],{stdio:['pipe','pipe','pipe']});
const pending=new Map(),results=[];let id=0,stderr='';
child.stderr.on('data',b=>stderr+=b.toString());
createInterface({input:child.stdout}).on('line',line=>{
 let data;try{data=JSON.parse(line)}catch{return}
 const entry=pending.get(data.id);if(entry){pending.delete(data.id);clearTimeout(entry.timer);entry.resolve(data)}
});
child.on('exit',()=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('Bridge exited unexpectedly'))}pending.clear()});
function rpc(method,params,requestID=++id){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{pending.delete(requestID);reject(Error('MCP response deadline exceeded'))},12000);
 pending.set(requestID,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:requestID,method,params})+'\n');
})}
async function check(sample,round){
 const start=performance.now();const response=await rpc('tools/call',{name:'evaluate_work',arguments:sample.input});
 const result=JSON.parse(response.result?.content?.[0]?.text??'{}');
 const item={case:sample.name,round,status:result.status,reason:result.reason,api_ms:result.elapsed_ms,mcp_ms:Math.round(performance.now()-start),answers:Object.fromEntries(Object.entries(result.answers??{}).map(([k,v])=>[k,v.choice])),usage:result.usage};
 item.pass=result.status==='advice'&&result.advisory_only===true&&Object.entries(sample.expected).every(([k,v])=>item.answers[k]===v);
 results.push(item);console.log(JSON.stringify(item));
}
try{
 const hello=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'isolated-jev-verification',version:'1'}});assert(hello.result?.serverInfo);
 const list=await rpc('tools/list',{});assert(list.result.tools.some(t=>t.name==='evaluate_work'));
 for(const sample of samples)await check(sample,1);
 // At most two concurrent requests, matching the bridge's existing admission limit.
 for(let i=0;i<samples.length;i+=2)await Promise.all(samples.slice(i,i+2).map(sample=>check(sample,2)));
 const cancellationID=++id,start=performance.now();
 const cancelled=rpc('tools/call',{name:'evaluate_work',arguments:samples[2].input},cancellationID);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:cancellationID}})+'\n');
 const response=await cancelled;const cancellation=JSON.parse(response.result?.content?.[0]?.text??'{}');
 results.push({case:'mcp-cancellation',status:cancellation.status,reason:cancellation.reason,mcp_ms:Math.round(performance.now()-start),pass:cancellation.reason==='timeout_or_cancelled'});
 await check(samples[0],'after-cancellation');
 const report={passed:results.every(x=>x.pass),timestamp:new Date().toISOString(),bridge,api_timeout_ms:5000,results};
 if(reportFile){fs.mkdirSync(path.dirname(reportFile),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n')}
 assert(report.passed,'One or more live checks failed; inspect the recorded results.');
 console.log('Live JEV checks passed: synthetic evidence, next-step routing, concurrent calls, MCP cancellation and recovery.');
}finally{
 child.stdin.end();if(child.exitCode===null)child.kill('SIGTERM');
 for(const entry of pending.values())clearTimeout(entry.timer);
 if(stderr)console.error('Bridge stderr was present; raw content omitted.');
}
