import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Computer } from '../examples/computer-control/server.mjs';
import { Client } from '../examples/computer-control/client.mjs';
import { Lease } from '../examples/computer-control/lease.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'computer-tests-'));
const mock = path.join(temp, 'backend.mjs');
fs.writeFileSync(mock, `
import {createInterface} from 'node:readline';
const names=['see','click','permissions','agent','browser_snapshot','browser_click','browser_navigate','browser_evaluate','browser_handle_dialog'];
createInterface({input:process.stdin}).on('line', line=>{
 const r=JSON.parse(line); if(r.id===undefined)return;
 let result={};
 if(r.method==='tools/list')result={tools:names.map(name=>({name,description:'test',inputSchema:{type:'object',properties:{},additionalProperties:false}}))};
 if(r.method==='tools/call'){
  const n=r.params.name,a=r.params.arguments;
  if(a.timeout)return;
  if(n==='see'&&a.owned&&a.capture_engine!=='classic')result={isError:true,content:[{type:'text',text:'ScreenCaptureKit is already owned by PID 42'}]};
  else if(n==='see')result={content:[{type:'text',text:'Snapshot ID: ps1_1234567890abcdef'},{type:'image',mimeType:'image/png',data:'test-image'}]};
  else result={content:[{type:'text',text:'observed'}],isError:!!a.fail};
 }
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');
});
`);
const config = extra => ({ stateDir: fs.mkdtempSync(path.join(temp, 'state-')), desktop: [process.execPath, mock], browser: [process.execPath, mock], ...extra });
const unwrap = r => JSON.parse(r.content[0].text);

test('shared lease denies another client and forged token; release transfers ownership', async () => {
  const cfg = config(), a = new Computer(cfg), b = new Computer(cfg);
  const first = unwrap(await a.call('acquire', { purpose: 'first' }));
  assert.equal(unwrap(await b.call('acquire', { purpose: 'second' })).busy, true);
  await assert.rejects(b.call('release', { token: first.token }), /matching/);
  await a.call('release', { token: first.token });
  const second = unwrap(await b.call('acquire', { purpose: 'second' }));
  assert.equal(second.acquired, true);
  await b.call('release', { token: second.token });
});

test('native images survive, snapshot must be owned and fresh; mutation invalidates it', async () => {
  const a = new Computer(config());
  try {
    const tools = await a.tools();
    assert(!tools.some(t => /agent|evaluate/.test(t.name)));
    const { token } = unwrap(await a.call('acquire', { purpose: 'native' }));
    await assert.rejects(a.call('desktop_click', { token, snapshot: 'forged' }), /fresh snapshot/);
    const observed = await a.call('desktop_see', { token, owned: true });
    assert.equal(observed.content[1].data, 'test-image');
    await a.call('desktop_click', { token, snapshot: 'ps1_1234567890abcdef' });
    await assert.rejects(a.call('desktop_click', { token, snapshot: 'ps1_1234567890abcdef' }), /fresh snapshot/);
    await a.call('desktop_see', { token }); a.observedAt -= 61000;
    await assert.rejects(a.call('desktop_click', { token, snapshot: 'ps1_1234567890abcdef' }), /fresh snapshot/);
    await a.call('release', { token });
  } finally { await a.close(); }
});

test('browser requires observation after each mutation and preserves backend errors', async () => {
  const a = new Computer(config());
  try {
    await a.tools(); const { token } = unwrap(await a.call('acquire', { purpose: 'browser' }));
    await assert.rejects(a.call('browser_click', { token }), /browser_snapshot/);
    await a.call('browser_snapshot', { token });
    const failed = await a.call('browser_click', { token, fail: true });
    assert.equal(failed.isError, true);
    await assert.rejects(a.call('browser_click', { token }), /browser_snapshot/);
    // A blocking dialog must remain recoverable when it prevents observation.
    await a.call('browser_handle_dialog', { token, accept: false });
    const audit = fs.readFileSync(path.join(a.config.stateDir, 'events.jsonl'), 'utf8');
    assert(!audit.includes(token)); assert(!audit.includes('test-image')); assert(!audit.includes('observed'));
    await a.call('release', { token });
  } finally { await a.close(); }
});

