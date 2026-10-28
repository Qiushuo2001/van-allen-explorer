import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GeomagneticStore} from '../js/indices.js';
import {GeomagneticPanels} from '../js/index-panels.js';

const DAY=86400000, dayOf=t=>Math.floor(t/DAY)*DAY;
const fixtureStore=new GeomagneticStore({fetchImpl:async url=>{
  const file=String(url).split('/').at(-1);
  return {ok:true,json:async()=>JSON.parse((await readFile(new URL('../data/indices/'+file,import.meta.url),'utf8')).replace(/^\uFEFF/,''))};
}});
const t=Date.parse('2015-03-17T12:00:00Z');
const actual=await fixtureStore.getDay(t), prior=await fixtureStore.getDay(t-DAY), later=await fixtureStore.getDay(t+DAY);
const elements=new Map();
const el=id=>{
  if(!elements.has(id)) elements.set(id,{textContent:'',title:'',href:'',disabled:false,listeners:{},
    classList:{toggle(){}},setAttribute(name,value){this[name]=value;},addEventListener(type,fn){this.listeners[type]=fn;}});
  return elements.get(id);
};
const cache=new Map([[dayOf(t),actual]]),pending=[];
const store={peekDay:time=>cache.get(dayOf(time)) || null,getDay:(time,options)=>new Promise(resolve=>pending.push({time,options,resolve}))};
const panels=new GeomagneticPanels({store,document:{getElementById:el},delay:0});
const text=id=>el(id).textContent;
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

panels.setTime(t);
assert.equal(text('index-ae-value'),'83');
assert.equal(text('index-dst-value'),'-55');
assert.match(text('index-ae-time'),/2015-03-17 12:00:00$/);
assert.match(text('index-dst-time'),/2015-03-17 12:30:00 \(hour midpoint\)$/);
assert.match(text('index-dst-interval'),/12:00:00, 13:00:00\)/);
assert.match(text('index-ae-quality'),/Provisional/);
assert.match(text('index-dst-quality'),/Final/);

panels.setTime(t+3599000);
assert.equal(text('index-ae-value'),'638');
assert.match(text('index-ae-time'),/12:59:00$/);
assert.equal(text('index-dst-value'),'-55','Dst remains the published hourly measurement through 12:59:59');
panels.setTime(t+3600000);
assert.equal(text('index-ae-value'),'675');
assert.equal(text('index-dst-value'),'-75');
assert.match(text('index-dst-time'),/13:30:00/);
assert.match(text('index-dst-interval'),/13:00:00, 14:00:00\)/);

const missing=structuredClone(actual);
missing.ae=missing.ae.filter(s=>s.start!==t+3600000);
missing.dst=missing.dst.filter(s=>s.start!==t+3600000);
cache.set(dayOf(t),missing);panels.setTime(t+3600000);
assert.equal(text('index-ae-value'),'—');assert.equal(text('index-dst-value'),'—');
assert.match(text('index-dst-state'),/no record/);
assert.equal(text('index-dst-time'),'Source UTC: —');
const fill=structuredClone(actual);
Object.assign(fill.ae.find(s=>s.start===t),{value:null,status:'fill'});
fill.errors.dst='Network disabled';
cache.set(dayOf(t),fill);panels.setTime(t);
assert.equal(text('index-ae-value'),'—');assert.match(text('index-ae-state'),/fill/);
assert.equal(text('index-dst-value'),'—');assert.match(text('index-dst-state'),/retrieval failed/);
assert.equal(el('index-dst-state').title,'Network disabled');
cache.set(dayOf(t),actual);

// Slow prior-day results must not overwrite a newer selected day's source values.
panels.setTime(t-DAY);await tick();
assert.equal(text('index-ae-value'),'—','New uncached selections clear stale values immediately');
panels.setTime(t+DAY);await tick();
assert.equal(pending[0].options.signal.aborted,true);
pending[1].resolve(later);await tick();
assert.match(text('index-ae-time'),/2015-03-18/);
const current=text('index-ae-value');
pending[0].resolve(prior);await tick();
assert.equal(text('index-ae-value'),current);
assert.match(text('index-dst-time'),/2015-03-18/);
panels.setTime(t-DAY);await tick();
panels.setTime(t);
assert.equal(pending[2].options.signal.aborted,true);
pending[2].resolve(prior);await tick();
assert.equal(text('index-ae-value'),'83');
assert.match(text('index-dst-time'),/2015-03-17 12:30:00/);
panels.dispose();
console.log('PASS: real index values, minute/hour transitions, preserved midpoint labels, quality/source display, no stale or missing-bin substitutions, and concurrent selections.');
