import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {patch,variants,anchors,css} from '../examples/patches/composer-orange-actions.mjs';

const fixtureCss='[data-component=icon-button]{}.prompt-input-container{border:1px solid blue}';
for(const v of variants) {
  const source=anchors(v).map(a=>'create'+a).join(';');
  const changed=patch(source);
  assert.equal(patch(changed),changed);assert.equal(patch(changed,'js',true),source);
  assert.throws(()=>patch(source+source),/ambiguous/);
  assert.throws(()=>patch(anchors(v).slice(0,2).join(';')),/anchors/);
  let enabled=true,label='Send',sent=0,stopped=0;
  const context={create:(_,props)=>props,[v.component]:{},[v.send]:()=>sent++,
    [v.enabled]:()=>enabled,[v.label]:()=>label,u:{t:key=>key},t:{abort:()=>stopped++}};
  // Evaluate each transformed native call rather than recreating its handlers.
  const controls=vm.runInNewContext('['+changed.split(';').join(',')+']',context);
  assert.equal(controls.length,3);
  for(const b of controls) assert.equal(b.class,'kilo-composer-action');
  assert.equal(controls[0].icon,'arrow-up');assert.equal(controls[2].icon,'stop');
  assert.equal(controls[0].disabled,false);enabled=false;assert.equal(controls[0].disabled,true);
  label='Continue';assert.equal(controls[0]['aria-label'],'Continue');
  assert.equal(controls[1].children,'prompt.goal.start');
  assert.equal(controls[2]['aria-label'],'prompt.action.stop');
  controls[0].onClick();controls[1].onClick();controls[2].onClick();
  assert.equal(sent,2);assert.equal(stopped,1);
}
assert.throws(()=>patch('unknown'),/Unsupported/);
assert.throws(()=>patch('unknown','css'),/Unsupported/);
const styledCss=patch(fixtureCss,'css');
assert.equal(patch(styledCss,'css'),styledCss);
assert.equal(patch(styledCss,'css',true),fixtureCss);
assert.throws(()=>patch(styledCss+css,'css'),/Ambiguous/);
assert.throws(()=>patch(styledCss.replace('width:36px','width:99px'),'css'),/modified/);
// CLI checks must detect missing installation, preserve backups, and restore exactly.
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kilo-orange-'));
try {
  const cli=path.resolve('examples/patches/composer-orange-actions.mjs');
  for(const [name,source] of [['fixture.js',anchors(variants[0]).map(a=>'create'+a).join(';')],['fixture.css',fixtureCss]]) {
    const target=path.join(temp,name);fs.writeFileSync(target,source);
    const run=mode=>execFileSync(process.execPath,[cli,target,mode],{stdio:'pipe'});
    assert.throws(()=>run('--check'));run('--apply');run('--check');
    assert.equal(fs.readFileSync(target+'.pre-composer-orange-actions','utf8'),source);
    const once=fs.readFileSync(target,'utf8');run('--apply');assert.equal(fs.readFileSync(target,'utf8'),once);
    run('--restore');assert.equal(fs.readFileSync(target,'utf8'),source);
  }
} finally {fs.rmSync(temp,{recursive:true,force:true});}
console.log('Orange composer checks passed: native send/stop handlers, dynamic labels, disabled state, goal text, idempotence, fail-closed anchors, backups and restoration.');