test('timeout kills backend before transfer and resets observations', async () => {
  const a = new Computer(config({ timeout: 150 }));
  try {
    await a.tools(); const { token } = unwrap(await a.call('acquire', { purpose: 'timeout' }));
    await a.call('desktop_see', { token });
    const child = a.clients.get('desktop').child;
    await assert.rejects(a.call('desktop_click', { token, snapshot: 'ps1_1234567890abcdef', timeout: true }), /timed out/);
    assert(child.exitCode !== null || child.signalCode);
    assert.equal(a.snapshots.size, 0);
    await a.call('release', { token });
  } finally { await a.close(); }
});

test('expired lease terminates backend and cannot reuse prior snapshot', async () => {
  const cfg = config(), a = new Computer(cfg), b = new Computer(cfg);
  try {
    await a.tools(); const first = unwrap(await a.call('acquire', { purpose: 'expires' }));
    await a.call('desktop_see', { token: first.token });
    const state = a.lease.read(); state.expires = 0; a.lease.write(state);
    const second = unwrap(await b.call('acquire', { purpose: 'replacement' }));
    assert.equal(second.acquired, true);
    await assert.rejects(a.call('desktop_see', { token: first.token }), /valid lease/);
    await b.call('release', { token: second.token });
  } finally { await a.close(); await b.close(); }
});

test('separate MCP processes serialize ownership and release on stdin close', async () => {
  const cfg = config(), file = path.join(temp, 'config.json'); fs.writeFileSync(file, JSON.stringify(cfg));
  const create = () => new Client([process.execPath, path.join(root, 'examples/computer-control/server.mjs')], { env: { ...process.env, COMPUTER_CONFIG: file } });
  const a = create(), b = create();
  try {
    await Promise.all([a.init(), b.init()]);
    const call = (c, name, args) => c.request('tools/call', { name, arguments: args });
    const results = await Promise.all([call(a, 'acquire', { purpose: 'a' }), call(b, 'acquire', { purpose: 'b' })]);
    assert.equal(results.filter(r => unwrap(r).acquired).length, 1);
    const winner = unwrap(results[0]).acquired ? a : b, loser = winner === a ? b : a;
    winner.child.stdin.end(); await winner.closed;
    assert.equal(unwrap(await call(loser, 'acquire', { purpose: 'survivor' })).acquired, true);
  } finally { await a.close(); await b.close(); }
});

test('dead process mutex and lease can be recovered', async () => {
  const dir = config().stateDir, lease = new Lease(dir);
  fs.mkdirSync(path.join(dir, 'mutex')); fs.writeFileSync(path.join(dir, 'mutex/owner'), '2147483647');
  lease.write({ pid: 2147483647, expires: Date.now() + 60000, backends: [] });
  assert.equal((await lease.acquire('recovered')).acquired, true);
});

test('crash before mutex owner publication is recoverable', async () => {
  const dir = config().stateDir, lease = new Lease(dir), mutex = path.join(dir, 'mutex');
  fs.mkdirSync(mutex); fs.utimesSync(mutex, new Date(0), new Date(0));
  assert.equal((await lease.acquire('orphan mutex')).acquired, true);
});

test('abrupt server death stops orphan backend before next ownership', async () => {
  const cfg = config(), file = path.join(temp, 'crash-config.json'); fs.writeFileSync(file, JSON.stringify(cfg));
  const c = new Client([process.execPath, path.join(root, 'examples/computer-control/server.mjs')], { env: { ...process.env, COMPUTER_CONFIG: file } });
  await c.init();
  const a = unwrap(await c.request('tools/call', { name: 'acquire', arguments: { purpose: 'crash' } }));
  await c.request('tools/call', { name: 'desktop_see', arguments: { token: a.token } });
  const [pid] = JSON.parse(fs.readFileSync(path.join(cfg.stateDir, 'lease.json'))).backends;
  c.child.kill('SIGKILL'); await c.closed;
  const next = new Lease(cfg.stateDir); assert.equal((await next.acquire('survivor')).acquired, true);
  await new Promise(r => setTimeout(r, 100));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));
