import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Small stdio MCP client. Screenshots remain content blocks, never console text.
export class Client {
  constructor(command, { timeout = 45000, cwd, env } = {}) {
    this.timeout = timeout; this.next = 0; this.pending = new Map();
    this.child = spawn(command[0], command.slice(1), { cwd, env: env || process.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', () => {});
    createInterface({ input: this.child.stdout }).on('line', line => {
      let r; try { r = JSON.parse(line); } catch { return; }
      if (r.method && r.id !== undefined) {
        const result = r.method === 'roots/list' ? { roots: [] } : {};
        this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }) + '\n');
      }
      const p = this.pending.get(r.id);
      if (!p) return;
      this.pending.delete(r.id); clearTimeout(p.timer);
      r.error ? p.reject(Error(r.error.message)) : p.resolve(r.result);
    });
    this.child.on('error', e => this.fail(e));
    this.closed = new Promise(resolve => this.child.on('close', () => { this.fail(Error('Backend closed')); resolve(); }));
  }
  fail(error) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); }
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Backend request timed out')); }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async init() {
    await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: { roots: {} }, clientInfo: { name: 'shared-computer', version: '1.0.0' } });
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return (await this.request('tools/list')).tools;
  }
  async close() {
    if (this.child.exitCode !== null || this.child.signalCode) return this.closed;
    try { process.kill(-this.child.pid, 'SIGTERM'); } catch {}
    const timer = setTimeout(() => { try { process.kill(-this.child.pid, 'SIGKILL'); } catch {} }, 1000);
    await this.closed; clearTimeout(timer);
  }
}
