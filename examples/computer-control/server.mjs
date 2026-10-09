#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from './client.mjs';
import { Lease } from './lease.mjs';

const object = properties => ({ type: 'object', additionalProperties: false, properties });
const token = { type: 'string', description: 'Opaque token returned by acquire in this same client session.' };
const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const desktopNames = new Set(['permissions', 'see', 'inspect_ui', 'verify_state', 'image', 'click', 'type', 'press', 'scroll', 'set_value', 'action', 'app', 'window', 'menu', 'dialog', 'dock', 'space']);
const browserNames = new Set(['browser_close', 'browser_resize', 'browser_console_messages', 'browser_handle_dialog', 'browser_file_upload', 'browser_press_key', 'browser_navigate', 'browser_navigate_back', 'browser_network_requests', 'browser_take_screenshot', 'browser_snapshot', 'browser_click', 'browser_drag', 'browser_hover', 'browser_select_option', 'browser_tabs', 'browser_wait_for', 'browser_type', 'browser_fill_form']);
const snapshotActions = new Set(['click', 'type', 'press', 'scroll', 'set_value', 'action']);
const desktopReads = new Set(['permissions', 'see', 'inspect_ui', 'verify_state', 'image', 'dock']);
const browserReads = new Set(['browser_console_messages', 'browser_network_requests', 'browser_take_screenshot', 'browser_snapshot', 'browser_wait_for']);
const baseTools = [
  { name: 'acquire', description: 'Acquire the one shared computer lease before desktop or browser use. If busy, do independent work; do not bypass this service. Repeating from this session renews it. Release promptly when done.', inputSchema: { ...object({ purpose: { type: 'string', maxLength: 240 }, ttl: { type: 'integer', minimum: 10, maximum: 300, default: 120 } }), required: ['purpose'] } },
  { name: 'status', description: 'Read lease availability without controlling the computer.', inputSchema: object({}) },
  { name: 'release', description: 'Release this session’s lease and close its automation backends/browser. Saved browser files remain. Call after verification, including when blocked.', inputSchema: { ...object({ token }), required: ['token'] } },
];

