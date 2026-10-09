import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const alive = pid => { if (!Number.isInteger(pid) || pid < 2) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const wait = ms => new Promise(r => setTimeout(r, ms));

export class Lease {
  constructor(dir) {
    this.dir = dir; this.owner = crypto.randomUUID();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, 'lease.json'); this.mutex = path.join(dir, 'mutex');
  }
  read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
  write(value) {
    const temp = this.file + '.' + this.owner;
    fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temp, this.file);
  }
  async lock(fn) {
    const until = Date.now() + 55000;
    while (true) {
      try {
        fs.mkdirSync(this.mutex, { mode: 0o700 });
        fs.writeFileSync(path.join(this.mutex, 'owner'), String(process.pid), { mode: 0o600 });
        break;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let pid;
        try { pid = Number(fs.readFileSync(path.join(this.mutex, 'owner'), 'utf8')); } catch {}
        if ((pid && !alive(pid)) || (!pid && Date.now() - fs.statSync(this.mutex).mtimeMs > 10000)) {
          const abandoned = this.mutex + '.dead.' + crypto.randomUUID();
          try {
            // Only one contender may reap this particular dead directory.
            const reaper = path.join(this.mutex, 'reaping');
            try { fs.writeFileSync(reaper, String(process.pid), { flag: 'wx' }); }
            catch (error) {
              if (error.code !== 'EEXIST') throw error;
              const other = Number(fs.readFileSync(reaper, 'utf8'));
              if (!alive(other)) fs.unlinkSync(reaper);
              continue;
            }
            let current = 0;
            try { current = Number(fs.readFileSync(path.join(this.mutex, 'owner'), 'utf8')); } catch {}
            if (!alive(current)) { fs.renameSync(this.mutex, abandoned); fs.rmSync(abandoned, { recursive: true }); }
            else fs.unlinkSync(reaper);
          } catch {}
          continue;
        }
        if (Date.now() >= until) throw Error('Computer is busy with an operation; retry status later.');
        await wait(25);
      }
    }
    try { return await fn(); } finally { fs.rmSync(this.mutex, { recursive: true, force: true }); }
  }
  async clean(state) {
    if (!state) return null;
    if (state.expires > Date.now() && alive(state.pid)) return state;
    // All backends are separate process groups; stop them before transferring ownership.
    for (const pid of state.backends || []) { try { process.kill(-pid, 'SIGTERM'); } catch {} }
    await wait(100);
    for (const pid of state.backends || []) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
    this.write(null); return null;
  }
  async acquire(purpose, ttl = 120) {
    if (typeof purpose !== 'string' || !purpose.trim() || purpose.length > 240) throw Error('A short purpose is required.');
    if (!Number.isInteger(ttl) || ttl < 10 || ttl > 300) throw Error('ttl must be 10–300 seconds.');
    return this.lock(async () => {
      const old = await this.clean(this.read());
      if (old && old.owner !== this.owner) return { acquired: false, busy: true, expires: old.expires };
      const state = old || { owner: this.owner, token: crypto.randomUUID(), pid: process.pid, backends: [], created: Date.now() };
      Object.assign(state, { purpose, ttl, expires: Date.now() + ttl * 1000 }); this.write(state);
      return { acquired: true, token: state.token, expires: state.expires };
    });
  }
  async use(token, fn) {
    return this.lock(async () => {
      const state = await this.clean(this.read());
      if (!state || state.owner !== this.owner || state.token !== token) throw Error('No valid lease for this client. Call acquire first.');
      try { return await fn(state); }
      finally { state.expires = Date.now() + state.ttl * 1000; this.write(state); }
    });
  }
  async release(token, cleanup) {
    return this.lock(async () => {
      const state = this.read();
      if (!state || state.owner !== this.owner || state.token !== token) throw Error('No matching lease to release.');
      await cleanup(); this.write(null); return { released: true };
    });
  }
  async status() { return this.lock(async () => { const s = await this.clean(this.read()); return { busy: !!s, ownedByThisClient: s?.owner === this.owner, expires: s?.expires }; }); }
}
