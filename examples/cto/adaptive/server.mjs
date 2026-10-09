#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '../server.mjs';
import { locked, home } from '../manager.mjs';
import { publish, consult } from './session.mjs';

const session = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const definitions = [
  { name: 'publish', description: 'Run the user-approved verification commands and apply only the scoped patch to the original project. Fails without applying if a check fails, scope is exceeded, or source changed. Successful calls checkpoint the session for the next request. No arbitrary commands accepted.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'status', description: 'Show routine scope, applied revision count and latest check evidence. A working-tree edit is not delivery until publish reports applied:true.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'consult', description: 'Ask the configured premium CTO a focused, read-only question when judgment is needed. This is an additional model call. Advice cannot enlarge the user-approved scope or authorize changes.', inputSchema: { type: 'object', properties: { question: { type: 'string', maxLength: 12000 } }, required: ['question'], additionalProperties: false } },
];
serve({ definitions, pump: async () => {}, call: async (name, args = {}) => {
  if (name === 'publish') return publish(session.id);
  if (name === 'consult') {
    const live = JSON.parse(fs.readFileSync(session.configPath, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
    return consult(session.id, args.question, session.premiumModel, session.variant, live);
  }
  if (name === 'status') return locked(db => {
    const job = db.tasks.find(t => t.id === session.id);
    if (!job) throw Error('Unknown routine session.');
    return { state: job.state, repo: job.repo, scopes: job.scopes, revisions: job.history?.length || 0, checks: job.verification, logs: (job.verification || []).map((_, i) => {
      const file = path.join(home, 'jobs', job.id, `routine-check-${i}.log`);
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').slice(-1500) : '';
    }) };
  });
  throw Error('Unknown routine tool.');
} });
