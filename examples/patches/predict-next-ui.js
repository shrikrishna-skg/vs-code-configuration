/* predict-next-ui:v4 */
(() => {
  const predictions = new Map(), latest = new Map(), events = new Map(), seen = new Set(), running = new Set(), manual = new Map();
  let counter = 0;
  const ICON = '<svg class="kns-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 2.5L7.6 5.4L10.5 6.5L7.6 7.6L6.5 10.5L5.4 7.6L2.5 6.5L5.4 5.4Z" fill="currentColor" stroke="none"/><path d="M12 9L12.7 10.8L14.5 11.5L12.7 12.2L12 14L11.3 12.2L9.5 11.5L11.3 10.8Z" fill="currentColor" stroke="none"/><path d="M12.5 2L12.9 3.1L14 3.5L12.9 3.9L12.5 5L12.1 3.9L11 3.5L12.1 3.1Z" fill="currentColor" stroke="none"/></svg><svg class="kns-spin" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2a6 6 0 1 1-6 6"/></svg>';
  const STYLE = '.next-suggest-trigger{position:absolute;bottom:calc(100% + 6px);z-index:30;width:25px;height:25px;display:inline-grid;place-items:center;padding:0;border:1px solid var(--border-weak-base,var(--vscode-widget-border,#454545));border-radius:6px;background:var(--surface-base,var(--vscode-button-secondaryBackground,transparent));color:var(--text-base,var(--vscode-foreground));cursor:pointer}'
    + '.next-suggest-trigger:hover:not(:disabled){background:var(--surface-base-hover,var(--vscode-list-hoverBackground))}'
    + '.next-suggest-trigger:focus-visible{outline:1px solid var(--vscode-focusBorder,#0078d4);outline-offset:1px}'
    + '.next-suggest-trigger:disabled{opacity:.45;cursor:not-allowed}'
    + '.next-suggest-trigger svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}'
    + '.next-suggest-trigger .kns-spin{display:none}.next-suggest-trigger[aria-busy=true] .kns-glyph{display:none}'
    + '.next-suggest-trigger[aria-busy=true] .kns-spin{display:block;animation:kns-turn .8s linear infinite}@keyframes kns-turn{to{transform:rotate(360deg)}}'
    + '@media (prefers-reduced-motion:reduce){.next-suggest-trigger[aria-busy=true] .kns-spin{animation:none}}'
    + '.next-suggest-note{position:absolute;left:calc(100% + 6px);top:50%;transform:translateY(-50%);white-space:nowrap;padding:2px 7px;border-radius:999px;background:var(--vscode-badge-background,#2b2b2b);color:var(--vscode-badge-foreground,#cccccc);font-size:11px;pointer-events:none}';
  function attach(opts) {
    const dom = typeof document !== 'undefined';
    let shown = null, original = null, element = null, detach = null, button = null, note = null, timer = null;
    const session = () => opts.session() || '';
    const forget = id => { predictions.delete(id); latest.delete(id); };
    const settle = id => { if (!manual.has(id)) return false; if (manual.get(id)) clearTimeout(manual.get(id)); manual.delete(id); return true; };
    function hide() {
      if (shown !== null && element && element.placeholder === shown) element.placeholder = original;
      shown = null;
    }
    function onKey(event) {
      if (shown === null || element.value !== '' || element.placeholder !== shown) return;
      if (event.key === 'Escape') { forget(session()); hide(); event.stopPropagation(); return; }
      if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      event.preventDefault(); event.stopPropagation();
      const text = shown; forget(session()); hide(); opts.apply(text);
    }
    function paint() {
      if (!button) return;
      const id = session();
      button.disabled = !id || running.has(id);
      if (manual.has(id)) button.setAttribute('aria-busy', 'true'); else button.removeAttribute('aria-busy');
    }
    function sync() {
      const id = session(), el = opts.input() || null;
      if (id) seen.add(id);
      if (el !== element) {
        hide();
        if (detach) detach();
        element = el;
        detach = el ? () => el.removeEventListener('keydown', onKey, true) : null;
        if (el) el.addEventListener('keydown', onKey, true);
      }
      const want = element ? predictions.get(id) || null : null;
      if (want !== shown) hide();
      if (want && shown === null) { original = element.placeholder; element.placeholder = want; shown = want; }
      paint();
    }
    // Manual suggestion: replaces the shown one, never touches typed text, refused while a reply runs.
    function generate() {
      const id = session();
      if (!id || running.has(id) || manual.has(id)) return false;
      seen.add(id);
      forget(id);
      const requestId = 'next-' + id + '-' + (++counter);
      latest.set(id, requestId);
      manual.set(id, typeof setTimeout === 'function' ? setTimeout(() => { if (latest.get(id) === requestId) { manual.delete(id); paint(); } }, 20000) : 0);
      opts.post({ type: 'requestNextPrompt', sessionID: id, requestId });
      sync();
      return true;
    }
    function flash(text) {
      if (!button) return;
      if (note) note.remove();
      const mine = note = document.createElement('span');
      mine.className = 'next-suggest-note';
      mine.textContent = text;
      button.append(mine);
      setTimeout(() => { mine.remove(); if (note === mine) note = null; }, 2200);
    }
    // Same approach as the Session map button: re-checked every second because the composer can re-render.
    function place() {
      const launcher = document.querySelector('.prompt-suggestion-launcher');
      if (!launcher) return;
      if (!document.getElementById('next-suggest-style')) {
        const style = document.createElement('style');
        style.id = 'next-suggest-style';
        style.textContent = STYLE;
        document.head.append(style);
      }
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'next-suggest-trigger';
        button.setAttribute('aria-label', 'Suggest next message');
        button.title = 'Suggest next message (Ctrl+Option+N)';
        button.innerHTML = ICON;
        button.addEventListener('click', generate);
      }
      if (button.parentNode !== launcher.parentNode) launcher.parentNode.insertBefore(button, launcher);
      const map = launcher.parentNode.querySelector(':scope > .session-map-trigger');
      button.style.left = (map ? map.offsetLeft + map.offsetWidth + 6 : 0) + 'px';
      paint();
    }
    const onShortcut = event => {
      if (!event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey || event.code !== 'KeyN' || !button || !button.isConnected) return;
      event.preventDefault();
      generate();
    };
    function receive(message) {
      if (!message || typeof message.type !== 'string') return;
      const id = message.sessionID;
      if (message.type === 'sessionStatus') {
        if (message.status === 'busy' || message.status === 'retry') { running.add(id); forget(id); settle(id); }
        else running.delete(id);
        sync();
      } else if (message.type === 'sessionTurnClosed') {
        running.delete(id);
        sync();
        if (message.parentID || message.reason !== 'completed' || !seen.has(id)) return;
        if (message.eventID && events.get(id) === message.eventID) return;
        events.set(id, message.eventID);
        forget(id);
        settle(id);
        const requestId = 'next-' + id + '-' + (++counter);
        latest.set(id, requestId);
        opts.post({ type: 'requestNextPrompt', sessionID: id, requestId });
        sync();
      } else if (message.type === 'nextPromptResult') {
        if (latest.get(id) === message.requestId) {
          const asked = settle(id);
          if (typeof message.text === 'string' && message.text) predictions.set(id, message.text);
          else if (asked && dom && id === session()) flash('No suggestion');
        }
        sync();
      }
    }
    const off = opts.on(receive);
    if (dom) { addEventListener('keydown', onShortcut, true); timer = setInterval(place, 1000); place(); }
    sync();
    const stop = () => {
      off && off(); hide(); if (detach) detach(); detach = null; element = null;
      if (dom) { clearInterval(timer); removeEventListener('keydown', onShortcut, true); if (button) button.remove(); button = null; }
    };
    stop.sync = sync;
    stop.generate = generate;
    return stop;
  }
  globalThis.__kiloNext = { attach };
})();
