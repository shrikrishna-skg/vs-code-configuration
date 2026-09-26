#!/usr/bin/env node
// Screen runner: executes a JSON plan of Peekaboo CLI steps with a deterministic check
// after every step, asks Jev only for `expect_text`, and prints one compact JSON report.
// Usage: node peekaboo-runner.mjs <plan.json> | --recipe <name>  [--save <name>] [--confirmed <stepId>]...
// Speed: `peekaboo daemon start` keeps Peekaboo services warm between CLI calls; this
// runner never starts it.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluate, readKey } from './typesafe-mcp.mjs';

const ALLOWED = new Set(['see', 'click', 'type', 'press', 'scroll', 'set-value', 'action', 'menu', 'paste', 'app', 'window', 'dialog', 'verify']);
const STEP_KEYS = new Set(['id', 'do', 'see', 'expect', 'expect_text', 'confirm']);
const EXPECT_KEYS = new Set(['on', 'value', 'contains']);
// ponytail: English button names only; a localized or unusually worded destructive button still needs `confirm: true`.
const DESTRUCTIVE = /^\s*(delete|don['’]?t save|discard|replace|erase|send|pay|submit|remove|buy|purchase|overwrite|move to trash)\b/i;
const NAME = /^[a-z0-9-]{1,40}$/;
const RETRY_MS = 300; // ponytail: one fixed wait for UI lag; a slower app needs a `verify --timeout` expect instead.
export const recipesDir = () => process.env.PEEKABOO_RECIPES_DIR || path.join(os.homedir(), '.config', 'kilo', 'recipes');

const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\0');
const argv = v => Array.isArray(v) && v.length >= 1 && v.length <= 40 && v.every(a => str(a, 4000)) && ALLOWED.has(v[0]);

// Trust boundary: the plan comes from a model, so validate everything before running anything.
export function validate(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return 'plan must be an object';
  if (Object.keys(plan).some(k => !['app', 'steps'].includes(k))) return 'unknown top-level key';
  if (!str(plan.app, 200)) return 'app must be a non-empty string';
  if (!Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > 100) return 'steps must be an array of 1-100 steps';
  const ids = new Set();
  for (const s of plan.steps) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return 'step must be an object';
    const at = `step ${typeof s.id === 'string' ? s.id.slice(0, 40) : '?'}: `;
    if (Object.keys(s).some(k => !STEP_KEYS.has(k))) return at + 'unknown key';
    if (typeof s.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(s.id) || ids.has(s.id)) return at + 'id must be unique [A-Za-z0-9_-]{1,40}';
    ids.add(s.id);
    if ((s.do === undefined) === (s.see === undefined)) return at + 'needs exactly one of do or see';
    if (s.see !== undefined && s.see !== true) return at + 'see must be true';
    if (s.do !== undefined && !argv(s.do)) return at + `do must be a Peekaboo argv starting with one of: ${[...ALLOWED].join(', ')}`;
    const e = s.expect;
    const obj = e && typeof e === 'object' && !Array.isArray(e);
    if (e != null && !argv(e) && !(obj && str(e.on, 200) &&
      Object.keys(e).every(k => EXPECT_KEYS.has(k)) && ['value', 'contains'].every(k => e[k] === undefined || (typeof e[k] === 'string' && e[k].length <= 4000))) &&
      !(obj && typeof e.dialog === 'boolean' && Object.keys(e).every(k => ['dialog', 'button'].includes(k)) && (e.button === undefined || (e.dialog && str(e.button, 200)))))
      return at + 'expect must be null, an allowed Peekaboo argv, {on, value?, contains?} or {dialog: true|false, button?}';
    if (s.expect_text !== undefined && !str(s.expect_text, 2000)) return at + 'expect_text must be a string of 1-2000 chars';
    if (s.confirm !== undefined && typeof s.confirm !== 'boolean') return at + 'confirm must be boolean';
  }
  return null;
}

const clip = (v, n) => (v.length > n ? v.slice(0, n) + '…' : v);
const secure = e => /secure/i.test(`${e.ax_role} ${e.role_description}`);

// Text-only element map for Jev and for re-planning; never includes secure field values.
export function summarize(data) {
  const lines = [`app: ${data?.application_name ?? '?'}; window: ${data?.window_title ?? '?'}`];
  for (const e of data?.ui_elements ?? []) {
    const label = e.label || e.title || e.identifier || '';
    const value = secure(e) ? '[secure]' : e.value == null || e.value === '' || e.value === label ? '' : clip(String(e.value), 160);
    if (!label && !value) continue;
    lines.push(`${e.id} ${e.role}${label ? ` "${clip(label, 80)}"` : ''}${value ? ` = ${value}` : ''}`);
  }
  return clip(lines.join('\n'), 4000);
}

function exec(bin, args) {
  return new Promise(resolve => execFile(bin, args.includes('--json') ? args : [...args, '--json'],
    { timeout: 30000, maxBuffer: 32 << 20 }, (error, stdout) => {
      let body = null; try { body = JSON.parse(stdout); } catch {}
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, body });
    }));
}

