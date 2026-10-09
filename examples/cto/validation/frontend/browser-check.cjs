const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
// Use an installed Playwright module; this check adds no package dependency.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(process.argv[2] || __dirname),checks=[],errors=[];
let server,browser;
(async()=>{
 server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+'/')||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForSelector('article[data-report-id]');
 const cards=page.locator('article[data-report-id]');
 const check=async(name,fn)=>{await fn();checks.push(name);};
 await check('initial three reports',async()=>assert.equal(await cards.count(),3));
 await check('blank title rejected without new card',async()=>{await page.fill('#title','   ');await page.click('button[type=submit]');assert((await page.textContent('#form-error')).trim());assert.equal(await cards.count(),3);});
 await check('creates trimmed Quarterly report',async()=>{await page.fill('#title','  Q4 review  ');await page.selectOption('#period','Quarterly');await page.click('button[type=submit]');assert.equal(await cards.count(),4);assert.equal(await page.locator('article h3').filter({hasText:'Q4 review'}).textContent(),'Q4 review');assert((await cards.filter({hasText:'Q4 review'}).textContent()).includes('Quarterly'));});
 await check('search updates as typed with whitespace/case',async()=>{await page.fill('#search','  REVENUE  ');await page.waitForTimeout(100);assert.equal(await cards.count(),1);});
 await check('combined status filter yields empty state',async()=>{await page.selectOption('#status','draft');assert.equal(await cards.count(),0);assert((await page.textContent('#reports')).includes('No reports match your filters'));});
 await page.fill('#search','');await page.selectOption('#status','all');
 await check('archive hides correct card',async()=>{await page.locator('article[data-report-id="1"] button').click();assert.equal(await cards.count(),3);assert.equal(await page.locator('article[data-report-id="1"]').count(),0);});
 await check('include archived reveals Restore action',async()=>{await page.check('#include-archived');assert.equal(await cards.count(),4);assert.equal(await page.locator('article[data-report-id="1"] button').textContent(),'Restore');});
 await check('restore preserves visibility',async()=>{await page.locator('article[data-report-id="1"] button').click();await page.uncheck('#include-archived');assert.equal(await cards.count(),4);});
 await check('hostile title stays text',async()=>{await page.fill('#title','<img src=x onerror="alert(1)"> & review');await page.click('button[type=submit]');assert.equal(await cards.count(),5);assert.equal(await page.locator('#reports img').count(),0);assert((await page.textContent('#reports')).includes('<img src=x onerror="alert(1)"> & review'));});
 await check('visible count agrees with cards',async()=>assert((await page.textContent('#count')).includes(String(await cards.count()))));

 await page.setViewportSize({width:390,height:844});
 await check('mobile has no horizontal overflow',async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)));

 await check('unbroken 200-character title stays within desktop and mobile',async()=>{await page.fill('#title','x'.repeat(200));await page.click('button[type=submit]');for(const width of [1280,390]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow at '+width+'px');}});
 await check('no browser runtime errors',async()=>assert.deepEqual(errors,[]));
 console.log(JSON.stringify({passed:true,checks,errors},null,2));
})().catch(e=>{console.log(JSON.stringify({passed:false,checks,errors,error:e.message},null,2));process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)server.close();});
