#!/usr/bin/env node
// Kilo 7.8.12 model picker: persistent favorite ordering and a favorites-only filter.
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const favoritesMemoBefore = 've=ye(()=>{if(!f())return[];if(e.favorites===!1)return[];if(!s||w())return[];let Je=new Map(fe().map(Pn=>[g3(Pn.providerID,Pn.id),Pn])),yt=s.favoriteModels().map(Pn=>Je.get(g3(Pn.providerID,Pn.modelID))).filter(Pn=>!!Pn),Pt=j();if(!Pt)return yt;let mn=yt.findIndex(Pn=>g3(Pn.providerID,Pn.id)===Pt);if(mn<=0)return yt;let Rn=yt[mn];return Rn?[Rn,...yt.slice(0,mn),...yt.slice(mn+1)]:yt})'
const favoritesMemoAfter = 've=ye(()=>{if(!f())return[];if(e.favorites===!1||!s||w())return[];let Je=new Map(fe().map(Pn=>[g3(Pn.providerID,Pn.id),Pn])),yt=s.favoriteModels().map(Pn=>Je.get(g3(Pn.providerID,Pn.modelID))).filter(Pn=>!!Pn),query=favoritesFilter().trim().toLowerCase();return query&&(yt=yt.filter(Pn=>`${Pn.name} ${Pn.providerName}`.toLowerCase().includes(query))),yt})'
const favoriteGroupBefore = 'let Rn=[],Pn=ve();Pn.length>0&&Rn.push({key:jAa,label:i.t("model.group.favorites"),rows:Pn.map(Ot=>({key:F5("favorite",Ot.providerID,Ot.id),kind:"favorite",model:Ot}))}),Je.length>0&&Rn.push'
const favoriteGroupAfter = 'let Rn=[],Pn=ve();e.favorites!==!1&&s&&!w()&&s.favoriteModels().length>0&&Rn.push({key:jAa,label:i.t("model.group.favorites"),rows:Pn.map(Ot=>({key:F5("favorite",Ot.providerID,Ot.id),kind:"favorite",model:Ot}))}),Je.length>0&&Rn.push'

const filterHeaderBefore = 'P(or,()=>Ca.label),'
const filterHeaderAfter = 'P(or,()=>Ca.label),Ca.key===jAa&&(()=>{let tools=document.createElement("span"),button=document.createElement("button"),input=document.createElement("input");tools.className="model-selector-favorites-tools",button.type="button",button.className="model-selector-favorites-filter-toggle",button.textContent="⌕",button.title="Filter favorites",button.setAttribute("aria-label","Filter favorites"),input.type="search",input.className="model-selector-favorites-filter-input",input.placeholder="Filter favorites",input.setAttribute("aria-label","Filter favorites"),input.value=favoritesFilter(),input.hidden=!favoritesFilterOpen(),button.setAttribute("aria-expanded",String(favoritesFilterOpen())),button.addEventListener("mousedown",event=>event.stopPropagation()),button.addEventListener("click",event=>{event.preventDefault(),event.stopPropagation();let open=!favoritesFilterOpen();setFavoritesFilterOpen(open),input.hidden=!open,button.setAttribute("aria-expanded",String(open)),open?requestAnimationFrame(()=>input.focus()):(input.value="",setFavoritesFilter(""))}),input.addEventListener("mousedown",event=>event.stopPropagation()),input.addEventListener("click",event=>event.stopPropagation()),input.addEventListener("input",event=>setFavoritesFilter(event.currentTarget.value)),input.addEventListener("keydown",event=>{event.stopPropagation(),event.key==="Escape"&&(event.preventDefault(),input.value="",setFavoritesFilter(""),setFavoritesFilterOpen(!1),input.hidden=!0,button.setAttribute("aria-expanded","false"),button.focus())}),tools.append(button,input),Qa.append(tools)})(),'

const favoritesContextBefore = "t.postMessage({type:\"toggleFavorite\",action:qn,providerID:ae,modelID:$e})}function Gr(ae){"
const favoritesContextAfter = "t.postMessage({type:\"toggleFavorite\",action:qn,providerID:ae,modelID:$e})}function reorderFavorites(ae){let $e=Array.isArray(ae)?ae:[];ln(\"favoriteModels\",$e),t.postMessage({type:\"reorderFavorites\",favorites:$e})}function Gr(ae){"
const favoritesContextObjectBefore = "favoriteModels:()=>jt.favoriteModels,toggleFavorite:_n,variantList:Is"
const favoritesContextObjectAfter = "favoriteModels:()=>jt.favoriteModels,toggleFavorite:_n,reorderFavorites,variantList:Is"

