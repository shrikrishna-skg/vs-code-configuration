#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { submit, status, cancel, accept, pump } from './manager.mjs';

const object = properties => ({ type: 'object', additionalProperties: false, properties });
const string = { type: 'string' };
export const definitions = [
  { name: 'submit', description: 'Queue a bounded worker in an isolated Git snapshot. The service enforces 14 active workers, 6 writers, role limits, dependencies, and exclusive file scopes. Returns immediately. All checks run as explicit argv without a shell. Existing ignored dependencies/build files are not copied into worktrees. Worker code cannot use a shell or external MCP tools.', inputSchema: {
    ...object({ workspace: string, role: { enum: ['implementer', 'investigator', 'tester', 'reviewer', 'utility'] }, title: string, task: string, acceptance: string, scopes: { type: 'array', items: string }, dependsOn: { type: 'array', items: string }, checks: { type: 'array', items: { type: 'array', items: string } } }), required: ['workspace', 'role', 'title', 'task', 'acceptance'],
  } },
  { name: 'status', description: 'Get compact status, worker evidence, model, and worktree paths. Omit id to list recent work. Ready means awaiting CTO review, not accepted or integrated. Progress runs in detached workers and survives MCP restarts. For an active worker, pass its id and waitMs: 20000 to wait for a state change without ending the CTO turn.', inputSchema: object({ id: string, waitMs: { type: 'integer', minimum: 0, maximum: 20000 } }) },
  { name: 'cancel', description: 'Cancel queued work or stop a running process group. Running work occupies its slots until it actually stops. Worktrees and logs are retained. Also rejects a ready patch without applying it.', inputSchema: { ...object({ id: string }), required: ['id'] } },
  { name: 'accept', description: 'After inspecting a ready worker result, record acceptance and apply its scoped patch to the original working tree. Requires passing worker checks and unchanged destination scope. Does not commit or push. Combined integration checks remain the CTO responsibility. For read-only workers records acceptance without applying changes.', inputSchema: { ...object({ id: string, evidence: string }), required: ['id', 'evidence'] } },
];
export async function call(name, args = {}) {
  if (name === 'submit') return submit(args);
  if (name === 'status') return status(args.id, args.waitMs);
  if (name === 'cancel') return cancel(args.id);
  if (name === 'accept') return accept(args.id, args.evidence);
  throw Error('Unknown CTO tool.');
}
export function serve() {
  const lines = createInterface({ input: process.stdin });
  const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  lines.on('line', async line => {
    let request;
    try { if (line.length > 100000) throw Error('Request too large'); request = JSON.parse(line); }
    catch { return; }
    if (request.id === undefined) return;
    if (request.method === 'initialize') return reply(request.id, { protocolVersion: request.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'cto-workers', version: '1.0.0' } });
    if (request.method === 'ping') return reply(request.id, {});
    if (request.method === 'tools/list') return reply(request.id, { tools: definitions });
    if (request.method !== 'tools/call') return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown method' } }) + '\n');
    try { reply(request.id, { content: [{ type: 'text', text: JSON.stringify(await call(request.params.name, request.params.arguments)) }] }); }
    catch (e) { reply(request.id, { content: [{ type: 'text', text: e.message }], isError: true }); }
  });
  pump().catch(() => {});
  // MCP restarts intentionally do not cancel detached, durably tracked jobs.
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve();
