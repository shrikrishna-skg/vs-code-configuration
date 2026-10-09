import fs from 'node:fs';

export const agentName = 'CTO Minimal';
export const prompt = fs.readFileSync(new URL('./policy.md', import.meta.url), 'utf8');

export function minimalConfig(live, { model, variant, ponytail }) {
  if (!model?.includes('/')) throw Error('Select an explicit provider/model.');
  if (!fs.statSync(ponytail).isFile()) throw Error('Canonical Ponytail policy is required.');
  return {
    ...live,
    model,
    default_agent: agentName,
    instructions: [ponytail],
    plugin: [],
    command: {},
    subagent_depth: 0,
    mcp: Object.fromEntries(Object.entries(live.mcp || {}).map(([key, value]) => [key, { ...value, enabled: false }])),
    agent: {
      [agentName]: {
        mode: 'primary', model, ...(variant ? { variant } : {}), prompt,
        permission: { task: 'deny', 'cto_*': 'deny', 'TypeSafe_*': 'deny', 'Claude_Code_Local_*': 'deny', schedule_wakeup: 'deny' },
      },
    },
  };
}
