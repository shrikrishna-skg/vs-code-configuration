import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimalConfig } from '../minimal/profile.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
export const names = { cto: 'CTO Coordinated', routine: 'CTO Routine', utility: 'CTO Mechanical' };
export const style = `Every final reply must include these three exact headings in order: ## Answer, ## My opinion, ## Next step. Do not omit My opinion for short replies. Optionally place ## Verification after Answer for checks actually run. My opinion is at most two sentences; Next step is one concrete action, or no further action needed. Progress may be brief plain prose. Do not create answer.md unless requested.`;
export function specialistModel(role, agentDirectory) {
  const filename = role === 'utility' ? 'luna-utility' : role === 'investigator' ? 'glm-investigator' : 'deepseek-implementer';
  const model = fs.readFileSync(path.join(agentDirectory, filename + '.md'), 'utf8').match(/^model:\s*(\S+)/m)?.[1];
  if (!model) throw Error(`No configured model for ${filename}`);
  return model;
}

export function adaptiveConfig(live, options) {
  const { mode, model, variant, ponytail, contract, sessionFile } = options;
  if (!names[mode]) throw Error('Choose cto, routine or utility mode.');
  const config = minimalConfig(live, { model, variant, ponytail });
  const agent = config.agent['CTO Minimal'];
  delete config.agent['CTO Minimal'];
  config.default_agent = names[mode];
  config.agent[names[mode]] = agent;
  if (mode === 'cto') {
    agent.prompt = `You are the accountable CTO. Understand the current goal, resolve material ambiguity, and choose the smallest useful team. Delegate substantial implementation and batches of small edits to DeepSeek implementers; use GLM for investigation or independent review, and Luna only for mechanical work. Keep brief decisions and tiny fixes direct when delegation would add more work.
Use only cto_submit/status/cancel/accept for delegation. The shared pool enforces 14 workers and 6 worker writers; test authors and utilities share these limits. Assign independent component scopes, acceptance criteria and meaningful check argv. Inspect ready diffs and checks before accepting; then verify the integrated result. Passing tests never override the user's actual request. Do not expand scope to make unrelated tests pass. Investigate shared causes before splitting work by file. Send focused context and project rules, not the full transcript. Workers cannot execute shell commands; their supervisor runs the specified checks. Do not silently switch models.
Own dispatch through completion in this turn; use bounded status waits while workers run. Do not finish merely because assignments were submitted. Handle missing dependencies honestly. Preserve user changes; do not overwrite conflicts. If editing directly, stay out of worker-owned scopes and leave one writer slot for yourself. ${style}`;
    agent.permission['cto_*'] = 'allow';
    config.mcp.cto = { type: 'local', command: [process.execPath, path.join(directory, '../server.mjs')], enabled: true, timeout: 30000 };
    // Retain the established desktop lease service; other external services stay off.
    if (live.mcp?.computer) config.mcp.computer = live.mcp.computer;
  } else {
    if (!contract?.scopes?.length || !contract?.checks?.length || !sessionFile) throw Error('Routine modes require approved scopes, checks and a session record.');
    const edits = { '*': 'deny' };
    for (const s of contract.scopes) for (const p of [s, s + '/**', path.join(contract.worktree, s), path.join(contract.worktree, s) + '/**']) edits[p] = 'allow';
    // Preserve stricter configured edit restrictions; an explicit ask remains an ask.
    const originalEdit = live.permission?.edit;
    if (typeof originalEdit === 'string' && originalEdit !== 'allow') for (const key of Object.keys(edits)) if (key !== '*') edits[key] = originalEdit;
    if (originalEdit && typeof originalEdit === 'object') {
      if (Object.values(originalEdit).includes('ask')) for (const key of Object.keys(edits)) if (key !== '*') edits[key] = 'ask';
      for (const [key, action] of Object.entries(originalEdit)) if (action === 'deny') edits[key] = 'deny';
    }
    agent.permission = { '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', list: 'allow', edit: edits, bash: 'deny', task: 'deny', external_directory: 'deny', 'routine_*': 'allow' };
    // Carry explicit global restrictions on read/search tools through the narrowed profile.
    for (const key of ['read', 'glob', 'grep', 'list']) if (live.permission?.[key]) agent.permission[key] = live.permission[key];
    agent.prompt = `You are the ${mode === 'utility' ? 'mechanical' : 'routine implementation'} executor under one CTO control layer. Use the current user message and relevant prior decisions; do not invent a target from repository tests. You work on an isolated snapshot, not the user's live files. Approved task family: ${contract.intent}. Writable scopes: ${JSON.stringify(contract.scopes)}.
Before editing, establish which element or behavior the user actually named. If the target is ambiguous, particularly an image with multiple marked regions, ask one focused question and leave files unchanged. A test for an unrelated behavior is not authorization to fix it. For broader, risky or uncertain work, call routine_consult with a focused question and evidence, or request a switch to coordinated CTO mode. Do not delegate or launch other agents yourself.
Handle clear work directly, reuse existing code, and avoid unrelated exploration. For each completed edit call routine_publish: the supervisor runs the preapproved checks and applies only the verified scoped diff. Do not claim live files changed unless that tool reports applied:true. A failure leaves the patch isolated; fix only within the requested goal or report the blocker. Do not change branches, commit, or edit Git metadata. Shell tools are deliberately unavailable. ${style}`;
    config.mcp.routine = { type: 'local', command: [process.execPath, path.join(directory, 'server.mjs'), sessionFile], enabled: true, timeout: 240000 };
  }
  return config;
}