const rowBefore = 'var Ca=zAa(),Po=Ca.firstChild,Bi=Po.firstChild,Qa=Bi.firstChild,Is=Qa.nextSibling;return Po.$$dblclick='
const rowAfter = 'var Ca=zAa(),Po=Ca.firstChild,Bi=Po.firstChild,Qa=Bi.firstChild,Is=Qa.nextSibling;if(Ln.kind==="favorite"){let handle=document.createElement("button"),favoriteKey=g3(nt.providerID,nt.id);handle.type="button",handle.className="model-selector-favorite-drag-handle",handle.textContent="⠿",handle.draggable=!0,handle.tabIndex=0,handle.title="Drag to reorder; Alt+Up/Down also moves this favorite",handle.setAttribute("aria-label",`Reorder favorite: ${NA(nt.name)}`),handle.addEventListener("mousedown",event=>event.stopPropagation()),handle.addEventListener("click",event=>{event.preventDefault(),event.stopPropagation()}),handle.addEventListener("dragstart",event=>{favoriteDragSource=favoriteKey,event.dataTransfer&&(event.dataTransfer.effectAllowed="move",event.dataTransfer.setData("text/plain",favoriteKey))}),handle.addEventListener("dragend",()=>{favoriteDragSource=null}),handle.addEventListener("keydown",event=>{if(!event.altKey||event.key!=="ArrowUp"&&event.key!=="ArrowDown")return;event.preventDefault(),event.stopPropagation();let favorites=s?.favoriteModels()??[],index=favorites.findIndex(item=>g3(item.providerID,item.modelID)===favoriteKey),next=index+(event.key==="ArrowUp"?-1:1);index>=0&&next>=0&&next<favorites.length&&reorderFavorite(favoriteKey,next)}),Po.addEventListener("dragover",event=>{favoriteDragSource&&Ln.kind==="favorite"&&(event.preventDefault(),event.dataTransfer&&(event.dataTransfer.dropEffect="move"))}),Po.addEventListener("drop",event=>{if(!favoriteDragSource||Ln.kind!=="favorite")return;event.preventDefault(),event.stopPropagation();let favorites=s?.favoriteModels()??[],sourceIndex=favorites.findIndex(item=>g3(item.providerID,item.modelID)===favoriteDragSource),targetIndex=favorites.findIndex(item=>g3(item.providerID,item.modelID)===favoriteKey),rect=Po.getBoundingClientRect(),insertAt=targetIndex+(event.clientY>=rect.top+rect.height/2?1:0);sourceIndex<insertAt&&insertAt--,reorderFavorite(favoriteDragSource,insertAt),favoriteDragSource=null}),Po.insertBefore(handle,Po.firstChild)}return Po.$$dblclick='
const pointerRowAfter = "var Ca=zAa(),Po=Ca.firstChild,Bi=Po.firstChild,Qa=Bi.firstChild,Is=Qa.nextSibling;if(Ln.kind===\"favorite\"){let handle=document.createElement(\"button\"),favoriteKey=g3(nt.providerID,nt.id);handle.type=\"button\",handle.className=\"model-selector-favorite-drag-handle\",handle.textContent=\"⠿\",handle.draggable=!1,handle.tabIndex=0,handle.title=\"Drag to reorder; Alt+Up/Down also moves this favorite\",handle.setAttribute(\"aria-label\",`Reorder favorite: ${NA(nt.name)}`),handle.addEventListener(\"mousedown\",event=>event.stopPropagation()),handle.addEventListener(\"click\",event=>{event.preventDefault(),event.stopPropagation()}),handle.addEventListener(\"pointerdown\",event=>{if(event.button!==0)return;event.preventDefault(),event.stopPropagation(),handle.focus({preventScroll:!0});let pointerID=event.pointerId,startY=event.clientY,moved=!1,cleanup=()=>{window.removeEventListener(\"pointermove\",move,!0),window.removeEventListener(\"pointerup\",finish,!0),window.removeEventListener(\"pointercancel\",cancel,!0)},move=nextEvent=>{nextEvent.pointerId===pointerID&&(Math.abs(nextEvent.clientY-startY)>3&&(moved=!0),moved&&nextEvent.preventDefault())},finish=nextEvent=>{nextEvent.pointerId===pointerID&&(cleanup(),moved&&placeFavorite(favoriteKey,nextEvent.clientY))},cancel=nextEvent=>{nextEvent.pointerId===pointerID&&cleanup()};handle.setPointerCapture?.(pointerID),window.addEventListener(\"pointermove\",move,!0),window.addEventListener(\"pointerup\",finish,!0),window.addEventListener(\"pointercancel\",cancel,!0)}),handle.addEventListener(\"keydown\",event=>{if(!event.altKey||event.key!==\"ArrowUp\"&&event.key!==\"ArrowDown\")return;event.preventDefault(),event.stopPropagation();let favorites=s?.favoriteModels()??[],index=favorites.findIndex(item=>g3(item.providerID,item.modelID)===favoriteKey),next=index+(event.key===\"ArrowUp\"?-1:1);index>=0&&next>=0&&next<favorites.length&&reorderFavorite(favoriteKey,next)}),Po.insertBefore(handle,Po.firstChild)}return Po.$$dblclick="
const visualPointerRowAfter = "var Ca=zAa(),Po=Ca.firstChild,Bi=Po.firstChild,Qa=Bi.firstChild,Is=Qa.nextSibling;if(Ln.kind===\"favorite\"){let handle=document.createElement(\"button\"),favoriteKey=g3(nt.providerID,nt.id);handle.type=\"button\",handle.className=\"model-selector-favorite-drag-handle\",handle.textContent=\"⠿\",handle.draggable=!1,handle.tabIndex=0,handle.title=\"Drag to reorder; Alt+Up/Down also moves this favorite\",handle.setAttribute(\"aria-label\",`Reorder favorite: ${NA(nt.name)}`),handle.addEventListener(\"mousedown\",event=>event.stopPropagation()),handle.addEventListener(\"click\",event=>{event.preventDefault(),event.stopPropagation()}),handle.addEventListener(\"pointerdown\",event=>{if(event.button!==0)return;event.preventDefault(),event.stopPropagation(),handle.focus({preventScroll:!0});let pointerID=event.pointerId,startX=event.clientX,startY=event.clientY,moved=!1,rowRect=Ca.getBoundingClientRect(),ghost=Ca.cloneNode(!0);ghost.className=`${Ca.className} model-selector-favorite-drag-ghost`,ghost.style.left=`${rowRect.left}px`,ghost.style.top=`${rowRect.top}px`,ghost.style.width=`${rowRect.width}px`,ghost.style.height=`${rowRect.height}px`,ghost.setAttribute(\"aria-hidden\",\"true\"),ghost.querySelectorAll(\"[id]\").forEach(item=>item.removeAttribute(\"id\")),document.body.append(ghost),Ca.classList.add(\"model-selector-favorite-drag-source\");let cleanup=()=>{window.removeEventListener(\"pointermove\",move,!0),window.removeEventListener(\"pointerup\",finish,!0),window.removeEventListener(\"pointercancel\",cancel,!0),ghost.remove(),Ca.classList.remove(\"model-selector-favorite-drag-source\")},move=nextEvent=>{nextEvent.pointerId===pointerID&&(Math.abs(nextEvent.clientY-startY)>3&&(moved=!0),moved&&(ghost.style.transform=`translate(${nextEvent.clientX-startX}px,${nextEvent.clientY-startY}px)`,nextEvent.preventDefault()))},finish=nextEvent=>{nextEvent.pointerId===pointerID&&(cleanup(),moved&&placeFavorite(favoriteKey,nextEvent.clientY))},cancel=nextEvent=>{nextEvent.pointerId===pointerID&&cleanup()};handle.setPointerCapture?.(pointerID),window.addEventListener(\"pointermove\",move,!0),window.addEventListener(\"pointerup\",finish,!0),window.addEventListener(\"pointercancel\",cancel,!0)}),handle.addEventListener(\"keydown\",event=>{if(!event.altKey||event.key!==\"ArrowUp\"&&event.key!==\"ArrowDown\")return;event.preventDefault(),event.stopPropagation();let favorites=s?.favoriteModels()??[],index=favorites.findIndex(item=>g3(item.providerID,item.modelID)===favoriteKey),next=index+(event.key===\"ArrowUp\"?-1:1);index>=0&&next>=0&&next<favorites.length&&reorderFavorite(favoriteKey,next)}),Po.insertBefore(handle,Po.firstChild)}return Po.$$dblclick="