export class Computer {
  constructor(config) {
    this.config = config; this.lease = new Lease(config.stateDir); this.clients = new Map(); this.definitions = new Map(); this.snapshots = new Set(); this.browserObserved = false;
  }
  async backend(kind, state) {
    if (this.clients.has(kind)) return this.clients.get(kind);
    const command = this.config[kind];
    if (!Array.isArray(command) || !command.length) throw Error(`${kind} backend is not configured.`);
    const client = new Client(command, { timeout: this.config.timeout || 45000 });
    this.clients.set(kind, client);
    if (state) { state.backends.push(client.child.pid); this.lease.write(state); }
    try { await client.init(); return client; } catch (e) { await client.close(); this.clients.delete(kind); throw e; }
  }
  async tools() {
    if (this.definitions.size) return [...baseTools, ...this.definitions.values()];
    const discovered = new Map();
    // Discovery does not capture the screen or launch a browser. These processes are
    // closed immediately; only a lease holder starts backends capable of operations.
    for (const kind of ['desktop', 'browser']) {
      const client = new Client(this.config[kind], { timeout: this.config.timeout || 45000 });
      try {
        for (const tool of await client.init()) {
          if (!(kind === 'desktop' ? desktopNames : browserNames).has(tool.name)) continue;
          const name = kind === 'desktop' ? 'desktop_' + tool.name : tool.name;
          const required = [...(tool.inputSchema.required || []), 'token'];
          const properties = { ...tool.inputSchema.properties, token };
          if (kind === 'desktop' && snapshotActions.has(tool.name)) {
            if (!required.includes('snapshot')) required.push('snapshot');
            properties.snapshot = { type: 'string', description: 'Required fresh snapshot from this lease’s latest see or inspect_ui. Observe again after each mutation.' };
          }
          const rule = kind === 'browser' ? ' Call browser_snapshot again after every mutation before the next action.' : '';
          discovered.set(name, { ...tool, name, description: `Requires shared lease token.${rule} ${tool.description}`, inputSchema: { ...tool.inputSchema, properties, required } });
        }
      } finally { await client.close(); }
    }
    this.definitions = discovered;
    return [...baseTools, ...this.definitions.values()];
  }
  remember(result) {
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      for (const [k, v] of Object.entries(value)) {
        if (/^(snapshot_id|snapshotId|snapshot|reference_id)$/.test(k) && typeof v === 'string') this.snapshots.add(v);
        else if (typeof v === 'object') visit(v);
      }
    };
    visit(result);
    for (const c of result.content || []) if (c.type === 'text') {
      try { visit(JSON.parse(c.text)); } catch {}
      for (const m of c.text.matchAll(/(?:snapshot(?:[ _]id)?|reference_id)["\s:=]+([A-Za-z0-9_-]{12,})/ig)) this.snapshots.add(m[1]);
    }
    this.observedAt = Date.now();
  }
  async close() {
    await Promise.all([...this.clients.values()].map(c => c.close())); this.clients.clear(); this.snapshots.clear(); this.browserObserved = false;
  }
  async call(name, args = {}) {
    if (name === 'acquire') {
      const r = await this.lease.acquire(args.purpose, args.ttl);
      if (r.acquired) { if (this.activeToken !== r.token) await this.close(); this.activeToken = r.token; }
      return text(r);
    }
    if (name === 'status') return text(await this.lease.status());
    if (name === 'release') return text(await this.lease.release(args.token, () => this.close()));
    if (!this.definitions.has(name)) throw Error('Unknown computer tool.');
    return this.lease.use(args.token, async state => {
      const { token: _, ...input } = args;
      const desktop = name.startsWith('desktop_'), upstream = desktop ? name.slice(8) : name;
      if (desktop && snapshotActions.has(upstream)) {
        if (!input.snapshot || !this.snapshots.has(input.snapshot) || Date.now() - this.observedAt > 60000) throw Error('A fresh snapshot from this lease is required. Observe the exact window again.');
        if (input.coordinate_reference && input.coordinate_reference !== input.snapshot) throw Error('Coordinate reference differs from snapshot.');
      }
      if (desktop && ['see', 'inspect_ui'].includes(upstream)) this.snapshots.clear();
      // A modal/chooser can prevent a page snapshot until it is handled. The
      // upstream owns that exact pending dialog inside this lease's browser.
      if (!desktop && !browserReads.has(upstream) && !['browser_navigate', 'browser_close', 'browser_resize', 'browser_tabs', 'browser_handle_dialog', 'browser_file_upload'].includes(upstream) && !this.browserObserved) throw Error('Take a browser_snapshot before acting.');
      const client = await this.backend(desktop ? 'desktop' : 'browser', state);
      const started = Date.now();
      try {
        let result = await client.request('tools/call', { name: upstream, arguments: input });
        // This refusal occurs before capture dispatch. A read-only classic retry
        // does not stop or steal the other session's ScreenCaptureKit owner.
        if (desktop && upstream === 'see' && !input.capture_engine && result.isError &&
            result.content?.some(c => c.type === 'text' && /ScreenCaptureKit is already owned/.test(c.text))) {
          result = await client.request('tools/call', { name: upstream, arguments: { ...input, capture_engine: 'classic' } });
        }
        if (desktop) {
          if (!desktopReads.has(upstream) && !(input.action === 'list')) this.snapshots.clear();
          if (['see', 'inspect_ui'].includes(upstream) && !result.isError) this.remember(result);
          if (result._meta) {
            // Some clients discard MCP _meta before showing a tool result to the
            // model. Make delivery uncertainty and coordinate frames visible too.
            const keys = ['state', 'effect', 'evidence', 'escalation', 'retry_safety', 'requires_fresh_observation', 'mutation_dispatched', 'coordinate_context', 'target_receipt'];
            const evidence = Object.fromEntries(keys.filter(k => result._meta[k] !== undefined).map(k => [k, result._meta[k]]));
            if (Object.keys(evidence).length) result = { ...result, content: [...(result.content || []), { type: 'text', text: 'Native evidence (not a success claim): ' + JSON.stringify(evidence) }] };
          }
        } else {
          if (!browserReads.has(upstream)) this.browserObserved = false;
          if (upstream === 'browser_snapshot' && !result.isError) this.browserObserved = true;
        }
        // No screen, payload, token or page text in persistent audit records.
        fs.appendFileSync(path.join(this.config.stateDir, 'events.jsonl'), JSON.stringify({ time: new Date().toISOString(), tool: name, ms: Date.now() - started, isError: !!result.isError }) + '\n', { mode: 0o600 });
        return result;
      } catch (e) { await this.close(); throw e; }
    });
  }
}

export async function serve(config) {
  const computer = new Computer(config);
  const lines = createInterface({ input: process.stdin });
  let queue = Promise.resolve();
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  const handle = async r => {
    if (r.id === undefined) return;
    try {
      let result;
      if (r.method === 'initialize') result = { protocolVersion: r.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'shared-computer', version: '1.0.0' } };
      else if (r.method === 'ping') result = {};
      else if (r.method === 'tools/list') result = { tools: await computer.tools() };
      else if (r.method === 'tools/call') result = await computer.call(r.params.name, r.params.arguments);
      else { send({ jsonrpc: '2.0', id: r.id, error: { code: -32601, message: 'Unknown method' } }); return; }
      send({ jsonrpc: '2.0', id: r.id, result });
    } catch (e) {
      send(r.method === 'tools/call'
        ? { jsonrpc: '2.0', id: r.id, result: { content: [{ type: 'text', text: e.message }], isError: true } }
        : { jsonrpc: '2.0', id: r.id, error: { code: -32603, message: e.message } });
    }
  };
  lines.on('line', line => {
    let r; try { if (line.length > 2_000_000) throw Error(); r = JSON.parse(line); } catch { return; }
    queue = queue.then(() => handle(r));
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    await queue; await computer.close();
    if (computer.activeToken) await computer.lease.release(computer.activeToken, async () => {}).catch(() => {});
    process.exit(0);
  };
  lines.on('close', stop); process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.env.COMPUTER_CONFIG || path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.json');
  await serve(JSON.parse(fs.readFileSync(file, 'utf8')));
}
