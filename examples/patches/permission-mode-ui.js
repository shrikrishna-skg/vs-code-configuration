/* permission-mode-ui:v1 */
;(function(){
  const choices=[
    ['ask','Ask','Keep permission prompts enabled'],
    ['auto','Auto','Approve ordinary requests; ask to leave the sandbox'],
    ['full','Full access','Approve tool and sandbox requests for this window'],
  ];
  const icon='<svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2 17 5v5c0 4-4 6-7 8-3-2-7-4-7-8V5l7-3Z" stroke="currentColor" stroke-width="1.4"/></svg>';
  globalThis.__kiloPermissionMenu=function(port,onCleanup){
    let mode,requestID,pending=false,timer,disposed=false;
    const root=document.createElement('span');root.className='kilo-permission-control';
    const trigger=document.createElement('button');trigger.type='button';trigger.className='kilo-permission-trigger';trigger.disabled=true;
    trigger.innerHTML=icon+'<span>Loading…</span><span aria-hidden="true">⌄</span>';
    trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');
    root.append(trigger);
    const menu=document.createElement('div');menu.className='kilo-permission-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Permissions');menu.hidden=true;
    const title=document.createElement('div');title.className='kilo-permission-title';title.textContent='Permissions';menu.append(title);
    const buttons=choices.map(([value,label,description])=>{
      const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitemradio');button.dataset.mode=value;button.tabIndex=-1;
      const symbol=document.createElement('span');symbol.className='kilo-permission-symbol';symbol.innerHTML=icon;
      if(value==='full'){symbol.textContent='⚠';symbol.classList.add('kilo-permission-warning');}
      const text=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small'),check=document.createElement('span');
      name.textContent=label;detail.textContent=description;check.textContent='✓';check.className='kilo-permission-check';check.setAttribute('aria-hidden','true');
      text.append(name,detail);button.append(symbol,text,check);button.onclick=()=>select(value);menu.append(button);return button;
    });
    const footer=document.createElement('div');footer.className='kilo-permission-footer';footer.textContent='Shared across Kilo chats in this window. Denied tools and system permissions still apply.';menu.append(footer);
    const error=document.createElement('div');error.className='kilo-permission-error';error.setAttribute('role','alert');error.hidden=true;root.append(error);
    function render(){
      const label=choices.find(x=>x[0]===mode)?.[1]??'Loading…';
      trigger.children[1].textContent=pending?'Changing…':label;trigger.disabled=!mode||pending;
      trigger.dataset.mode=mode??'';trigger.setAttribute('aria-label','Permissions: '+label);trigger.setAttribute('aria-busy',String(pending));
      for(const b of buttons){b.disabled=pending;b.setAttribute('aria-checked',String(b.dataset.mode===mode));}
    }
    function position(){
      if(menu.hidden)return;
      const rect=trigger.getBoundingClientRect(),gap=8;
      menu.style.width=Math.min(360,window.innerWidth-16)+'px';
      menu.style.left=Math.max(8,Math.min(rect.right-menu.offsetWidth,window.innerWidth-menu.offsetWidth-8))+'px';
      const top=rect.top-menu.offsetHeight-gap;
      menu.style.top=Math.max(8,top>=8?top:Math.min(rect.bottom+gap,window.innerHeight-menu.offsetHeight-8))+'px';
    }
    function close(focus=false){menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();}
    function open(){if(trigger.disabled)return;document.body.append(menu);menu.hidden=false;trigger.setAttribute('aria-expanded','true');position();(buttons.find(b=>b.dataset.mode===mode)??buttons[0]).focus();}
    function showError(message){error.textContent=message;error.hidden=false;}
    function select(next){
      if(pending||next===mode){close(true);return;}
      pending=true;error.hidden=true;requestID='permission-'+crypto.getRandomValues(new Uint32Array(4)).join('-');render();close(true);
      timer=setTimeout(()=>{pending=false;requestID=undefined;render();showError('No confirmation received. Reopen Permissions to check the current mode.');port.postMessage({type:'requestAutoApproveState'});},15000);
      port.postMessage({type:'setPermissionMode',mode:next,requestID});
    }
    const subscription=port.onMessage(message=>{
      if(disposed)return;
      if(message.type==='autoApproveState'){
        mode=['ask','auto','full'].includes(message.mode)?message.mode:(message.active?'auto':'ask');render();
      }
      if(message.type==='permissionModeResult'&&message.requestID===requestID){
        clearTimeout(timer);requestID=undefined;pending=false;
        if(message.error)showError(message.error);
        if(['ask','auto','full'].includes(message.mode))mode=message.mode;
        render();
      }
    });
    trigger.onclick=()=>menu.hidden?open():close(true);
    trigger.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open();}};
    menu.onkeydown=e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);return;}
      if(e.key==='Tab'){close(true);return;}
      const index=buttons.indexOf(document.activeElement);
      let next;
      if(e.key==='ArrowDown')next=(index+1)%buttons.length;
      if(e.key==='ArrowUp')next=(index+buttons.length-1)%buttons.length;
      if(e.key==='Home')next=0;if(e.key==='End')next=buttons.length-1;
      if(next!==undefined){e.preventDefault();buttons[next].focus();}
    };
    const outside=e=>{if(!root.contains(e.target)&&!menu.contains(e.target))close();};
    const scroll=()=>close();
    document.addEventListener('pointerdown',outside);window.addEventListener('resize',position);window.addEventListener('scroll',scroll,true);
    onCleanup(()=>{disposed=true;clearTimeout(timer);subscription?.dispose?.();if(typeof subscription==='function')subscription();document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',position);window.removeEventListener('scroll',scroll,true);menu.remove();});
    render();port.postMessage({type:'requestAutoApproveState'});return root;
  };
})();
/* end permission-mode-ui */
