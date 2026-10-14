'use strict';
// Session map grouping: one Kilo session's messages -> turns and loops.
// Pure CommonJS, no dependencies, no I/O, no model calls.

const APPROVAL_RE = /^(sure|yes|yep|ok(ay)?|great|perfect|nice|awesome|looks good|continue|please continue|go ahead|approved|i like|let'?s (go|implement|do))/i;
const REDIRECT_RE = /^(no\b|still\b|i mean\b|not\b)/i;
const EDIT_TOOLS = new Set(['edit', 'write', 'apply_patch', 'multiedit']);
const MOCK_TOOLS = new Set(['write', 'edit', 'apply_patch']);
const CHECK_RE = /playwright|browser|Peekaboo|computer_/i;

// ponytail: keyword heuristics for loop boundaries, titles and call tags misgroup
// unusual sessions (an approval phrased as a question, a redirect opening with a
// noun). Upgrade path: one cheap model call to title loops and place boundaries.

function partsOf(message) {
  return Array.isArray(message?.parts) ? message.parts : [];
}

function textOf(message) {
  return partsOf(message)
    .filter(p => p.type === 'text' && !p.synthetic)
    .map(p => p.text || '')
    .join('\n');
}

function collapse(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function imagesOf(message) {
  return partsOf(message).filter(p => p.type === 'file' && /^image\//i.test(String(p.mime || ''))).length;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

// +add/-del line counts. '+++'/'---' diff headers are not counted.
function diffCount(diff) {
  let add = 0;
  let del = 0;
  for (const line of String(diff || '').split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) add++;
    else if (line.startsWith('-')) del++;
  }
  return { add, del };
}

// Shorten a tool file path: strip options.root (with its leading '/'), else '~' for options.home.
function shortenPath(file, options) {
  const value = String(file || '');
  const root = options && options.root;
  if (root && value.startsWith(root)) return value.slice(root.length).replace(/^\/+/, '');
  const home = options && options.home;
  if (home && value.startsWith(home)) return '~' + value.slice(home.length);
  return value;
}

// First non-empty line of a tool error with a leading '### Error'/'Error' heading removed.
function errorLine(error, max) {
  return String(error || '').replace(/^#+\s*Error\s*/i, '').split('\n').filter(Boolean)[0]?.slice(0, max) || 'Error';
}

// Body of a '## <name>' section, or '' when the section is absent.
function sectionOf(text, name) {
  const match = String(text || '').match(new RegExp('##\\s*' + name + '\\s*([\\s\\S]*?)(\\n##\\s|$)'));
  return match ? match[1] : '';
}

// Reply prose as plain text: drop code fences, markup characters, fence bullets, blank runs.
function plainText(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*`#>]/g, '')
    .replace(/^\s*-\s+/gm, '\u2022 ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function kindOf(message, canned) {
  const text = textOf(message).trim();
  const hasFile = partsOf(message).some(p => p.type === 'file');
  if (!text && !hasFile) return 'auto';
  // "Sure, I like A" is an approval; "Sure. Create a mock form first and…" is a new ask.
  if (APPROVAL_RE.test(text) && text.split(/\s+/).length <= 12) return 'approval';
  if (canned.some(c => {
    const value = String(c == null ? '' : c).trim();
    return value.length > 0 && text.startsWith(value);
  })) return 'approval';
  return 'ask';
}

function redirectTag(text) {
  const value = String(text || '').trim();
  if (!REDIRECT_RE.test(value)) return null;
  if (/^i mean\b/i.test(value)) return 'Clarified';
  return 'Corrected';
}

function optionLetter(text) {
  // "I like A", "I like the A option", "option b", "go with c". Requires a choice verb so
  // "create a to-do list" or "I like a lot" are not read as picking option a.
  const match = /\b(?:option|like|pick|choose|go with|use)\s+(?:the\s+)?([a-d])(?=\s*(?:option\b|$|[.,!;]))/i.exec(String(text || ''));
  return match ? match[1].toUpperCase() : null;
}

function shorten(text) {
  const flat = collapse(text);
  return flat.length > 60 ? flat.slice(0, 60) + '\u2026' : flat;
}

function findMock(list) {
  for (const turn of list) {
    for (const part of turn.parts) {
      if (part.type !== 'tool' || !MOCK_TOOLS.has(String(part.tool || ''))) continue;
      const input = part.state?.input || {};
      const file = input.filePath || input.path;
      if (typeof file === 'string' && /mockup/i.test(file) && /\.html$/i.test(file)) return { n: turn.n, path: file };
    }
  }
  return null;
}

function findCall(list) {
  const redirects = list.filter(t => t.redirect);
  const target = redirects.length ? redirects[redirects.length - 1] : list.find(t => t.kind === 'approval');
  if (!target) return null;
  if (target.redirect) return { n: target.n, text: target.text, tag: target.redirect };
  const letter = optionLetter(target.text);
  return { n: target.n, text: target.text, tag: letter ? `Chose ${letter}` : 'Approved' };
}

function findCheck(list) {
  let found = null;
  for (const turn of list) {
    for (const part of turn.parts) {
      if (part.type === 'tool' && CHECK_RE.test(String(part.tool || ''))) found = { n: turn.n };
    }
  }
  return found;
}

function buildStats(list) {
  const agents = {};
  let edits = 0;
  let rawMinutes = 0;
  for (const turn of list) {
    rawMinutes += turn.rawMinutes;
    for (const part of turn.parts) {
      if (part.type !== 'tool') continue;
      const name = String(part.tool || '');
      if (name === 'task') {
        const subtype = part.state?.input?.subagent_type || 'helper';
        agents[subtype] = (agents[subtype] || 0) + 1;
      } else if (EDIT_TOOLS.has(name)) {
        edits++;
      }
    }
  }
  return { agents, edits, minutes: round1(rawMinutes) };
}

function buildMap(messages, options = {}) {
  const canned = Array.isArray(options?.canned) ? options.canned : [];
  const list = Array.isArray(messages) ? messages : [];

  // Turn = one user message plus the assistant messages after it until the next user message.
  const groups = [];
  for (const message of list) {
    if (message?.info?.role === 'user') groups.push({ user: message, rest: [] });
    else if (groups.length) groups[groups.length - 1].rest.push(message);
  }

  const meta = [];
  const turns = [];
  groups.forEach((group, index) => {
    const n = index + 1;
    const user = group.user;
    const parts = [user, ...group.rest].flatMap(partsOf);
    const text = textOf(user).trim();
    const kind = kindOf(user, canned);
    const assistants = group.rest.filter(m => m?.info?.role === 'assistant');
    const last = assistants[assistants.length - 1];
    const created = user?.info?.time?.created;
    const end = last?.info?.time?.completed ?? last?.info?.time?.created;
    const rawMinutes = typeof created === 'number' && typeof end === 'number' ? (end - created) / 60000 : 0;
    let edits = 0;
    let tasks = 0;
    for (const part of parts) {
      if (part.type !== 'tool') continue;
      if (String(part.tool) === 'task') tasks++;
      if (EDIT_TOOLS.has(String(part.tool))) edits++;
    }
    // Per-turn detail: what the grouping keeps without (tokens, files, commands, …).
    let tokens = 0;
    let lastReply = '';
    let checks = 0;
    const fileMap = new Map();
    const commands = [];
    const errors = [];
    const agents = [];
    for (const message of assistants) {
      const tk = message?.info?.tokens || {};
      tokens += (tk.input || 0) + (tk.output || 0) + (tk.reasoning || 0) + ((tk.cache && tk.cache.read) || 0);
      for (const part of partsOf(message)) {
        if (part.type === 'text') {
          if (!part.synthetic && part.text && String(part.text).trim()) lastReply = part.text;
          continue;
        }
        if (part.type !== 'tool') continue;
        const name = String(part.tool || '');
        const state = part.state || {};
        const input = state.input || {};
        const metadata = state.metadata || {};
        if (CHECK_RE.test(name)) checks++;
        if (EDIT_TOOLS.has(name)) {
          const file = shortenPath(input.filePath || input.path, options);
          let count = diffCount(metadata.diff);
          if (!metadata.diff && name === 'write') count = { add: String(input.content || '').split('\n').length, del: 0 };
          const entry = fileMap.get(file);
          if (entry) {
            entry.add += count.add;
            entry.del += count.del;
          } else fileMap.set(file, { file, add: count.add, del: count.del });
        }
        if (name === 'bash') {
          commands.push({
            desc: input.description || '',
            cmd: String(input.command || '').split('\n')[0].slice(0, 120),
            exit: metadata.exit,
            status: state.status,
          });
        }
        if (name === 'task') {
          agents.push({ type: input.subagent_type || 'helper', desc: input.description || '', status: state.status });
        }
        if (state.status === 'error') errors.push({ tool: String(part.tool || 'tool'), text: errorLine(state.error, 160) });
      }
    }
    const answer = sectionOf(lastReply, 'Answer');
    meta.push({ n, kind, text, user, parts, rawMinutes, redirect: null });
    turns.push({
      n,
      kind,
      text: text.slice(0, 6000),
      images: imagesOf(user),
      edits,
      tasks,
      minutes: round1(rawMinutes),
      messageID: user?.info?.id,
      tokens,
      files: [...fileMap.values()],
      commands,
      errors,
      agents,
      checks,
      reply: plainText(answer || lastReply).slice(0, 900),
      next: plainText(sectionOf(lastReply, 'Next step')).slice(0, 300),
    });
  });

  // Loop boundaries. A later ask starts a new loop only if the current loop already
  // holds an approval; otherwise it stays and may become the loop's redirect.
  const loopMeta = [];
  let current = null;
  for (const turn of meta) {
    if (!current) {
      current = { turns: [turn] };
      loopMeta.push(current);
      continue;
    }
    const hasApproval = current.turns.some(t => t.kind === 'approval');
    if (turn.kind === 'ask' && hasApproval) {
      current = { turns: [turn] };
      loopMeta.push(current);
      continue;
    }
    if (turn.kind === 'ask') {
      const tag = redirectTag(turn.text);
      if (tag) turn.redirect = tag;
    }
    current.turns.push(turn);
  }

  const loops = loopMeta.map((loop, index) => {
    const members = loop.turns;
    const firstAsk = members.find(t => t.kind === 'ask') || null;
    const images = members.filter(t => t.kind === 'ask').reduce((sum, t) => sum + imagesOf(t.user), 0);
    return {
      title: shorten(firstAsk ? firstAsk.text : (members[0] ? members[0].text : '')),
      from: members[0].n,
      to: members[members.length - 1].n,
      status: index === loopMeta.length - 1 ? 'active' : 'done',
      ask: firstAsk
        ? { n: firstAsk.n, text: firstAsk.text, images }
        : { n: members[0].n, text: '', images },
      mock: findMock(members),
      call: findCall(members),
      build: buildStats(members),
      check: findCheck(members),
    };
  });

  const totals = {
    turns: turns.length,
    asks: turns.filter(t => t.kind === 'ask').length,
    approvals: turns.filter(t => t.kind === 'approval').length,
    autos: turns.filter(t => t.kind === 'auto').length,
    images: turns.reduce((sum, t) => sum + t.images, 0),
    helpers: loops.reduce((sum, loop) => sum + Object.values(loop.build.agents).reduce((a, b) => a + b, 0), 0),
    edits: turns.reduce((sum, t) => sum + t.edits, 0),
    files: new Set(turns.flatMap(t => t.files.map(f => f.file))).size,
    minutes: round1(meta.reduce((sum, t) => sum + t.rawMinutes, 0)),
  };

  return { turns, loops, totals };
}

module.exports = { buildMap };