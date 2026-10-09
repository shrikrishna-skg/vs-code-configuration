import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { invocation, parseResult } from './kilo-workers-mcp.mjs';

for (const name of ['deepseek_plan', 'glm_investigate', 'astra_review']) {
  const spec = await invocation(name, { workspace: process.cwd(), task: 'Public validation prompt.' });
  const config = JSON.parse(spec.env.KILO_CONFIG_CONTENT);
  const agent = config.agent[config.default_agent];
  assert(agent.prompt.includes('# Ponytail, lazy senior dev mode'), 'context-only coding proposals must receive Ponytail');
  for (const tool of ['read', 'glob', 'grep', 'bash', 'edit', 'write', 'task']) {
    assert.equal(agent.permission[tool], 'deny');
    assert.equal(agent.tools[tool], false);
  }
  assert.equal(agent.permission['*'], 'deny');
  assert.equal(agent.permission.external_directory, 'deny');
  assert.equal(spec.args.includes('--auto'), false);
  assert.equal(spec.args.includes('--pure'), true);
  assert.equal(spec.cwd, undefined);
  assert.equal(spec.args.includes('--dir'), false);
}
await assert.rejects(invocation('deepseek_plan', { workspace: process.cwd(), task: 'api_key=abcdefghijklmnopqrstuvwxyz1234567890' }), /sensitive_input/);
await assert.rejects(invocation('glm_investigate', { workspace: '/', task: 'Public prompt.' }), /invalid_workspace/);
assert.equal(parseResult('{"type":"step_start"}\n{"type":"text","part":{"text":"READY"}}\n{"type":"step_finish","part":{"reason":"stop"}}'), 'READY');
assert.throws(() => parseResult('{"type":"error"}'), /worker_provider_error/);
assert.throws(() => parseResult('{"type":"text","part":{"text":"incomplete"}}'), /worker_incomplete/);

const requests = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'unregistered', arguments: {} } },
];
const child = spawnSync(process.execPath, [fileURLToPath(new URL('./kilo-workers-mcp.mjs', import.meta.url))], { input: requests.map(r => JSON.stringify(r)).join('\n') + '\n', encoding: 'utf8', timeout: 5000 });
assert.equal(child.status, 0);
const responses = child.stdout.trim().split('\n').map(JSON.parse);
assert.equal(responses.length, 3);
assert.equal(responses[0].result.serverInfo.name, 'claude-engineering-workers');
assert.deepEqual(responses[1].result.tools.map(t => t.name), ['deepseek_plan', 'glm_investigate', 'astra_review']);
assert.equal(responses[2].error.code, -32602);
console.log('PASS: context-only permissions, sensitive-input rejection, bounded output parsing, and MCP discovery protocol.');
