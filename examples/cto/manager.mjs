import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const home = process.env.CTO_STATE_DIR || path.join(os.homedir(), '.local/state/kilo/cto');
export const limits = { workers: 14, writers: 6 };
export const roles = {
  implementer: { source: 'deepseek-implementer', writer: true, max: 6 },
  investigator: { source: 'glm-investigator', writer: false, max: 6 },
  tester: { source: 'deepseek-implementer', writer: true, max: 4 },
  reviewer: { source: 'glm-investigator', writer: false, max: 3 },
  utility: { source: 'luna-utility', writer: true, max: 2 },
};
export const active = j => ['starting', 'running', 'checking', 'cancelling'].includes(j.state);
export function alive(pid) { if (!Number.isInteger(pid) || pid < 2) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
export function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
export const registryFile = path.join(home, 'tasks.json');
export async function locked(fn) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const lock = path.join(home, 'lock');
  const deadline = Date.now() + 15000;
  for (;;) {
    try { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'pid'), String(process.pid)); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const pid = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8'));
        if (!alive(pid) && Date.now() - fs.statSync(lock).mtimeMs > 10000) { fs.rmSync(lock, { recursive: true }); continue; }
      } catch {}
      if (Date.now() > deadline) throw Error('Task registry is busy; retry.');
      await new Promise(r => setTimeout(r, 30));
    }
  }
  try {
    const db = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, 'utf8')) : { version: 1, tasks: [] };
    const result = fn(db);
    if (result?.then) throw Error('Registry transactions must be synchronous.');
    atomic(registryFile, db);
    return result;
  } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}
