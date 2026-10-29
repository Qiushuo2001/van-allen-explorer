import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MagneticStore} from '../js/magnetic.js';
import {MagneticPanels} from '../js/magnetic-panels.js';

const DAY=86400000,t=Date.parse('2015-03-17T12:00:00Z'),dayOf=v=>Math.floor(v/DAY)*DAY;
const realStore=new MagneticStore({fetchImpl:async url=>({ok:true,json:async()=>JSON.parse(await readFile(new URL('../data/magnetic/'+String(url).split('/').at(-1),import.meta.url),'utf8'))})});
const actual=await realStore.getDay(t),prior=await realStore.getDay(t-DAY),later=await realStore.getDay(t+DAY);
const elements=new Map(),el=id=>{
  if(!elements.has(id)) elements.set(id,{textContent:'',listeners:{},classList:{toggle(){}},addEventListener(e,fn){this.listeners[e]=fn;}});
  return elements.get(id);
};
const cache=new Map([[dayOf(t),actual]]),pending=[];
const store={peekDay:time=>cache.get(dayOf(time))||null,getDay:(time,options)=>new Promise(resolve=>pending.push({time,options,resolve}))};
const panels=new MagneticPanels({store,document:{getElementById:el},delay:0});
const selection=(time,epoch=time)=>({time,positions:{rbspa:{t:epoch},rbspb:{t:epoch}}});
const text=id=>el(id).textContent,tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const sceneValues=()=>['rbspa','rbspb'].map(probe=>['l','mlt','mlat'].map(key=>text(`scene-${key}-${probe}`)));
const noSceneValues=[['—','—','—'],['—','—','—']];
const noonSceneValues=[['5.437','23.376','-11.21'],['2.441','16.869','-13.87']];
const assertSceneMatchesInspector=()=>{
  for(const probe of ['rbspa','rbspb']) for(const key of ['l','mlt','mlat'])
    assert.equal(text(`scene-${key}-${probe}`),text(`${key}-${probe}`),'Main-panel label and inspector must always agree');
};

panels.setSelection(selection(t));
assert.equal(text('l-rbspa'),'5.437');assert.equal(text('mlt-rbspa'),'23.376');assert.equal(text('mlat-rbspa'),'-11.21');
assert.equal(text('l-rbspb'),'2.441');assert.equal(text('mlt-rbspb'),'16.869');assert.equal(text('mlat-rbspb'),'-13.87');
assert.match(text('magnetic-time-rbspa'),/2015-03-17 12:00:00$/);
assert.match(text('magnetic-status-rbspa'),/centered dipole/);
assert.deepEqual(sceneValues(),noonSceneValues);
assertSceneMatchesInspector();
assert.match(el('scene-magnetic-rbspa').title,/Magnetic UTC: 2015-03-17 12:00:00/);
assert.match(el('scene-magnetic-rbspb').title,/MLT: Solar Magnetic local time in hours/);

panels.setSelection({time:t+22000,positions:{}});
assert.equal(text('l-rbspa'),'—','No exact position means no magnetic coordinate is silently substituted');
assert.deepEqual(sceneValues(),noSceneValues,'The scene clears both probes when no position sample exists');
assert.match(el('scene-magnetic-rbspa').title,/No position sample selected/);
panels.setSelection(selection(t+22000,t));
assert.equal(text('l-rbspa'),'5.437','Nearest display follows the actual plotted sample');
assert.match(text('magnetic-time-rbspa'),/12:00:00$/,'Source time is distinct from picker time');
assert.deepEqual(sceneValues(),noonSceneValues);
assert.match(el('scene-magnetic-rbspa').title,/Magnetic UTC: 2015-03-17 12:00:00/,'Scene tooltip identifies the plotted sample UTC');
assert.doesNotMatch(el('scene-magnetic-rbspa').title,/12:00:22/);
panels.setSelection({time:t,positions:{rbspa:{t}}});
assert.equal(text('l-rbspb'),'—','Unavailable probe stays unavailable independently');
assert.deepEqual(sceneValues(),[noonSceneValues[0],noSceneValues[1]]);
assertSceneMatchesInspector();

const missing=structuredClone(actual);
missing.series.rbspa=missing.series.rbspa.filter(s=>s.t!==t);
missing.series.rbspb.find(s=>s.t===t).mlt=null;
cache.set(dayOf(t),missing);panels.setSelection(selection(t));
assert.equal(text('l-rbspa'),'—');assert.match(text('magnetic-status-rbspa'),/No magnetic record/);
assert.equal(text('mlt-rbspb'),'—');assert.equal(text('l-rbspb'),'2.441');
assert.deepEqual(sceneValues(),[noSceneValues[0],['2.441','—','-13.87']],'A missing field does not remove valid fields or retain a previous value');
assertSceneMatchesInspector();
assert.match(el('scene-magnetic-rbspb').title,/Some magnetic values are missing/);
const failure={...actual,error:'Network disabled'};
cache.set(dayOf(t),failure);panels.setSelection(selection(t));
assert.equal(text('l-rbspa'),'—');assert.match(text('magnetic-status-rbspa'),/retrieval failed/);
assert.deepEqual(sceneValues(),noSceneValues,'A retrieval failure clears every scene value');
assert.match(el('scene-magnetic-rbspa').title,/retrieval failed[\s\S]*Network disabled/);
cache.set(dayOf(t),actual);

panels.setSelection(selection(t-DAY));await tick();
assert.equal(text('l-rbspa'),'—','An uncached time clears stale values immediately');
assert.deepEqual(sceneValues(),noSceneValues,'Loading cannot leave the previous time visible in the scene');
assert.match(el('scene-magnetic-rbspa').title,/Loading magnetic coordinates/);
panels.setSelection(selection(t+DAY));await tick();
assert.equal(pending[0].options.signal.aborted,true);
pending[1].resolve(later);await tick();
assert.match(text('magnetic-time-rbspa'),/2015-03-18/);
assertSceneMatchesInspector();
const latestSceneValues=sceneValues(),latestTitle=el('scene-magnetic-rbspa').title;
pending[0].resolve(prior);await tick();
assert.match(text('magnetic-time-rbspa'),/2015-03-18/,'A stale response cannot restore older values');
assert.deepEqual(sceneValues(),latestSceneValues,'A stale response cannot restore old scene labels');
assert.equal(el('scene-magnetic-rbspa').title,latestTitle);
panels.setSelection(selection(t-DAY));await tick();
panels.setSelection(selection(t));
assert.equal(pending[2].options.signal.aborted,true);
pending[2].resolve(prior);await tick();assert.equal(text('l-rbspa'),'5.437');
assert.deepEqual(sceneValues(),noonSceneValues);
assertSceneMatchesInspector();
panels.dispose();
console.log('PASS: real L/MLT/MLAT inspector and scene labels, plotted sample matching, explicit gaps, independent probes, missing fields, failures, and stale-response rejection.');
