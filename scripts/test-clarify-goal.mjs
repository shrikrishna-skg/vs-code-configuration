import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { clarify, contextFrom } from '../examples/patches/clarify-goal.cjs';
import { patch } from '../examples/patches/clarify-goal.mjs';

const input={text:'Explain this first; do not edit.',providerID:'test',modelID:'model',sessionID:'original',files:[]};
let calls=[];
const client={provider:{list:async()=>({data:{all:[{id:'test',models:{model:{capabilities:{input:{image:false}}}}}]}})},session:{
  messages:async args=>{calls.push(['history',args]);return {data:[{info:{role:'user'},parts:[{type:'text',text:'Fix the account layout.'},{type:'tool',text:'must not leak'}]}]};},
  create:async args=>{calls.push(['create',args]);return {data:{id:'temporary'}};},
  prompt:async args=>{calls.push(['prompt',args]);return {data:{parts:[{type:'text',text:'Explain the account layout issue without editing files.'}]}};},
  abort:async args=>{calls.push(['abort',args]);},delete:async args=>{calls.push(['delete',args]);}
}};
const result=await clarify(client,input,'/tmp');
assert.match(result.text,/without editing/);
assert.deepEqual(calls.map(c=>c[0]),['history','create','prompt','abort','delete']);
assert.deepEqual(calls[1][1].permission,[{permission:'*',pattern:'*',action:'deny'}]);
assert.equal(calls[2][1].model.modelID,'model');
assert.equal(calls[2][1].agent,'goal-clarifier');
assert(!calls[2][1].parts[0].text.includes('must not leak'));
assert(calls[2][1].system.includes('Ponytail'));
assert.equal(input.text,'Explain this first; do not edit.');
assert.equal(contextFrom(Array.from({length:100},()=>({info:{role:'user'},parts:[{type:'text',text:'x'.repeat(5000)}]}))).length,8);
assert(contextFrom([{parts:[{type:'text',text:'x'.repeat(5000)}]}])[0].text.length<=850);
calls=[];
await assert.rejects(()=>clarify(client,{...input,files:[{mime:'image/png',url:'data:image/png;base64,AAA='}]},'/tmp'),/cannot read images/);
assert.equal(calls.length,0,'No history or generation when attachments cannot be understood');
const originalPrompt=client.session.prompt;
client.session.prompt=async()=>{throw Error('Provider failed');};calls=[];
await assert.rejects(()=>clarify(client,input,'/tmp'),/Provider failed/);
assert.equal(calls.at(-1)[0],'delete');
client.session.prompt=async()=>({data:{parts:[{type:'tool',tool:'bash'},{type:'text',text:'done'}]}});
await assert.rejects(()=>clarify(client,input,'/tmp'),/tool call/);
client.session.prompt=originalPrompt;
assert.throws(()=>patch('unsupported','webview.js'),/Unsupported/);
const extensionAnchor='sdkClient.enhancePrompt.enhance({text:message6.text},{throwOnError:!0}).then(({data:data2})=>{this.postMessage({type:"enhancePromptResult",text:data2.text,requestId:message6.requestId})})';
const patched=patch(extensionAnchor,'extension.js');assert.equal(patch(patched,'extension.js'),patched);assert(!patched.includes('enhancePrompt.enhance'));
console.log('Clarify goal checks passed: selected model, bounded context, denied tools, attachment capability gate, cleanup, idempotence.');

