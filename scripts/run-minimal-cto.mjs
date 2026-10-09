#!/usr/bin/env node
// A separate runtime: never rewrite the live global config or active chat.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agentName, minimalConfig } from '../examples/cto/minimal/profile.mjs';
import { discoverBinary } from '../examples/cto/manager.mjs';

export function launchOptions(live, options) {
  const config = minimalConfig(live, options);
  const args = ['run', '--interactive', '--pure', '--agent', agentName, '--model', options.model, '--dir', options.directory];
  if (options.variant) args.push('--variant', options.variant);
  return { config, args };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--model', '--variant', '--dir'].includes(args[i]) || !args[i + 1]) throw Error('Usage: node scripts/run-minimal-cto.mjs --model provider/model [--variant high] [--dir /project]');
    values[args[i].slice(2)] = args[i + 1];
  }
  const directory = fs.realpathSync(values.dir || process.cwd());
  if (!fs.statSync(directory).isDirectory()) throw Error('Choose an existing project directory.');
  const livePath = path.join(os.homedir(), '.config/kilo/kilo.jsonc');
  const live = JSON.parse(fs.readFileSync(livePath, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  const { config, args: cliArgs } = launchOptions(live, {
    model: values.model, variant: values.variant, directory,
    ponytail: path.join(os.homedir(), '.config/ponytail/AGENTS.md'),
  });
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-minimal-cto-'));
  console.log('Minimal CTO pilot: single agent; external MCP tools disabled; live configuration unchanged.');
  const child = spawn(discoverBinary(), cliArgs, {
    cwd: directory, stdio: 'inherit',
    env: { ...process.env, XDG_CONFIG_HOME: isolated, KILO_CONFIG: '', KILO_CONFIG_DIR: '', KILO_CONFIG_CONTENT: JSON.stringify(config) },
  });
  const cleanup = () => fs.rmSync(isolated, { recursive: true, force: true });
  child.once('error', error => { cleanup(); console.error(error.message); process.exitCode = 1; });
  child.once('close', code => { cleanup(); process.exitCode = code ?? 1; });
}
