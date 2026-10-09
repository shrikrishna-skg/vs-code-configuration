/* clarify-goal-ui:v1 */
(() => {
  const pending = new WeakMap();
  const panels = new WeakMap();
  function close(anchor) { const panel = panels.get(anchor); if (panel) panel.remove(); panels.delete(anchor); }
  function panel(anchor, title) {
    close(anchor);
    const host = anchor?.closest('.prompt-input-container');
    if (!host) return null;
    const el = document.createElement('section');
    el.className = 'kilo-goal-preview'; el.setAttribute('aria-label', title);
    const heading = document.createElement('strong'); heading.textContent = title; el.append(heading);
    host.append(el); panels.set(anchor, el); return el;
  }
  function button(label, callback) { const b = document.createElement('button'); b.type='button'; b.textContent=label;b.addEventListener('click',callback);return b; }
  const api = {
    begin(anchor, snapshot, current, control) {
      const request = {snapshot,current,control,stopped:false};
      pending.set(anchor,request);
      const el=panel(anchor,'Clarifying goal…');if(!el)return;
      const meta=document.createElement('p');meta.className='kilo-goal-meta';meta.textContent='DeepSeek V4.1 Flash Ultra · LithosAI';
      const status=document.createElement('p');status.className='kilo-goal-meta';status.setAttribute('role','status');status.textContent='Clarifying your draft with available attachments and recent context. Your original draft stays unchanged.';
      el.append(meta,status);
      if(control) el.append(button('Stop',event=>{
        if(request.stopped)return;
        request.stopped=true;event.currentTarget.disabled=true;
        status.textContent='Stopping clarification… Your draft and attachments are kept.';
        control.cancel(control.requestId);
      }));
    },
    cancelled(anchor, requestId) {
      const request=pending.get(anchor);if(!request||request.control?.requestId!==requestId)return;
      request.stopped=true;
      const el=panel(anchor,'Clarification stopped');if(!el)return;
      const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Your draft and attachments are unchanged. You can edit or clarify again.';
      el.append(status,button('Dismiss',()=>close(anchor)));
    },
    preview(anchor, response, apply) {
      const request = pending.get(anchor); if (!request || request.stopped || !anchor.isConnected) return;
      const el = panel(anchor, 'Review your goal'); if (!el) return;
      const meta = document.createElement('p'); meta.className='kilo-goal-meta';
      meta.textContent = `${response.model} · ${response.attachments} attachment(s) · ${response.contextMessages} recent message(s)`;el.append(meta);
      const field = document.createElement('textarea');field.value=response.text;field.setAttribute('aria-label','Editable clarified prompt');field.rows=5;el.append(field);
      const status=document.createElement('p');status.className='kilo-goal-meta';status.setAttribute('role','status');status.textContent='Your draft and attachments stay unchanged until you apply.';el.append(status);
      const row=document.createElement('div');row.className='kilo-goal-actions';
      row.append(button('Cancel',()=>{close(anchor);anchor.focus();}));
      const use=button('Use this prompt',()=>{
        if (request.current() !== request.snapshot) {status.textContent='The draft, attachments, model, or chat changed. Clarify again to use the latest context.';use.disabled=true;return;}
        if (!field.value.trim()) {status.textContent='The prompt is empty.';return;}
        apply(field.value);close(anchor);
      });use.className='kilo-goal-use';row.append(use);el.append(row);field.focus();
      el.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close(anchor);anchor.focus();}});
    },
    error(anchor, text, requestId) {const request=pending.get(anchor);if(request?.stopped&&request.control?.requestId===requestId)return;const el=panel(anchor,'Could not clarify goal');if(!el)return;const p=document.createElement('p');p.textContent=text;p.setAttribute('role','alert');el.append(p,button('Dismiss',()=>close(anchor)));}
  };
  globalThis.__kiloGoal = api;
  const style=document.createElement('style');style.textContent=`
    .kilo-goal-preview{padding:14px;margin:10px 0;border:1px solid var(--vscode-input-border,var(--border-base,#666));border-radius:7px;background:var(--vscode-editor-background);color:var(--vscode-foreground);font:inherit}
    .kilo-goal-preview textarea{display:block;width:100%;box-sizing:border-box;min-height:140px;resize:vertical;padding:10px;border:1px solid var(--vscode-input-border,#666);border-radius:4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);font:inherit;line-height:1.5}
    .kilo-goal-meta{font-size:12px;opacity:.85;margin:8px 0;overflow-wrap:anywhere}
    .kilo-goal-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
    .kilo-goal-preview button{font:inherit;padding:6px 12px;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer}
    .kilo-goal-preview button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
    .kilo-goal-preview .kilo-goal-use{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
    .kilo-goal-preview button:disabled{opacity:.5;cursor:default}
    button[aria-label="Clarify goal"]{width:auto!important;max-width:100%;height:auto!important;min-height:24px;aspect-ratio:auto!important;padding:3px 7px!important;gap:5px!important;white-space:nowrap;color:var(--vscode-input-foreground,var(--text-strong,#cccccc))!important;background:var(--vscode-input-background,var(--input-base,#202020));}
    button[aria-label="Clarify goal"]:is([aria-busy="true"],[data-loading="true"]){opacity:1!important;cursor:progress!important;transition:none!important;background:var(--vscode-input-background,var(--input-base,#202020))!important;border:1px solid var(--vscode-contrastBorder,transparent)}
    button[aria-label="Clarify goal"]:focus-visible{outline:2px solid var(--vscode-focusBorder,Highlight)!important;outline-offset:2px}
    button[aria-label="Clarify goal"] .icon-button-spinner{flex-shrink:0;color:inherit!important}
    .kilo-clarify-label{font-size:12px;color:inherit;line-height:1.4}
    @media(prefers-reduced-motion:reduce){button[aria-label="Clarify goal"] .icon-button-spinner *{animation:none!important;opacity:1!important}}
    @media(forced-colors:active){button[aria-label="Clarify goal"]{color:ButtonText!important;background:ButtonFace!important;border:1px solid ButtonText!important}}
  `;
  document.head.append(style);
  const label=()=>document.querySelectorAll('button[aria-label="Clarify goal"]').forEach(b=>{
    let span=b.querySelector('.kilo-clarify-label');
    if(!span){span=document.createElement('span');span.className='kilo-clarify-label';span.setAttribute('role','status');span.setAttribute('aria-live','polite');span.setAttribute('aria-atomic','true');b.append(span);}
    const text=b.getAttribute('aria-busy')==='true'||b.getAttribute('data-loading')==='true'?'Clarifying goal…':'Clarify goal';
    if(span.textContent!==text)span.textContent=text;
  });
  new MutationObserver(label).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-busy','data-loading']});label();
})();
