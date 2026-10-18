import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';import{createRequire}from'node:module';import{spawnSync}from'node:child_process';
import{patch as effort}from'./chat-effort-isolation.mjs';import{patch as clarify}from'./clarify-goal.mjs';import{patch}from'./per-agent-model.mjs';import{patchWebview,patchExtension}from'./global-last-agent.mjs';
const root=new URL('../stock/extension/dist/',import.meta.url),require=createRequire(import.meta.url);
function func(source,name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);let i=source.indexOf('{',start),depth=1;for(++i;depth&&i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}')depth--}assert.equal(depth,0);return source.slice(start,i)}
for(const [kind,b]of [['webview',{resolve:'pZ',model:'Omt',current:'Rbe',defaults:'jmt',lookup:'mnr',store:'jt',set:'ln',remember:'Po',retain:'Ca',agent:'ae',pick:'$e',variant:'gt',local:'Et',key:'Pm',cleanup:'Xe',selector:'x0e',defaultSet:'Te',pendingSet:'Pe',fallback:'We',getAgent:'Je',composer:'Qm'}],['agent-manager',{resolve:'Nfe',model:'XCn',current:'YWe',defaults:'e_n',lookup:'JDa',store:'Vt',set:'An',remember:'mo',retain:'Ra',agent:'me',pick:'Ke',variant:'yt',local:'Qt',key:'F1',cleanup:'qe',selector:'hz',defaultSet:'Ne',pendingSet:'He',fallback:'We',getAgent:'nt',composer:'R1'}]]){
 const original=fs.readFileSync(new URL(kind+'.js',root),'utf8'),source=patchWebview(patch(original));assert.equal(patch(source),source);assert.equal(patchWebview(source),source);assert.equal(spawnSync(process.execPath,['--check'],{input:source,encoding:'utf8'}).status,0);
 const A={providerID:'local',modelID:'A'},B={providerID:'local',modelID:'B'},C={providerID:'local',modelID:'C'},D={providerID:'local',modelID:'D'},E={providerID:'local',modelID:'E'};
 const validate=(providers,connected,value)=>value&&providers[value.providerID]?.models[value.modelID];
 const context={bS:validate,rQ:validate};vm.createContext(context);for(const f of[b.resolve,b.model,b.lookup,b.current,b.defaults])vm.runInContext(func(source,f),context);
 const options={providers:{local:{models:{A:{},B:{},C:{},D:{},E:{}}}},connected:['local'],ready:true,organizationId:null,getModeModel:()=>C,getGlobalModel:()=>E};
 const store={sessionOverrides:{ses_one:{alpha:A},__kiloPerAgent:{alpha:B},__kiloPreferred:D},recentModels:[]};
 assert.equal(context[b.current](store,options,'ses_one','alpha'),A);delete store.sessionOverrides.ses_one.alpha;assert.equal(context[b.current](store,options,'ses_one','alpha'),B);
 assert.equal(context[b.defaults](store,options,'alpha'),B);store.sessionOverrides.__kiloPerAgent.alpha={providerID:'missing',modelID:'invalid'};assert.equal(context[b.defaults](store,options,'alpha'),C);
 options.getModeModel=()=>undefined;assert.equal(context[b.defaults](store,options,'alpha'),D);delete store.sessionOverrides.__kiloPreferred;assert.equal(context[b.defaults](store,options,'alpha'),E);
 const posts=[],states=[];const localStore={sessions:{ses_existing:{}},agentSelections:{},sessionOverrides:{}};let currentDefault='alpha',pending=null;
 const set=(...args)=>{states.push(args);let target=localStore;while(args.length>2){const key=args.shift();target=target[key]??=( {} )}target[args[0]]=args[1]};
 const scope={...context,[b.store]:localStore,[b.set]:set,[b.retain]:{retain(){},pin(){},forget(id){delete localStore.agentSelections[id]}},[b.composer]:'composer',[b.defaultSet]:value=>currentDefault=value,[b.pendingSet]:value=>pending=value,[b.getAgent]:id=>localStore.agentSelections[id]??currentDefault,kiloPreferenceState:{revision:0,picks:{},preferred:null},t:{postMessage:m=>posts.push(m)},s:()=>null};
 vm.createContext(scope);vm.runInContext(func(source,b.selector),scope);scope[b.selector]('beta');assert.equal(currentDefault,'beta');assert.equal(pending,'beta');assert.equal(localStore.agentSelections.ses_existing,'alpha');assert.equal(posts[0].type,'persistLastSelectedAgent');
 scope[b.selector]('gamma','sidebar-pending:new');assert.equal(localStore.agentSelections.ses_existing,'alpha');assert.equal(localStore.agentSelections['sidebar-pending:new'],'gamma');
 // Execute actual remembered-pick write path and verify original host message contract.
 scope[b.key]=(pick,agent)=>agent+'/'+pick.modelID;scope[b.retain].retain=()=>{};vm.runInContext(func(source,b.remember),scope);scope[b.remember]('gamma',B,'high');
 assert.equal(localStore.sessionOverrides.__kiloPerAgent.gamma.modelID,'B');assert.equal(localStore.sessionOverrides.__kiloPreferred.variant,'high');assert.equal(posts.at(-2).type,'persistModelSelection');assert.equal(posts.at(-2).agent,'gamma');
 // A restored snapshot is not authoritative over disk; only edits made while a
 // particular request is in flight may override that response.
 const loadStart=source.indexOf('(()=>{const requests='),loadEnd=source.indexOf('})(),t.postMessage({type:"requestRecents"})',loadStart)+4;
 let listener;const fresh={sessions:{},agentSelections:{},sessionOverrides:{__kiloPerAgent:{gamma:A},__kiloPreferred:A}};
 const loadScope={...scope,ws:fn=>fn(),Ha:fn=>fn(),crypto:{randomUUID:(()=>{let n=0;return()=>String(++n)})()},kiloPreferenceState:{revision:0,picks:{},preferred:null},[b.store]:fresh,[b.set]:(...args)=>{let at=fresh;while(args.length>2){const key=args.shift();at=at[key]??={}}at[args[0]]=args[1]},[b.cleanup]:()=>{},t:{onMessage:fn=>(listener=fn,()=>{}),postMessage:m=>posts.push(m)}};
 vm.createContext(loadScope);vm.runInContext(source.slice(loadStart,loadEnd),loadScope);vm.runInContext(func(source,b.remember),loadScope);
 const first=posts.at(-1).requestId;
 listener({type:'modelSelectionsLoaded',requestId:first,selections:{gamma:B},preferred:{...B,variant:'high'}});
 assert.equal(fresh.sessionOverrides.__kiloPerAgent.gamma.modelID,'B');assert.equal(fresh.sessionOverrides.__kiloPreferred.variant,'high');
 listener({type:'providersLoaded'});const second=posts.at(-1).requestId;
 loadScope[b.remember]('gamma',C,'max');
 listener({type:'modelSelectionsLoaded',requestId:second,selections:{gamma:B},preferred:B});
 assert.equal(fresh.sessionOverrides.__kiloPerAgent.gamma.modelID,'C');assert.equal(fresh.sessionOverrides.__kiloPreferred.variant,'max');
 listener({type:'providersLoaded'});const third=posts.at(-1).requestId;
 listener({type:'modelSelectionsLoaded',requestId:third,selections:{gamma:D},preferred:D});
 assert.equal(fresh.sessionOverrides.__kiloPerAgent.gamma.modelID,'D');
 listener({type:'modelSelectionsLoaded',requestId:second,selections:{gamma:A},preferred:A});assert.equal(fresh.sessionOverrides.__kiloPerAgent.gamma.modelID,'D');
 const refreshed=clarify(clarify(source,kind+'.js'),kind+'.js');assert.equal(patch(refreshed),refreshed);assert.equal(patchWebview(refreshed),refreshed);const combined=effort(refreshed);assert.equal(patch(combined),combined);assert.equal(patchWebview(combined),combined);assert.equal(clarify(combined,kind+'.js'),combined);assert.equal(effort(combined),combined);

}
const original=fs.readFileSync(new URL('extension.js',root),'utf8'),host=patchExtension(original);assert.equal(patchExtension(host),host);assert.equal(spawnSync(process.execPath,['--check'],{input:host,encoding:'utf8'}).status,0);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kilo-preference-test-'));
try{
 // Execute the exact injected helper, preserving other model.json fields and old picks.
 const context={require,process:{env:{XDG_STATE_HOME:dir}},console};vm.createContext(context);vm.runInContext(func(host,'kiloModelPreferences'),context);const state=path.join(dir,'kilo');fs.mkdirSync(state);fs.writeFileSync(path.join(state,'model.json'),JSON.stringify({favorite:['keep'],model:{alpha:{providerID:'local',modelID:'A'}}}));fs.writeFileSync(path.join(state,'vscode-model.json'),JSON.stringify({preferred:{providerID:'local',modelID:'A',variant:'low'}}));
 const replies=[],client={path:{get:async()=>({data:{state}})}},run=m=>context.kiloModelPreferences(client,m,v=>replies.push(v));
 await run({type:'requestModelSelections'});assert.equal(replies[0].selections.alpha.modelID,'A');assert.equal(replies[0].preferred.variant,'low');
 await Promise.all(['beta','gamma'].map(agent=>run({type:'persistModelSelection',agent,providerID:'local',modelID:agent,variant:'high'})));
 const saved=JSON.parse(fs.readFileSync(path.join(state,'model.json')));assert.equal(saved.favorite[0],'keep');assert.deepEqual(Object.keys(saved.model).sort(),['alpha','beta','gamma']);
 fs.writeFileSync(path.join(state,'model.json'),'broken json');await assert.rejects(run({type:'persistModelSelection',agent:'alpha',providerID:'local',modelID:'new'}));assert.equal(fs.readFileSync(path.join(state,'model.json'),'utf8'),'broken json');
 // Execute actual host persistence case and verify XDG path plus visible-agent validation.
 const start=host.indexOf('case"persistLastSelectedAgent":{')+'case"persistLastSelectedAgent":{'.length,end=host.indexOf('break}case"requestModelSelections"',start);vm.runInContext('(()=>{'+host.slice(start,end)+'})()',Object.assign(context,{message6:{agent:'beta'}}));assert.equal(fs.readFileSync(path.join(state,'last-selected-agent'),'utf8'),'beta');
 const expressionStart=host.indexOf('defaultAgent:(()=>{')+'defaultAgent:'.length,expressionEnd=host.indexOf('};this.cachedAgentsMessage',expressionStart);const expr=host.slice(expressionStart,expressionEnd);context.visible=[{name:'alpha'},{name:'beta'}];context.defaultAgent='alpha';assert.equal(vm.runInContext(expr,context),'beta');context.visible=[{name:'alpha'}];assert.equal(vm.runInContext(expr,context),'alpha');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
console.log('PASS: both real bundle model lookup precedence, missing model fallback, per-agent picks, preserved existing-session labels, new-chat selection, legacy persisted model/preferred files, queued writes, corrupt-file protection, XDG state, visible-agent validation, syntax and idempotence.');
