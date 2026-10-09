import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { home, locked, update, pump, git, snapshot, fingerprint, inScope, workerConfig, discoverBinary, atomic } from './manager.mjs';

export function run(command, args, options = {}) {
  return new Promise(resolve => {
    for (const file of [options.outputFile, options.errorFile].filter(Boolean)) fs.writeFileSync(file, '', { mode: 0o600 });
    const child = spawn(command, args, { cwd: options.cwd, env: options.env || process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, tooLarge = false;
    options.onStart?.(child.pid);
    const stop = () => { child.kill('SIGTERM'); const t = setTimeout(() => child.kill('SIGKILL'), 3000); t.unref(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeout || 120000);
    const abort = () => stop(); options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) stop();
    child.stdout.on('data', b => { if (stdout.length < 2_000_000) { stdout += b.toString(); if (options.outputFile) fs.appendFileSync(options.outputFile, b); } else { tooLarge = true; stop(); } });
    child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-16000); if (options.errorFile) fs.writeFileSync(options.errorFile, stderr); });
    child.stdin.on('error', () => {}); child.stdin.end(options.input || '');
    child.on('error', e => { stderr = e.message; });
    child.on('close', code => {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      resolve({ exitCode: code ?? -1, stdout, stderr, timedOut, tooLarge });
    });
  });
}

export function parseEvents(text) {
  let report = [], finished = false, session;
  for (const line of text.split('\n').filter(l => l.trim())) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    session ||= event.sessionID;
    if (event.type === 'error') throw Error('Worker provider/runtime error; inspect private task logs.');
    if (event.type === 'step_start') { report = []; finished = false; }
    if (event.type === 'text' && event.part?.text) report.push(event.part.text);
    if (event.type === 'step_finish') finished = event.part?.reason === 'stop';
  }
  if (!finished || !report.length) throw Error('Worker did not return a completed final turn.');
  return { report: report.join('\n\n'), session };
}

export async function main(id) {
  const controller = new AbortController();
  process.on('SIGTERM', () => controller.abort());
  process.on('SIGINT', () => controller.abort());
  const dir = path.join(home, 'jobs', id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let job;
  try {
    job = await locked(db => db.tasks.find(t => t.id === id));
    if (!job || job.state === 'cancelling') throw Error('Cancelled before start.');
    const livePath = process.env.CTO_CONFIG || path.join(os.homedir(), '.config/kilo/kilo.jsonc');
    const live = JSON.parse(fs.readFileSync(livePath, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
    const base = snapshot(job.repo, dir);
    const worktree = path.join(dir, 'workspace');
    git(job.repo, ['worktree', 'add', '--detach', worktree, base]);
    job = { ...job, base, worktree };
    // Capture the selected snapshot's owned files, not a later destination state.
    const scopeFingerprint = fingerprint(worktree, job.scopes);
    const spec = workerConfig(job, live);
    await update(id, { base, worktree, scopeFingerprint, state: 'running', model: spec.model });
    const prompt = `Task: ${job.title}\n${job.task}\n\nAcceptance criteria:\n${job.acceptance}\n\nExclusive writable paths:\n${job.scopes.join('\n') || '(none; read only)'}\n\nSupervisor will run these checks:\n${JSON.stringify(job.checks)}\n\nThis is an isolated Git worktree. Do not change branches, commit, or edit .git. Do not claim success if the requested implementation is incomplete. Report precise files and limitations.`;
    const result = await run(discoverBinary(), ['run', '--pure', '--format', 'json', '--agent', 'cto-worker', '--model', spec.model, '--variant', 'high', '--dir', worktree], {
      cwd: worktree, env: { ...process.env, KILO_CONFIG_CONTENT: JSON.stringify(spec.config) }, input: prompt, timeout: 1800000, signal: controller.signal,
      outputFile: path.join(dir, 'events.jsonl'), errorFile: path.join(dir, 'stderr.log'),
      onStart: pid => { update(id, { childPid: pid }).catch(() => {}); },
    });
    atomic(path.join(dir, 'events.jsonl'), result.stdout);
    atomic(path.join(dir, 'stderr.log'), result.stderr);
    if (controller.signal.aborted) throw Error('Cancelled.');
    if (result.exitCode !== 0 || result.timedOut || result.tooLarge) throw Error('Worker process failed or exceeded its time/output budget; inspect private task logs.');
    const parsed = parseEvents(result.stdout);
    await update(id, { ...parsed, state: 'checking', childPid: null });
    const verification = [];
    for (const argv of job.checks) {
      if (controller.signal.aborted) throw Error('Cancelled.');
      const r = await run(argv[0], argv.slice(1), { cwd: worktree, signal: controller.signal, onStart: pid => { update(id, { childPid: pid }).catch(() => {}); } });
      verification.push({ argv, exitCode: r.exitCode, timedOut: r.timedOut });
      atomic(path.join(dir, `check-${verification.length}.log`), r.stdout + '\n' + r.stderr);
      if (r.exitCode !== 0 || r.timedOut) { await update(id, { verification }); throw Error('A requested check failed; worktree retained for inspection.'); }
    }
    if (controller.signal.aborted) throw Error('Cancelled.');
    // Include new files when producing the reviewable patch. Also reject files
    // created by checks outside ownership; ignored build outputs stay excluded.
    git(worktree, ['add', '-A', '--', '.']);
    const changedFiles = git(worktree, ['diff', '--cached', '--no-renames', '--name-only', '-z', base]).split('\0').filter(Boolean);
    if ((!job.writer && changedFiles.length) || changedFiles.some(f => !inScope(f, job.scopes))) throw Error('Changes exceeded assigned scope; patch quarantined in worktree.');
    const raw = spawnPatch(worktree, base);
    const patch = path.join(dir, 'changes.patch'); atomic(patch, raw);
    const resultTree = git(worktree, ['write-tree']);
    await update(id, { state: 'ready', finishedAt: Date.now(), childPid: null, changedFiles, verification, resultTree, patch, ...parsed });
  } catch (error) {
    await update(id, { state: controller.signal.aborted ? 'cancelled' : 'failed', error: error.message, finishedAt: Date.now(), childPid: null }).catch(() => {});
  } finally { await pump().catch(() => {}); }
}

function spawnPatch(worktree, base) {
  // git() trims trailing newlines, which would corrupt a patch.
  const patch = git(worktree, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-renames', base]);
  return patch ? patch + '\n' : '';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv[2]);
