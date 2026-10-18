#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkRender } from './check-kilo-render.mjs';

const backupFile = name => /\.pre[-.]|\.bak(?:[-.]|$)|\.safe-patch-/.test(name);
function files(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    if (backupFile(entry.name)) return [];
    const name = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw Error(`Symlink in patch target: ${name}`);
    return entry.isDirectory() ? files(root, name) : [name];
  }).sort();
}
function snapshot(root) {
  return new Map(files(root).map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')]));
}
const same = (a, b) => a.size === b.size && [...a].every(([name, hash]) => b.get(name) === hash);
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 120000 });
  if (result.status !== 0) throw Error(`${path.basename(command)} ${args.map(a => path.basename(a)).join(' ')} failed\n${(result.stderr || result.stdout || result.error?.message || '').slice(-3000)}`);
}

export async function install(mode, command, targets = []) {
  const extensionRoot = process.env.KILO_EXTENSIONS_DIR || path.join(os.homedir(), '.vscode/extensions');
  const roots = mode === 'reapply'
    ? ['shrikrishna-skg.kilo-code-local-', 'kilocode.kilo-code-'].flatMap(prefix => {
      const name = fs.readdirSync(extensionRoot).filter(name => name.startsWith(prefix))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
      return name ? [path.join(extensionRoot, name, 'dist')] : [];
    })
    : [...new Set(targets.map(target => {
      let dir = fs.statSync(target).isDirectory() ? path.resolve(target) : path.dirname(path.resolve(target));
      while (path.basename(dir) !== 'dist') {
        const parent = path.dirname(dir);
        if (parent === dir) throw Error('Patch targets must be within an extension dist directory');
        dir = parent;
      }
      return dir;
    }))];
  if (!roots.length) throw Error('No installed Kilo patch target found');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-patch-stage-'));
  const staged = [], originals = [], prepared = [], committed = [], locks = [];
  try {
    for (const root of [...roots].sort()) {
      const lock = root + '.kilo-patch-lock';
      const fd = fs.openSync(lock, 'wx');
      locks.push(lock);
      try { fs.writeFileSync(fd, String(process.pid)); } finally { fs.closeSync(fd); }
    }
    for (const root of roots) {
      const dest = mode === 'reapply' ? path.join(temp, path.basename(path.dirname(root)), 'dist') : path.join(temp, String(staged.length), 'dist');
      originals.push(snapshot(root));
      fs.cpSync(root, dest, { recursive: true, mode: fs.constants.COPYFILE_FICLONE,
        filter: source => !backupFile(path.basename(source)) });
      staged.push(dest);
    }
    const env = { ...process.env, KILO_PATCH_STAGING: '1', KILO_EXTENSIONS_DIR: temp, KILO_PATCH_SETTLE: '0' };
    const mapped = targets.map(target => {
      const i = roots.findIndex(root => path.resolve(target) === root || path.resolve(target).startsWith(root + path.sep));
      return path.join(staged[i], path.relative(roots[i], path.resolve(target)));
    });
    const apply = () => mode === 'reapply' ? run('bash', [command], env)
      : run(process.execPath, [command, ...mapped, '--apply'], env);
    apply();
    if (mode === 'patch') run(process.execPath, [command, ...mapped, '--check'], env);
    const first = staged.map(snapshot);
    apply();
    if (mode === 'patch') run(process.execPath, [command, ...mapped, '--check'], env);
    if (staged.some((root, i) => !same(first[i], snapshot(root)))) throw Error('Patch is not idempotent');
    for (const root of staged) for (const name of files(root)) {
      if (/\.(?:js|cjs|mjs)$/.test(name)) run(process.execPath, ['--check', path.join(root, name)]);
    }
    await checkRender(staged);
    // Do not overwrite edits made by another chat while validation was running.
    if (roots.some((root, i) => !same(originals[i], snapshot(root)))) throw Error('Installed files changed during validation; retry after the other writer finishes');
    for (let i = 0; i < roots.length; i++) {
      if ([...originals[i].keys()].some(name => !first[i].has(name))) throw Error('Patch unexpectedly deleted an installed file');
      for (const [name, hash] of first[i]) {
        if (originals[i].get(name) === hash) continue;
        const target = path.join(roots[i], name), candidate = target + '.safe-patch-' + randomUUID();
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const backup = fs.existsSync(target) ? target + '.pre-validated-' + randomUUID() : null;
        if (backup) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
        fs.copyFileSync(path.join(staged[i], name), candidate, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(candidate, fs.statSync(path.join(staged[i], name)).mode & 0o777);
        prepared.push({ target, candidate, backup });
      }
    }
    // Dependencies first, executable entry points last; each replacement is atomic.
    prepared.sort((a, b) => Number(/(?:extension|webview|agent-manager)\.js$/.test(a.target)) - Number(/(?:extension|webview|agent-manager)\.js$/.test(b.target)));
    for (const entry of prepared) {
      fs.renameSync(entry.candidate, entry.target);
      committed.push(entry);
    }
    console.log(`PASS Kilo patch gate: syntax, rendering, idempotence; ${committed.length} files installed`);
    return committed.length;
  } catch (error) {
    for (const entry of committed.reverse()) {
      if (entry.backup) fs.renameSync(entry.backup, entry.target);
      else fs.rmSync(entry.target, { force: true });
    }
    throw error;
  } finally {
    for (const entry of prepared) fs.rmSync(entry.candidate, { force: true });
    for (const lock of locks) fs.rmSync(lock, { force: true });
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, command, ...targets] = process.argv.slice(2);
  const report = message => {
    console.log(message);
    const log = process.env.KILO_PATCH_LOG || path.join(os.homedir(), '.config/kilo/logs/kilo-patches.log');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.appendFileSync(log, `${new Date().toISOString()} ${message}\n`);
  };
  const notify = message => spawnSync('osascript', ['-e', `display notification ${JSON.stringify(message)} with title "Kilo Code"`]);
  try {
    if (!['reapply', 'patch'].includes(mode) || !command || (mode === 'patch' && !targets.length))
      throw Error('Usage: safe-kilo-patches.mjs reapply <installer.sh> | patch <patch.mjs> <dist targets...>');
    const changed = await install(mode, path.resolve(command), targets.map(target => path.resolve(target)));
    report(changed ? 'Validated patch installed; reload only when running work can safely restart.' : 'All patches validated; no installed files changed.');
    if (changed) notify('Kilo patches validated and installed. Reload when running work can safely restart.');
  } catch (error) {
    report('Kilo patch BLOCKED; previous installed files preserved. ' + error.message);
    notify('Kilo patch blocked. Previous files preserved; see kilo-patches.log.');
    process.exitCode = 1;
  }
}
