(globalThis.__kiloPin ??= (() => {
  /* Footer pin button: when on, each typed message is sent as your text, one blank line,
     then each pinned Prompts-panel prompt on its own line. Hovering or focusing the button
     opens a popover for choosing and ordering the pinned prompts. */
  const KEY = 'kilo.composer.appendPinned', STORE = 'kilo.promptSuggestions.v6';
  const PIN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6z"/><path d="M8 8.5V14"/></svg>';
  const UP = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12V4M4 8l4-4 4 4"/></svg>';
  const DOWN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4v8M4 8l4 4 4-4"/></svg>';
  const STYLE = '.kilo-pin-append-wrap{position:relative;display:inline-flex}'
    + '.kilo-pin-append{position:relative;width:24px;height:24px;display:inline-grid;place-items:center;padding:0;border:0;border-radius:4px;background:transparent;color:var(--vscode-foreground);cursor:pointer}'
    + '.kilo-pin-append:hover{background:var(--vscode-toolbar-hoverBackground,rgba(90,93,94,.31))}'
    + '.kilo-pin-append:focus-visible{outline:1px solid var(--vscode-focusBorder,#0078d4);outline-offset:1px}'
    + '.kilo-pin-append[aria-pressed=false]{color:var(--vscode-disabledForeground,#6f6f6f)}'
    + '.kilo-pin-append svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}'
    + '.kilo-pin-append-badge{position:absolute;top:-2px;right:-3px;min-width:13px;height:13px;padding:0 3px;border-radius:999px;background:var(--vscode-activityBarBadge-background,#0078d4);color:var(--vscode-activityBarBadge-foreground,#fff);font-size:9px;font-weight:700;line-height:13px;text-align:center}'
    + '.kilo-pin-append[aria-pressed=false] .kilo-pin-append-badge,.kilo-pin-append-badge[hidden]{display:none}'
    + '.kilo-pin-append-pop{position:absolute;bottom:calc(100% + 6px);right:0;width:min(340px,calc(100vw - 24px));max-height:60vh;overflow:auto;z-index:1000;box-sizing:border-box;padding:4px;font-size:12px;background:var(--vscode-editorWidget-background,var(--vscode-menu-background,#252526));color:var(--vscode-editorWidget-foreground,var(--vscode-foreground));border:1px solid var(--vscode-editorWidget-border,var(--vscode-menu-border,rgba(128,128,128,.35)));border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.35)}'
    + '.kilo-pin-append-pop[hidden]{display:none}'
    + '.kilo-pin-append-row{display:flex;align-items:center;gap:2px;padding:2px 4px;border-radius:4px}'
    + '.kilo-pin-append-row:hover{background:var(--vscode-list-hoverBackground,rgba(90,93,94,.31))}'
    + '.kilo-pin-append-label{display:flex;align-items:center;gap:6px;flex:1;min-width:0;cursor:pointer}'
    + '.kilo-pin-append-text{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0}'
    + '.kilo-pin-append-move{width:20px;height:20px;flex:none;display:inline-grid;place-items:center;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer}'
    + '.kilo-pin-append-move:hover:not(:disabled){background:var(--vscode-toolbar-hoverBackground,rgba(90,93,94,.31))}'
    + '.kilo-pin-append-move:disabled{opacity:.35;cursor:default}'
    + '.kilo-pin-append-move:focus-visible{outline:1px solid var(--vscode-focusBorder,#0078d4);outline-offset:1px}'
    + '.kilo-pin-append-move svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}'
    + '.kilo-pin-append-foot{display:flex;justify-content:flex-end;gap:6px;padding:6px 4px 2px;margin-top:4px;border-top:1px solid var(--vscode-editorWidget-border,rgba(128,128,128,.25))}'
    + '.kilo-pin-append-btn{font:inherit;font-size:12px;padding:3px 10px;border:1px solid transparent;border-radius:4px;cursor:pointer;background:var(--vscode-button-secondaryBackground,rgba(128,128,128,.25));color:var(--vscode-button-secondaryForeground,var(--vscode-foreground))}'
    + '.kilo-pin-append-btn.kilo-pin-append-save{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff)}'
    + '.kilo-pin-append-btn:disabled{opacity:.5;cursor:default}'
    + '.kilo-pin-append-btn:focus-visible{outline:1px solid var(--vscode-focusBorder,#0078d4);outline-offset:1px}'
    + '.kilo-pin-append-empty{padding:6px;color:var(--vscode-descriptionForeground,#8b8b8b)}';
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const on = () => read(KEY) === '1';
  const readItems = () => {
    let items;
    try { items = JSON.parse(read(STORE) || '[]'); } catch { return null; }
    return Array.isArray(items) ? items : null;
  };
  const isPinned = item => !!(item && (item.pinned === true || Number(item.pinned) > 0));
  /* Pinned first by pin sequence (true = legacy pin, after numbered pins), then unpinned in store order. */
  const orderedItems = items => items
    .map((item, index) => ({ item, index, rank: item && item.pinned === true ? 1e6 + index : Number(item && item.pinned) }))
    .sort((a, b) => {
      const ap = a.rank > 0, bp = b.rank > 0;
      if (ap !== bp) return ap ? -1 : 1;
      if (ap && a.rank !== b.rank) return a.rank - b.rank;
      return a.index - b.index;
    })
    .map(entry => entry.item);
  /* Pure: checked ids get pinned 1..n in their given order, unchecked lose the key. */
  const applyPins = (items, orderedCheckedIds) => {
    if (!Array.isArray(items)) return [];
    const rank = new Map();
    (Array.isArray(orderedCheckedIds) ? orderedCheckedIds : []).forEach((id, index) => { if (!rank.has(id)) rank.set(id, index + 1); });
    return items.map(item => {
      if (!item || typeof item !== 'object') return item;
      const next = { ...item };
      if (rank.has(item.id)) next.pinned = rank.get(item.id);
      else delete next.pinned;
      return next;
    });
  };
  /* Same order as the Prompts panel: pinned is a pin sequence number (true = legacy pin). */
  const pinned = () => {
    const items = readItems();
    if (!items) return [];
    return items
      .map((item, index) => ({ text: typeof item?.prompt === 'string' ? item.prompt.trim() : '', order: item?.pinned === true ? 1e6 + index : Number(item?.pinned) }))
      .filter(item => item.text && item.order > 0)
      .sort((a, b) => a.order - b.order)
      .map(item => item.text);
  };
  /* Prompts already in the text (for example added by Auto-add pinned) are not repeated. */
  const append = text => {
    if (!text || !on()) return text;
    const extra = pinned().filter(prompt => !text.includes(prompt));
    return extra.length ? text + '\n\n' + extra.join('\n') : text;
  };
  const button = (root, footerRow, cleanup) => {
    if (!document.getElementById('kilo-pin-append-style')) {
      const style = document.createElement('style');
      style.id = 'kilo-pin-append-style';
      style.textContent = STYLE;
      document.head.append(style);
    }
    const wrap = document.createElement('span'), el = document.createElement('button'), badge = document.createElement('span'), pop = document.createElement('div');
    wrap.className = 'kilo-pin-append-wrap';
    el.type = 'button';
    el.className = 'kilo-pin-append';
    el.innerHTML = PIN;
    badge.className = 'kilo-pin-append-badge';
    badge.setAttribute('aria-hidden', 'true');
    el.append(badge);
    pop.className = 'kilo-pin-append-pop';
    pop.hidden = true;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Pinned prompts');
    wrap.append(el, pop);
    let last = null, openState = false, dirty = false, openTimer = 0, closeTimer = 0, suppressFocus = false, viaPointer = false;
    let rows = [], rowsBox = null, saveBtn = null;
    const paint = () => {
      const list = pinned(), active = on(), state = active + '\u0000' + list.join('\u0000');
      if (state === last) return;
      last = state;
      const label = 'Add pinned prompts to my messages (' + list.length + ')';
      el.setAttribute('aria-pressed', String(active));
      el.setAttribute('aria-label', label);
      el.title = label + (active ? ': on' : ': off');
      badge.textContent = String(list.length);
      badge.hidden = !list.length;
    };
    const updateDisabled = () => {
      rows.forEach((row, i) => { row.up.disabled = i === 0; row.down.disabled = i === rows.length - 1; });
    };
    const markDirty = () => { dirty = true; if (saveBtn) saveBtn.disabled = false; };
    const close = () => {
      clearTimeout(openTimer); clearTimeout(closeTimer);
      openState = false; dirty = false;
      pop.hidden = true;
    };
    const moveButton = (label, icon) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'kilo-pin-append-move';
      b.setAttribute('aria-label', label);
      b.innerHTML = icon;
      return b;
    };
    const move = (row, dir) => {
      const i = rows.indexOf(row), j = i + dir;
      if (i < 0 || j < 0 || j >= rows.length) return;
      rows[i] = rows[j]; rows[j] = row;
      if (rowsBox) rowsBox.replaceChildren(...rows.map(r => r.el));
      updateDisabled();
      markDirty();
    };
    const makeRow = item => {
      const el = document.createElement('div'), label = document.createElement('label'), cb = document.createElement('input'), text = document.createElement('span');
      el.className = 'kilo-pin-append-row';
      label.className = 'kilo-pin-append-label';
      label.title = typeof item.prompt === 'string' ? item.prompt : '';
      cb.type = 'checkbox';
      cb.checked = isPinned(item);
      text.className = 'kilo-pin-append-text';
      text.textContent = typeof item.label === 'string' && item.label ? item.label : (typeof item.prompt === 'string' && item.prompt ? item.prompt : '(untitled)');
      label.append(cb, text);
      const up = moveButton('Move up', UP), down = moveButton('Move down', DOWN);
      const row = { item, cb, el, up, down };
      cb.addEventListener('change', markDirty);
      up.addEventListener('click', () => move(row, -1));
      down.addEventListener('click', () => move(row, 1));
      el.append(label, up, down);
      return row;
    };
    const saveChanges = () => {
      const items = readItems();
      if (items) {
        const ids = rows.filter(row => row.cb.checked).map(row => row.item && row.item.id);
        const next = applyPins(items, ids);
        try { localStorage.setItem(STORE, JSON.stringify(next)); } catch {}
        try { window.dispatchEvent(new CustomEvent('kilo-prompt-suggestions-changed')); } catch {}
      }
      paint();
      close();
    };
    const show = () => {
      clearTimeout(openTimer); clearTimeout(closeTimer);
      const items = readItems();
      dirty = false;
      rows = [];
      rowsBox = null;
      saveBtn = null;
      pop.replaceChildren();
      if (!items || !items.length) {
        const msg = document.createElement('div');
        msg.className = 'kilo-pin-append-empty';
        msg.textContent = 'No saved prompts. Add some in Prompts.';
        pop.append(msg);
      } else {
        rows = orderedItems(items).map(makeRow);
        rowsBox = document.createElement('div');
        rowsBox.append(...rows.map(row => row.el));
        const foot = document.createElement('div'), cancel = document.createElement('button'), save = document.createElement('button');
        foot.className = 'kilo-pin-append-foot';
        cancel.type = 'button'; cancel.className = 'kilo-pin-append-btn'; cancel.textContent = 'Cancel';
        cancel.addEventListener('click', close);
        save.type = 'button'; save.className = 'kilo-pin-append-btn kilo-pin-append-save'; save.textContent = 'Save';
        save.disabled = true;
        save.addEventListener('click', saveChanges);
        saveBtn = save;
        foot.append(cancel, save);
        pop.append(rowsBox, foot);
        updateDisabled();
      }
      pop.hidden = false;
      openState = true;
    };
    el.addEventListener('click', () => { try { localStorage.setItem(KEY, on() ? '0' : '1'); } catch {} paint(); });
    el.addEventListener('pointerdown', () => { viaPointer = true; setTimeout(() => { viaPointer = false; }, 0); });
    el.addEventListener('focus', () => { if (!suppressFocus && !viaPointer && !openState) show(); });
    wrap.addEventListener('pointerenter', () => { clearTimeout(closeTimer); if (!openState) { clearTimeout(openTimer); openTimer = setTimeout(show, 150); } });
    wrap.addEventListener('pointerleave', () => { clearTimeout(openTimer); clearTimeout(closeTimer); closeTimer = setTimeout(() => { if (!dirty && openState) close(); }, 300); });
    const onKey = e => {
      if (!openState || e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      close();
      suppressFocus = true; el.focus(); suppressFocus = false;
    };
    const onDown = e => { if (openState && !wrap.contains(e.target)) close(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    paint();
    /* ponytail: a 1s poll picks up pins changed in the Prompts panel; a shared change event would replace it. */
    const timer = setInterval(paint, 1000);
    cleanup(() => {
      clearInterval(timer); clearTimeout(openTimer); clearTimeout(closeTimer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      wrap.remove();
    });
    return wrap;
  };
  return { append, button, pinned, applyPins };
})())