/* predict-next-ui:v2 */
(() => {
  const predictions = new Map(), latest = new Map(), events = new Map(), seen = new Set();
  let counter = 0;
  function attach(opts) {
    let shown = null, original = null, element = null, detach = null;
    const session = () => opts.session() || '';
    const forget = id => { predictions.delete(id); latest.delete(id); };
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
    }
    function receive(message) {
      if (!message || typeof message.type !== 'string') return;
      const id = message.sessionID;
      if (message.type === 'sessionStatus') {
        if (message.status === 'busy') { forget(id); sync(); }
      } else if (message.type === 'sessionTurnClosed') {
        sync();
        if (message.parentID || message.reason !== 'completed' || !seen.has(id)) return;
        if (message.eventID && events.get(id) === message.eventID) return;
        events.set(id, message.eventID);
        forget(id);
        const requestId = 'next-' + id + '-' + (++counter);
        latest.set(id, requestId);
        opts.post({ type: 'requestNextPrompt', sessionID: id, requestId });
        sync();
      } else if (message.type === 'nextPromptResult') {
        if (typeof message.text === 'string' && message.text && latest.get(id) === message.requestId) predictions.set(id, message.text);
        sync();
      }
    }
    const off = opts.on(receive);
    sync();
    const stop = () => { off && off(); hide(); if (detach) detach(); detach = null; element = null; };
    stop.sync = sync;
    return stop;
  }
  globalThis.__kiloNext = { attach };
})();
