// Reads isolated stock/caller-supplied bundles; patches only disposable temporary files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {patch,restore} from './chat-effort-isolation.mjs';
const root=process.argv[2]??new URL('../stock/extension/dist/',import.meta.url);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kilo-stable-effort-'));
try{
  for(const file of ['webview.js','agent-manager.js']){
    const source=fs.readFileSync(root instanceof URL?new URL(file,root):path.join(root,file),'utf8');
    const once=patch(source);assert.notEqual(once,source);assert.equal(patch(once),once);assert.equal(restore(once),source);assert.equal(restore(source),source);new vm.Script(once);
    assert.throws(()=>patch(source+source));assert.throws(()=>patch('unsupported'));
    const name=file==='webview.js'?'fgt':'E_n',key=file==='webview.js'?'Pm':'F1',match=file==='webview.js'?'ph':'dA',end=file==='webview.js'?'var hgt=':'var B_n=';
    const start=once.indexOf('function '+name+'(e)'),helper=once.slice(start,once.indexOf(end,start));
    const model={providerID:'test',modelID:'test'},writes=[],messages=[],remembered=[];let listener;
    const keyFor=(m,a,id)=>[m.modelID,a,id??'default'].join('/');
    const make=vm.runInNewContext(helper+';'+name,{[key]:keyFor,[match]:(x,variants)=>variants.includes(x)?x:undefined});
    const ctrl=make({find:()=>({variants:{high:{}}}),set:(...x)=>writes.push(x),post:x=>messages.push(x),session:()=> 'one',selected:()=>model,agent:()=> 'agent',draft:()=>true,remember:(...x)=>remembered.push(x),listen:fn=>{listener=fn;return()=>{}}});
    ctrl.carry(model,'high','agent','one');ctrl.select('high','two');
    assert.deepEqual(writes.map(x=>x[0]),['test/agent/one','test/agent/default','test/agent/two','test/agent/default']);assert.equal(messages.length,4);assert.equal(remembered.length,1);
    const before=writes.length;ctrl.carry(model,'unsupported','agent','one');assert.equal(writes.length,before);
    ctrl.load();listener({type:'variantsLoaded',variants:{'session/one':'high'}});assert.equal(writes.at(-1)[0],'session/one');
    // Use the actual bundled keys, rank matcher and shared resolver, not mocked lookups.
    const global=file==='webview.js'?'gZ':'Ofe',resolver=file==='webview.js'?'Fbe':'JWe',agentResolver=file==='webview.js'?'Hmt':'n_n',rank=file==='webview.js'?'mZ':'zfe';
    const extract=name=>{const begin=once.indexOf('function '+name+'(');return once.slice(begin,once.indexOf('function ',begin+9));};
    const actual=vm.runInNewContext([match,global,key,resolver,agentResolver].map(extract).join('')+helper+';({factory:'+name+',key:'+key+',global:'+global+'})',{[rank]:['none','minimal','low','medium','high','xhigh','max']});
    const selections={},actualModel={providerID:'test',modelID:'test'};let currentSession='one',currentAgent='CTO',preferred;
    const state=actual.factory({selections:()=>selections,selected:()=>actualModel,find:()=>({variants:{low:{},high:{},xhigh:{}}}),session:()=>currentSession,agent:()=>currentAgent,preferred:()=>preferred,config:()=>({model:'test/test',variant:'xhigh'}),set:(k,v)=>{selections[k]=v},post(){},draft:()=>true,remember(){}});
    assert.equal(state.current(),'xhigh');state.select('high');currentSession='two';
    assert.equal(state.current(),'high');assert.equal(state.saved(actualModel,'CTO','two'),'high');assert.equal(state.agent('CTO',actualModel),'high');
    selections[actual.key(actualModel,'CTO','two')]='low';assert.equal(state.current(),'low');assert.equal(state.saved(actualModel,'CTO','two'),'low');
    currentSession='three';delete selections[actual.key(actualModel,'CTO')];selections[actual.global(actualModel)]='high';assert.equal(state.current(),'high');
    state.select(undefined);currentSession='four';assert.equal(state.current(),undefined);assert.equal(state.saved(actualModel,'CTO','four'),'');assert.equal(state.request(),'');
    // A model selected in A should provide its preferred effort to another agent B.
    for(const k of Object.keys(selections))delete selections[k];currentAgent='B';currentSession='new-B';
    preferred={...actualModel,variant:'high'};
    assert.equal(state.current(),'high');assert.equal(state.agent('B',actualModel),'high');assert.equal(state.saved(actualModel,'B','new-B'),'high');
    selections[actual.key(actualModel,'B')]='xhigh';assert.equal(state.current(),'high','matching preferred outranks agent default');
    selections[actual.key(actualModel,'B','new-B')]='low';assert.equal(state.current(),'low','current session outranks preferred');
    delete selections[actual.key(actualModel,'B','new-B')];preferred.variant='';assert.equal(state.current(),undefined);assert.equal(state.request(),'');assert.equal(state.saved(actualModel,'B','new-B'),'');assert.equal(state.agent('B',actualModel),undefined);
    preferred={providerID:'different',modelID:actualModel.modelID,variant:'low'};assert.equal(state.current(),'xhigh');assert.equal(state.agent('B',actualModel),'xhigh');
    preferred={providerID:actualModel.providerID,modelID:'different',variant:'low'};assert.equal(state.current(),'xhigh');
    assert.ok(once.includes('preferred:()=>'+(file==='webview.js'?'jt':'Vt')+'.sessionOverrides.__kiloPreferred,'),'factory reads restored preferred state');
    const target=path.join(temp,file);fs.writeFileSync(target,source);
    for(const mode of ['--apply','--check','--restore'])execFileSync(process.execPath,[new URL('./chat-effort-isolation.mjs',import.meta.url).pathname,target,mode],{stdio:'pipe'});
    assert.equal(fs.readFileSync(target,'utf8'),source);console.log('PASS '+file+': session isolation, matching preferred precedence/empty/mismatch, persisted defaults/reload, draft memory, invalid carry, fail closed, CLI round trip');
  }
}finally{fs.rmSync(temp,{recursive:true,force:true});}
