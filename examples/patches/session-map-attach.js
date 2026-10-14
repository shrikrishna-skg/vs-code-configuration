var __ksmStop=(()=>{
  // Runs inside the chat composer component: p = webview<->host bridge, t = session state, nt = cleanup.
  // Quick-action texts that count as approvals, plus the user's saved ✦ Prompts.
  const QUICK=['Continue with the recommended next step.','Fix the remaining issues and run the relevant checks.','Use multiple agents in parallel where useful.','Understand the goal and inspect all relevant context before making changes.'];
  const canned=()=>{try{const raw=JSON.parse(localStorage.getItem('kilo.promptSuggestions.v6')||'null');const list=Array.isArray(raw)?raw:raw&&Array.isArray(raw.items)?raw.items:[];return QUICK.concat(list.map(x=>typeof x==='string'?x:x&&(x.text||x.prompt)).filter(s=>typeof s==='string'&&s.length>3)).slice(0,100)}catch(e){return QUICK}};
  const pending=new Map();let counter=0,button=null,mountEl=null,detach=null;
  const off=p.onMessage(m=>{if(!m||m.type!=='sessionMapResult')return;const w=pending.get(m.requestId);if(!w)return;pending.delete(m.requestId);m.error?w.reject(new Error(m.error)):w.resolve(m.map)});
  const load=()=>new Promise((resolve,reject)=>{
    const sessionID=t.currentSessionID();
    if(!sessionID){reject(new Error('Open or start a chat first.'));return}
    const requestId='ksm-'+(++counter);
    const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('The session map took too long. Try again.'))},30000);
    // A reply for a chat you have since left is dropped instead of drawn over the new chat.
    pending.set(requestId,{resolve:v=>{clearTimeout(timer);t.currentSessionID()===sessionID?resolve(v):reject(new Error('You switched chats. Open the map again.'))},reject:e=>{clearTimeout(timer);reject(e)}});
    p.postMessage({type:'requestSessionMap',sessionID,requestId,canned:canned()});
  });
  // ponytail: only scrolls to messages the virtual list has rendered; older turns need "load older" first.
  const jump=id=>{const el=id&&document.querySelector('[data-message="'+CSS.escape(id)+'"]');if(el)el.scrollIntoView({block:'start'})};
  const onKey=e=>{if(e.key==='Escape'&&button&&button.getAttribute('aria-expanded')==='true'){e.preventDefault();button.click()}};
  let mountPos=null;
  const teardown=()=>{if(detach)detach();detach=null;if(button){button.removeEventListener('keydown',onKey);button.remove()}button=null;if(mountEl&&mountPos!==null)mountEl.style.position=mountPos;mountEl=null;mountPos=null};
  // Re-checked every second: the composer or message list can be re-rendered (session switch, reload),
  // so a detached button or mount is torn down and attached again to the live elements.
  const ensure=()=>{
    if(button&&button.isConnected&&mountEl&&mountEl.isConnected){
      // Kilo can re-render the list's children and drop the open overlay; reset the button so it reopens cleanly.
      if(button.getAttribute('aria-expanded')==='true'&&!mountEl.querySelector('.ksm-map'))button.click();
      return;
    }
    teardown();
    const launcher=document.querySelector('.prompt-suggestion-launcher'),mount=document.querySelector('.message-list-container');
    if(!launcher||!mount||!globalThis.__kiloSessionMap)return;
    const prev=launcher.previousElementSibling;
    if(prev&&prev.classList.contains('session-map-trigger'))return;
    button=document.createElement('button');button.type='button';button.className='session-map-trigger';
    button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','Session map');button.textContent='Session map';
    button.addEventListener('keydown',onKey);
    launcher.parentNode.insertBefore(button,launcher);
    if(getComputedStyle(mount).position==='static'){mountPos=mount.style.position;mount.style.position='relative';}
    mountEl=mount;
    detach=globalThis.__kiloSessionMap.attach({mount,button,load,jump});
  };
  const frame=requestAnimationFrame(ensure),interval=setInterval(ensure,1000);
  return()=>{cancelAnimationFrame(frame);clearInterval(interval);if(off)off();teardown();for(const w of pending.values())w.reject(new Error('Closed.'));pending.clear()};
})();nt(()=>__ksmStop());
