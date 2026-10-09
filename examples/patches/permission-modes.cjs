// Full access is deliberately window-lifetime only; the native enabled flag persists.
function createPermissionController({context,readActive,writeActive,onConfiguration,registerCommand,client,directories,resolve,replyOnce,retry,showError}) {
  let mode=readActive()?'auto':'ask',generation=0,transition=false,writing=false,queue=Promise.resolve();
  const listeners=new Set(),inflight=new Map();
  const notify=()=>{for(const fn of listeners)fn(mode!=='ask');};
  const allowed=(request,current)=>current!=='ask'&&(current==='full'||request.metadata?.sandboxEscalation!==true);
  async function approveRequest(request,directory,ticket=generation) {
    if(transition||ticket!==generation||!allowed(request,mode))return false;
    const sdk=client();if(!sdk)return false;
    const key=JSON.stringify([directory,request.id]);
    if(inflight.has(key))return inflight.get(key);
    const run=replyOnce(sdk,request.id,directory,()=>!transition&&ticket===generation&&allowed(request,mode));
    inflight.set(key,run);
    try{return await run;}finally{if(inflight.get(key)===run)inflight.delete(key);}
  }
  async function drain(ticket) {
    const sdk=client();if(!sdk)return;
    for(const directory of directories()) {
      if(transition||ticket!==generation)return;
      try {
        const {data:requests}=await retry(()=>sdk.permission.list({directory},{throwOnError:true}));
        for(const request of requests??[]) {
          if(transition||ticket!==generation)return;
          await approveRequest(request,directory,ticket);
        }
      }catch(error){showError('Could not process pending Kilo permissions: '+error.message);}
    }
  }
  function select(next) {
    if(!['ask','auto','full'].includes(next))return Promise.reject(Error('Unknown permission mode.'));
    const ticket=++generation;transition=true;
    const operation=queue.catch(()=>{}).then(async()=>{
      if(ticket!==generation)return mode;
      try {
        writing=true;
        if(readActive()!==(next!=='ask'))await writeActive(next!=='ask');
        if(ticket!==generation)return mode;
        mode=next;transition=false;notify();
      }catch(error){if(ticket===generation){mode='ask';transition=false;notify();}throw Error('Could not save permission mode; automatic approvals are paused for this window. '+error.message);}
      finally{writing=false;}
      // Publish the selection before draining; a subsequent Ask invalidates every retry.
      void drain(ticket);
      return mode;
    });
    queue=operation;return operation;
  }
  const toggle=()=>select(mode==='ask'?'auto':'ask');
  context.subscriptions.push(onConfiguration(event=>{
    if(!writing&&event.affectsConfiguration('kilo-code.new.autoApprove.enabled')){
      generation++;transition=false;mode=readActive()?'auto':'ask';notify();
    }
  }));
  context.subscriptions.push(registerCommand('kilo-code.new.toggleAutoApprove',()=>toggle().catch(error=>showError(error.message))));
  return {active:()=>mode!=='ask',mode:()=>mode,select,toggle,
    approve:(event,directory)=>approveRequest(event.properties,directory??resolve(event.properties)),
    onChange(fn){listeners.add(fn);return{dispose(){listeners.delete(fn);}};}};
}
module.exports={createPermissionController};
