// Read actual child/job metadata. Never substitute the parent chat's selection.
export function describeAgent(job, session, providers) {
  const child = session.sessions().find(item => item.id === job.id);
  const tools = session.getSessionToolParts(session.currentSessionID()) ?? [];
  const tool = tools.find(part => part.tool === 'task' &&
    (part.metadata?.sessionId ?? part.state?.metadata?.sessionId) === job.id);
  const messages = session.allMessages?.()[job.id] ?? [];
  const actual = [...messages].reverse().find(message => message.role === 'assistant' && message.modelID);
  const metadata = job.metadata ?? {};
  const launch = metadata.model ?? tool?.state?.metadata?.model;
  const model = actual ?? launch ?? child?.model ?? {};
  const providerID = model.providerID;
  const modelID = model.modelID ?? model.id;
  const catalog = providerID && modelID ? providers.findModel({providerID,modelID}) : undefined;
  const providerName = catalog?.providerName ?? providers.providers()[providerID]?.name ?? providerID ?? 'Provider unavailable';
  const modelName = catalog?.name ?? modelID ?? 'Model unavailable';
  const agentID = actual?.agent ?? child?.agent ?? tool?.state?.input?.subagent_type ?? job.agent ?? metadata.agent;
  const agentInfo = session.allAgents?.().find(agent => agent.name === agentID);
  const agentName = agentInfo?.displayName ?? agentID ?? 'Subagent';
  const task = job.description ?? tool?.state?.input?.description ?? 'Background task';
  const status = job.permission ? 'Waiting for tool approval' : job.question ? 'Waiting for an answer' :
    ({running:'Running',completed:'Done',cancelled:'Cancelled',error:'Error'}[job.status] ?? job.status ?? 'Unknown');
  const variant = metadata.variant ?? child?.model?.variant;
  const timestamp = value => value ? new Date(value).toLocaleString() : undefined;
  const lines = [task, 'Agent: '+agentName+(agentID && agentID!==agentName?' ('+agentID+')':''),
    'Model: '+modelName, 'Provider: '+providerName, 'Status: '+status];
  if(modelID)lines.push('Model ID: '+modelID);
  if(providerID)lines.push('Provider ID: '+providerID);
  if(variant)lines.push('Reasoning: '+variant);
  if(job.startedAt)lines.push('Started: '+timestamp(job.startedAt));
  if(job.finishedAt)lines.push('Finished: '+timestamp(job.finishedAt));
  if(job.error)lines.push('Error: '+(typeof job.error==='string'?job.error:JSON.stringify(job.error)));
  if(job.id)lines.push('Session: '+job.id);
  return {agentName,agentID,modelName,providerName,status,
    label:task+'\n'+agentName+' · '+modelName+' · '+providerName, tooltip:lines.join('\n')};
}
