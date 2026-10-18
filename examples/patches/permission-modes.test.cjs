'use strict';
const assert=require('node:assert');
const {createPermissionController}=require('./permission-modes.cjs');

const LAST='kilo.chatPermissionModes.last.v1';

function memento(initial={}) {
  const store={...initial};
  return {get:(key,fallback)=>key in store?store[key]:fallback,async update(key,value){store[key]=value;},_store:store};
}

function make({auto=false,global,workspace}={}) {
  const g=global??memento(),w=workspace??memento();
  const context={workspaceState:w,globalState:g,subscriptions:[]};
  const ctrl=createPermissionController({
    context,
    readActive:()=>auto,
    onConfiguration:()=>({dispose(){}}),
    registerCommand:()=>({dispose(){}}),
    client:()=>null,
    directories:()=>[],
    resolve:()=>undefined,
    replyOnce:async()=>true,
    retry:fn=>fn(),
    showError:()=>{},
  });
  return {ctrl,g,w};
}

(async()=>{
  // 1. Selecting 'full' is remembered and a new session inherits 'full' (user choice).
  {
    const {ctrl,g}=make({auto:false});
    await ctrl.select('full','s1');
    assert.equal(ctrl.mode('s1'),'full','selected session keeps full');
    assert.equal(g._store[LAST],'full','full is remembered in globalState');
    assert.equal(ctrl.mode('fresh'),'full','new session after full defaults to full');
  }

  // 2. Selecting 'ask' then a new session defaults to 'ask'.
  {
    const {ctrl,g}=make({auto:true});
    await ctrl.select('ask','s1');
    assert.equal(g._store[LAST],'ask');
    assert.equal(ctrl.mode('fresh'),'ask','new session after ask defaults to ask');
  }

  // 3. An existing session keeps its own mode across other selections.
  {
    const {ctrl}=make({auto:false});
    await ctrl.select('full','s1');
    await ctrl.select('ask','s2');
    assert.equal(ctrl.mode('s1'),'full','existing session keeps full');
    assert.equal(ctrl.mode('s2'),'ask');
  }

  // 4. An invalid stored last value is ignored and readActive() decides.
  {
    const {ctrl}=make({auto:true,global:memento({[LAST]:'bogus'})});
    assert.equal(ctrl.mode('fresh'),'auto','garbage falls back to readActive true');
    const {ctrl:ctrl2}=make({auto:false,global:memento({[LAST]:'full'})});
    assert.equal(ctrl2.mode('fresh'),'full','stored full is restored for new sessions');
  }

  // 5. A valid stored last value wins over readActive().
  {
    const {ctrl}=make({auto:true,global:memento({[LAST]:'ask'})});
    assert.equal(ctrl.mode('fresh'),'ask','stored last ask wins over readActive true');
  }

  console.log('permission-modes.test.cjs: all checks passed');
})().catch(error=>{console.error(error);process.exit(1);});