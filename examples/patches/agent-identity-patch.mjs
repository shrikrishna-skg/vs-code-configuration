// Preserve launch metadata once for every native reader; enrich visible controls.
export function patchAgentIdentity(source,restore=false) {
  const specs=[
    {panel:'i0e',ctx:'ur',provider:'io',bind:'gn',label:'P(Q,()=>A(S))',richLabel:'P(Q,()=>__kiloDescribeAgent(S,t,__kiloAgentProvider).label)',
      row:'var L=lri(),R=L.firstChild,Q=R.firstChild,$=Q.nextSibling;',rowEffect:'tt(()=>Fe(R,"title",__kiloDescribeAgent(S,t,__kiloAgentProvider).tooltip));',
      avatar:'var N=mri();',avatarEffect:'tt(()=>Fe(N,"title",__kiloDescribeAgent(e.state.agents().find(item=>item.id===R)??{id:R,description:d().get(R)?.description},t,__kiloAgentProvider).tooltip));'},
    {panel:'t0e',ctx:'Mr',provider:'ao',bind:'Yt',label:'S(F,()=>A(B))',richLabel:'S(F,()=>__kiloDescribeAgent(B,t,__kiloAgentProvider).label)',
      row:'var M=$ja(),T=M.firstChild,F=T.firstChild,N=F.nextSibling;',rowEffect:'Le(()=>Ee(T,"title",__kiloDescribeAgent(B,t,__kiloAgentProvider).tooltip));',
      avatar:'var $=jja();',avatarEffect:'Le(()=>Ee($,"title",__kiloDescribeAgent(e.state.agents().find(item=>item.id===T)??{id:T,description:d().get(T)?.description},t,__kiloAgentProvider).tooltip));'},
  ];
  const matches=specs.filter(s=>source.includes('var '+s.panel+'=e=>{let t='+s.ctx+'()')||source.includes('var '+s.panel+'=e=>{/* agent-identity:v1 */let __kiloAgentProvider='+s.provider+'();let t='+s.ctx+'()'));
  if(matches.length!==1)throw Error('Unsupported native agent identity target.');
  const s=matches[0];
  const swap=(text,before,after)=>{
    const old=text.split(before).length-1,newer=text.split(after).length-1;
    if(old+newer!==1)throw Error('Missing/ambiguous identity anchor: '+before.slice(0,65));
    return text.replace(newer?after:before,restore?before:after);
  };
  let next=swap(source,'finishedAt:a.completed_at,jobID:a.id,permission:n.find','finishedAt:a.completed_at,jobID:a.id,metadata:a.metadata,permission:n.find');
  const start=next.indexOf('var '+s.panel+'=e=>{'),end=next.indexOf(';'+s.bind+'(["click"]);',start);
  if(end<0)throw Error('Native agent panel end not found.');
  let panel=next.slice(start,end);
  panel=swap(panel,'var '+s.panel+'=e=>{let t='+s.ctx+'()', 'var '+s.panel+'=e=>{/* agent-identity:v1 */let __kiloAgentProvider='+s.provider+'();let t='+s.ctx+'()');
  panel=swap(panel,s.label,s.richLabel);
  panel=swap(panel,s.row+'return',s.row+s.rowEffect+'return');
  panel=swap(panel,s.avatar+'return',s.avatar+s.avatarEffect+'return');
  return next.slice(0,start)+panel+next.slice(end);
}
