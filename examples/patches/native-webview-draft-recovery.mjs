// Preserve the unsent composer state when the native webview renderer is replaced.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export function restoreDraftTabs(saved, fallback) {
  if (!saved || !Array.isArray(saved.ids) || !saved.ids.length || saved.ids.some(id => typeof id !== 'string' || !id) || new Set(saved.ids).size !== saved.ids.length || !saved.ids.includes(saved.active)) return fallback();
  return { ids: [...saved.ids], active: saved.active };
}

export function installDraftRecovery(maps, root = globalThis) {
  const saved = root.__nativeWebviewInitial?.drafts;
  if (saved?.version === 1) {
    for (const [name, map] of Object.entries(maps)) {
      for (const entry of Array.isArray(saved.maps?.[name]) ? saved.maps[name] : []) {
        if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string') map.set(entry[0], entry[1]);
      }
    }
  }
  const readers = new Map();
  let queued = false, previousImages;
  root.__nativeDraftReaders = readers;
  root.__nativeQueueDraftSnapshot = () => {
    if (queued) return;
    queued = true;
    root.queueMicrotask(() => {
      queued = false;
      root.dispatchEvent(new root.Event('__nativeDraftChanged'));
    });
  };
  root.__nativeGetDraftSnapshot = () => {
    for (const read of readers.values()) read();
    // Keep the large data URL strings by reference and compare their fields;
    // typing into the same draft must not copy or resend its attached images.
    const images = maps.images ?? new Map();
    const imagesChanged = !previousImages || images.size !== previousImages.size || [...images].some(([key, values]) => {
      const previous = previousImages.get(key);
      return !previous || values.length !== previous.length || values.some((image, index) => {
        const before = previous[index];
        return image.id !== before.id || image.filename !== before.filename || image.mime !== before.mime || image.dataUrl !== before.dataUrl;
      });
    });
    const serializedMaps = Object.fromEntries(Object.entries(maps).filter(([name]) => name !== 'images' || imagesChanged).map(([name, map]) => [name, [...map]]));
    // Solid stores are proxies; send only a detached JSON payload to the host.
    const snapshot = JSON.parse(JSON.stringify({
      version: 1,
      maps: serializedMaps,
      selections: root.__nativeReadDraftSelections?.() ?? {},
      ...(root.__nativeReadDraftTabs ? { tabs: root.__nativeReadDraftTabs() } : {}),
    }));
    if (imagesChanged) previousImages = new Map([...images].map(([key, values]) => [key, values.map(image => ({ ...image }))]));
    return snapshot;
  };
}

const marker = '/* native-webview-draft-recovery:v2 */';
export function patchDraftClient(source) {
  if (source.includes(marker)) return source;
  if (source.includes('/* native-webview-draft-recovery:v1 */')) throw new Error('Outdated draft recovery patch: regenerate the webview from its unpatched source.');
  const replace = (before, after) => {
    const count = source.split(before).length - 1;
    if (count !== 1) throw new Error(`Unsupported Kilo draft recovery anchor count ${count}: ${before.slice(0,65)}`);
    source = source.replace(before, after);
  };
  const declaration = 'fy=new Map,Nm=new Map,cf=new Map,Td=new Map,zg=new Map,Og=new Map,jg=new Map,QA=new Map,wZ=new Set,kZ=new Set,Hbe=new Set';
  replace(declaration, declaration + ';installDraftRecovery({mentions:fy,text:Nm,browsers:cf,comments:Td,contexts:zg,images:Og,scrolls:jg,pastes:QA,aliases:aP});');
  // Initialize before any effects infer a model from the last sent message.
  for (const name of ['sessionOverrides', 'agentSelections', 'variantSelections']) {
    replace(`${name}:{}`, `${name}:(globalThis.__nativeWebviewInitial?.drafts?.version===1?globalThis.__nativeWebviewInitial.drafts.selections?.${name}:void 0)??{}`);
  }
  replace(',cYn={sessionsProject:g,currentSessionID:s,', ',nativeDraftSelections=(globalThis.__nativeReadDraftSelections=()=>({sessionOverrides:jt.sessionOverrides,agentSelections:jt.agentSelections,variantSelections:jt.variantSelections}),Ue(()=>{JSON.stringify([jt.sessionOverrides,jt.agentSelections,jt.variantSelections]);globalThis.__nativeQueueDraftSnapshot()})),cYn={sessionsProject:g,currentSessionID:s,');
  // Normal persistent VS Code state intentionally drops temporary tabs. Only
  // renderer recovery retains their exact IDs so draft scope keys still match.
  const tabInitializer = 'o=jqn(a?.sidebarSessionTabIDs,a?.sidebarActiveSessionTabID,i),[s,l]=Ae(o.ids);';
  replace(tabInitializer, 'o=restoreDraftTabs(globalThis.__nativeWebviewInitial?.drafts?.version===1?globalThis.__nativeWebviewInitial.drafts.tabs:void 0,()=>jqn(a?.sidebarSessionTabIDs,a?.sidebarActiveSessionTabID,i)),[s,l]=Ae(o.ids);');
  replace('h=new Set,A=()=>({ids:s(),active:d()}),b=V=>', 'h=new Set,A=()=>({ids:s(),active:d()}),nativeDraftTabs=(globalThis.__nativeReadDraftTabs=A,Ue(()=>{s();d();globalThis.__nativeQueueDraftSnapshot()})),b=V=>');
  const scopeEnd = 'let ln=/^## Review Comments\\n[\\s\\S]*?\\n\\n/;';
  replace(scopeEnd, `const nativeDraftReader=()=>{V(Q(),W(),Oe(),w.images());const paths=[...y.mentionedPaths()],sessions=[...y.mentionedSessions().values()];if(paths.length||sessions.length)fy.set(Q(),{paths,sessions});else fy.delete(Q())};globalThis.__nativeDraftReaders.set(L(),nativeDraftReader);Xe(()=>{if(globalThis.__nativeDraftReaders.get(L())===nativeDraftReader)globalThis.__nativeDraftReaders.delete(L())});Ue(()=>{Q();W();Oe();w.images();fe();Ne();Le.pastes();y.mentionedPaths();y.mentionedSessions();globalThis.__nativeQueueDraftSnapshot()});${scopeEnd}`);
  return `${marker}\n${restoreDraftTabs.toString()}\n${installDraftRecovery.toString()}\n${source}`;
}

