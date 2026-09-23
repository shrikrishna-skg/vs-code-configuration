#!/usr/bin/env node
// Validates the VS Code Chat custom agents and reply-style instruction file.
// Usage: node copilot-chat/scripts/check-copilot-agents.mjs [--live]
//   --live also checks the user prompts folder is identical to copilot-chat/config/prompts
//   and that the reply-style body still matches ~/.config/kilo/chat-response-style.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'config', 'prompts');
const live = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'prompts');

// Agent keys accepted by VS Code 1.139 (workbench prompt header validator).
const KEYS = new Set(['name', 'description', 'model', 'reasoning-effort', 'tools', 'advancedOptions', 'handoffs',
  'argument-hint', 'target', 'agents', 'hooks', 'user-invocable', 'disable-model-invocation', 'github']);
const LEADS = ['Astra Engineering Lead', 'Astra + Jev Engineering Lead', 'Fable Engineering Lead',
  'Fable + Jev Engineering Lead'];
const WORKERS = ['deepseek-workstream-lead', 'deepseek-implementer', 'glm-investigator', 'luna-utility'];
const AGENTS = {
  ...Object.fromEntries(LEADS.map((n) => [n, WORKERS])),
  'deepseek-workstream-lead': ['deepseek-implementer', 'glm-investigator', 'luna-utility'],
  'deepseek-implementer': [], 'glm-investigator': [], 'luna-utility': [],
};
const MARK = '<!-- Exact copy of ~/.config/kilo/chat-response-style.md';

const list = (v) => (v ?? '').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

function parse(file) {
  const m = fs.readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${file}: missing frontmatter`);
  return Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
}

function checkDir(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.agent.md'));
  assert.equal(files.length, 16, `${dir}: expected 16 agents, found ${files.length}`);
  const names = new Set();
  for (const f of files) {
    const file = path.join(dir, f);
    const fm = parse(file);
    const name = JSON.parse(fm.name);
    names.add(name);
    for (const k of Object.keys(fm)) assert.ok(KEYS.has(k), `${f}: unsupported key ${k}`);
    assert.ok(fm.description && fm.model && fm.tools, `${f}: description, model and tools are required`);
    const tools = list(fm.tools);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/peekaboo\/(browser|\*)/.test(text), `${f}: peekaboo browser or wildcard`);
    assert.equal(tools.some((t) => t.startsWith('claude-code-local/')), LEADS.includes(name), `${f}: claude-code-local is lead-only`);
    assert.ok(!/claude-code-local|Claude_Code_Local/.test(text) || LEADS.includes(name), `${f}: mentions claude-code-local`);
    if (name in AGENTS) assert.deepEqual(list(fm.agents), AGENTS[name], `${f}: subagent allow-list`);
    else assert.ok(!list(fm.agents).some((a) => !WORKERS.includes(a)), `${f}: may only call workers`);
    if (!list(fm.agents).length) assert.ok(!tools.includes('agent') && !tools.includes('agent/runSubagent'), `${f}: has agent tool without allow-list`);
    if (LEADS.includes(name)) assert.equal(fm['disable-model-invocation'], 'true', `${f}: leads must not be subagents`);
    if (WORKERS.includes(name)) assert.equal(fm['user-invocable'], 'false', `${f}: must be hidden`);
    if (name === 'glm-investigator') {
      assert.ok(!tools.some((t) => /^edit($|\/)/.test(t) || t === 'execute'), `${f}: GLM must be read-only`);
    }
  }
  for (const n of [...LEADS, ...WORKERS]) assert.ok(names.has(n), `${dir}: missing agent ${n}`);
  const style = fs.readFileSync(path.join(dir, 'reply-style.instructions.md'), 'utf8');
  assert.match(style, /^applyTo: "\*\*"$/m);
  assert.ok(style.includes(MARK), 'reply-style: missing copy marker');
  return style;
}

const repoStyle = checkDir(repo);
if (process.argv.includes('--live')) {
  checkDir(live);
  for (const f of fs.readdirSync(repo)) {
    assert.equal(fs.readFileSync(path.join(live, f), 'utf8'), fs.readFileSync(path.join(repo, f), 'utf8'), `live ${f} differs from repo`);
  }
  const src = fs.readFileSync(path.join(os.homedir(), '.config', 'kilo', 'chat-response-style.md'), 'utf8');
  assert.ok(repoStyle.endsWith(`-->\n\n${src}`), 'reply-style body drifted from ~/.config/kilo/chat-response-style.md');
}
console.log(`copilot agents ok${process.argv.includes('--live') ? ' (repo + live)' : ''}`);
