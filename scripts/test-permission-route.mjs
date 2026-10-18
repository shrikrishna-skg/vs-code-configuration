import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { patch, recovery } from '../examples/patches/permission-route.mjs';
const require = createRequire(import.meta.url);
const { recoverPermissionRoute } = require('../examples/patches/permission-route.cjs');
const installed = path.join(os.homedir(), '.vscode/extensions/shrikrishna-skg.kilo-code-local-7.8.2/dist/extension.js');
const original = fs.readFileSync(installed, 'utf8').replace(recovery, '');
const changed = patch(original);
assert.equal(patch(changed), changed);
assert.equal(patch(changed, true), original);
assert.throws(() => patch('unknown'), /Unsupported/);
assert.throws(() => patch(original + original), /ambiguous/);

function fixture({ pending = [], broken = false, recorded = false, directories = ['/repo'] } = {}) {
  const posts = [], replies = [], routes = new Map(), sessions = new Map();
  if (recorded) { routes.set('p', '/repo'); sessions.set('p', 'child'); }
  const ctx = {
    client: { permission: { async list({ directory }) {
      if (broken) throw Error('offline');
      return { data: pending.filter(p => (p.directory ?? '/repo') === directory) };
    } } },
    sessionDirectories: new Map(directories.map(d => [d, d])),
    getWorkspaceDirectory: () => '/repo',
    extraDirectories: () => ['/worktree'],
    getPermissionDirectory: id => routes.get(id),
    getPermissionSession: id => sessions.get(id),
    recordPermissionDirectory(id, dir, session) { routes.set(id, dir); sessions.set(id, session); },
    clearPermissionDirectory(id) { routes.delete(id); sessions.delete(id); },
    postMessage: m => posts.push(m),
  };
  return { ctx, posts, replies };
}
const source = changed.slice(changed.indexOf('async function handlePermissionResponse('), changed.indexOf('async function fetchAndSendPendingPermissions('));
const handler = vm.runInNewContext(source + ';handlePermissionResponse', {
  require: name => name === 'node:path' ? path : { recoverPermissionRoute }, __dirname: '.',
  console: { error() {} },
  respondToPermission: async (_, input) => { active.replies.push(input); return { saved: false }; },
  isNotFoundError: () => false, permissionSettled: () => false,
  fetchAndSendPendingPermissions() {},
});
let active;
async function run(options, session = 'child') {
  active = fixture(options);
  await handler(active.ctx, 'p', session, 'once', [], []);
  return active;
}
{
  const f = await run({});
  assert.equal(f.posts[0].stale, true, 'Already resolved requests must dismiss the stale card');
  assert.equal(f.replies.length, 0);
}
{
  const f = await run({ pending: [{ id: 'p', sessionID: 'child', directory: '/worktree' }] });
  assert.equal(f.replies.length, 1, 'Missing route must recover and approve once');
  assert.equal(f.replies[0].directory, '/worktree');
  assert.equal(f.posts[0].type, 'permissionResolved');
  assert.equal(f.posts[0].sessionID, 'child');
}
for (const options of [
  { broken: true }, { pending: [{ id: 'p', sessionID: 'other-chat' }] },
]) {
  const f = await run(options);
  assert.equal(f.replies.length, 0, 'Failed lookup or session mismatch must not approve');
  assert.equal(f.posts[0].stale, undefined, 'Do not dismiss unverified requests');
}
{
  const f = await run({ recorded: true });
  assert.equal(f.replies.length, 1, 'Existing route still works');
  const mismatch = await run({ recorded: true }, 'other-chat');
  assert.equal(mismatch.replies.length, 0, 'Existing route session validation remains intact');
}
{
  const f = fixture();
  f.ctx.client.permission.list = async () => ({ error: 'unavailable' });
  assert.equal(await recoverPermissionRoute(f.ctx, 'p', 'child'), 'error');
  f.ctx.client.permission.list = async () => ({ data: null });
  assert.equal(await recoverPermissionRoute(f.ctx, 'p', 'child'), 'error');
}
console.log('PASS: actual permission handler recovers missing routes, dismisses stale requests, preserves session checks, and retains requests on backend failures; patch is reversible and idempotent.');