const legacyFavoritesCss = `.model-selector-favorites-tools{display:flex;align-items:center;gap:4px;margin-left:auto}.model-selector-favorites-filter-toggle{all:unset;display:flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;border-radius:3px;color:var(--text-weak,var(--vscode-descriptionForeground));cursor:pointer}.model-selector-favorites-filter-toggle:hover,.model-selector-favorites-filter-toggle[aria-expanded=true]{color:var(--text-base,var(--vscode-foreground));background:var(--surface-interactive-hover,var(--vscode-list-hoverBackground))}.model-selector-favorites-filter-toggle:focus-visible,.model-selector-favorites-filter-input:focus-visible,.model-selector-favorite-drag-handle:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}.model-selector-favorites-filter-input{box-sizing:border-box;width:116px;min-width:0;height:22px;padding:2px 6px;border:1px solid var(--vscode-input-border);border-radius:3px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);font:inherit;font-size:var(--kilo-font-size-12);outline:none}.model-selector-favorites-filter-input::placeholder{color:var(--vscode-input-placeholderForeground,var(--text-weaker))}.model-selector-favorite-drag-handle{all:unset;display:flex;align-items:center;justify-content:center;flex:none;width:18px;height:24px;margin-left:-4px;border-radius:3px;color:var(--text-weak,var(--vscode-descriptionForeground));font-size:14px;line-height:1;cursor:grab;touch-action:none;user-select:none}.model-selector-favorite-drag-handle:active{cursor:grabbing}.model-selector-favorite-drag-handle:hover{color:var(--text-base,var(--vscode-foreground));background:var(--surface-interactive-hover,var(--vscode-list-hoverBackground))}`
export const favoritesCss = `${legacyFavoritesCss}.model-selector-favorite-drag-source{opacity:.35}.model-selector-favorite-drag-ghost{position:fixed!important;z-index:2147483647;box-sizing:border-box;pointer-events:none;opacity:.96;border:1px solid var(--vscode-focusBorder);border-radius:3px;background:var(--vscode-list-activeSelectionBackground,var(--surface-base));box-shadow:0 8px 24px rgba(0,0,0,.35)}`
const previousFavoritesCss = legacyFavoritesCss.replace("font-size:var(--kilo-font-size-12)", "font-size:var(--kilo-font-size-11)")

