#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const glideSource=String.raw`/*kilo-glide:v1*/function __kiloGlide(el) {
  // Glides el to its bottom with time-based easing (~150 ms); retargets as content grows; user input cancels it.
  let raf = 0, last = 0, settle = performance.now() + 700;
  const reduce = () => (globalThis.matchMedia && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches) || (globalThis.document && globalThis.document.hidden);
  const bottom = () => Math.max(0, el.scrollHeight - el.clientHeight);
  const cancel = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
  const step = now => {
    const dt = Math.min(64, Math.max(1, now - last)); last = now;
    const rem = bottom() - el.scrollTop;
    if (rem <= 3) { if (rem > 0) el.scrollTop = bottom(); raf = 0; return; }
    // At least 3 px per frame so the tail never crawls and device-pixel rounding cannot stall it.
    el.scrollTop += Math.max(3, rem * (1 - Math.exp(-dt / 32)));
    raf = requestAnimationFrame(step);
  };
  const to = (live) => {
    // Glide only small additions to a live reply. Chat switch, reload, jump to latest, idle
    // re-renders and the 700 ms of late layout after a long trip snap, so a chat never moves twice on open.
    const now = performance.now(), far = bottom() - el.scrollTop > el.clientHeight;
    if (far) settle = now + 700;
    if (!live || reduce() || far || now < settle) { cancel(); el.scrollTop = el.scrollHeight; return; }
    if (raf) return; // already gliding: the next frame reads the new bottom
    last = performance.now();
    raf = requestAnimationFrame(step);
  };
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) el.addEventListener(type, cancel, { passive: true });
  return { el, to, cancel, active: () => raf !== 0 };
}
`;
export function patch(source){
 // Restore the complete scroll implementation when an update replaces the bundle.
 if(!source.includes('/*kilo-glide:v1*/')){
   const bootstrap=[
     ['function ik(e){let t,','function ik(e){let __kg,t,'],
     ['p=()=>{t&&(t.scrollTop=t.scrollHeight)}','p=()=>{t&&((__kg&&__kg.el===t)||(__kg&&__kg.cancel(),__kg=__kiloGlide(t)),__kg.to(u()))}'],
     ['h=()=>{t&&(n=t.scrollTop,','h=()=>{__kg&&__kg.cancel(),t&&(n=t.scrollTop,'],
     ['let L=A.consumeScroll(),M=e_(t);if(ET(t)){','let L=A.consumeScroll(),M=e_(t);if(__kg&&__kg.active()&&!L)return;if(ET(t)){if(M<80&&s.userScrolled&&T){A.clear(),l("userScrolled",!1),p();return}'],
     ['if(A.isRecent()&&e_(t)>d()){','if(A.isRecent()&&e_(t)>d()&&!(__kg&&__kg.active())){'],
   ];
   for(const [before,after]of bootstrap){if(source.split(before).length!==2)throw Error('Unsupported native scroll anchor: '+before);source=source.replace(before,after)}
   const anchor='var Jia=300';if(source.split(anchor).length!==2)throw Error('Unsupported scroll helper location');source=source.replace(anchor,glideSource+anchor);
 }

 if(source.includes('/* chat-scroll-stability:v1 */')){
   for(const required of ['__kg.to(!force&&e.working(),e.session?.())','ready:()=>!t.loading()&&!qe()','const to = (live, id) => {'])if(!source.includes(required))throw Error('Incomplete scroll stability patch');
   return source;
 }
 const edits=[
 ['let raf = 0, last = 0, settle = performance.now() + 700;', 'let raf = 0, last = 0, settle = performance.now() + 700, session;'],
 ['const to = (live) => {', 'const to = (live, id) => {\n    if (id !== session) { cancel(); session = id; settle = performance.now() + 700; }'],
 ['p=()=>{t&&((__kg&&__kg.el===t)||(__kg&&__kg.cancel(),__kg=__kiloGlide(t)),__kg.to(u()))}', 'p=(force=!1)=>{if(!force&&e.ready&&!e.ready()){__kg?.cancel();return}t&&((__kg&&__kg.el===t)||(__kg&&__kg.cancel(),__kg=__kiloGlide(t)),__kg.to(!force&&e.working(),e.session?.()))}'],
 ['g=()=>{t&&(s.userScrolled&&l("userScrolled",!1),!(e_(t)<2)&&p())}', 'g=()=>{t&&(s.userScrolled&&l("userScrolled",!1),!(e_(t)<2)&&p(!0))}'],
 ['i=ik({working:()=>t.status()!=="idle"});', 'i=ik({/* chat-scroll-stability:v1 */working:()=>t.status()!=="idle",session:()=>t.currentSessionID(),ready:()=>!t.loading()&&!qe()});'],
 ['f9(()=>s.contentRef,v),f9(()=>s.scrollRef,k),', 'Xe(()=>{e.session?.();if(e.ready)e.ready();__kg?.cancel()}),f9(()=>s.contentRef,v),f9(()=>s.scrollRef,k),'],
 ];
 let next=source;for(const [before,after]of edits){if(next.split(before).length!==2)throw Error('Unsupported scroll anchor: '+before.slice(0,80));next=next.replace(before,after)}return next;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [file,mode='--apply']=process.argv.slice(2);if(!file||!['--apply','--check'].includes(mode))throw Error('Usage: chat-scroll-stability.mjs <webview.js> [--apply|--check]');
 const source=fs.readFileSync(file,'utf8'),next=patch(source);
 if(mode==='--check'){if(next!==source)throw Error('Chat scroll stability is missing.');}
 else if(next!==source){const tmp=file+'.scroll-'+process.pid;try{fs.writeFileSync(tmp,next,{flag:'wx',mode:fs.statSync(file).mode&0o777});if(fs.readFileSync(file,'utf8')!==source)throw Error('Bundle changed while patching');fs.renameSync(tmp,file)}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}}
 console.log('Chat scroll stability '+mode+': '+path.basename(file));
}