async function selfCheck() {
  const tasks = [], events = [];
  const maps = Object.fromEntries(['mentions','text','browsers','comments','contexts','images','scrolls','pastes','aliases'].map(name => [name, new Map()]));
  const values = {
    mentions: { paths: ['src/report.jsx'], sessions: [{ id: 'ses_ref', title: 'Reference' }] },
    text: 'Draft with @src/report.jsx', browsers: [{ id: 'browser', url: 'http://localhost/' }],
    comments: [{ id: 'review', comment: 'Keep this review' }], contexts: [{ id: 'context', text: 'Relevant context' }],
    images: [{ id: 'image', filename: 'reference.png', mime: 'image/png', dataUrl: 'data:image/png;base64,dGVzdA==' }],
    scrolls: 42, pastes: ['Original long pasted text'], aliases: 'session:ses_1',
  };
  const selections = { agentSelections: { ses_1: 'CTO' }, sessionOverrides: { ses_1: { providerID: 'provider', modelID: 'model' } }, variantSelections: { 'session/ses_1': 'high' }, modelSelections: {} };
  const saved = { version: 1, maps: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, [['prompt:session:ses_1', value]]])), selections };
  const root = { __nativeWebviewInitial: { drafts: saved }, queueMicrotask: callback => tasks.push(callback), Event: class { constructor(type) { this.type = type; } }, dispatchEvent: event => events.push(event.type) };
  installDraftRecovery(maps, root);
  root.__nativeReadDraftSelections = () => selections;
  assert.deepEqual(root.__nativeGetDraftSnapshot(), saved);
  assert.equal(Object.hasOwn(root.__nativeGetDraftSnapshot().maps, 'images'), false);
  root.__nativeDraftReaders.set('prompt', () => maps.text.set('prompt:session:ses_1', 'Latest unsent edit'));
  const edited = root.__nativeGetDraftSnapshot();
  assert.equal(edited.maps.text[0][1], 'Latest unsent edit');
  assert.equal(Object.hasOwn(edited.maps, 'images'), false);
  maps.images.set('prompt:session:ses_1', [{ ...values.images[0] }]);
  assert.equal(Object.hasOwn(root.__nativeGetDraftSnapshot().maps, 'images'), false);
  maps.images.get('prompt:session:ses_1')[0].dataUrl = 'data:image/png;base64,Y2hhbmdlZA==';
  assert.equal(root.__nativeGetDraftSnapshot().maps.images[0][1][0].dataUrl, 'data:image/png;base64,Y2hhbmdlZA==');
  assert.equal(Object.hasOwn(root.__nativeGetDraftSnapshot().maps, 'images'), false);
  root.__nativeQueueDraftSnapshot(); root.__nativeQueueDraftSnapshot();
  assert.equal(tasks.length, 1); tasks.shift()();
  assert.deepEqual(events, ['__nativeDraftChanged']);
  maps.images.delete('prompt:session:ses_1');
  assert.deepEqual(root.__nativeGetDraftSnapshot().maps.images, []);
  assert.equal(Object.hasOwn(root.__nativeGetDraftSnapshot().maps, 'images'), false);
  const empty = { ...root, __nativeWebviewInitial: { drafts: { version: 0, maps: saved.maps } } };
  const emptyMaps = { text: new Map() }; installDraftRecovery(emptyMaps, empty);
  assert.equal(emptyMaps.text.size, 0);
  for (const tabs of [
    { ids: ['sidebar-pending:new'], active: 'sidebar-pending:new' },
    { ids: ['ses_existing', 'sidebar-pending:first', 'sidebar-pending:second'], active: 'sidebar-pending:second' },
  ]) {
    root.__nativeReadDraftTabs = () => tabs;
    const snapshot = root.__nativeGetDraftSnapshot();
    let fallbackUsed = false;
    const restored = restoreDraftTabs(snapshot.tabs, () => { fallbackUsed = true; return { ids: ['generated'], active: 'generated' }; });
    assert.deepEqual(restored, tabs);
    assert.equal(fallbackUsed, false);
    assert.notEqual(restored.ids, tabs.ids);
  }
  const fallback = { ids: ['normal-new-id'], active: 'normal-new-id' };
  assert.equal(restoreDraftTabs(undefined, () => fallback), fallback);
  assert.equal(restoreDraftTabs({ ids: ['a'], active: 'missing' }, () => fallback), fallback);
  console.log('Draft recovery checks passed: full payload, latest edit, unchanged-image omission, attachment changes/removal, coalescing, version guard, exact new/pending tab identities.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--test')) await selfCheck();
