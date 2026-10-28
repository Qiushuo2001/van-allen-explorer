import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import {PROBES,MISSION_START,MISSION_END,sampleAt} from '../js/ephemeris.js';

const MINUTE=60000, HOUR=3600000, DAY=24*HOUR;
const initialTime=Date.parse('2015-03-17T12:00:00Z');
const inputTime=t=>new Date(t).toISOString().slice(0,19);
let source=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
source=source.replace(/^import .*;\r?\n/gm,'');
source=source.slice(0,source.lastIndexOf('\nsyncTime();'));

// Empty responses exercise controller state and transport timing only.
// Scientific record and coordinate tests use genuine fixtures in ephemeris.test.mjs.
const dataFor=(start,end,errors=[])=>({start,end,frame:'GSE',series:{rbspa:[],rbspb:[]},
  provenance:{sources:[],errors,warnings:[]}});

function harness() {
  const elements=new Map();
  function element(id='') {
    return {id,value:'',checked:false,disabled:false,style:{},dataset:{},listeners:{},
      classList:{add(){},remove(){},toggle(){}},setAttribute(){},append(){},replaceChildren(){},
      addEventListener(event,handler){this.listeners[event]=handler;},setCustomValidity(){},reportValidity(){}};
  }
  const get=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
  let store;
  class FakeStore {
    constructor(){this.requests=[];store=this;}
    loadRange(start,end,frame,{signal}) {
      return new Promise((resolve,reject)=>this.requests.push({start,end,frame,signal,resolve,reject}));
    }
  }
  class FakeScene {setFrame(){}setData(){}setVisibility(){}setView(){}resetView(){}dispose(){}}
  class FakeIndices {setTime(){}dispose(){}}
  class FakeMagnetic {setSelection(){}dispose(){}}
  const context={PROBES,MISSION_START,MISSION_END,sampleAt,EphemerisStore:FakeStore,OrbitScene:FakeScene,GeomagneticPanels:FakeIndices,MagneticPanels:FakeMagnetic,
    document:{getElementById:get,querySelectorAll:()=>[],createTextNode:text=>({text}),createElement:()=>element(),addEventListener(){}},
    window:{addEventListener(){}},performance,AbortController,setTimeout(){return 1;},clearTimeout(){},requestAnimationFrame(){},console,
  };
  vm.createContext(context);
  vm.runInContext(source+'\nglobalThis.audit={state,loadData,seek,animate};',context);
  const {state,loadData,seek,animate}=context.audit;
  state.data=dataFor(initialTime-10*HOUR,initialTime+10*HOUR);
  const click=id=>get(id).listeners.click();
  const pick=t=>{get('selected-time').value=inputTime(t);get('selected-time').listeners.change({target:get('selected-time')});};
  const settle=async (request,{errors=[],reject=null}={})=>{
    if(reject) request.reject(reject);
    else request.resolve(dataFor(request.start,request.end,errors));
    await Promise.resolve(); await Promise.resolve();
  };
  return {state,loadData,seek,animate,get,store,click,pick,settle};
}

test('Returning to retained data aborts a stale request and rejects its late completion',async()=>{
  const h=harness(),original=h.state.data;
  h.state.time=initialTime+3*DAY;
  const pending=h.loadData(),request=h.store.requests[0];
  assert.equal(h.state.loading,true);
  h.state.time=initialTime;
  await h.loadData();
  assert.equal(request.signal.aborted,true);
  assert.equal(h.state.loading,false);
  await h.settle(request); await pending;
  assert.equal(h.state.data,original);
});

test('Picker seconds remain synchronized; slider gestures snap to an archived minute',()=>{
  const h=harness();
  h.pick(initialTime+22000);
  assert.equal(h.get('timeline').value,String((initialTime+22000)/1000));
  assert.equal(h.get('timeline').step,'1');
  h.get('timeline').value=String((initialTime+38000)/1000);
  h.get('timeline').listeners.input({target:h.get('timeline')});
  assert.equal(h.state.time,initialTime+MINUTE);
});

for(const date of ['2013-06-12T09:20:00Z','2018-08-01T12:00:00Z']) {
  test(`Play preserves picker selection ${date}, waits for its data, and advances there`,async()=>{
    const h=harness(),selected=Date.parse(date);
    h.pick(selected);
    assert.equal(h.state.time,selected);
    assert.equal(h.state.loading,true);
    h.click('play');
    assert.equal(h.state.time,selected,'Play must never seek back to the bundled date');
    assert.equal(h.state.intervalStart,selected);
    assert.equal(h.state.intervalEnd,selected+DAY,'Retain the existing playback duration');
    assert.equal(h.get('interval-start').value,inputTime(selected));
    assert.equal(h.get('interval-end').value,inputTime(selected+DAY));
    assert.equal(h.get('timeline').min,String(selected/1000));
    assert.equal(h.get('timeline').max,String((selected+DAY)/1000));
    assert.equal(h.get('timeline').value,String(selected/1000));
    assert.equal(h.state.playing,true);
    assert.ok(h.store.requests.every(r=>r.start<=selected && r.end>=selected),'Requests cover the chosen date');
    h.state.lastFrame=1000;h.state.speed=60;
    h.animate(1250);
    assert.equal(h.state.time,selected,'Playback waits for the selected-date request');
    for(const request of h.store.requests) await h.settle(request);
    assert.equal(h.state.loading,false);
    for(const now of [1500,1750,2000,2250]) h.animate(now);
    assert.equal(h.state.time,selected+MINUTE,'Playback advances at the selected date');
  });
}