const extensionCaseBefore = 'case"requestFavorites":{let favorites=validateFavorites(this.extensionContext?.globalState.get("favoriteModels"));this.postMessage({type:"favoritesLoaded",favorites});break}'
const extensionCaseAfter = 'case"reorderFavorites":{await this.reorderFavorites(message6);break}case"requestFavorites":{let favorites=validateFavorites(this.extensionContext?.globalState.get("favoriteModels"));this.postMessage({type:"favoritesLoaded",favorites});break}'
const extensionMethodBefore = 'async toggleFavorite(message6){let current=validateFavorites(this.extensionContext?.globalState.get("favoriteModels")),key6=`${message6.providerID}/${message6.modelID}`,exists5=current.some(f4=>`${f4.providerID}/${f4.modelID}`===key6),favorites=message6.action==="add"&&!exists5?[...current,{providerID:message6.providerID,modelID:message6.modelID}]:message6.action==="remove"&&exists5?current.filter(f4=>`${f4.providerID}/${f4.modelID}`!==key6):current;await this.extensionContext?.globalState.update("favoriteModels",favorites),this.connectionService.notifyFavoritesChanged(favorites)}initializeConnection()'
const extensionMethodAfter = 'async reorderFavorites(message6){let current=validateFavorites(this.extensionContext?.globalState.get("favoriteModels")),requested=Array.isArray(message6.favorites)?message6.favorites:[],known=new Set(current.map(item=>`${item.providerID}/${item.modelID}`)),rank=new Map;for(let item of requested){if(!item||typeof item.providerID!=="string"||typeof item.modelID!=="string")continue;let key=`${item.providerID}/${item.modelID}`;known.has(key)&&!rank.has(key)&&rank.set(key,rank.size)}let favorites=current.slice().sort((a,b)=>(rank.get(`${a.providerID}/${a.modelID}`)??1/0)-(rank.get(`${b.providerID}/${b.modelID}`)??1/0));await this.extensionContext?.globalState.update("favoriteModels",favorites),this.connectionService.notifyFavoritesChanged(favorites)}async toggleFavorite(message6){let current=validateFavorites(this.extensionContext?.globalState.get("favoriteModels")),key6=`${message6.providerID}/${message6.modelID}`,exists5=current.some(f4=>`${f4.providerID}/${f4.modelID}`===key6),favorites=message6.action==="add"&&!exists5?[...current,{providerID:message6.providerID,modelID:message6.modelID}]:message6.action==="remove"&&exists5?current.filter(f4=>`${f4.providerID}/${f4.modelID}`!==key6):current;await this.extensionContext?.globalState.update("favoriteModels",favorites),this.connectionService.notifyFavoritesChanged(favorites)}initializeConnection()'

