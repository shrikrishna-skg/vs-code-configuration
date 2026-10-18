const STORE='kilo.chatPermissionModes.v1';
const LAST='kilo.chatPermissionModes.last.v1';
const valid=id=>typeof id==='string'&&id.length>0&&id.length<300;
const scope=id=>valid(id)?id.replace(/^(?:sidebar-)?pending:/,''):null;
const modes=['ask','auto','full'];
function createPermissionController({context,readActive,onConfiguration,registerCommand,client,directories,resolve,replyOnce,retry,showError}) {
  const fallback=()=>readActive()?'auto':'ask';
  const storage=context.workspaceState??context.globalState;
  const global=context.globalState??context.workspaceState;
  const readLast=()=>{const value=global?.get(LAST);return modes.includes(value)?value:null;};
  let last=readLast(),defaultMode=last??fallback(),saveQueue=Promise.resolve();
  const states=new Map(),parents=new Map(),listeners=new Set(),inflight=new Map();
  for(const [id,mode]of Object.entries(storage?.get(STORE,{})??{}))if(scope(id)&&modes.includes(mode))states.set(scope(id),{mode,generation:0,transition:false});
  const row=id=>{if(!states.has(id))states.set(id,{mode:defaultMode,generation:0,transition:false});return states.get(id);};
  const owner=id=>{const seen=new Set();while(id&&!seen.has(id)){if(states.has(id))return id;seen.add(id);id=parents.get(id);}return null;};
  async function resolveOwner(id,directory,seen=new Set()) {
    if(!id||seen.has(id)||seen.size>=16)return null;
    if(states.has(id))return id;
    seen.add(id);
    if(!parents.has(id)){
      try{const sdk=client();const result=await sdk?.session?.get?.({sessionID:id,directory},{throwOnError:true});parents.set(id,scope(result?.data?.parentID));}
      catch{return null;}
    }
    const parent=parents.get(id);
    if(parent)return resolveOwner(parent,directory,seen);
    row(id);return id;
  }
  const mode=id=>states.get(owner(scope(id)))?.mode??defaultMode;
  const notify=id=>{for(const fn of listeners)fn(id);};
  const persist=()=>{
    const run=saveQueue.catch(()=>{}).then(()=>storage?.update(STORE,Object.fromEntries([...states].map(([id,state])=>[id,state.mode]))));
    saveQueue=run;return run;
  };
  // User choice: new chats keep the last mode, Full access included.
  const remember=mode=>{last=defaultMode=mode;try{Promise.resolve(global?.update?.(LAST,last)).catch(()=>{});}catch{}};
  // Full access includes config edits; sandbox escalation and skill-shell consent remain separate.
  const allowed=(request,current)=>current!=='ask'&&request.permission!=='sandbox_escalation'
    && !['sandboxEscalation','skillShell'].some(key=>request.metadata?.[key]===true)
    && (current==='full'||(request.metadata?.configProtected!==true&&request.permission!=='external_directory'));
  async function approveRequest(request,directory) {
    const id=scope(request.sessionID),target=await resolveOwner(id,directory);
    if(!target)return false;
    const state=row(target),ticket=state.generation;
    const current=()=>owner(id)===target&&!state.transition&&ticket===state.generation&&allowed(request,state.mode);
    if(!current())return false;
    const sdk=client();if(!sdk)return false;
    const key=JSON.stringify([directory,request.id]);
    if(inflight.has(key))return inflight.get(key);
    const run=replyOnce(sdk,request.id,directory,current);inflight.set(key,run);
    try{return await run;}finally{if(inflight.get(key)===run)inflight.delete(key);}
  }
  async function drain(id,ticket) {
    const sdk=client();if(!sdk)return;
    for(const directory of directories()){
      if(row(id).transition||row(id).generation!==ticket)return;
      try{
        const {data:requests}=await retry(()=>sdk.permission.list({directory},{throwOnError:true}));
        for(const request of requests??[]){
          if(row(id).transition||row(id).generation!==ticket)return;
          if(await resolveOwner(scope(request.sessionID),directory)===id)await approveRequest(request,directory);
        }
      }catch(error){showError('Could not process pending Kilo permissions: '+error.message);}
    }
  }
  async function select(next,sessionID) {
    const id=scope(sessionID);
    if(!id)throw Error('Choose permissions from the chat you want to change.');
    if(!modes.includes(next))throw Error('Unknown permission mode.');
    const state=row(id),ticket=++state.generation;state.transition=true;state.mode=next;
    try{await persist();}
    catch(error){if(ticket===state.generation){state.mode='ask';state.transition=false;notify(id);}throw Error('Could not save permissions; automatic approvals are paused for this chat. '+error.message);}
    remember(next);
    if(ticket!==state.generation)return state.mode;
    state.transition=false;notify(id);void drain(id,ticket);return state.mode;
  }
  async function promote(from,to){
    await saveQueue.catch(()=>{});
    from=scope(from);to=scope(to);if(!from||!to||from===to||!states.has(from))return;
    const previous=row(from);previous.generation++;
    if(!states.has(to))states.set(to,{mode:previous.mode,generation:0,transition:false});
    states.delete(from);await persist();notify(to);
  }
  context.subscriptions.push(onConfiguration(event=>{if(event.affectsConfiguration('kilo-code.new.autoApprove.enabled'))defaultMode=last??fallback();}));
  context.subscriptions.push(registerCommand('kilo-code.new.toggleAutoApprove',sessionID=>select(mode(sessionID)==='ask'?'auto':'ask',sessionID).catch(error=>showError(error.message))));
  return {mode,active:id=>mode(id)!=='ask',select,promote,
    async state(sessionID){const id=scope(sessionID);if(!id)throw Error('No chat selected.');const target=await resolveOwner(id);if(target&&mode(target)!=='ask')await drain(target,row(target).generation);return mode(id);},
    approve:(event,directory)=>approveRequest(event.properties,directory??resolve(event.properties)),
    onChange(fn){listeners.add(fn);return{dispose(){listeners.delete(fn);}};}};
}
function createPermissionBridge(ctrl,post,next){
  const watched=new Set();
  const send=async sessionID=>{if(!valid(sessionID))return;const mode=await ctrl.state(sessionID);post({type:'autoApproveState',sessionID,active:mode!=='ask',mode});};
  const sub=ctrl.onChange(()=>{for(const id of watched)void send(id);});
  return {dispose:()=>sub.dispose(),promote:(from,to)=>ctrl.promote(from,to),async handle(msg){
    if(msg.type==='setPermissionMode'){
      try{await ctrl.select(msg.mode,msg.sessionID);post({type:'permissionModeResult',sessionID:msg.sessionID,requestID:msg.requestID,mode:ctrl.mode(msg.sessionID)});}
      catch(error){post({type:'permissionModeResult',sessionID:msg.sessionID,requestID:msg.requestID,mode:ctrl.mode(msg.sessionID),error:error.message});}
      return null;
    }
    if(msg.type==='requestAutoApproveState'){if(valid(msg.sessionID))watched.add(msg.sessionID);await send(msg.sessionID);return null;}
    if(msg.type==='toggleAutoApprove'){await ctrl.select(ctrl.mode(msg.sessionID)==='ask'?'auto':'ask',msg.sessionID);return null;}
    return next?next(msg):msg;
  }};
}
module.exports={createPermissionController,createPermissionBridge};