// Deterministic pass/fail from Peekaboo's JSON envelope; `verify` must be satisfied, not unknown.
// With an expect, Peekaboo's own "unverifiable"/"suspected_noop" guesses defer to that check
// (e.g. `window close` reports suspected_noop while its save sheet is opening).
function outcome(args, { code, body }, deferToExpect = false) {
  if (!body || typeof body !== 'object') return `no JSON from peekaboo (exit ${code})`;
  if (deferToExpect && ['unverifiable', 'suspected_noop'].includes(body.effect)) return null;
  if (body.success !== true) return clip(String(body.error?.message ?? body.error?.code ?? 'failed'), 300);
  if (['refused', 'suspected_noop'].includes(body.effect)) return `effect ${body.effect}`;
  if (args[0] === 'verify' && body.data?.status !== 'satisfied') return `verify ${body.data?.status ?? 'unknown'}`;
  if (code !== 0) return `exit ${code}`;
  return null;
}

// Irreversible button presses always pass the confirm gate, even if the plan omits `confirm: true`.
function destructive(args) {
  if (!args) return false;
  const i = args.indexOf('--button'), flag = args.find(a => a.startsWith('--button='));
  const names = args[0] === 'dialog' && args[1] === 'click' ? [i > 0 ? args[i + 1] : undefined, flag?.slice(9)]
    : args[0] === 'click' && args[1] && !args[1].startsWith('-') ? [args[1]] : [];
  return names.some(n => typeof n === 'string' && DESTRUCTIVE.test(n));
}

function findElement(els, on) {
  const i = on.indexOf(':'), role = i > 0 ? on.slice(0, i) : null, label = i > 0 ? on.slice(i + 1) : on;
  const match = keys => els.find(e => (!role || e.role === role) && keys.some(k => e[k] === label));
  // Some apps relabel a field with its contents, so fall back to the stable role description.
  return els.find(e => e.id === on) ?? match(['label', 'title', 'identifier', 'description']) ?? match(['role_description']);
}

