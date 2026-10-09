import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { clarify, cancel, contextFrom } from '../examples/patches/clarify-goal.cjs';
import { patch } from '../examples/patches/clarify-goal.mjs';

const input={text:'Explain this first; do not edit.',providerID:'test',modelID:'model',sessionID:'original',files:[]};
const fixedModel={providerID:'lithosai',modelID:'deepseek-ai/DeepSeek-V4.1-Flash-ultra'};
const fixedDefinition={capabilities:{input:{image:false}}};
let calls=[];
const client={provider:{list:async()=>({data:{all:[{id:'test',models:{model:{capabilities:{input:{image:true}}}}},{id:fixedModel.providerID,models:{[fixedModel.modelID]:fixedDefinition}}]}})},session:{
  messages:async args=>{calls.push(['history',args]);return {data:[{info:{role:'user'},parts:[{type:'text',text:'Fix the account layout.'},{type:'tool',text:'must not leak'}]}]};},
  create:async args=>{calls.push(['create',args]);return {data:{id:'temporary'}};},
  prompt:async args=>{calls.push(['prompt',args]);return {data:{parts:[{type:'text',text:'Explain the account layout issue without editing files.'}]}};},
  abort:async args=>{calls.push(['abort',args]);},delete:async args=>{calls.push(['delete',args]);}
}};
const result=await clarify(client,input,'/tmp');
assert.match(result.text,/without editing/);
assert.deepEqual(calls.map(c=>c[0]),['history','create','prompt','abort','delete']);
assert.deepEqual(calls[1][1].permission,[{permission:'*',pattern:'*',action:'deny'}]);
assert.deepEqual(calls[2][1].model,fixedModel);
assert.equal(result.model,`${fixedModel.providerID}/${fixedModel.modelID}`);
assert.equal(input.providerID,'test');assert.equal(input.modelID,'model','Main chat selection must stay unchanged');
assert.equal(calls[2][1].agent,'goal-clarifier');
assert(!calls[2][1].parts[0].text.includes('must not leak'));
assert(calls[2][1].system.includes('Ponytail'));
assert.equal(input.text,'Explain this first; do not edit.');
assert.equal(contextFrom(Array.from({length:100},()=>({info:{role:'user'},parts:[{type:'text',text:'x'.repeat(5000)}]}))).length,8);
assert(contextFrom([{parts:[{type:'text',text:'x'.repeat(5000)}]}])[0].text.length<=850);
for(const selection of [{providerID:'openai',modelID:'another-model'},{providerID:undefined,modelID:undefined}]) {
  calls=[];await clarify(client,{...input,...selection},'/tmp');
  assert.deepEqual(calls.find(c=>c[0]==='prompt')[1].model,fixedModel,'Always use the fixed clarification route');
}
const originalProviders=client.provider.list;
client.provider.list=async()=>({data:{all:[]}});calls=[];
await assert.rejects(()=>clarify(client,input,'/tmp'),/DeepSeek.*unavailable/);
assert.equal(calls.length,0,'Unavailable DeepSeek must not fall back to another model');
client.provider.list=originalProviders;
calls=[];
await assert.rejects(()=>clarify(client,{...input,files:[{mime:'image/png',url:'data:image/png;base64,AAA='}]},'/tmp'),/cannot read images/);
assert.equal(calls.length,0,'No history or generation when attachments cannot be understood');
fixedDefinition.capabilities.input.image=true;calls=[];
const image={mime:'image/png',url:'data:image/png;base64,AAA=',filename:'goal.png'};
await clarify(client,{...input,files:[image]},'/tmp');
assert.deepEqual(calls.find(c=>c[0]==='prompt')[1].parts[0],{type:'file',...image});
fixedDefinition.capabilities.input.image=false;
const originalPrompt=client.session.prompt;
client.session.prompt=async()=>{throw Error('Provider failed');};calls=[];
await assert.rejects(()=>clarify(client,input,'/tmp'),/Provider failed/);
assert.equal(calls.at(-1)[0],'delete');
client.session.prompt=async()=>({data:{parts:[{type:'tool',tool:'bash'},{type:'text',text:'done'}]}});
await assert.rejects(()=>clarify(client,input,'/tmp'),/tool call/);
client.session.prompt=originalPrompt;
// Cancellation is scoped to the composer/provider, never the original chat.
const owner={},otherOwner={},cancelInput={...input,requestId:'same-id'};
let signal,started;
const promptStarted=new Promise(resolve=>started=resolve);
client.session.prompt=async(args,options)=>{
  calls.push(['prompt',args]);signal=options.signal;started();
  return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
};
calls=[];
const stopped=clarify(client,cancelInput,'/tmp',owner);
const stoppedCheck=assert.rejects(stopped,{name:'AbortError'});
await promptStarted;
assert.equal(cancel(otherOwner,'same-id'),false,'Another composer cannot cancel this request');
await assert.rejects(()=>clarify(client,cancelInput,'/tmp',owner),/already running/);
assert.equal(cancel(owner,'same-id'),true);assert.equal(signal.aborted,true);
await stoppedCheck;
assert.deepEqual(calls.filter(c=>['abort','delete'].includes(c[0])).map(c=>c[1].sessionID),['temporary','temporary']);
assert.equal(cancel(owner,'same-id'),false,'Completed cancellation is idempotent');
client.session.prompt=originalPrompt;
await clarify(client,cancelInput,'/tmp',owner); // Same composer can restart.
client.provider.list=async(args,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
calls=[];
const early=clarify(client,cancelInput,'/tmp',owner),earlyCheck=assert.rejects(early,{name:'AbortError'});
assert.equal(cancel(owner,'same-id'),true);await earlyCheck;
assert.equal(calls.length,0,'Stopping during provider lookup must not create a session');
client.provider.list=originalProviders;
// Even a transport resolving late after Stop cannot deliver a result or leave its session behind.
let createStarted,finishCreate;
const creating=new Promise(resolve=>createStarted=resolve),originalCreate=client.session.create;
client.session.create=async()=>{createStarted();return new Promise(resolve=>finishCreate=resolve);};
calls=[];
const late=clarify(client,cancelInput,'/tmp',owner),lateCheck=assert.rejects(late,{name:'AbortError'});
await creating;cancel(owner,'same-id');finishCreate({data:{id:'late-temporary'}});await lateCheck;
assert.deepEqual(calls.filter(c=>['abort','delete'].includes(c[0])).map(c=>c[1].sessionID),['late-temporary','late-temporary']);
assert(!calls.some(c=>c[0]==='prompt'));
client.session.create=originalCreate;
assert.throws(()=>patch('unsupported','webview.js'),/Unsupported/);
const extensionAnchor='sdkClient.enhancePrompt.enhance({text:message6.text},{throwOnError:!0}).then(({data:data2})=>{this.postMessage({type:"enhancePromptResult",text:data2.text,requestId:message6.requestId})})';
const extensionFixture='switch(message6.type){case"enhancePrompt":{'+extensionAnchor+'.catch(err2=>{let raw2=getErrorMessage(err2)||"Failed to enhance prompt";});break}}';
const patched=patch(extensionFixture,'extension.js');assert.equal(patch(patched,'extension.js'),patched);assert(!patched.includes('enhancePrompt.enhance'));
assert(patched.includes('case"cancelEnhancePrompt"'));assert(patched.includes('enhancePromptCancelled'));
const ui=fs.readFileSync(new URL('../examples/patches/clarify-goal-ui.js',import.meta.url),'utf8');
const rendererFixture=kind=>{
  const [id,counter,finger,event]=kind==='webview.js'?['D','Oe','F','ze']:['I','Ve','R','Oe'];
  const fingerprint=`()=>JSON.stringify([${id}(),${finger}(${id}()),t.selected(g()),t.currentVariant(g()),f()])`;
  return '/* native-webview-recovery-client:v2 */\nfunction recovery() {}\n/* clarify-goal-patch:v1 */\n'+ui+'\n"use strict";\nfunction existing(){'+`globalThis.__kiloGoal.begin(w,(${fingerprint})(),${fingerprint});${event}.type==="enhancePromptError"&&J(!1);`+'}';
};
for(const kind of ['webview.js','agent-manager.js']) {
  const upgraded=patch(rendererFixture(kind),kind);
  assert(upgraded.startsWith('/* native-webview-recovery-client:v2 */\nfunction recovery() {}'));
  assert.equal(patch(upgraded,kind),upgraded,'Keep installed renderer recovery wrappers and cancellation on reinstall');
  assert(upgraded.includes('type:"cancelEnhancePrompt"'));
}
console.log('Clarify goal checks passed: fixed DeepSeek routing, no fallback, cancellation and restart, bounded context, denied tools, attachments, cleanup, idempotence and recovery compatibility.');

const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'clarify-installer-'));
try {
  const dist=path.join(fixture,'.vscode/extensions/shrikrishna-skg.kilo-code-local-7.8.2/dist');fs.mkdirSync(dist,{recursive:true});
  for(const file of ['extension.js','webview.js','agent-manager.js'])fs.writeFileSync(path.join(dist,file),file==='extension.js'?patched:rendererFixture(file));
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
    await page.setContent('<div class="prompt-input-container"><textarea id="draft">Keep my draft</textarea><button aria-label="Clarify goal" data-component="icon-button" data-variant="ghost" data-size="small"><span>✦</span></button></div><div id="attachment">image.png</div>');
    const extensions=path.join(os.homedir(),'.vscode/extensions');
    const version=fs.readdirSync(extensions).filter(n=>n.startsWith('shrikrishna-skg.kilo-code-local-')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).at(-1);
    // Exercise the actual disabled icon-button rules that caused the invisible label.
    await page.addStyleTag({path:path.join(extensions,version,'dist/webview.css')});
    await page.addScriptTag({content:fs.readFileSync(new URL('../examples/patches/clarify-goal-ui.js',import.meta.url),'utf8')});
    const clarifyButton=page.getByRole('button',{name:'Clarify goal',exact:true});
    const loading=async busy=>page.evaluate(busy=>{
      const b=document.querySelector('button[aria-label="Clarify goal"]');
      b.disabled=busy;b.setAttribute('aria-busy',String(busy));
      if(busy){
        b.setAttribute('data-loading','true');
        // Match Kilo's spinner and simulate its reactive replacement of the children.
        b.innerHTML='<svg class="icon-button-spinner" viewBox="0 0 15 15" fill="currentColor" style="width:16px;height:16px"><rect x="1" y="1" width="4" height="4" style="animation:pulse-opacity 1s ease-in-out infinite"/><rect x="6" y="6" width="4" height="4"/></svg>';
      }else{b.removeAttribute('data-loading');b.innerHTML='<span>✦</span>';}
    },busy);
    for(const [theme,foreground,background] of [['dark','#cccccc','#3c3c3c'],['light','#3b3b3b','#ffffff'],['high-contrast-dark','#ffffff','#000000'],['high-contrast-light','#000000','#ffffff']]) {
      await page.evaluate(({foreground,background})=>{
        document.documentElement.style.cssText=`--vscode-input-foreground:${foreground};--vscode-input-background:${background};--vscode-foreground:${foreground};--vscode-editor-background:${background};--icon-invert-base:${background}`;
        document.body.style.cssText=`background:${background};color:${foreground};padding:16px;`;
      },{foreground,background});
      for(const width of [900,320]) {
        await page.setViewportSize({width,height:500});await loading(true);
        await page.waitForFunction(()=>document.querySelector('.kilo-clarify-label')?.textContent==='Clarifying goal…');
        assert(await clarifyButton.isDisabled(),'Loading must still prevent duplicate requests');
        const appearance=await clarifyButton.evaluate(b=>{
          const label=b.querySelector('.kilo-clarify-label'),spinner=b.querySelector('svg'),style=getComputedStyle(b),box=b.getBoundingClientRect();
          const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);
          const luminance=color=>rgb(color).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
          const fg=luminance(getComputedStyle(label).color),bg=luminance(style.backgroundColor);
          return {contrast:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05),opacity:style.opacity,spinnerColor:getComputedStyle(spinner).color,labelColor:getComputedStyle(label).color,fits:b.scrollWidth<=b.clientWidth&&box.right<=innerWidth,labelCount:b.querySelectorAll('.kilo-clarify-label').length,animations:spinner.getAnimations({subtree:true}).length};
        });
        assert(appearance.contrast>=4.5,`${theme}: loading text contrast ${JSON.stringify(appearance)}`);
        assert.equal(appearance.opacity,'1');assert.equal(appearance.spinnerColor,appearance.labelColor);
        assert(appearance.fits,`${theme}: loading label must not be clipped at ${width}px`);assert.equal(appearance.labelCount,1);
        assert(appearance.animations>0,'The native loading indicator must animate');
        if(process.env.CLARIFY_GOAL_SCREENSHOTS){fs.mkdirSync(process.env.CLARIFY_GOAL_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.CLARIFY_GOAL_SCREENSHOTS,`${theme}-${width}.png`)});}
      }
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await clarifyButton.locator('svg').evaluate(e=>e.getAnimations({subtree:true}).length),0,'Respect reduced motion without hiding the status');
    assert.equal(await clarifyButton.locator('.kilo-clarify-label').textContent(),'Clarifying goal…');
    await page.emulateMedia({forcedColors:'active'});
    assert.equal(await clarifyButton.evaluate(e=>getComputedStyle(e).borderTopStyle),'solid');
    assert(await clarifyButton.isVisible());
    await page.emulateMedia({reducedMotion:'no-preference',forcedColors:'none'});
    await loading(false);await page.waitForFunction(()=>document.querySelector('.kilo-clarify-label')?.textContent==='Clarify goal');
    assert(await clarifyButton.isEnabled());
    await clarifyButton.focus();assert.equal(await clarifyButton.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
    console.log('Loading visibility checks passed: real Kilo CSS, four themes, 320/900px widths, reactive rerender, contrast, animation, reduced motion, forced colors, focus and reset.');
    const begin=()=>page.evaluate(()=>{
      const field=document.getElementById('draft');
      window.stoppedIds=[];
      window.__kiloGoal.begin(field,field.value,()=>field.value,{requestId:'stop-test',cancel:id=>window.stoppedIds.push(id)});
    });
    await begin();
    assert.match(await page.locator('.kilo-goal-preview').textContent(),/DeepSeek V4.1 Flash Ultra · LithosAI/);
    const stopButton=page.getByRole('button',{name:'Stop',exact:true});
    assert(await stopButton.isVisible());await stopButton.focus();await stopButton.press('Enter');
    assert(await stopButton.isDisabled());
    assert.match(await page.locator('.kilo-goal-preview').getByRole('status').textContent(),/Stopping/);
    assert.deepEqual(await page.evaluate(()=>window.stoppedIds),['stop-test']);
    await page.evaluate(()=>{
      const field=document.getElementById('draft');
      window.__kiloGoal.preview(field,{text:'Late unwanted result'},()=>{throw Error('Must not apply');});
      window.__kiloGoal.error(field,'Late error must be ignored','stop-test');
      window.__kiloGoal.cancelled(field,'wrong-request');
    });
    assert.match(await page.locator('.kilo-goal-preview').getByRole('status').textContent(),/Stopping/);
    await page.evaluate(()=>window.__kiloGoal.cancelled(document.getElementById('draft'),'stop-test'));
    assert.match(await page.locator('.kilo-goal-preview').textContent(),/Clarification stopped/);
    assert.equal(await page.locator('#draft').inputValue(),'Keep my draft');
    assert.equal(await page.locator('#attachment').textContent(),'image.png');
    await page.getByRole('button',{name:'Dismiss',exact:true}).click();
    await page.evaluate(()=>window.__kiloGoal.error(document.getElementById('draft'),'Add a message describing your goal first.'));
    assert.match(await page.getByRole('alert').textContent(),/Add a message/,'Validation still works after cancellation');
    await begin();assert(await stopButton.isEnabled(),'A new clarification can start after Stop');
    await page.evaluate(()=>{
      const field=document.getElementById('draft');
      window.__kiloGoal.preview(field,{text:'New result',model:'DeepSeek',attachments:1,contextMessages:0},()=>{});
    });
    assert.equal(await stopButton.count(),0,'Finished request has no stale Stop control');
    console.log('Stop UI checks passed: visible model/status, keyboard activation, single cancel, late replies ignored, acknowledgment, draft/attachments retained and restart.');
    const setup=async()=>page.evaluate(()=>{
      const field=document.getElementById('draft');
      window.__kiloGoal.begin(field,field.value,()=>field.value);
      window.__kiloGoal.preview(field,{text:'A clearer goal',model:'test/model',attachments:1,contextMessages:2},text=>{field.value=text;});
    });
    await setup();assert.equal(await page.locator('#draft').inputValue(),'Keep my draft');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('#draft').inputValue(),'Keep my draft');
    await setup();await page.locator('#draft').fill('Newer edit');await page.getByRole('button',{name:'Use this prompt',exact:true}).click();
    assert.equal(await page.locator('#draft').inputValue(),'Newer edit');assert.match(await page.locator('.kilo-goal-preview').getByRole('status').textContent(),/changed/);
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
