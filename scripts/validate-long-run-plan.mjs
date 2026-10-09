#!/usr/bin/env node
// Validate a long-running task plan (JSON). Usage: node scripts/validate-long-run-plan.mjs <plan.json>
// Exits 0 when valid, 1 when invalid or unreadable, 2 on wrong usage. See docs/long-run-plan-pilot.md.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const STATES = ['queued', 'active', 'waiting', 'completed', 'failed', 'cancelled'];
export const MAX_OPEN = 20; // active + queued
export const MAX_ACTIVE = 8;

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = v => typeof v === 'string' && v.trim() !== '';

// Returns every validation error as a string; an empty array means the plan is valid.
export function validatePlan(plan) {
  if (!isObject(plan)) return ['plan: must be a JSON object'];
  const errors = [];
  if (!nonEmpty(plan.objective)) errors.push('objective: must be a non-empty string');

  const reqIds = new Set();
  if (!Array.isArray(plan.requirements) || !plan.requirements.length) errors.push('requirements: must be a non-empty array');
  else plan.requirements.forEach((req, i) => {
    const id = req?.id;
    if (!nonEmpty(id)) errors.push(`requirements[${i}].id: must be a non-empty string`);
    else if (reqIds.has(id)) errors.push(`requirements[${i}].id: duplicate requirement ID "${id}"`);
    else reqIds.add(id);
  });

  if (!Array.isArray(plan.tasks)) { errors.push('tasks: must be an array'); return errors; }
  const taskIds = new Set(), scopeHolders = new Map(), counts = {};
  plan.tasks.forEach((task, i) => {
    const at = `tasks[${i}]`;
    if (!isObject(task)) return errors.push(`${at}: must be an object`);
    if (!nonEmpty(task.id)) errors.push(`${at}.id: must be a non-empty string`);
    else if (taskIds.has(task.id)) errors.push(`${at}.id: duplicate task ID "${task.id}"`);
    else taskIds.add(task.id);
    if (!STATES.includes(task.state)) errors.push(`${at}.state: must be one of ${STATES.join('/')}, got ${JSON.stringify(task.state)}`);
    else counts[task.state] = (counts[task.state] ?? 0) + 1;

    if (task.writer !== undefined && typeof task.writer !== 'boolean') errors.push(`${at}.writer: must be a boolean`);
    if (task.writer === true) {
      if (!nonEmpty(task.owner)) errors.push(`${at}.owner: writer tasks need a non-empty owner`);
      const scopes = task.exclusiveScopes;
      if (!Array.isArray(scopes) || !scopes.length || !scopes.every(nonEmpty)) {
        errors.push(`${at}.exclusiveScopes: writer tasks need a non-empty array of non-empty strings`);
      } else if (task.state === 'active' || task.state === 'waiting') {
        // ponytail: scopes conflict only on exact string match, so "scripts/" and "scripts/a.mjs" pass.
        // Upgrade path: normalize paths and treat directory-prefix overlap as a conflict.
        for (const scope of new Set(scopes)) {
          const holder = scopeHolders.get(scope);
          if (holder) errors.push(`${at}.exclusiveScopes: "${scope}" is already held by active/waiting writer ${holder}`);
          else scopeHolders.set(scope, nonEmpty(task.id) ? task.id : at);
        }
      }
    }

    if (task.requirements !== undefined) {
      if (!Array.isArray(task.requirements)) errors.push(`${at}.requirements: must be an array of requirement IDs`);
      else for (const ref of task.requirements) {
        if (!reqIds.has(ref)) errors.push(`${at}.requirements: unknown requirement ${JSON.stringify(ref)}`);
      }
    }
  });

  const active = counts.active ?? 0, open = active + (counts.queued ?? 0);
  if (open > MAX_OPEN) errors.push(`tasks: ${open} active+queued tasks exceed the limit of ${MAX_OPEN}`);
  if (active > MAX_ACTIVE) errors.push(`tasks: ${active} active tasks exceed the limit of ${MAX_ACTIVE}`);
  return errors;
}

export function main(args) {
  if (args.length !== 1) {
    console.error('usage: node scripts/validate-long-run-plan.mjs <plan.json>');
    return 2;
  }
  const [file] = args;
  let text, plan;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { console.error(`invalid: ${file}\n- cannot read file: ${error.message}`); return 1; }
  try { plan = JSON.parse(text); }
  catch (error) { console.error(`invalid: ${file}\n- malformed JSON: ${error.message}`); return 1; }
  const errors = validatePlan(plan);
  if (errors.length) {
    console.error(`invalid: ${file} (${errors.length} error${errors.length === 1 ? '' : 's'})`);
    for (const error of errors) console.error(`- ${error}`);
    return 1;
  }
  console.log(`valid: ${file}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