function replaceOnce(source, before, after, label) {
  const beforeCount = source.split(before).length - 1
  const afterCount = source.split(after).length - 1
  if (afterCount === 1) return source
  if (afterCount !== 0 || beforeCount !== 1) throw new Error(`${label}: expected exactly one known anchor, found ${beforeCount} original + ${afterCount} patched; no changes made.`)
  return source.replace(before, () => after)
}

export function patchWebview(source) {
  source = replaceOnce(source, ',[te,ze]=Ae(!0);function Oe(Je)', ',[te,ze]=Ae(!0),[favoritesFilterOpen,setFavoritesFilterOpen]=Ae(!1),[favoritesFilter,setFavoritesFilter]=Ae("");function Oe(Je)', "favorites filter state")
  source = replaceOnce(source, favoritesMemoBefore, favoritesMemoAfter, "favorite filter and ordering")
  source = replaceOnce(source, favoriteGroupBefore, favoriteGroupAfter, "empty favorites filter state")
  source = replaceOnce(source, filterHeaderBefore, filterHeaderAfter, "favorites filter control")
  source = replaceOnce(source, favoritesContextBefore, favoritesContextAfter, "favorites context reordering")
  source = replaceOnce(source, favoritesContextObjectBefore, favoritesContextObjectAfter, "favorites context reorder API")
  const legacyRowAfter = rowAfter.replace("Mi.$$dblclick=", "Mi.$dblclick=")
  if (!source.includes(visualPointerRowAfter)) {
    if (!source.includes(pointerRowAfter)) {
      if (source.includes(legacyRowAfter)) source = source.replace(legacyRowAfter, () => rowAfter)
      else if (!source.includes(rowAfter)) source = replaceOnce(source, rowBefore, rowAfter, "favorite drag handle")
      source = replaceOnce(source, rowAfter, pointerRowAfter, "pointer favorite drag handle")
    }
    source = replaceOnce(source, pointerRowAfter, visualPointerRowAfter, "favorite drag preview")
  }
  const helperBefore = 's.toggleFavorite(Je.providerID,Je.id)}function Ft(Je){'
  const helperAfter = 's.toggleFavorite(Je.providerID,Je.id)}let favoriteDragSource=null;function reorderFavorite(key,index){if(!s)return;let current=s.favoriteModels(),from=current.findIndex(item=>g3(item.providerID,item.modelID)===key);if(from<0||from===index)return;let next=current.slice(),moved=next.splice(from,1)[0];next.splice(Math.max(0,Math.min(index,next.length)),0,moved),m.postMessage({type:"reorderFavorites",favorites:next.map(item=>({providerID:item.providerID,modelID:item.modelID}))})}function Ft(Je){'
  const pointerHelperAfter = "s.toggleFavorite(Je.providerID,Je.id)}function reorderFavorite(key,index){if(!s)return;let current=s.favoriteModels(),from=current.findIndex(item=>g3(item.providerID,item.modelID)===key);if(from<0||from===index)return;let next=current.slice(),moved=next.splice(from,1)[0];next.splice(Math.max(0,Math.min(index,next.length)),0,moved),m.postMessage({type:\"reorderFavorites\",favorites:next.map(item=>({providerID:item.providerID,modelID:item.modelID}))})}function placeFavorite(key,clientY){let current=s?.favoriteModels()??[],from=current.findIndex(item=>g3(item.providerID,item.modelID)===key),rows=[...document.querySelectorAll(\"[data-key^=\\\"favorite:\\\"]\")];if(from<0||rows.length===0)return;let row=rows.find(item=>clientY<item.getBoundingClientRect().bottom)??rows[rows.length-1],targetKey=row.getAttribute(\"data-key\")?.slice(\"favorite:\".length),target=current.findIndex(item=>g3(item.providerID,item.modelID)===targetKey);if(target<0)return;let rect=row.getBoundingClientRect(),index=target+(clientY>=rect.top+rect.height/2?1:0);from<index&&index--,reorderFavorite(key,index)}function Ft(Je){"
  const contextHelperAfter = "s.toggleFavorite(Je.providerID,Je.id)}function reorderFavorite(key,index){if(!s)return;let current=s.favoriteModels(),from=current.findIndex(item=>g3(item.providerID,item.modelID)===key);if(from<0||from===index)return;let next=current.slice(),moved=next.splice(from,1)[0];next.splice(Math.max(0,Math.min(index,next.length)),0,moved),s.reorderFavorites(next)}function placeFavorite(key,clientY){let current=s?.favoriteModels()??[],from=current.findIndex(item=>g3(item.providerID,item.modelID)===key),rows=[...document.querySelectorAll(\"[data-key^=\\\"favorite:\\\"]\")];if(from<0||rows.length===0)return;let row=rows.find(item=>clientY<item.getBoundingClientRect().bottom)??rows[rows.length-1],targetKey=row.getAttribute(\"data-key\")?.slice(\"favorite:\".length),target=current.findIndex(item=>g3(item.providerID,item.modelID)===targetKey);if(target<0)return;let rect=row.getBoundingClientRect(),index=target+(clientY>=rect.top+rect.height/2?1:0);from<index&&index--,reorderFavorite(key,index)}function Ft(Je){"
  if (!source.includes(contextHelperAfter)) {
    if (!source.includes(pointerHelperAfter)) {
      if (!source.includes(helperAfter)) source = replaceOnce(source, helperBefore, helperAfter, "favorite reorder handler")
      source = replaceOnce(source, helperAfter, pointerHelperAfter, "pointer reorder handler")
    }
    source = replaceOnce(source, pointerHelperAfter, contextHelperAfter, "favorites context reorder call")
  }
  return source
}

