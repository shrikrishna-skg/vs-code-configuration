import { readdir, readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const KILO_MODELS = {
  'astra-engineering-lead': { displayName: 'Astra Engineering Lead', model: 'openai/gpt-6-astra-fast', agent: 'codex-astra-lead', lead: 'astra-engineering-lead.md', effort: 'xhigh', efforts: ['high', 'xhigh', 'max'], inputModalities: ['text', 'image'], priority: 54 },
  // The claude-local-cli provider bakes effort into the model id, so max selects a separate model.
  'fable-engineering-lead': { displayName: 'Fable Engineering Lead', model: 'claude-local-cli/fable-5-1-high', models: { max: 'claude-local-cli/fable-5-1-max' }, agent: 'codex-fable-lead', lead: 'fable-engineering-lead.md', effort: 'high', efforts: ['high', 'max'], inputModalities: ['text', 'image'], priority: 55 },
  'deepseek-high': { displayName: 'DeepSeek High', model: 'deepseek/deepseek-flash', agent: 'codex-deepseek', effort: 'high', efforts: ['high', 'max'], inputModalities: ['text', 'image'], priority: 56 },
  'glm-high': { displayName: 'GLM High', model: 'openrouter/z-ai/glm-5.3-flash', agent: 'codex-glm', effort: 'high', efforts: ['high', 'max'], inputModalities: ['text', 'image'], priority: 57 },
};

export async function kiloBinary() {
  if (process.env.CODEX_KILO_BINARY) return process.env.CODEX_KILO_BINARY;
  const root = path.join(os.homedir(), '.vscode/extensions');
  const dirs = (await readdir(root)).filter(name => /^kilocode\.kilo-code-\d/.test(name));
  dirs.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const dir of dirs) {
    const binary = path.join(root, dir, 'bin/kilo');
    try { if ((await stat(binary)).isFile()) return binary; } catch {}
  }
  throw new Error('Kilo CLI not found. Set CODEX_KILO_BINARY to its absolute path.');
}

export async function strictWorkspace(prompt) {
  // The last environment context wins when a conversation moves workspaces.
  const tags = [...prompt.matchAll(/<cwd>([^<]+)<\/cwd>/g)];
  const cwd = tags.at(-1)?.[1].trim();
  if (!cwd || !path.isAbsolute(cwd)) throw new Error('An absolute workspace <cwd> is required for Kilo routes.');
  if (!(await stat(cwd)).isDirectory()) throw new Error('Workspace is not a directory.');
  return cwd;
}

export function effectiveEffort(profile, requested) {
  const effort = requested || profile.effort;
  if (!profile.efforts.includes(effort)) throw new Error(`Unsupported reasoning effort: ${effort}`);
  return effort;
}

export async function kiloInvocation(profile, prompt, requested, attachmentFiles = []) {
  const cwd = await strictWorkspace(prompt);
  const effort = effectiveEffort(profile, requested);
  const lead = Boolean(profile.lead);
  const model = profile.models?.[effort] || profile.model;
  const instructions = [path.join(os.homedir(), '.config/ponytail/AGENTS.md'), path.join(os.homedir(), '.config/kilo/chat-response-style.md')];
  for (const file of instructions) await readFile(file, 'utf8');
  const leadPrompt = lead ? (await readFile(path.join(os.homedir(), '.config/kilo/agent', profile.lead), 'utf8')).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '') : '';
  const outputContract = '\nYour final user-facing report must contain exactly these unnumbered headings in order: ## Answer, ## My opinion, ## Next step. Put verification evidence under Answer; do not add a Verification heading. Include a concise assessment under My opinion and one concrete next action (or state completion) under Next step. Explicit user requests for a different format take precedence.';
  const task = lead ? { '*': 'deny', 'deepseek-implementer': 'allow', 'glm-investigator': 'allow', 'deepseek-workstream-lead': 'allow' } : 'deny';
  const externalDirectory = { '*': 'deny', [cwd + '/*']: 'allow', [(await realpath(cwd)) + '/*']: 'allow', [path.join(os.homedir(), '.config/ponytail/*')]: 'allow', [path.join(os.homedir(), '.config/kilo/chat-response-style.md')]: 'allow' };
  for (const file of attachmentFiles) {
    if (!path.isAbsolute(file) || !(await stat(file)).isFile()) throw new Error('Kilo attachments must be existing absolute files.');
    externalDirectory[path.dirname(file) + '/*'] = 'allow';
    externalDirectory[path.dirname(await realpath(file)) + '/*'] = 'allow';
  }
  const config = {
    instructions,
    permission: {
      bash: 'allow', edit: 'allow',
      external_directory: externalDirectory,
    },
    default_agent: profile.agent,
    subagent_depth: lead ? 2 : 0,
    subagent_variant_overrides: { 'deepseek/deepseek-flash': 'high', 'openrouter/z-ai/glm-5.3-flash': 'high' },
    agent: {
      'deepseek-workstream-lead': { permission: { task: { '*': 'deny', 'deepseek-implementer': 'allow', 'glm-investigator': 'allow', 'luna-utility': 'deny' } } },
      [profile.agent]: {
      mode: 'primary', model, variant: effort,
      permission: { task, 'Claude_Code_Local_*': 'deny', 'Peekaboo_*': 'deny' },
      prompt: (lead ? leadPrompt + '\nFor this Codex route, delegate only to the permitted DeepSeek and GLM agents. Forward the coding policy and scoped verification requirements. Report worker names, actual tests, and limitations. Do not claim Codex-native tools are available inside Kilo.' : 'Own the complete task independently. Do not delegate through tools, external CLIs, or other agents. Follow project instructions, Ponytail and the response style. Inspect the relevant code, preserve unrelated changes, make the smallest correct implementation, and verify it with a focused runnable check. Do not claim success without evidence.') + '\nWhen image attachments are present, use native model vision first. Do not invoke shell commands, OCR, or image-processing tools merely to restate visible content; use them only when direct inspection is inconclusive or the user explicitly requests measured pixel-level analysis.' + outputContract,
    } },
  };
  return {
    command: await kiloBinary(), cwd,
    args: ['run', '--format', 'json', '--agent', profile.agent, '--model', model, '--variant', effort, ...attachmentFiles.flatMap(file => ['--file', file]), '--dir', cwd],
    env: { ...process.env, KILO_CONFIG_CONTENT: JSON.stringify(config) },
  };
}

export function kiloResult(stdout) {
  let text = [];
  let finished = false;
  let sessionId;
  const usage = { input_tokens: 0, output_tokens: 0 };
  for (const line of stdout.split('\n').filter(line => line.trim())) {
    let event;
    try { event = JSON.parse(line); } catch { throw new Error('Malformed Kilo JSON output.'); }
    sessionId ||= event.sessionID;
    if (event.type === 'step_start') { text = []; finished = false; }
    if (event.type === 'error') throw new Error(event.error?.data?.message || event.error?.message || 'Kilo reported an error.');
    if (event.type === 'text' && event.part?.text) text.push(event.part.text);
    if (event.type === 'step_finish') {
      finished = event.part?.reason === 'stop';
      usage.input_tokens += event.part?.tokens?.input || 0;
      usage.output_tokens += event.part?.tokens?.output || 0;
    }
  }
  if (!finished || !text.length) throw new Error('Kilo did not return a completed text result. Check its session for a permission request or provider failure.');
  return { result: text.join('\n\n'), usage, session_id: sessionId };
}
