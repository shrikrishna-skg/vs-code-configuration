/* session-map-ui:v1 */
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  // DOM builder: strings become text nodes (session text is never parsed as
  // HTML); plain objects are attributes, and keys starting "on" are listeners.
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    const attrs = o => {
      for (const k in o) {
        if (k === 'class') el.className = o[k];
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), o[k]);
        else if (o[k] != null && o[k] !== false) el.setAttribute(k, o[k]);
      }
    };
    if (typeof props === 'string') el.className = props;
    else if (props) attrs(props);
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false || k === '' || k === 0) continue;
      if (k instanceof Node) el.append(k);
      else if (typeof k === 'object') attrs(k);
      else el.append(String(k));
    }
    return el;
  }
  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  const fmtTok = n => {
    const v = +n || 0;
    return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : String(v);
  };
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const base = f => String(f || '').split('/').pop();
  const AGENT = { 'deepseek-implementer': 'DeepSeek', 'glm-investigator': 'GLM', explore: 'Explore' };
  const agentName = t => Object.prototype.hasOwnProperty.call(AGENT, t) ? AGENT[t] : t;
  const failed = c => c.status === 'error' || (c.exit != null && c.exit !== 0);
  const kindTag = s => s.kind === 'approval' ? 'You approved' : 'You asked';
  const kindCls = s => s.kind === 'approval' ? 'ksm-approval' : '';

  function sumFiles(turns) {
    const m = new Map();
    for (const t of turns) for (const f of (t.files || [])) {
      const e = m.get(f.file) || { file: f.file, add: 0, del: 0, edits: 0 };
      e.add += (+f.add || 0);
      e.del += (+f.del || 0);
      e.edits++;
      m.set(f.file, e);
    }
    return [...m.values()].sort((a, b) => (b.add + b.del) - (a.add + a.del));
  }
  const reduceMotion = () => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  };
  const scrollBehavior = () => reduceMotion() ? 'auto' : 'smooth';

  const X = { msg: 14, help: 196, file: 336 };
  const W = { msg: 160, help: 124, file: 150 };

  function attach(opts) {
    opts = opts || {};
    const mount = opts.mount;
    const trigger = opts.button;
    const load = opts.load;
    const jump = typeof opts.jump === 'function' ? opts.jump : function () {};
    if (!mount) throw new Error('session-map: mount is required');

    // ---- state ------------------------------------------------------------
    let overlay = null;
    let open = false;
    let disposed = false;
    let seq = 0;
    let steps = [];
    let loops = [];
    let ALLF = [];
    let rows = {};
    let dn = {};
    let edges = [];
    let paths = [];
    let live = null;
    let active = null;
    let file = null;
    let scale = 1;
    let fsz = 14;
    let focusState = null;
    let full = false;
    const N = {};

    // ---- overlay skeleton (built once, lazily) ----------------------------
    function buildOverlay() {
      const root = h('div', 'ksm-map');
      root.hidden = true;
      root.tabIndex = -1;
      root.setAttribute('role', 'region');
      root.setAttribute('aria-label', 'Session map');

      const ttl = h('span', 'ksm-ttl');
      const totals = h('span', 'ksm-totals');
      const closeIcon = svgEl('svg', { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'aria-hidden': 'true' });
      closeIcon.appendChild(svgEl('path', { d: 'M2 2l8 8M10 2l-8 8' }));
      const closeBtn = h('button', { class: 'ksm-tool ksm-close', type: 'button', 'aria-label': 'Close session map', onclick: closeMap }, closeIcon, 'Close');
      root.appendChild(h('div', 'ksm-mhead',
        h('h2', null, 'Session map'), ttl, h('span', 'ksm-sp'), totals, closeBtn));

      const szLabel = h('span', 'ksm-dim', '14px');
      const dgToggle = h('button', { class: 'ksm-tool', type: 'button', 'aria-pressed': 'true' }, 'Diagram');
      const jumpNow = h('button', { class: 'ksm-tool', type: 'button' }, 'Jump to now');
      dgToggle.addEventListener('click', onToggleDiagram);
      jumpNow.addEventListener('click', () => {
        if (!live) return;
        setActive(live.n, true);
        jumpStory(live.n);
      });
      root.appendChild(h('div', 'ksm-bar',
        h('span', null, 'Text size'),
        h('button', { class: 'ksm-tool', type: 'button', 'aria-label': 'Smaller text', onclick: () => size(-1) }, 'A−'),
        szLabel,
        h('button', { class: 'ksm-tool', type: 'button', 'aria-label': 'Larger text', onclick: () => size(1) }, 'A+'),
        h('span', 'ksm-sp'), jumpNow, dgToggle));

      const status = h('div', 'ksm-status');
      status.setAttribute('role', 'status');
      root.appendChild(status);
      const empty = h('div', 'ksm-empty');
      root.appendChild(empty);

      const stMain = h('div', 'ksm-st-main');
      const layer = h('div', 'ksm-dg-layer');
      const svg = svgEl('svg', { class: 'ksm-dg-edges' });
      layer.appendChild(svg);
      const dgBody = h('div', 'ksm-dg-body', layer);
      const pick = h('span', 'ksm-dg-pick');
      pick.hidden = true;
      const fullIcon = svgEl('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
      fullIcon.appendChild(svgEl('path', { d: 'M6 2H2v4M10 14h4v-4M14 6V2h-4M2 10v4h4' }));
      const fullLabel = h('span', null, 'Full screen');
      const fullBtn = h('button', { class: 'ksm-tool', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Full screen' }, fullIcon, fullLabel);
      fullBtn.addEventListener('click', onToggleFull);
      const dg = h('aside', { class: 'ksm-dg', 'aria-label': 'Diagram of the whole chat' },
        h('div', 'ksm-dg-head',
          h('b', null, 'Diagram'), h('span', 'ksm-dim', 'whole chat'), pick, h('span', 'ksm-sp'),
          h('button', { class: 'ksm-tool', type: 'button', 'aria-label': 'Zoom out', onclick: () => zoom(-0.1) }, '−'),
          h('button', { class: 'ksm-tool', type: 'button', 'aria-label': 'Zoom in', onclick: () => zoom(0.1) }, '+'),
          fullBtn),
        dgBody,
        h('div', 'ksm-dg-legend',
          h('span', null, h('i', { style: 'border-left:3px solid var(--ksm-blue)' }), 'Your message'),
          h('span', null, h('i', { style: 'border-style:dashed' }), 'Helper'),
          h('span', null, h('i'), 'File changed'),
          h('span', null, h('i', { style: 'border-color:var(--ksm-blue);background:#10253a' }), 'In view')));
      const sd = h('div', 'ksm-sd', stMain, dg);
      root.appendChild(sd);

      stMain.addEventListener('scroll', onStoryScroll, { passive: true });
      root.addEventListener('keydown', onKeyDown, true);

      Object.assign(N, { root, ttl, totals, szLabel, dgToggle, jumpNow, status, empty, stMain, layer, svg, dgBody, dg, pick, sd, fullBtn, fullLabel });
      mount.appendChild(root);
      return root;
    }

    // ---- open / close / load ---------------------------------------------
    function onTriggerClick() { if (open) closeMap(); else openMap(); }

    function openMap() {
      if (disposed) return;
      if (!overlay) overlay = buildOverlay();
      overlay.hidden = false;
      open = true;
      // The diagram starts closed every time; the Diagram toggle reveals it.
      N.dg.hidden = true;
      N.dgToggle.setAttribute('aria-pressed', 'false');
      setFull(false);
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
      closeFocus();
      file = null;
      active = null;
      scale = 1;
      fsz = 14;
      if (N.pick) { N.pick.hidden = true; N.pick.textContent = ''; }
      showLoading();
      const mine = ++seq;
      let p;
      try { p = Promise.resolve().then(load); } catch (e) { p = Promise.reject(e); }
      p.then(map => {
        if (disposed || mine !== seq) return;
        render(map || null);
      }, err => {
        if (disposed || mine !== seq) return;
        showError(err);
      });
      try { overlay.focus(); } catch (e) { /* ignore */ }
    }

    function closeMap() {
      if (!overlay || !open) return;
      open = false;
      seq++;
      setFull(false);
      closeFocus();
      file = null;
      active = null;
      overlay.hidden = true;
      if (N.pick) { N.pick.hidden = true; N.pick.textContent = ''; }
      if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
        try { trigger.focus(); } catch (e) { /* ignore */ }
      }
    }

    function showLoading() {
      N.status.hidden = false;
      N.status.className = 'ksm-status';
      N.status.textContent = 'Loading session map\u2026';
      N.empty.hidden = true;
      N.sd.hidden = true;
    }

    function showError(err) {
      N.status.hidden = false;
      N.status.className = 'ksm-status ksm-status--error';
      N.status.textContent = '';
      N.status.appendChild(el('p', 'ksm-err-msg',
        'Could not load the session map' + (err && err.message ? ': ' + err.message : '.')));
      const retry = button('ksm-retry', 'Retry');
      retry.addEventListener('click', openMap);
      N.status.appendChild(retry);
      N.empty.hidden = true;
      N.sd.hidden = true;
    }

    function showEmpty() {
      N.status.hidden = true;
      N.sd.hidden = true;
      N.empty.hidden = false;
      N.empty.textContent = '';
      N.empty.appendChild(el('p', 'ksm-empty-t', 'Nothing to map yet.'));
      N.empty.appendChild(el('p', 'ksm-empty-s', 'This session has no turns to show yet.'));
    }

    // ---- render -----------------------------------------------------------
    function render(map) {
      const turns = (map && map.turns) || [];
      const T = (map && map.totals) || {};
      N.ttl.textContent = map && map.title ? String(map.title) : '';

      // reset per-load view state
      active = null;
      file = null;
      scale = 1;
      fsz = 14;
      rows = {};
      dn = {};
      edges = [];
      paths = [];
      N.pick.hidden = true;
      N.pick.textContent = '';
      N.stMain.textContent = '';
      N.stMain.style.setProperty('--fs', fsz + 'px');
      N.szLabel.textContent = fsz + 'px';
      N.stMain.scrollTop = 0;
      N.dgBody.scrollTop = 0;
      N.layer.style.zoom = '';
      for (const el of [...N.layer.querySelectorAll('.ksm-dn, .ksm-dg-col, .ksm-dg-band')]) el.remove();
      N.svg.replaceChildren();

      const list = turns.slice().sort((a, b) => a.n - b.n);
      if (!list.length) { loops = []; showEmpty(); return; }

      // A step = one message you sent plus the automatic turns after it.
      steps = [];
      for (const t of list) {
        if (t.kind !== 'auto' || !steps.length) {
          steps.push({ n: t.n, kind: t.kind === 'auto' ? 'ask' : t.kind, text: t.text, images: t.images, turns: [t] });
        } else {
          steps[steps.length - 1].turns.push(t);
        }
      }
      const lastOf = a => a.filter(Boolean).pop() || '';
      for (const s of steps) {
        const ts = s.turns;
        s.to = ts[ts.length - 1].n;
        s.files = sumFiles(ts);
        s.commands = ts.flatMap(t => (t.commands || []).map(c => ({ desc: c.desc, cmd: c.cmd, exit: c.exit, status: c.status, n: t.n })));
        s.errors = ts.flatMap(t => (t.errors || []).map(e => ({ tool: e.tool, text: e.text, n: t.n })));
        s.agents = ts.flatMap(t => (t.agents || []).map(a => ({ type: a.type, desc: a.desc, status: a.status, n: t.n })));
        s.checks = ts.reduce((a, t) => a + (+t.checks || 0), 0);
        s.tokens = ts.reduce((a, t) => a + (+t.tokens || 0), 0);
        s.minutes = Math.round(ts.reduce((a, t) => a + (+t.minutes || 0), 0) * 10) / 10;
        s.reply = lastOf(ts.map(t => t.reply));
        s.next = lastOf(ts.map(t => t.next));
        s.messageID = ts[0] && ts[0].messageID;
        s.loop = -1;
      }
      loops = ((map && map.loops) || []).map(l => ({ title: l.title, from: l.from, to: l.to, status: l.status }));
      if (!loops.length) {
        loops = [{ title: 'This session', from: steps[0].n, to: steps[steps.length - 1].n, status: 'active' }];
      }
      for (const s of steps) s.loop = loops.findIndex(l => s.n >= l.from && s.n <= l.to);
      live = steps[steps.length - 1];
      ALLF = sumFiles(list).map(f => ({
        ...f,
        steps: steps.filter(s => s.files.some(x => x.file === f.file)).map(s => s.n)
      }));

      const replyText = s => (s === live && !s.reply) ? 'Working on this now\u2026' : (s.reply || 'No written reply in this step.');

      // header totals
      N.totals.textContent = '';
      N.totals.append(
        h('b', null, String(steps.length)), ' messages from you \u00b7 ',
        h('b', null, String(T.turns != null ? T.turns : list.length)), ' turns \u00b7 ',
        h('b', null, String(ALLF.length)), ' files \u00b7 ',
        h('b', null, String(T.helpers != null ? T.helpers : 0)), ' helper runs \u00b7 ',
        h('b', null, String(Math.round(+T.minutes || 0))), ' min');

      renderStory(replyText);
      renderDiagram();
      N.status.hidden = true;
      N.empty.hidden = true;
      N.sd.hidden = false;

      // Diagram off by default; the toggle reveals it (and reset any full-screen).
      N.dg.hidden = true;
      N.dgToggle.setAttribute('aria-pressed', 'false');
      setFull(false);

      requestAnimationFrame(() => {
        if (disposed || !open) return;
        if (!N.dg.hidden) layoutDiagram();
        if (steps.length) setActive(steps[0].n, true);
      });
    }

    function renderStory(replyText) {
      const fileBtn = f => h('button', {
        class: 'ksm-flink ksm-mono', type: 'button',
        title: 'Show every message that changed ' + f.file,
        onclick: () => selectFile(f.file)
      }, base(f.file));

      loops.forEach((l, li) => {
        const ss = steps.filter(s => s.loop === li);
        if (!ss.length) return;
        N.stMain.appendChild(h('div', 'ksm-st-loop',
          h('b', null, 'Loop ' + (li + 1) + ' \u00b7 ' + (l.title || '')),
          h('span', null, 'turns ' + l.from + '\u2013' + l.to + ' \u00b7 ' + (l.status === 'done' ? 'done' : 'in progress'))));
        for (const s of ss) {
          const jumpBtn = h('button', { class: 'ksm-mini', type: 'button', 'aria-label': 'Jump to message ' + s.n }, 'Jump to message');
          jumpBtn.addEventListener('click', () => jumpStep(s));
          const focusBtn = h('button', { class: 'ksm-mini', type: 'button', 'aria-label': 'Open message ' + s.n + ' at full size' }, '\u2922 Full size');
          focusBtn.addEventListener('click', () => openFocus(s, focusBtn));

          const card = h('div', 'ksm-st-msg ' + kindCls(s),
            h('div', 'ksm-msg-head',
              h('span', 'ksm-tag ksm-' + s.kind, '#' + s.n + ' ' + kindTag(s)),
              s.images ? h('span', 'ksm-dim', plural(s.images, 'screenshot')) : null,
              h('span', 'ksm-sp'),
              jumpBtn, focusBtn),
            h('div', 'ksm-txt', s.text));

          const tree = h('ul', 'ksm-tree',
            h('li', null,
              h('div', 'ksm-th', 'Kilo replied \u00b7 turns ' + s.n + '\u2013' + s.to),
              h('div', 'ksm-rep', replyText(s)),
              s.next ? h('div', 'ksm-rep', { style: 'color:var(--ksm-text)' }, 'Next: ' + s.next) : null),
            s.agents.length ? h('li', null, h('div', 'ksm-th', 'Helpers \u00b7 ' + s.agents.length),
              s.agents.map(a => h('div', 'ksm-li', h('span', 'ksm-chip', agentName(a.type)), h('span', null, a.desc)))) : null,
            s.files.length ? h('li', null, h('div', 'ksm-th', 'Files \u00b7 ' + s.files.length),
              s.files.map(f => h('div', 'ksm-li', fileBtn(f), h('span', 'ksm-add', '+' + f.add), h('span', 'ksm-del', '\u2212' + f.del)))) : null,
            (s.commands.length || s.checks) ? h('li', null, h('div', 'ksm-th', 'Commands and checks'),
              s.commands.map(c => h('div', 'ksm-li',
                h('span', failed(c) ? 'ksm-bad' : 'ksm-ok', failed(c) ? '\u2717' : '\u2713'),
                h('span', null, c.desc || c.cmd))),
              s.checks ? h('div', 'ksm-li ksm-dim', plural(s.checks, 'browser check')) : null) : null,
            s.errors.length ? h('li', null, h('div', 'ksm-th', 'Problems \u00b7 ' + s.errors.length),
              s.errors.map(e => h('div', 'ksm-li ksm-bad', e.tool + ': ' + e.text))) : null,
            h('li', null, h('div', 'ksm-dim', { style: 'font-size:11px' }, s.minutes + ' min \u00b7 ' + fmtTok(s.tokens) + ' tokens')));

          const row = h('div', 'ksm-st-row', { 'data-n': String(s.n) },
            card, h('div', 'ksm-st-wire', { 'aria-hidden': 'true' }), tree);
          row.addEventListener('mouseenter', () => setActive(s.n));
          rows[s.n] = row;
          N.stMain.appendChild(row);
        }
      });
    }

    function renderDiagram() {
      const mkNode = (id, cls, col, kids, onclick) => {
        const el = h('button', { class: 'ksm-dn ' + cls, type: 'button', style: 'left:' + X[col] + 'px;width:' + W[col] + 'px', onclick }, kids);
        N.layer.appendChild(el);
        dn[id] = el;
        return el;
      };
      [['msg', 'Messages'], ['help', 'Helpers'], ['file', 'Files']].forEach(([c, t]) => {
        N.layer.appendChild(h('div', { class: 'ksm-dg-col', style: 'left:' + X[c] + 'px' }, t));
      });
      for (const s of steps) {
        const go = () => { setActive(s.n, true); jumpStory(s.n); };
        mkNode('m' + s.n, 'ksm-msg ' + kindCls(s), 'msg',
          [h('div', 'ksm-k', '#' + s.n + ' \u00b7 ' + kindTag(s)), h('div', 'ksm-t2', s.text)], go);
        s.agents.forEach((a, j) => {
          mkNode('h' + s.n + '-' + j, 'ksm-help', 'help',
            [h('div', 'ksm-k', agentName(a.type)), h('div', 'ksm-t2', a.desc)], go);
          edges.push(['m' + s.n, 'h' + s.n + '-' + j]);
        });
      }
      ALLF.forEach((f, j) => {
        const el = mkNode('f' + j, 'ksm-file', 'file',
          [h('span', 'ksm-nm ksm-mono', base(f.file)),
            h('span', 'ksm-k', h('span', 'ksm-add', '+' + f.add), ' ', h('span', 'ksm-del', '\u2212' + f.del), ' \u00b7 ' + plural(f.steps.length, 'message'))],
          () => selectFile(f.file));
        el.title = f.file;
        f.steps.forEach(n => edges.push(['m' + n, 'f' + j]));
      });
    }

    // ---- diagram layout (measure while visible) --------------------------
    function layoutDiagram() {
      if (!N.dg || N.dg.hidden) return;
      for (const b of [...N.layer.querySelectorAll('.ksm-dg-band')]) b.remove();
      let y = 36;
      loops.forEach((l, li) => {
        const ss = steps.filter(s => s.loop === li);
        if (!ss.length) return;
        const top = y;
        y += 16;
        for (const s of ss) {
          const m = dn['m' + s.n];
          if (!m) continue;
          m.style.top = y + 'px';
          let hy = y;
          s.agents.forEach((_, j) => {
            const e = dn['h' + s.n + '-' + j];
            if (!e) return;
            e.style.top = hy + 'px';
            hy += e.offsetHeight + 6;
          });
          y = Math.max(y + m.offsetHeight, hy - 6) + 12;
        }
        N.layer.prepend(h('div', {
          class: 'ksm-dg-band',
          style: 'top:' + top + 'px;height:' + (y - top) + 'px;width:' + (X.help + W.help) + 'px'
        }, h('span', null, 'Loop ' + (li + 1) + ' \u00b7 ' + (l.title || ''))));
        y += 18;
      });
      const fs = ALLF.map((f, j) => {
        const el = dn['f' + j];
        const ys = f.steps.map(n => dn['m' + n] ? dn['m' + n].offsetTop + dn['m' + n].offsetHeight / 2 : 0);
        const want = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length - el.offsetHeight / 2 : 36;
        return { el, want };
      }).sort((a, b) => a.want - b.want);
      let fy = 36;
      for (const f of fs) { fy = Math.max(fy, f.want); f.el.style.top = fy + 'px'; fy += f.el.offsetHeight + 6; }
      const H = Math.max(y, fy) + 20;
      const Wd = X.file + W.file + 14;
      N.layer.style.width = Wd + 'px';
      N.layer.style.height = H + 'px';
      N.svg.setAttribute('width', Wd);
      N.svg.setAttribute('height', H);
      paths = [];
      const made = edges.map(([a, b]) => {
        const A = dn[a], B = dn[b];
        if (!A || !B) return null;
        const x1 = A.offsetLeft + A.offsetWidth, y1 = A.offsetTop + A.offsetHeight / 2;
        const x2 = B.offsetLeft, y2 = B.offsetTop + B.offsetHeight / 2, mx = (x1 + x2) / 2;
        const p = svgEl('path', { d: 'M' + x1 + ' ' + y1 + 'C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2 });
        p.dataset.a = a;
        p.dataset.b = b;
        paths.push(p);
        return p;
      }).filter(Boolean);
      N.svg.replaceChildren(...made);
      paint();
    }

    // ---- sync -------------------------------------------------------------
    function paint() {
      const hot = new Set();
      if (file) {
        const j = ALLF.findIndex(f => f.file === file);
        if (j >= 0) { hot.add('f' + j); ALLF[j].steps.forEach(n => hot.add('m' + n)); }
      }
      if (active != null) {
        hot.add('m' + active);
        for (const p of paths) if (p.dataset.a === 'm' + active) hot.add(p.dataset.b);
      }
      for (const id in dn) {
        const el = dn[id];
        el.classList.toggle('ksm-active', id === 'm' + active);
        el.classList.toggle('ksm-rel', hot.has(id) && id !== 'm' + active);
      }
      const fileId = file ? 'f' + ALLF.findIndex(f => f.file === file) : null;
      for (const p of paths) {
        p.classList.toggle('ksm-hot', p.dataset.a === 'm' + active || (!!fileId && p.dataset.b === fileId));
      }
      const fe = file ? ALLF.find(f => f.file === file) : null;
      for (const n in rows) {
        const r = rows[n];
        r.classList.toggle('ksm-active', +n === active);
        r.classList.toggle('ksm-filehit', !!fe && fe.steps.indexOf(+n) >= 0);
      }
      N.sd.classList.toggle('ksm-filtering', !!file);
      N.dg.classList.toggle('ksm-filtering', !!file);
    }

    function setActive(n, force) {
      if (active === n && !force) return;
      active = n;
      paint();
      if (!N.dg || N.dg.hidden) return;
      const el = dn['m' + n];
      if (!el) return;
      const top = el.offsetTop * scale;
      const bottom = top + el.offsetHeight * scale;
      if (top < N.dgBody.scrollTop + 20 || bottom > N.dgBody.scrollTop + N.dgBody.clientHeight - 20) {
        N.dgBody.scrollTo({ top: Math.max(0, top - 60), behavior: scrollBehavior() });
      }
    }

    function jumpStory(n) {
      const row = rows[n];
      if (row) N.stMain.scrollTo({ top: row.offsetTop - 8, behavior: scrollBehavior() });
    }

    function selectFile(f) {
      file = f;
      N.pick.hidden = false;
      N.pick.replaceChildren(
        h('span', 'ksm-mono', base(f)),
        h('button', { class: 'ksm-mini', type: 'button', 'aria-label': 'Clear file filter', onclick: clearFile }, '\u2715'));
      paint();
      const entry = ALLF.find(x => x.file === f);
      const first = entry && entry.steps[0];
      if (first != null && rows[first]) N.stMain.scrollTo({ top: rows[first].offsetTop - 8, behavior: scrollBehavior() });
    }

    function clearFile() {
      if (!file) return;
      file = null;
      N.pick.hidden = true;
      N.pick.textContent = '';
      paint();
    }

    function size(d) {
      fsz = Math.min(22, Math.max(12, fsz + d));
      N.stMain.style.setProperty('--fs', fsz + 'px');
      N.szLabel.textContent = fsz + 'px';
      if (open && N.dg && !N.dg.hidden) layoutDiagram();
    }

    function zoom(d) {
      scale = Math.min(1.4, Math.max(0.6, Math.round((scale + d) * 10) / 10));
      N.layer.style.zoom = scale;
      if (open && N.dg && !N.dg.hidden) layoutDiagram();
    }

    function onToggleDiagram() {
      const show = N.dg.hidden;
      N.dg.hidden = !show;
      N.dgToggle.setAttribute('aria-pressed', String(show));
      if (show) {
        // A narrow panel cannot fit the story and the diagram side by side, so the diagram opens full screen there.
        if (narrow()) setFull(true); else layoutDiagram();
        if (active != null) setActive(active, true);
      } else {
        setFull(false);
      }
    }

    // ponytail: fixed 640px breakpoint (story ~300px + diagram 300px); upgrade path is a ResizeObserver if the panel is resized while open.
    function narrow() { return N.root.clientWidth > 0 && N.root.clientWidth < 640; }

    function onToggleFull() { setFull(!full); }

    function setFull(on) {
      on = !!on && !!N.dg && !N.dg.hidden;
      full = on;
      if (!N.dg) return;
      N.dg.classList.toggle('ksm-dg-full', on);
      N.fullBtn.setAttribute('aria-pressed', String(on));
      N.fullBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
      N.fullLabel.textContent = on ? 'Exit full screen' : 'Full screen';
      if (on && open) layoutDiagram();
      // Leaving full screen in a narrow panel closes the diagram instead of squeezing the story.
      if (!on && !N.dg.hidden && narrow()) { N.dg.hidden = true; N.dgToggle.setAttribute('aria-pressed', 'false'); }
    }

    function onStoryScroll() {
      if (!steps.length) return;
      const y = N.stMain.scrollTop + 40;
      let cur = steps[0].n;
      for (const s of steps) if (rows[s.n].offsetTop <= y) cur = s.n;
      setActive(cur);
    }

    // ---- focus: one message at full size ----------------------------------
    function openFocus(s, triggerEl) {
      if (focusState) return;
      const closeBtn = h('button', { class: 'ksm-tool', type: 'button' }, 'Close (Esc)');
      closeBtn.addEventListener('click', closeFocus);
      const jumpBtn = h('button', { class: 'ksm-tool', type: 'button' }, 'Jump to message');
      jumpBtn.addEventListener('click', () => jumpStep(s));

      const ov = h('div', {
        class: 'ksm-focus', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Message ' + s.n,
        onclick: e => { if (e.target === ov) closeFocus(); }
      },
        h('div', 'ksm-focus-card',
          h('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' },
            h('h3', null, 'Message #' + s.n),
            h('span', 'ksm-tag ksm-' + s.kind, kindTag(s)),
            h('span', 'ksm-dim', 'Loop ' + (s.loop + 1) + ' \u00b7 turns ' + s.n + '\u2013' + s.to),
            h('span', 'ksm-sp'), jumpBtn, closeBtn),
          h('div', 'ksm-big', s.text),
          h('h4', null, 'Kilo replied'),
          h('div', 'ksm-txt', { style: 'font-size:13.5px;color:var(--ksm-text2)' }, replyFor(s)),
          s.next ? h('div', 'ksm-li', h('span', 'ksm-dim', 'Next step:'), h('span', null, s.next)) : null,
          h('h4', null, 'Helpers'),
          s.agents.length
            ? s.agents.map(a => h('div', 'ksm-li', h('span', 'ksm-n', '#' + a.n), h('span', null, agentName(a.type) + ': ' + a.desc)))
            : h('div', 'ksm-li ksm-dim', 'None, the lead did it'),
          h('h4', null, 'Files changed'),
          s.files.length
            ? s.files.map(f => h('div', 'ksm-li', h('span', 'ksm-mono', f.file), h('span', 'ksm-add', '+' + f.add), h('span', 'ksm-del', '\u2212' + f.del)))
            : h('div', 'ksm-li ksm-dim', 'No files changed'),
          h('h4', null, 'Commands and checks'),
          s.commands.length
            ? s.commands.map(c => h('div', 'ksm-li', h('span', 'ksm-n', '#' + c.n), h('span', failed(c) ? 'ksm-bad' : 'ksm-ok', failed(c) ? '\u2717' : '\u2713'), h('span', null, c.desc || c.cmd)))
            : h('div', 'ksm-li ksm-dim', 'No commands'),
          h('h4', null, 'Problems'),
          s.errors.length
            ? s.errors.map(e => h('div', 'ksm-li', h('span', 'ksm-n', '#' + e.n), h('span', 'ksm-bad', e.tool + ': ' + e.text)))
            : h('div', 'ksm-li ksm-dim', 'None')));

      // The dialog is modal: everything else in the panel is inert until it closes.
      const behind = [...N.root.children];
      behind.forEach(c => { c.inert = true; });
      focusState = { ov, trigger: triggerEl || null, behind };
      N.root.appendChild(ov);
      try { closeBtn.focus(); } catch (e) { /* ignore */ }
    }

    function closeFocus() {
      if (!focusState) return;
      const t = focusState.trigger;
      focusState.behind.forEach(c => { c.inert = false; });
      focusState.ov.remove();
      focusState = null;
      if (t && t.isConnected) { try { t.focus(); } catch (e) { /* ignore */ } }
    }

    function replyFor(s) {
      return (s === live && !s.reply) ? 'Working on this now\u2026' : (s.reply || 'No written reply in this step.');
    }

    function jumpStep(s) {
      const id = s.messageID != null ? s.messageID : (s.turns[0] && s.turns[0].messageID);
      try { if (id != null) jump(id); } finally { closeMap(); }
    }

    // ---- keyboard ---------------------------------------------------------
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      if (focusState) { e.preventDefault(); e.stopPropagation(); closeFocus(); return; }
      if (full) { e.preventDefault(); e.stopPropagation(); setFull(false); return; }
      if (file) { e.preventDefault(); e.stopPropagation(); clearFile(); return; }
      if (open) { e.preventDefault(); e.stopPropagation(); closeMap(); }
    }

    // ---- tiny construction helpers ---------------------------------------
    function el(tag, cls, text) {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }
    function button(cls, text) {
      const b = el('button', cls, text);
      b.type = 'button';
      return b;
    }

    // ---- wire up / teardown ----------------------------------------------
    if (trigger) {
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      trigger.addEventListener('click', onTriggerClick);
    }

    return function detach() {
      if (disposed) return;
      disposed = true;
      seq++;
      open = false;
      closeFocus();
      if (trigger) {
        trigger.removeEventListener('click', onTriggerClick);
        trigger.setAttribute('aria-expanded', 'false');
      }
      if (overlay) {
        overlay.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        overlay = null;
      }
    };
  }

  globalThis.__kiloSessionMap = { attach: attach };
})();