import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {patchWebview,patchExtension,patchCss} from './model-favorites.mjs';
import {patch as order,orderAgents} from './jev-agent-order.mjs';

const root=new URL('../stock/extension/dist/',import.meta.url);
const raw=fs.readFileSync(new URL('webview.js',root),'utf8');
const source=patchWebview(order(raw));
assert.equal(patchWebview(order(source)),source);
new vm.Script(source);
assert.throws(()=>patchWebview(raw+raw),/anchor/);
const catalog=[
  {providerID:'p',id:'a',name:'Alpha',providerName:'One'},
  {providerID:'p',id:'b',name:'Beta',providerName:'Two'},
  {providerID:'p',id:'c',name:'Gamma',providerName:'Two'},
];
let favorites=[{providerID:'p',modelID:'b'},{providerID:'p',modelID:'a'}],query='';
const messages=[];
const scope={f:()=>true,e:{},s:{favoriteModels:()=>favorites,
  reorderFavorites:next=>{favorites=next;}},w:()=>false,fe:()=>catalog,
  g3:(p,m)=>p+'/'+m,j:()=> 'p/a',favoritesFilter:()=>query,
  ye:fn=>fn,ln:(key,value)=>{assert.equal(key,'favoriteModels');favorites=value;},
  t:{postMessage:value=>messages.push(value)}};
const memo=source.match(/ve=ye\(\(\)=>\{[\s\S]*?\}\),we=ye/)[0].slice(3,-6);
const list=vm.runInNewContext(memo,scope);
assert.deepEqual(Array.from(list(),x=>x.id),['b','a'],'selected model must not reorder favorites');
query='ONE';assert.deepEqual(Array.from(list(),x=>x.id),['a']);
query='missing';assert.equal(list().length,0);
const group=source.match(/let Rn=\[\],Pn=ve\(\);e\.favorites[^;]*?(?=,Je\.length>0&&Rn\.push)/)[0];
const groups=vm.runInNewContext('(()=>{'+group+';return Rn})()',{
  ...scope,ve:list,jAa:'favorites',i:{t:x=>x},F5:(kind,p,m)=>kind+':'+p+'/'+m});
assert.equal(groups.length,1,'empty filtered favorites keep their filter controls');
assert.equal(groups[0].rows.length,0);
const context=source.match(/function reorderFavorites\(ae\)\{[\s\S]*?\}(?=function Gr)/)[0];
vm.runInNewContext(context+';reorderFavorites',scope)([favorites[1],favorites[0]]);
assert.deepEqual(Array.from(favorites,x=>x.modelID),['a','b']);
assert.equal(messages[0].type,'reorderFavorites');
const mover=source.match(/function reorderFavorite\(key,index\)\{[\s\S]*?\}(?=function placeFavorite)/)[0];
const move=vm.runInNewContext(mover+';reorderFavorite',scope);
move('p/a',99);assert.deepEqual(Array.from(favorites,x=>x.modelID),['b','a']);
move('missing',0);assert.deepEqual(Array.from(favorites,x=>x.modelID),['b','a']);

const host=patchExtension(fs.readFileSync(new URL('extension.js',root),'utf8'));
new vm.Script(host);assert.equal(patchExtension(host),host);
const method=host.match(/async reorderFavorites\(message6\)\{[\s\S]*?\}(?=async toggleFavorite)/)[0];
let saved,notified;
const ctrl=vm.runInNewContext('({'+method+'})', {validateFavorites:x=>x});
ctrl.extensionContext={globalState:{get:()=>[
  {providerID:'p',modelID:'a'},{providerID:'p',modelID:'b'},{providerID:'p',modelID:'c'}],
  update:async(key,value)=>{assert.equal(key,'favoriteModels');saved=value;}}};
ctrl.connectionService={notifyFavoritesChanged:value=>{notified=value;}};
await ctrl.reorderFavorites({favorites:[null,{providerID:'q',modelID:'unknown'},
  {providerID:'p',modelID:'b'},{providerID:'p',modelID:'b'},{}]});
assert.deepEqual(Array.from(saved,x=>x.modelID),['b','a','c']);
assert.equal(saved,notified);
const css=patchCss(fs.readFileSync(new URL('webview.css',root),'utf8'));
assert.equal(patchCss(css),css);
const agents=['Astra + Jev Engineering Lead','Fable Engineering Lead','Other',
  'Opus + Jev Engineering Lead','Fable + Jev Engineering Lead'].map(name=>({name}));
assert.deepEqual(orderAgents(agents).map(x=>x.name),['Fable Engineering Lead',
  'Fable + Jev Engineering Lead','Opus + Jev Engineering Lead','Astra + Jev Engineering Lead','Other']);
assert.equal(agents[0].name,'Astra + Jev Engineering Lead');
console.log('PASS favorites order/filter/empty state/optimistic update/moves/host validation, Jev order, syntax and idempotence');
