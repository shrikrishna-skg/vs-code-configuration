import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { locked, validate, canStart, update, git, snapshot, fingerprint, inScope, home, atomic, workerConfig, discoverBinary } from '../manager.mjs';
import { run, parseEvents } from '../worker.mjs';

export async function reserve(input, ownerPid = process.pid) {
  return locked(db => {
    const job = { ...validate(input, db.tasks), id: 'cto-' + crypto.randomUUID().slice(0, 12), kind: 'interactive', state: 'running', pid: ownerPid, createdAt: Date.now(), startedAt: Date.now() };
    if (!canStart(job, db.tasks)) throw Error('Worker capacity or requested file scope is occupied. Close the conflicting session or choose another scope.');
    db.tasks.push(job);
    return job;
  });
}

export async function createRoutine(input, model, ownerPid = process.pid) {
  const job = await reserve(input, ownerPid);
  const dir = path.join(home, 'jobs', job.id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    const base = snapshot(job.repo, dir);
    const worktree = path.join(dir, 'workspace');
    git(job.repo, ['worktree', 'add', '--detach', worktree, base]);
    // ponytail: full-source hashes cost O(non-ignored bytes) per publish; use a
    // content-addressed source monitor if very large projects make this costly.
    const fields = { base, worktree, model, scopeFingerprint: fingerprint(worktree, job.scopes), sourceFingerprint: fingerprint(worktree, null) };
    await update(job.id, fields);
    return { ...job, ...fields };
  } catch (error) {
    await update(job.id, { state: 'failed', error: error.message, finishedAt: Date.now() });
    throw error;
  }
}

export async function release(id) {
  await locked(db => {
    const job = db.tasks.find(t => t.id === id);
    if (job?.kind === 'interactive' && ['running', 'checking', 'cancelling'].includes(job.state)) {
      job.state = 'cancelled'; job.finishedAt = Date.now(); job.childPid = null;
    }
  });
}

export async function publish(id) {
  const job = await locked(db => {
    const j = db.tasks.find(t => t.id === id);
    if (j?.kind !== 'interactive' || j.state !== 'running' || !j.writer) throw Error('No active writable routine session.');
    j.state = 'checking'; return { ...j };
  });
  const verification = [];
  try {
    const changed = () => {
      git(job.worktree, ['add', '-A', '--', '.']);
      const files = git(job.worktree, ['diff', '--cached', '--no-renames', '--name-only', '-z', job.base]).split('\0').filter(Boolean);
      if (files.some(f => !inScope(f, job.scopes))) throw Error('Patch exceeded the approved scope; nothing applied.');
      return files;
    };
    let files = changed();
    if (!files.length) return { applied: false, changedFiles: [], message: 'No changes to apply.' };
    for (const [index, argv] of job.checks.entries()) {
      const result = await run(argv[0], argv.slice(1), { cwd: job.worktree, timeout: 120000, onStart: pid => { update(id, { childPid: pid }).catch(() => {}); } });
      verification.push({ argv, exitCode: result.exitCode, timedOut: result.timedOut });
      atomic(path.join(home, 'jobs', id, `routine-check-${index}.log`), result.stdout + '\n' + result.stderr);
      if (result.exitCode !== 0 || result.timedOut) throw Error('Approved verification failed; nothing applied. Inspect routine_status for evidence.');
    }
    files = changed(); // Checks themselves may modify files; recheck ownership.
    if (!files.length) return { applied: false, changedFiles: [], verification, message: 'Checks left no changes to apply.' };
    const patch = git(job.worktree, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-renames', job.base]);
    const tree = git(job.worktree, ['write-tree']);
    const nextBase = git(job.worktree, ['-c', 'user.name=CTO Routine', '-c', 'user.email=cto@localhost', 'commit-tree', tree, '-p', job.base], { input: 'Verified routine checkpoint\n' });
    return await locked(db => {
      const current = db.tasks.find(t => t.id === id);
      if (current?.state !== 'checking') throw Error('Session cancelled while checking; nothing applied.');
      if (fingerprint(job.repo, job.scopes) !== job.scopeFingerprint) throw Error('Destination changed since the snapshot; nothing applied. Reopen from current source.');
      if (fingerprint(job.repo, null) !== job.sourceFingerprint) throw Error('Other project files changed since this snapshot; nothing applied. Reopen to refresh dependencies.');
      if (patch) {
        git(job.repo, ['apply', '--check', '--binary', '-'], { input: patch + '\n' });
        git(job.repo, ['apply', '--binary', '-'], { input: patch + '\n' });
      }
      git(job.worktree, ['update-ref', 'HEAD', nextBase]);
      Object.assign(current, { base: nextBase, scopeFingerprint: fingerprint(job.repo, job.scopes), sourceFingerprint: fingerprint(job.repo, null), verification, childPid: null });
      current.history ||= [];
      current.history.push({ at: Date.now(), changedFiles: files, verification });
      return { applied: true, changedFiles: files, verification, revisions: current.history.length };
    });
  } finally {
    await locked(db => {
      const current = db.tasks.find(t => t.id === id);
      if (current?.state === 'checking') current.state = 'running';
      if (current) { current.childPid = current.executorPid || null; current.verification = verification; }
    });
  }
}

export async function consult(id, question, premiumModel, variant, live) {
  if (typeof question !== 'string' || !question.trim() || question.length > 12000) throw Error('Provide a focused question of at most 12000 characters.');
  const parent = await locked(db => db.tasks.find(t => t.id === id));
  if (parent?.state !== 'running') throw Error('Routine session is not active.');
  const job = await reserve({ workspace: parent.worktree, role: 'reviewer', title: 'CTO advice for ' + parent.title, task: question, acceptance: 'Evidence-backed read-only advice', scopes: [], checks: [] }, parent.pid);
  const dir = path.join(home, 'jobs', job.id); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    const spec = workerConfig({ ...job, worktree: parent.worktree }, live);
    spec.config.agent['cto-worker'].model = premiumModel;
    spec.config.agent['cto-worker'].prompt += '\nYou are the premium CTO adviser. Resolve the stated question from evidence, distinguish missing user intent from technical uncertainty, and request clarification when intent is missing. Do not edit or delegate. Your advice is not approval to expand the routine scope.';
    const isolated = path.join(dir, 'config'); fs.mkdirSync(isolated);
    const started = Date.now();
    await update(job.id, { model: premiumModel, worktree: parent.worktree });
    const result = await run(discoverBinary(), ['run', '--pure', '--format', 'json', '--agent', 'cto-worker', '--model', premiumModel, '--variant', variant || 'high', '--dir', parent.worktree], {
      cwd: parent.worktree, env: { ...process.env, XDG_CONFIG_HOME: isolated, KILO_CONFIG: '', KILO_CONFIG_DIR: '', KILO_CONFIG_CONTENT: JSON.stringify(spec.config) },
      input: question, timeout: 180000, outputFile: path.join(dir, 'events.jsonl'), errorFile: path.join(dir, 'stderr.log'), onStart: pid => { update(job.id, { childPid: pid }).catch(() => {}); },
    });
    if (result.exitCode !== 0 || result.timedOut) throw Error('Premium consultation failed; no fallback model was used.');
    const { report } = parseEvents(result.stdout);
    await update(job.id, { state: 'accepted', report, childPid: null, finishedAt: Date.now() });
    return { model: premiumModel, seconds: (Date.now() - started) / 1000, report, adviceOnly: true };
  } catch (error) {
    await update(job.id, { state: 'failed', error: error.message, childPid: null, finishedAt: Date.now() });
    throw error;
  }
}