export function git(repo, args, options = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60000, ...options });
  if (r.status !== 0) throw Error(`git ${args[0]} failed: ${(r.stderr || r.error?.message || '').slice(0, 800)}`);
  return r.stdout.trim();
}
export function scope(s) {
  if (typeof s !== 'string' || !s || s.length > 500 || s.includes('\\') || /[\x00-\x1f*?\[\]]/.test(s) || path.posix.isAbsolute(s) || s.split('/').some(x => ['..', '.', '.git'].includes(x))) throw Error('Scopes must be explicit repository-relative paths, without globs or traversal.');
  return s.replace(/\/+$/, '');
}
export const overlap = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
export const inScope = (file, scopes) => scopes.some(s => file === s || file.startsWith(s + '/'));
function required(s, label, max = 16000) { if (typeof s !== 'string' || !s.trim() || s.length > max) throw Error(`Invalid ${label}.`); return s.trim(); }
export function validate(input, tasks) {
  if (!input || !roles[input.role]) throw Error('Unknown role.');
  const workspace = fs.realpathSync(required(input.workspace, 'workspace', 4096));
  if (workspace === '/' || workspace === os.homedir()) throw Error('Select a specific Git repository.');
  const repo = fs.realpathSync(git(workspace, ['rev-parse', '--show-toplevel']));
  if (workspace !== repo) throw Error(`Use repository root: ${repo}`);
  if (git(repo, ['ls-files', '--stage']).split('\n').some(l => l.startsWith('160000 '))) throw Error('Repositories with submodules require direct CTO execution.');
  const title = required(input.title, 'title', 200), task = required(input.task, 'task');
  const acceptance = required(input.acceptance, 'acceptance criteria', 8000);
  const scopes = (input.scopes || []).map(scope);
  if (roles[input.role].writer && !scopes.length) throw Error('Writer needs exclusive scopes.');
  const dependsOn = input.dependsOn || [];
  if (!Array.isArray(dependsOn) || dependsOn.length > 20 || dependsOn.some(id => !tasks.some(t => t.id === id && t.repo === repo))) throw Error('Dependencies must name existing tasks in the same repository.');
  const checks = input.checks || [];
  if (!Array.isArray(checks) || checks.length > 6 || checks.some(a => !Array.isArray(a) || !a.length || a.length > 40 || a.some(v => typeof v !== 'string' || !v || v.length > 4096))) throw Error('Checks must be arrays of executable and arguments, without shell wrapping.');
  if (checks.some(a => /^(?:.*\/)?(?:sh|bash|zsh|fish|cmd|powershell)$/.test(a[0]))) throw Error('Specify a check executable and arguments, not a shell.');
  if (roles[input.role].writer && !checks.length) throw Error('Writer needs at least one concrete verification command.');
  return { repo, title, task, acceptance, scopes, dependsOn, checks, role: input.role, writer: roles[input.role].writer };
}
export function canStart(job, tasks) {
  if (!job.dependsOn.every(id => tasks.find(t => t.id === id)?.state === 'accepted')) return false;
  const busy = tasks.filter(active);
  if (busy.length >= limits.workers || busy.filter(t => t.role === job.role).length >= roles[job.role].max) return false;
  if (job.writer && busy.filter(t => t.writer).length >= limits.writers) return false;
  // Ready patches keep ownership until accepted/rejected so two queued writers
  // cannot silently build incompatible changes against the same base.
  return !job.writer || !tasks.some(t => t.id !== job.id && t.repo === job.repo && t.writer && (active(t) || t.state === 'ready') && t.scopes.some(a => job.scopes.some(b => overlap(a, b))));
}
export function reconcile(db) {
  for (const j of db.tasks) if (active(j) && !alive(j.pid) && Date.now() - j.startedAt > 15000) {
    // A surviving CLI process must continue to occupy its slot.
    if (alive(j.childPid) || alive(j.executorPid)) continue;
    j.state = 'failed'; j.error = 'Runner interrupted; worktree retained for inspection.'; j.finishedAt = Date.now();
  }
}
function launch(db) {
  reconcile(db);
  for (const j of db.tasks) {
    if (j.state !== 'queued' || !canStart(j, db.tasks)) continue;
    j.state = 'starting'; j.startedAt = Date.now();
    const child = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'worker.mjs'), j.id], { detached: true, stdio: 'ignore', env: process.env });
    j.pid = child.pid; child.unref();
    child.on('error', () => {}); // reconciled from missing PID on next status
  }
}
export async function pump() { return locked(db => launch(db)); }
export async function update(id, fields) { return locked(db => { const j = db.tasks.find(t => t.id === id); if (!j) throw Error('Unknown task.'); Object.assign(j, fields); return j; }); }
export async function submit(input) {
  return locked(db => {
    const j = { ...validate(input, db.tasks), id: `cto-${crypto.randomUUID().slice(0, 12)}`, state: 'queued', createdAt: Date.now() };
    db.tasks.push(j); launch(db); return summary(j);
  });
}
export const summary = j => ({ id: j.id, title: j.title, role: j.role, state: j.state, model: j.model, repo: j.repo, scopes: j.scopes, dependsOn: j.dependsOn, error: j.error, worktree: j.worktree, changedFiles: j.changedFiles, verification: j.verification, report: j.report?.slice(-12000), base: j.base, acceptedTree: j.acceptedTree });
export async function status(id, waitMs = 0) {
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 20000) throw Error('waitMs must be an integer from 0 to 20000.');
  const read = () => locked(db => { launch(db); const tasks = id ? db.tasks.filter(t => t.id === id) : db.tasks.slice(-50); return { limits, activeWorkers: db.tasks.filter(active).length, activeWriters: db.tasks.filter(t => active(t) && t.writer).length, tasks: tasks.map(summary) }; });
  const initial = await read();
  if (!waitMs || !initial.tasks.some(active) || initial.tasks.some(t => t.state === 'ready')) return initial;
  const key = value => JSON.stringify(value.tasks.map(t => [t.id, t.state]));
  const before = key(initial), deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(250, deadline - Date.now())));
    const current = await read();
    if (key(current) !== before || Date.now() >= deadline) return current;
  }
  return read();
}
export async function cancel(id) {
  return locked(db => {
    const j = db.tasks.find(t => t.id === id); if (!j) throw Error('Unknown task.');
    if (active(j)) {
      j.state = 'cancelling';
      try { process.kill(j.kind === 'interactive' ? j.pid : -j.pid, 'SIGTERM'); } catch {}
      // Do not release ownership until worker exit is observed.
    } else if (['queued', 'ready', 'failed'].includes(j.state)) { j.state = 'cancelled'; j.finishedAt = Date.now(); }
    else throw Error('Task already accepted or cancelled.');
    return summary(j);
  });
}
export function snapshot(repo, dir) {
  const index = path.join(dir, 'snapshot.index');
  const env = { ...process.env, GIT_INDEX_FILE: index };
  git(repo, ['read-tree', 'HEAD'], { env });
  // The user's index and branch are never changed. Include non-ignored local
  // work so writers do not unknowingly start from an older committed revision.
  git(repo, ['add', '-A', '--', '.'], { env });
  const tree = git(repo, ['write-tree'], { env });
  const base = git(repo, ['commit-tree', tree, '-p', git(repo, ['rev-parse', 'HEAD'])], { input: 'Local CTO worker snapshot\n', env: { ...env, GIT_AUTHOR_NAME: 'CTO Snapshot', GIT_AUTHOR_EMAIL: 'cto@localhost', GIT_COMMITTER_NAME: 'CTO Snapshot', GIT_COMMITTER_EMAIL: 'cto@localhost' } });
  return base;
}
export function fingerprint(repo, scopes) {
  const files = [...new Set(git(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))].filter(f => scopes === null || inScope(f, scopes)).sort();
  const h = crypto.createHash('sha256');
  for (const f of files) {
    const full = path.join(repo, f);
    // Compare the actual source tree, including local deletions and broken links,
    // using Git's executable bit rather than checkout-specific file permissions.
    let st;
    try { st = fs.lstatSync(full); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    h.update(f + '\0'); h.update(String(st.mode & 0o111));
    h.update(st.isSymbolicLink() ? fs.readlinkSync(full) : fs.readFileSync(full));
  }
  return h.digest('hex');
}
export async function accept(id, evidence) {
  required(evidence, 'CTO acceptance evidence', 8000);
  return locked(db => {
    const j = db.tasks.find(t => t.id === id);
    if (!j || j.state !== 'ready') throw Error('Only a ready task can be accepted.');
    if (j.writer) {
      if (!j.verification?.length || j.verification.some(c => c.exitCode !== 0)) throw Error('Worker verification has not passed.');
      if (fingerprint(j.repo, j.scopes) !== j.scopeFingerprint) throw Error('Owned files changed in the destination; review/rebase instead of overwriting.');
      const patch = fs.readFileSync(j.patch);
      if (patch.length) {
        git(j.repo, ['apply', '--check', '--binary', '-'], { input: patch });
        git(j.repo, ['apply', '--binary', '-'], { input: patch });
      }
    }
    j.state = 'accepted'; j.acceptanceEvidence = evidence; j.acceptedAt = Date.now();
    j.acceptedTree = j.resultTree;
    // Integration is recorded, not claimed to be tested: CTO must run checks
    // against the combined working tree before declaring the overall task done.
    launch(db); return { ...summary(j), integrationVerified: false, next: 'Run the relevant integration checks on the combined destination revision.' };
  });
}
export function discoverBinary() {
  if (process.env.CTO_KILO_BINARY) return fs.realpathSync(process.env.CTO_KILO_BINARY);
  const root = path.join(os.homedir(), '.vscode/extensions');
  const entries = JSON.parse(fs.readFileSync(path.join(root, 'extensions.json'), 'utf8'));
  const e = entries.find(x => x.identifier.id === 'shrikrishna-skg.kilo-code-local') || entries.find(x => x.identifier.id === 'kilocode.kilo-code');
  if (!e) throw Error('Installed Kilo runtime not found.');
  return path.join(e.location.path, 'bin/kilo');
}
export function workerConfig(j, live) {
  const agentDir = process.env.CTO_AGENT_DIR || path.join(os.homedir(), '.config/kilo/agent');
  const source = fs.readFileSync(path.join(agentDir, `${roles[j.role].source}.md`), 'utf8');
  const model = source.match(/^model:\s*(\S+)/m)?.[1];
  if (!model) throw Error('Worker model missing from live profile.');
  // Embed policy because isolated workers cannot read external instruction paths.
  const ponytail = fs.readFileSync(process.env.CTO_PONYTAIL_FILE || path.join(os.homedir(), '.config/ponytail/AGENTS.md'), 'utf8');
  const goalPolicy = fs.readFileSync(new URL('./goal-policy.md', import.meta.url), 'utf8');
  const edits = { '*': 'deny' };
  for (const s of j.scopes) for (const p of [s, s + '/**', path.join(j.worktree, s), path.join(j.worktree, s) + '/**']) edits[p] = 'allow';
  const permission = { ...Object.fromEntries(Object.keys(live.permission || {}).map(k => [k, 'deny'])), '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', list: 'allow', edit: j.writer ? edits : 'deny', bash: 'deny', task: 'deny', external_directory: 'deny' };
  return { model, config: {
    share: 'disabled', instructions: [], subagent_depth: 0,
    // Workers have an isolated config home; custom routes must remain available.
    ...(live.provider ? { provider: live.provider } : {}),
    ...(live.disabled_providers ? { disabled_providers: live.disabled_providers } : {}),
    ...(live.enabled_providers ? { enabled_providers: live.enabled_providers } : {}),
    mcp: Object.fromEntries(Object.keys(live.mcp || {}).map(k => [k, { enabled: false }])),
    permission,
    agent: { 'cto-worker': { mode: 'primary', model, steps: j.writer ? 75 : 25, permission,
      prompt: `You are a bounded ${j.role} working for one CTO. Use only the supplied repository snapshot. Do not delegate, use external services, edit Git metadata, or modify files outside the explicitly assigned scopes. Follow applicable project instructions. ${j.writer ? 'Implement the assignment in the owned paths. Shell access is intentionally unavailable: the supervisor runs the specified checks after your edits. Do not claim those checks ran yourself.' : 'Read-only investigation. Do not change any files. Cite paths and observed evidence.'} Report changes or findings, uncertainty, and anything incomplete. A report is not overall task acceptance.\n\n${ponytail}\n\n${goalPolicy}`,
    } },
  } };
}