if(process.argv.includes('--ui')) {
  const require=createRequire(path.join(os.homedir(),'.config/shared-computer/runtime/package.json'));
  const {chromium}=require('playwright');
  const dist=path.join(os.homedir(),'.vscode/extensions/shrikrishna-skg.kilo-code-local-7.8.2/dist');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    for(const name of ['webview','agent-manager']) {
      const source=fs.readFileSync(path.join(dist,name+'.js'),'utf8');
      const changed=patch(source);assert.equal(patch(changed),changed);
      const nativeCss=fs.readFileSync(path.join(dist,name+'.css'),'utf8');
      const icon=n=>source.match(new RegExp('(?:,|\\{)(?:"'+n+'"|'+n+'):\\x27([^\\x27]+)\\x27'))[1];
      const page=await browser.newPage({viewport:{width:1000,height:440}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.emulateMedia({colorScheme:'dark'});
      await page.setContent('<style>:root{--border-focus:#007fd4;--vscode-focusBorder:#007fd4}body{background:#191a1a;padding:24px;color:#ccc;font:14px Arial}.sample{margin-bottom:28px;padding:10px}.row{display:flex;align-items:center;gap:8px}.right{margin-left:auto;display:flex;align-items:center;gap:12px}textarea{display:block;width:100%;height:70px;background:transparent;border:0;resize:none;color:#ccc;outline:0}.pill{border:1px solid #444;border-radius:6px;padding:5px}h3{font-weight:400}</style><h3>Ready to send</h3><section class="prompt-input-container sample" id="send"><textarea placeholder="Describe the goal…"></textarea><div class="row"><span class="pill">CTO</span><span class="pill">GPT-6.1 Sol Ultrafast</span><span class="pill">High</span><div class="right"><span>✦ Clarify goal</span></div></div></section><h3>Working</h3><section class="prompt-input-container sample" id="stop"><textarea placeholder="Add a follow-up…"></textarea><div class="row"><span class="pill">CTO</span><span class="pill">GPT-6.1 Sol Ultrafast</span><span class="pill">High</span><div class="right"><span>✦ Clarify goal</span></div></div></section>');
      const originalStyle=await page.addStyleTag({content:nativeCss});
      await page.locator('#send textarea').focus();
      const originalBorder=await page.locator('#send').evaluate(e=>getComputedStyle(e).borderTopColor);
      await originalStyle.evaluate(e=>e.remove());
      await page.addStyleTag({content:patch(nativeCss,'css')});
      await page.evaluate(({arrow,stop})=>{
        window.clicks={send:0,stop:0};
        for(const [id,svg] of [['send',arrow],['stop',stop]]) {
          const b=document.createElement('button');b.className='kilo-composer-action';b.dataset.component='icon-button';b.dataset.variant='ghost';b.dataset.size='small';b.dataset.icon=id==='send'?'arrow-up':'stop';b.setAttribute('aria-label',id==='send'?'Send message':'Stop');
          b.innerHTML='<svg data-slot="icon-svg" viewBox="0 0 20 20" aria-hidden="true">'+svg+'</svg>';
          b.onclick=()=>window.clicks[id]++;document.querySelector('#'+id+' .right').append(b);
        }
      },{arrow:icon('arrow-up'),stop:icon('stop')});
      const send=page.getByRole('button',{name:'Send message'}),stop=page.getByRole('button',{name:'Stop',exact:true});
      for(const b of [send,stop]) {
        assert.equal(await b.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(222, 115, 91)');
        assert.equal(await b.evaluate(e=>getComputedStyle(e.querySelector('svg')).color),'rgb(255, 255, 255)');
        const box=await b.boundingBox();assert.equal(box.width,36);assert.equal(box.height,36);
        await b.hover();
        await page.waitForFunction(el=>getComputedStyle(el).backgroundColor==='rgb(202, 98, 75)',await b.elementHandle());
        await b.focus();assert.equal(await b.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
        await b.press('Enter');await b.press('Space');
      }
      assert.deepEqual(await page.evaluate(()=>window.clicks),{send:2,stop:2});
      await send.evaluate(e=>e.disabled=true);
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('#send button')).opacity==='0.4');
      // A disabled native button must ignore actual pointer input.
      await page.mouse.click((await send.boundingBox()).x+10,(await send.boundingBox()).y+10);
      assert.equal((await page.evaluate(()=>window.clicks)).send,2);
      await send.evaluate(e=>e.disabled=false);
      assert.equal(await stop.locator('rect').evaluate(e=>getComputedStyle(e).animationName),'none');
      await page.locator('#send textarea').focus();
      assert.equal(await page.locator('#send').evaluate(e=>getComputedStyle(e).borderTopColor),originalBorder);
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('#send button')).opacity==='1');
      await page.mouse.move(0,0);
      await page.waitForFunction(()=>[...document.querySelectorAll('.kilo-composer-action')].every(e=>getComputedStyle(e).backgroundColor==='rgb(222, 115, 91)'));
      assert.equal(await page.locator('#send').evaluate(e=>getComputedStyle(e).borderTopColor),'rgb(0, 127, 212)');
      await page.screenshot({path:path.join(os.tmpdir(),'kilo-orange-'+name+'.png')});
      await page.emulateMedia({forcedColors:'active'});
      assert.equal(await send.evaluate(e=>getComputedStyle(e).borderTopStyle),'solid');
      assert.deepEqual(errors,[]);await page.close();
      console.log(name+': actual bundle CSS/icons passed pointer, keyboard, disabled, focus, blue border and forced-colors browser checks.');
    }
  } finally {await browser.close();}
}
