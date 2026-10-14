// Offline persistence check. All restarts and extension replacement use a temporary directory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-persistence-'));
const bridge=path.join(root,'config/kilo/bridges/typesafe-mcp.mjs');
const configFile=path.join(root,'config/kilo/kilo.json');
const extensions=path.join(root,'extensions');
const run=(bin,args,options={})=>{
 const result=spawnSync(bin,args,{encoding:'utf8',timeout:15000,...options});
 assert.equal(result.status,0,result.error?.message||result.stderr);return result.stdout;
};
try{
 fs.mkdirSync(path.dirname(bridge),{recursive:true});fs.mkdirSync(extensions);
 fs.copyFileSync(new URL('../examples/bridges/typesafe-mcp.mjs',import.meta.url),bridge);
 const template=JSON.parse(fs.readFileSync(new URL('../examples/kilo.jsonc',import.meta.url),'utf8').replace(/^\s*\/\/.*$/gm,''));
 fs.writeFileSync(configFile,JSON.stringify({mcp:{TypeSafe:{...template.mcp.TypeSafe,command:[process.execPath,bridge]}}}));
 const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const before=[digest(configFile),digest(bridge)];
 const probe=`import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
 const cfg=JSON.parse(fs.readFileSync(process.argv[1],'utf8')).mcp.TypeSafe;
 assert.equal(cfg.timeout,10000);const {evaluate}=await import(pathToFileURL(cfg.command[1]));
 const result=await evaluate({purpose:'next_step',task:'Explain a known setting',evidence:'No code change is needed'}, {key:'synthetic',fetcher:async(_url,{signal})=>{
  await new Promise((resolve,reject)=>{const t=setTimeout(resolve,1200);signal.addEventListener('abort',()=>{clearTimeout(t);reject(signal.reason)},{once:true})});
  return Response.json({model:'jev-1.13.0',answers:{next_step:{type:'choice',choice:'direct',confidence:1,probabilities:{investigate:0,implement:0,verify:0,coordinate:0,direct:1}}},usage:{input_tokens:1,output_tokens:1}});
 }});assert.equal(result.status,'advice');`;
 for(const phase of ['initial launch','process restart','extension replacement']){
  if(phase==='extension replacement'){fs.rmSync(extensions,{recursive:true});fs.mkdirSync(path.join(extensions,'kilo-new-version'),{recursive:true});fs.writeFileSync(path.join(extensions,'kilo-new-version/package.json'),'{"version":"next"}');}
  run(process.execPath,['--input-type=module','-e',probe,configFile]);
  assert.deepEqual([digest(configFile),digest(bridge)],before,'Extension replacement must not change external JEV files');
  console.log('PASS:',phase,'keeps 5-second API behavior and 10-second MCP setting');
 }
 const i=process.argv.indexOf('--kilo');
 if(i>=0){
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('KILO_')||key.startsWith('OPENCODE_'))delete env[key];
  for(const name of ['config','data','cache','state']){env['XDG_'+name.toUpperCase()+'_HOME']=path.join(root,name);fs.mkdirSync(path.join(root,name,'kilo'),{recursive:true})}
  env.KILO_DISABLE_MODELS_FETCH='true';env.KILO_DISABLE_PROJECT_CONFIG='true';
  const output=run(process.argv[i+1],['debug','config','--pure'],{cwd:root,env});
  const resolved=JSON.parse(output);assert.equal(resolved.mcp.TypeSafe.timeout,10000);assert.equal(resolved.mcp.TypeSafe.command[1],bridge);
  console.log('PASS: fresh installed Kilo process resolves the persisted external JEV configuration');
 }
}finally{fs.rmSync(root,{recursive:true,force:true})}