test('Play keeps a custom interval that already contains the selected timestamp',()=>{
  const h=harness(),start=initialTime-HOUR,end=initialTime+2*HOUR;
  h.get('interval-start').value=inputTime(start);
  h.get('interval-end').value=inputTime(end);
  h.click('apply-interval');
  h.pick(initialTime);h.click('play');
  assert.equal(h.state.time,initialTime);
  assert.equal(h.state.intervalStart,start);
  assert.equal(h.state.intervalEnd,end);
  assert.equal(h.get('interval-start').value,inputTime(start));
  assert.equal(h.get('interval-end').value,inputTime(end));
});

test('A new date with seconds reanchors the interval and aligns playback forward',()=>{
  const h=harness(),selected=Date.parse('2018-08-01T12:00:22Z');
  h.pick(selected);h.click('play');
  assert.equal(h.state.time,selected+38000);
  assert.equal(h.state.intervalStart,selected);
  assert.equal(h.state.intervalEnd,selected+DAY);
  assert.equal(h.get('selected-time').value,inputTime(selected+38000));
  assert.equal(h.get('interval-start').value,inputTime(selected));
  assert.equal(h.state.playing,true);
});

test('Play at the old interval end extends forward rather than rewinding',()=>{
  const h=harness(),selected=h.state.intervalEnd;
  h.pick(selected);h.click('play');
  assert.equal(h.state.time,selected);
  assert.equal(h.state.intervalStart,selected);
  assert.equal(h.state.intervalEnd,selected+DAY);
});

for(const failure of ['reported','rejected']) {
  test(`${failure} retrieval failure pauses at the chosen date without a bundled-date fallback`,async()=>{
    const h=harness(),selected=Date.parse('2018-08-01T12:00:00Z');
    h.pick(selected);h.click('play');
    await h.settle(h.store.requests.at(-1),failure==='reported'?{errors:['NASA unavailable']}:{reject:new Error('NASA unavailable')});
    assert.equal(h.state.time,selected);
    assert.equal(h.state.playing,false);
    assert.equal(h.state.loading,false);
    assert.equal(h.get('selected-time').value,inputTime(selected));
    assert.equal(h.get('x-rbspa').textContent,'—');
    assert.equal(h.get('x-rbspb').textContent,'—');
  });
}

test('Play clamps its new interval to mission end while preserving the selection',()=>{
  const h=harness(),selected=Date.parse('2019-10-18T22:00:00Z');
  h.pick(selected);h.click('play');
  assert.equal(h.state.time,selected);
  assert.equal(h.state.intervalStart,selected);
  assert.equal(h.state.intervalEnd,MISSION_END);
  assert.equal(h.get('interval-end').value,inputTime(MISSION_END));
  assert.equal(h.state.playing,true);
});

test('At mission end Play stays paused at the selected timestamp',()=>{
  const h=harness();
  h.pick(MISSION_END);h.click('play');
  assert.equal(h.state.time,MISSION_END);
  assert.equal(h.state.playing,false);
  assert.ok(h.get('interval-message').textContent.length>0);
});

test('No complete UTC minute before interval end means paused without rewind or rounding past it',()=>{
  const h=harness(),selected=initialTime+22000;
  h.get('interval-start').value=inputTime(initialTime);
  h.get('interval-end').value=inputTime(initialTime+40000);
  h.click('apply-interval');
  h.pick(selected);h.click('play');
  assert.equal(h.state.time,selected);
  assert.equal(h.state.playing,false);
  assert.equal(h.state.intervalEnd,initialTime+40000);
  assert.ok(h.get('interval-message').textContent.length>0);
});

test('Playback and loop restart align to source minutes',()=>{
  const h=harness();
  h.pick(initialTime+22000);h.click('play');
  assert.equal(h.state.time,initialTime+MINUTE);
  assert.equal(h.state.playing,true);
  h.state.intervalStart=initialTime+22000;
  h.state.intervalEnd=initialTime+3*MINUTE;
  h.state.time=initialTime+2*MINUTE;
  h.state.speed=3600;h.state.lastFrame=1000;h.state.accumulator=0;
  h.get('loop').checked=true;
  h.animate(1250);
  assert.equal(h.state.time,initialTime+MINUTE);
});