export async function run(plan, { bin = process.env.PEEKABOO_BIN || 'peekaboo', jev, confirmed = [], wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const started = performance.now(), steps = [];
  const report = extra => ({ ok: false, steps, ...extra, total_ms: Math.round(performance.now() - started) });
  const invalid = validate(plan);
  if (invalid) return report({ error: invalid });
  jev ??= async input => evaluate(input, { key: await readKey(), timeoutMs: 8000 });
  let snapshot = null, lastSee = null;
  const see = async () => {
    const r = await exec(bin, ['see', '--app', plan.app, '--tree', '--no-screenshot']);
    const err = outcome(['see'], r);
    if (!err) { snapshot = r.body.data?.snapshot_id ?? snapshot; lastSee = r.body.data; }
    return err;
  };
  const call = (args, deferToExpect) => {
    if (args.includes('$snapshot') && !snapshot) return Promise.resolve('$snapshot used before any see');
    return exec(bin, args.map(a => (a === '$snapshot' ? snapshot : a))).then(r => outcome(args, r, deferToExpect));
  };
  const check = async e => {
    if (Array.isArray(e)) return call(e);
    if (e.dialog !== undefined) {
      // Sheets and alerts are invisible to `see --app`; `dialog list` finds them.
      // Sheets animate in, so a positive check lets Peekaboo poll briefly.
      const { body } = await exec(bin, ['dialog', 'list', '--app', plan.app, ...(e.dialog ? ['--timeout', '2000'] : [])]);
      const buttons = body?.success === true ? (body.data?.buttons ?? []).map(String) : null;
      if (!e.dialog) return buttons ? `dialog still open: ${clip(buttons.join(', '), 120)}` : /no (active )?dialog/i.test(body?.error?.message ?? '') ? null : 'dialog state unknown';
      if (!buttons) return 'no dialog';
      return !e.button || buttons.some(b => b.toLowerCase() === e.button.toLowerCase()) ? null : `dialog buttons: ${clip(buttons.join(', '), 120)}`;
    }
    const err = await see(); if (err) return err;
    const el = findElement(lastSee?.ui_elements ?? [], e.on);
    if (!el) return `element not found: ${e.on}`;
    const v = el.value == null ? '' : String(el.value);
    if ((e.value !== undefined && v !== e.value) || (e.contains !== undefined && !v.includes(e.contains)))
      return secure(el) ? 'secure value mismatch' : `value mismatch: ${JSON.stringify(clip(v, 120))}`;
    return null;
  };
  let failed = null;
  for (const s of plan.steps) {
    if (failed) { steps.push({ id: s.id, status: 'skipped', ms: 0 }); continue; }
    const t = performance.now(), done = (status, error) => {
      steps.push({ id: s.id, status, ms: Math.round(performance.now() - t), ...(error ? { error } : {}) });
      if (status !== 'passed') failed = s.id;
    };
    if ((s.confirm || destructive(s.do)) && !confirmed.includes(s.id)) { done('needs_user_confirmation', 'irreversible step; rerun with --confirmed ' + s.id + ' after the user approves'); continue; }
    let err = s.see ? await see() : await call(s.do, s.expect != null);
    if (!err && s.expect != null) {
      err = await check(s.expect);
      if (err) { await wait(RETRY_MS); err = await check(s.expect); }
    }
    if (err) { done('failed', err); continue; }
    if (s.expect_text) {
      err = await see();
      if (err) { done('failed', err); continue; }
      const answer = await jev({ purpose: 'evidence_check', task: `Screen automation step ${s.id} in ${plan.app}.`,
        evidence: `Element map after the step (accessibility tree, text only):\n${summarize(lastSee)}`,
        requirements: [{ id: 'r1', text: s.expect_text }] });
      const a = answer?.answers?.r1;
      if (answer?.status !== 'advice' || !a) { done('unverified', `jev ${answer?.reason ?? 'unavailable'}`); continue; }
      if (a.choice !== 'supported' || !(a.confidence >= 0.9)) { done('failed', `jev ${a.choice} (${a.confidence})`); continue; }
    }
    done('passed');
  }
  if (!failed) return { ok: true, steps, total_ms: Math.round(performance.now() - started) };
  await see().catch(() => {});
  return report({ failed_step: failed, ...(lastSee ? { last_see_summary: clip(summarize(lastSee), 2000) } : {}) });
}

const recipePath = name => {
  if (typeof name !== 'string' || !NAME.test(name)) throw new Error('recipe name must match ^[a-z0-9-]{1,40}$');
  return path.join(recipesDir(), `${name}.json`);
};

export async function main(args) {
  const opts = { confirmed: [] }; let file, save, recipe;
  try {
    for (let i = 0; i < args.length; i++) {
      const a = args[i], next = () => { if (i + 1 >= args.length) throw new Error(`${a} needs a value`); return args[++i]; };
      if (a === '--save') save = recipePath(next());
      else if (a === '--recipe') recipe = recipePath(next());
      else if (a === '--confirmed') opts.confirmed.push(next());
      else if (!a.startsWith('--') && !file) file = a;
      else throw new Error(`unknown argument ${a}`);
    }
    if (!file === !recipe) throw new Error('give exactly one plan file or --recipe <name>');
    const source = file ?? recipe;
    if (fs.statSync(source).size > 262144) throw new Error('plan file larger than 256 KiB');
    const plan = JSON.parse(fs.readFileSync(source, 'utf8'));
    const result = await run(plan, opts);
    if (result.ok && save) {
      fs.mkdirSync(path.dirname(save), { recursive: true, mode: 0o700 });
      fs.writeFileSync(save, JSON.stringify(plan, null, 2) + '\n', { mode: 0o600 });
      result.saved = path.basename(save, '.json');
    }
    return result;
  } catch (error) {
    return { ok: false, steps: [], error: clip(String(error.message), 300), total_ms: 0 };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await main(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.ok ? 0 : 1;
}
