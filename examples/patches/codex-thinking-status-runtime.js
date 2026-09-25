/* codex-thinking-status-runtime:v1 */
// Appended to Codex's local conversation chunk by codex-thinking-status.mjs.
// It only decorates Codex's own transient Thinking/Typing shimmer; it never
// changes a completed answer or claims a specific tool is running.
(() => {
  const installedKey = "__codexThinkingStatusRuntimeV1";
  if (globalThis[installedKey]) return;
  globalThis[installedKey] = true;

  const states = new WeakMap();
  const activeNodes = new Set();
  const failureNotice = /stream disconnected before completion|transport error|network error|connection (?:lost|failed)|response failed/i;
  const reconnectNotice = /\breconnecting(?:\s+\d+\s*\/\s*\d+)?\b/i;
  let latestTransportNotice = null;

  function installStyles() {
    if (document.getElementById("codex-thinking-status-style")) return;
    const style = document.createElement("style");
    style.id = "codex-thinking-status-style";
    style.textContent = `
      @keyframes codex-thinking-status-pulse {
        0%, 100% { opacity: .35; transform: scale(.8); }
        50% { opacity: 1; transform: scale(1); }
      }
      @keyframes codex-thinking-status-spin {
        to { transform: rotate(360deg); }
      }
      span[data-codex-work-status] {
        align-items: center !important;
        background: var(--color-surface-secondary, rgba(127, 127, 127, .1));
        border: 1px solid var(--color-border, rgba(127, 127, 127, .25));
        border-radius: 999px;
        box-sizing: border-box;
        color: transparent !important;
        display: inline-flex !important;
        font-size: 0 !important;
        gap: .45rem;
        line-height: 1.5rem !important;
        min-height: 1.75rem;
        min-width: 12.25rem;
        overflow: visible !important;
        padding: 0 .6rem;
        pointer-events: none;
        -webkit-text-fill-color: transparent !important;
      }
      span[data-codex-work-status] > * {
        animation: none !important;
        visibility: hidden !important;
      }
      span[data-codex-work-status]::before {
        animation: codex-thinking-status-pulse 1.2s ease-in-out infinite;
        background: var(--color-text-info, #66a8ff);
        border-radius: 999px;
        content: "";
        display: block;
        flex: none;
        height: .45rem;
        width: .45rem;
      }
      span[data-codex-work-status]::after {
        color: var(--color-text-secondary, #a1a1aa);
        content: attr(data-codex-work-label) "  ·  " attr(data-codex-work-elapsed);
        font-family: var(--font-ui-family, -apple-system, system-ui, sans-serif);
        font-size: var(--codex-chat-font-size, 13px);
        font-variant-numeric: tabular-nums;
        line-height: 1.5rem;
        white-space: nowrap;
      }
      span[data-codex-work-status="reconnecting"]::before {
        animation: codex-thinking-status-spin .85s linear infinite;
        background: transparent;
        border: 2px solid color-mix(in srgb, var(--color-text-info, #66a8ff) 30%, transparent);
        border-top-color: var(--color-text-info, #66a8ff);
        box-sizing: border-box;
      }
      span[data-codex-work-status="failed"] {
        background: color-mix(in srgb, var(--color-text-warning, #e0a458) 10%, var(--color-surface-secondary, rgba(127, 127, 127, .1)));
        border-color: color-mix(in srgb, var(--color-text-warning, #e0a458) 45%, transparent);
      }
      span[data-codex-work-status="failed"]::before {
        animation: none;
        background: var(--color-text-warning, #e0a458);
      }
      span[data-codex-work-status="failed"]::after {
        color: var(--color-text-warning, #e0a458);
      }
      @media (prefers-reduced-motion: reduce) {
        span[data-codex-work-status]::before { animation: none; }
      }
    `;
    (document.head || document.documentElement).append(style);
  }

  function compactText(value) {
    return String(value || "").replace(/\s+/g, "");
  }

  function modeFor(node) {
    if (!(node instanceof HTMLElement) || !String(node.className).includes("cadencedShimmer")) return null;
    const text = compactText(node.textContent);
    if (/^(?:Thinking)+$/.test(text)) return "thinking";
    if (/^(?:Typing(?:…|\.\.\.)?)+$/.test(text)) return "typing";
    return null;
  }

  function elapsed(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainder = String(seconds % 60).padStart(2, "0");
    return `${minutes}:${remainder}`;
  }

  function recordTransportNotice(value) {
    const text = String(value || "").trim();
    if (!text || text.length > 800) return;
    const kind = failureNotice.test(text) ? "failed" : reconnectNotice.test(text) ? "reconnecting" : null;
    if (kind) latestTransportNotice = { kind, at: Date.now() };
  }

  function decorate(node, mode) {
    const now = Date.now();
    let state = states.get(node);
    if (!state) {
      state = { startedAt: now, originalAriaLabel: node.getAttribute("aria-label") };
      states.set(node, state);
      activeNodes.add(node);
    }
    const notice = latestTransportNotice?.at >= state.startedAt ? latestTransportNotice : null;
    const isFailed = notice?.kind === "failed";
    const isReconnecting = !isFailed && notice?.kind === "reconnecting" && now - notice.at < 15000;
    const seconds = Math.max(0, Math.floor(((isFailed ? notice.at : now) - state.startedAt) / 1000));
    const status = isFailed ? "failed" : isReconnecting ? "reconnecting" : mode;
    const label = isFailed ? "Connection lost" : isReconnecting ? "Reconnecting" : mode === "typing" ? "AI is writing" : seconds < 3 ? "AI is starting" : "AI is working";
    node.dataset.codexWorkStatus = status;
    node.dataset.codexWorkLabel = label;
    node.dataset.codexWorkElapsed = elapsed(seconds);
    node.setAttribute("aria-label", `${label}, ${elapsed(seconds)} elapsed`);
  }

  function restore(node) {
    const state = states.get(node);
    if (!state) return;
    delete node.dataset.codexWorkStatus;
    delete node.dataset.codexWorkLabel;
    delete node.dataset.codexWorkElapsed;
    if (state.originalAriaLabel == null) node.removeAttribute("aria-label");
    else node.setAttribute("aria-label", state.originalAriaLabel);
    states.delete(node);
    activeNodes.delete(node);
  }

  function scan() {
    for (const node of document.querySelectorAll('span[class*="cadencedShimmer"]')) {
      const mode = modeFor(node);
      if (mode) decorate(node, mode);
    }
    for (const node of activeNodes) {
      if (!node.isConnected || !modeFor(node)) restore(node);
    }
  }

  function observe() {
    installStyles();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") recordTransportNotice(record.target.data);
        for (const node of record.addedNodes) recordTransportNotice(node.nodeType === Node.TEXT_NODE ? node.data : node.textContent);
      }
      scan();
    });
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
    scan();
    window.setInterval(scan, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe, { once: true });
  else observe();
})();