export function patchExtension(source) {
  source = replaceOnce(source, extensionCaseBefore, extensionCaseAfter, "favorite reorder message")
  return replaceOnce(source, extensionMethodBefore, extensionMethodAfter, "favorite persistence handler")
}

export function patchCss(source) {
  if (source.includes(favoritesCss)) return source
  if (source.includes(legacyFavoritesCss)) return source.replace(legacyFavoritesCss, favoritesCss)
  if (source.includes(previousFavoritesCss)) return source.replace(previousFavoritesCss, favoritesCss)
  if (source.includes(".model-selector-favorites-tools{")) throw new Error("model-favorites CSS: patched marker exists without the complete rules; no changes made.")
  const anchor = ".model-selector-group-label{"
  if (source.split(anchor).length - 1 !== 1) throw new Error("model-favorites CSS: expected one group-label anchor; no changes made.")
  return source.replace(anchor, `${favoritesCss}${anchor}`)
}

function atomicWrite(target, source, updated) {
  if (source === updated) return false
  const backup = `${target}.pre-model-favorites`
  if (!fs.existsSync(backup)) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL)
  const temporary = `${target}.model-favorites-${process.pid}`
  try {
    fs.writeFileSync(temporary, updated, { flag: "wx", mode: fs.statSync(target).mode & 0o777 })
    if (fs.readFileSync(target, "utf8") !== source) throw new Error("Bundle changed during maintenance; refusing to overwrite it.")
    fs.renameSync(temporary, target)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const flags = args.filter((arg) => arg.startsWith("--"))
  const files = args.filter((arg) => !arg.startsWith("--"))
  if (flags.length > 1 || flags.some((arg) => !["--check", "--apply"].includes(arg)) || files.length !== 3) {
    console.error("Usage: model-favorites.mjs <webview.js> <extension.js> <webview.css> [--check|--apply]")
    process.exit(2)
  }
  const checkOnly = flags[0] === "--check"
  const updates = [
    [files[0], patchWebview],
    [files[1], patchExtension],
    [files[2], patchCss],
  ].map(([target, patch]) => {
    const source = fs.readFileSync(target, "utf8")
    return [target, source, patch(source)]
  })
  let missing = false
  for (const [target, source, updated] of updates) {
    if (checkOnly) {
      if (source !== updated) { console.error(`Model favorites patch is not installed in ${target}.`); missing = true }
      else console.log(`Model favorites patch is installed in ${target}.`)
      continue
    }
    console.log(atomicWrite(target, source, updated) ? `Patched ${target}.` : `Model favorites patch already installed in ${target}.`)
  }
  if (missing) process.exit(1)
}
