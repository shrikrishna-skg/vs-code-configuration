// Exact v6 library with real DOM interaction in an isolated, offline browser profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {patchWebview,patchCss,stableLibrary} from './prompt-suggestions.mjs';
import {patch as permissions} from './permission-modes.mjs';
import {patch as pin} from './pinned-append.mjs';
import {patch as chevrons} from './composer-chevrons.mjs';
const stock=new URL('../stock/extension/dist/',import.meta.url),js=fs.readFileSync(new URL('webview.js',stock),'utf8'),css=fs.readFileSync(new URL('webview.css',stock),'utf8');
const patched=patchWebview(js),styled=patchCss(css);new vm.Script(patched);
assert.equal(patchWebview(patched),patched);assert.equal(patchWebview(patched,true),js);assert.equal(patchWebview(js,true),js);
assert.equal(patchCss(styled),styled);assert.equal(patchCss(styled,true),css);assert.throws(()=>patchWebview(js+js));assert.throws(()=>patchWebview('unsupported'));
const composed=pin(permissions(patched,'webview.js'));assert.equal(patchWebview(composed),composed);assert.equal(pin(composed),composed);assert.equal(chevrons(composed),composed);new vm.Script(composed);
const require=createRequire(process.env.KILO_BROWSER_RUNTIME||path.join(os.homedir(),'.config/shared-computer/runtime/package.json'));
const {chromium}=require('playwright'),browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage(),errors=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.fulfill({status:200,body:''}));await page.goto('http://localhost:41739/');
  await page.setContent('<html><head></head><body style="padding-top:580px"><div id=host>'+stableLibrary.template+'</div></body></html>');await page.addStyleTag({content:styled});
  await page.evaluate(block=>{
    const seeds=[{id:'one',label:'One',prompt:'One prompt',section:'Custom',pinned:1},{id:'two',label:'Two',prompt:'Two prompt',section:'Custom'},{id:'three',label:'Three',prompt:'Three prompt',section:'Custom'}];
    localStorage.setItem('kilo.promptSuggestions.v6',JSON.stringify(seeds));window.__sends=[];window.__cleanup=[];window.__ready=true;
    const B=document.querySelector('textarea'),ci=document.querySelector('.prompt-input-hint');let value='';
    const W=()=>value,Z=next=>{value=next},ea=()=>{},Xe=fn=>window.__cleanup.push(fn),Zc=({text})=>{value+=(value?'\n\n':'')+text;B.value=value},Bn=()=>!!value.trim(),Ln=()=>window.__ready,je={active:()=>false},c2=()=>{window.__sends.push(value);value='';B.value=''};
    B.addEventListener('input',()=>{value=B.value});
    new Function('ci','Xe','Zc','W','Bn','Ln','je','Z','B','ea','c2',block)(ci,Xe,Zc,W,Bn,Ln,je,Z,B,ea,c2);
  },stableLibrary.block);
  const open=async()=>{if(!await page.locator('.prompt-suggestion-menu').isVisible())await page.locator('.prompt-suggestion-trigger').click();await page.locator('.prompt-suggestion-category').evaluateAll(nodes=>nodes.forEach(node=>{node.open=true;node.dispatchEvent(new Event('toggle'))}));};
  await open();await page.locator('.prompt-suggestion-option',{hasText:'Two'}).click();assert.equal(await page.locator('textarea').inputValue(),'Two prompt');assert.equal(await page.evaluate(()=>__sends.length),0);
  await page.locator('textarea').fill('');await open();
  await page.locator('.prompt-suggestion-auto').click();await page.locator('.prompt-suggestion-option',{hasText:'Two'}).click();assert.equal(await page.locator('textarea').inputValue(),'Two prompt\n\nOne prompt');
  await page.locator('textarea').fill('');await open();await page.locator('.prompt-suggestion-pin[aria-label="Pin Two"]').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('kilo.promptSuggestions.v6')).find(x=>x.id==='two').pinned),2);
  const row=page.locator('.prompt-suggestion-row').filter({has:page.locator('.prompt-suggestion-option',{hasText:'Three'})});await row.locator('.prompt-suggestion-drag-handle').focus();await page.keyboard.press('Alt+ArrowUp');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('kilo.promptSuggestions.v6')).map(x=>x.id)),['one','three','two']);
  await page.locator('.prompt-suggestion-add').click();await page.locator('.prompt-suggestion-label-input').fill('My custom action');await page.locator('.prompt-suggestion-editor textarea').fill('Custom prompt preserved');await page.locator('.prompt-suggestion-save').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('kilo.promptSuggestions.v6')).find(x=>x.label==='My custom action').prompt),'Custom prompt preserved');
  // Clear the draft before an immediate-send quick action; a non-empty draft must be protected.
  await page.locator('textarea').fill('');await page.locator('.quick-action-trigger').click();await page.locator('[data-quick-action=continue]').click();
  assert.deepEqual(await page.evaluate(()=>__sends),['Continue with the recommended next step.']);assert.equal(await page.locator('textarea').inputValue(),'');
  await page.locator('textarea').fill('Keep my draft');await page.locator('.quick-action-trigger').click();assert.equal(await page.locator('[data-quick-action=continue]').isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('.quick-action-menu').isVisible(),false);
  await page.locator('textarea').fill('');await page.locator('.quick-action-trigger').click();await page.locator('.quick-action-more-toggle').click();assert.equal(await page.locator('.quick-action-more').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('.quick-action-more').isVisible(),false);
  await page.evaluate(()=>__cleanup.forEach(fn=>fn()));assert.deepEqual(errors,[]);
  console.log('PASS prompt v6: syntax/idempotence/exact restore, pin+permission+chevron composition; browser insertion, auto-add, ranked pins, keyboard reorder, custom save, immediate-send Continue, draft protection, submenu Escape, cleanup');
}finally{await browser.close();}