const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'clarify-installer-'));
try {
  const dist=path.join(fixture,'.vscode/extensions/shrikrishna-skg.kilo-code-local-7.8.2/dist');fs.mkdirSync(dist,{recursive:true});
  for(const file of ['extension.js','webview.js','agent-manager.js'])fs.writeFileSync(path.join(dist,file),'/* clarify-goal-patch:v1 */\n'+(file==='extension.js'?'':fs.readFileSync(new URL('../examples/patches/clarify-goal-ui.js',import.meta.url),'utf8')+'\n"use strict";\n'));
  const config=path.join(fixture,'.config/kilo/kilo.jsonc');fs.mkdirSync(path.dirname(config),{recursive:true});
  const originalConfig=JSON.stringify({model:'keep/model',permission:{bash:'ask'},provider:{keep:{apiKey:'test-only-placeholder'}}});fs.writeFileSync(config,originalConfig);
  const policy=path.join(fixture,'.config/ponytail/AGENTS.md');fs.mkdirSync(path.dirname(policy),{recursive:true});fs.writeFileSync(policy,'test policy');
  const run=(...args)=>execFileSync(process.execPath,[new URL('./install-clarify-goal.mjs',import.meta.url).pathname,...args],{env:{...process.env,CLARIFY_GOAL_HOME:fixture},encoding:'utf8',stdio:['ignore','pipe','pipe']});
  run();assert.equal(fs.readFileSync(config,'utf8'),originalConfig);
  const install=run('--apply'),backup=install.match(/Backup: (.+)/)[1],applied=JSON.parse(fs.readFileSync(config,'utf8'));
  assert.equal(applied.model,'keep/model');assert.equal(applied.permission.bash,'ask');assert.equal(applied.provider.keep.apiKey,'test-only-placeholder');
  assert.deepEqual(applied.agent['goal-clarifier'].permission,{'*':'deny'});assert.equal(applied.agent['goal-clarifier'].steps,2);
  assert.deepEqual(JSON.parse(run()).files,[]);
  const installed=fs.readFileSync(config,'utf8');fs.appendFileSync(config,' ');
  assert.throws(()=>run('--restore',backup),/Changed after install/);
  fs.writeFileSync(config,installed);run('--restore',backup);assert.equal(fs.readFileSync(config,'utf8'),originalConfig);
  console.log('Clarify installer checks passed: dry-run, preserved configuration, no-op reinstall, drift refusal, restoration.');
} finally {fs.rmSync(fixture,{recursive:true,force:true});}

if(process.argv.includes('--ui')) {
  const require=createRequire(path.join(os.homedir(),'.config/shared-computer/runtime/package.json'));
  const {chromium}=require('playwright');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:900,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<div class="prompt-input-container"><textarea id="draft">Keep my draft</textarea><button aria-label="Clarify goal"><span>✦</span></button></div><div id="attachment">image.png</div>');
    await page.addScriptTag({content:fs.readFileSync(new URL('../examples/patches/clarify-goal-ui.js',import.meta.url),'utf8')});
    const setup=async()=>page.evaluate(()=>{
      const field=document.getElementById('draft');
      window.__kiloGoal.begin(field,field.value,()=>field.value);
      window.__kiloGoal.preview(field,{text:'A clearer goal',model:'test/model',attachments:1,contextMessages:2},text=>{field.value=text;});
    });
    await setup();assert.equal(await page.locator('#draft').inputValue(),'Keep my draft');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('#draft').inputValue(),'Keep my draft');
    await setup();await page.locator('#draft').fill('Newer edit');await page.getByRole('button',{name:'Use this prompt',exact:true}).click();
    assert.equal(await page.locator('#draft').inputValue(),'Newer edit');assert.match(await page.getByRole('status').textContent(),/changed/);
    await setup();await page.getByRole('textbox',{name:'Editable clarified prompt'}).fill('Reviewed goal');
    await page.getByRole('button',{name:'Use this prompt',exact:true}).click();assert.equal(await page.locator('#draft').inputValue(),'Reviewed goal');
    assert.equal(await page.locator('#attachment').textContent(),'image.png');
    await setup();await page.getByRole('textbox',{name:'Editable clarified prompt'}).press('Escape');assert.equal(await page.locator('.kilo-goal-preview').count(),0);
    await setup();await page.getByRole('textbox',{name:'Editable clarified prompt'}).fill('<script>throw Error("unsafe")</script>');
    assert.equal(await page.locator('.kilo-goal-preview script').count(),0);
    await page.setViewportSize({width:390,height:900});
    const fits=await page.locator('.kilo-goal-preview').evaluate(e=>e.scrollWidth<=e.clientWidth);assert(fits);
    await page.locator('.prompt-input-container').evaluate(e=>e.remove());assert.equal(await page.locator('.kilo-goal-preview').count(),0,'Preview must leave with its composer');
    assert.deepEqual(errors,[]);
    console.log('Clarify goal UI checks passed: preview, cancel, editable apply, stale draft guard, attachments retained, Escape, safe text, narrow layout.');
  } finally {await browser.close();}
}
