#!/usr/bin/env node
// Opt-in real model + real UI test. Never part of unattended verify.sh.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import { run, parseEvents } from '../examples/cto/worker.mjs';
import { discoverBinary } from '../examples/cto/manager.mjs';
import { Client } from '../examples/computer-control/client.mjs';

const model = process.argv[2] || 'openai/gpt-6.1-sol-ultrafast';
const includeNative = process.argv.includes('--native');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'computer-live-'));
let saved = null, rejected = 0, saves = 0, reloads = 0;
const html = `<!doctype html><html><head><title>Disposable invoice validation</title></head>
<body><h1>Invoice verification sandbox</h1><p>Local test only. Nothing is purchased or sent.</p>
<form id="invoice"><label>Item <input name="item" value=""></label><br>
<label>Quantity <input name="quantity" type="text" value=""></label><br>
<label>Unit price <input name="price" type="text" value=""></label><br>
<label>Tax percent <input name="tax" type="text" value=""></label><br>
<button>Save invoice</button></form><p role="status" id="status"></p><section><h2>Saved invoice</h2><pre id="saved">None</pre></section>
<script>
fetch('/state').then(r=>r.json()).then(d=>{document.querySelector('#saved').textContent=d.saved?JSON.stringify(d.saved):'None';});
document.querySelector('form').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));const r=await fetch('/save',{method:'POST',body:JSON.stringify(data)});const d=await r.json();document.querySelector('#status').textContent=d.error||'Saved successfully';if(r.ok)document.querySelector('#saved').textContent=JSON.stringify(d);};
</script></body></html>`;
const server = http.createServer(async (req, res) => {
  if (req.url === '/state') { reloads++; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ saved })); }
  if (req.url === '/save' && req.method === 'POST') {
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 10000) { res.writeHead(413); return res.end(); } }
    let d; try { d = JSON.parse(body); } catch { res.writeHead(400); return res.end('{}'); }
    const quantity = Number(d.quantity), price = Number(d.price), tax = Number(d.tax);
    res.setHeader('Content-Type', 'application/json');
    if (!d.item || !Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(price) || price < 0 || !Number.isFinite(tax) || tax < 0 || tax > 100) {
      rejected++; res.writeHead(422); return res.end(JSON.stringify({ error: 'Rejected: quantity must be a positive integer; nothing saved.' }));
    }
    saves++; saved = { item: d.item, quantity, price, tax, total: Math.round(quantity * price * (1 + tax / 100) * 100) / 100 };
    fs.writeFileSync(path.join(dir, 'saved.json'), JSON.stringify(saved)); return res.end(JSON.stringify(saved));
  }
  res.setHeader('Content-Type', 'text/html'); res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const liveFile = path.join(os.homedir(), '.config/kilo/kilo.jsonc');
const config = JSON.parse(fs.readFileSync(liveFile, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
for (const [name, value] of Object.entries(config.mcp)) value.enabled = name === 'computer';
config.permission = { '*': 'deny', 'computer_*': 'allow' };
config.agent = { 'computer-validation': { mode: 'primary', model, steps: 100, permission: { '*': 'deny', 'computer_*': 'allow' }, prompt: 'You are testing the shared computer tools. Use only computer_* tools. Observe before acting, verify after, and always release. Do not stop until the requested UI task is complete or a real blocker is demonstrated. Do not use shell, code execution, HTTP tools, filesystem tools, task delegation or other MCP servers.' } };
config.default_agent = 'computer-validation';
const prompt = `Use the shared computer MCP service to test the following UI workflow. Acquire one lease and retain its token. Navigate the automation browser to ${url}. First fill Item as Test widgets, Quantity as -1, Unit price as 19.95 and Tax percent as 8.25. Click Save invoice, observe the validation rejection and confirm nothing was saved. Then correct only Quantity to 3, save once, and verify total 64.79. Navigate to the same URL again and verify the saved invoice survived reload. Do not access this local site other than through browser UI tools. Take a browser screenshot after verification.
${includeNative ? 'Also use the native Calculator application: observe its exact window, click All Clear, 6, Multiply, 9, Equals, observing after every click. Verify the displayed result is 54. Use desktop_see at least once so a real image is returned. Do not infer success from arithmetic alone.' : ''}
Release the lease, then report each observed outcome. If an observation tool fails, follow its recovery hints and re-observe before retrying.`;
fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt, { mode: 0o600 });
const start = Date.now();
console.log(JSON.stringify({ started: true, model, dir, native: includeNative }));
try {
  const r = await run(discoverBinary(), ['run', '--pure', '--format', 'json', '--agent', 'computer-validation', '--model', model, '--variant', 'high', '--dir', dir], {
    cwd: dir, env: { ...process.env, KILO_CONFIG_CONTENT: JSON.stringify(config) }, input: prompt, timeout: 600000,
    outputFile: path.join(dir, 'events.jsonl'), errorFile: path.join(dir, 'stderr.log'),
  });
  assert.equal(r.exitCode, 0, r.stderr.slice(-1500));
  const parsed = parseEvents(r.stdout);
  const records = r.stdout.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
  const calls = records.filter(e => e.type === 'tool_use').map(e => e.part || e);
  const observedCalls = calls.map(e => e.tool);
  assert(rejected >= 1, 'Invalid quantity was not rejected by the real server');
  assert.equal(saves, 1, 'Exactly one valid save is required');
  assert.deepEqual(saved, { item: 'Test widgets', quantity: 3, price: 19.95, tax: 8.25, total: 64.79 });
  assert(reloads >= 2, 'Saved state was not reloaded');
  assert(observedCalls.includes('computer_release'), 'Agent did not release ownership');
  assert(observedCalls.includes('computer_browser_take_screenshot'), 'Agent did not capture screenshot');
  if (includeNative) assert(observedCalls.includes('computer_desktop_see'), 'No native screenshot observed');
  const proof = new Client([process.execPath, path.join(os.homedir(), '.config/shared-computer/server.mjs')]);
  let nativeEvidence;
  try {
    await proof.init();
    const call = (name, args) => proof.request('tools/call', { name, arguments: args });
    const status = JSON.parse((await call('status', {})).content[0].text); assert.equal(status.busy, false);
    if (includeNative) {
      const a = JSON.parse((await call('acquire', { purpose: 'Independent native result verification' })).content[0].text);
      const observation = await call('desktop_inspect_ui', { token: a.token, app_target: 'Calculator' });
      nativeEvidence = observation.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      fs.writeFileSync(path.join(dir, 'native-verification.txt'), nativeEvidence);
      assert.match(nativeEvidence, /(?:value:\s*"54"|StandardInputView;value:54)/);
      await call('release', { token: a.token });
    }
  } finally { await proof.close(); }
  const result = { passed: true, model, elapsedSeconds: Math.round((Date.now() - start) / 1000), rejected, saves, reloads, saved, nativeVerified: !!nativeEvidence, toolCalls: observedCalls, report: parsed.report, dir };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
