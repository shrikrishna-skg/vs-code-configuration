(globalThis.__kiloPin ??= (() => {
  /* Footer pin button: when on, each typed message is sent as your text, one blank line,
     then each pinned Prompts-panel prompt on its own line. */
  const KEY = 'kilo.composer.appendPinned', STORE = 'kilo.promptSuggestions.v6';
  const PIN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6z"/><path d="M8 8.5V14"/></svg>';
  const STYLE = '.kilo-pin-append{position:relative;width:24px;height:24px;display:inline-grid;place-items:center;padding:0;border:0;border-radius:4px;background:transparent;color:var(--vscode-foreground);cursor:pointer}'
    + '.kilo-pin-append:hover{background:var(--vscode-toolbar-hoverBackground,rgba(90,93,94,.31))}'
    + '.kilo-pin-append:focus-visible{outline:1px solid var(--vscode-focusBorder,#0078d4);outline-offset:1px}'
    + '.kilo-pin-append[aria-pressed=false]{color:var(--vscode-disabledForeground,#6f6f6f)}'
    + '.kilo-pin-append svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}'
    + '.kilo-pin-append-badge{position:absolute;top:-2px;right:-3px;min-width:13px;height:13px;padding:0 3px;border-radius:999px;background:var(--vscode-activityBarBadge-background,#0078d4);color:var(--vscode-activityBarBadge-foreground,#fff);font-size:9px;font-weight:700;line-height:13px;text-align:center}'
    + '.kilo-pin-append[aria-pressed=false] .kilo-pin-append-badge,.kilo-pin-append-badge[hidden]{display:none}'
    + '.kilo-pin-append-preview{margin:4px 0 2px;padding:0 10px;color:var(--vscode-descriptionForeground,#8b8b8b);font-size:12px;line-height:1.5}'
    + '.kilo-pin-append-preview[hidden]{display:none}'
    + '.kilo-pin-append-preview div{display:flex;gap:6px;align-items:center;min-width:0}'
    + '.kilo-pin-append-preview span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0}'
    + '.kilo-pin-append-preview svg{width:11px;height:11px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}';
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const on = () => read(KEY) === '1';
  /* Same order as the Prompts panel: pinned is a pin sequence number (true = legacy pin). */
  const pinned = () => {
    let items;
    try { items = JSON.parse(read(STORE) || '[]'); } catch { return []; }
    if (!Array.isArray(items)) return [];
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
  const button = (root, footer, cleanup) => {
    if (!document.getElementById('kilo-pin-append-style')) {
      const style = document.createElement('style');
      style.id = 'kilo-pin-append-style';
      style.textContent = STYLE;
      document.head.append(style);
    }
    const el = document.createElement('button'), badge = document.createElement('span'), preview = document.createElement('div');
    el.type = 'button';
    el.className = 'kilo-pin-append';
    el.innerHTML = PIN;
    badge.className = 'kilo-pin-append-badge';
    badge.setAttribute('aria-hidden', 'true');
    el.append(badge);
    preview.className = 'kilo-pin-append-preview';
    preview.setAttribute('aria-label', 'Added below your message when you send');
    let last = null;
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
      preview.hidden = !active || !list.length;
      preview.replaceChildren(...list.map(text => {
        const row = document.createElement('div'), span = document.createElement('span');
        row.innerHTML = PIN;
        span.textContent = text;
        row.append(span);
        return row;
      }));
    };
    el.addEventListener('click', () => { try { localStorage.setItem(KEY, on() ? '0' : '1'); } catch {} paint(); });
    if (root && footer && footer.parentNode === root) root.insertBefore(preview, footer);
    paint();
    /* ponytail: a 1s poll picks up pins changed in the Prompts panel; a shared change event would replace it. */
    const timer = setInterval(paint, 1000);
    cleanup(() => { clearInterval(timer); preview.remove(); });
    return el;
  };
  return { append, button, pinned };
})())
