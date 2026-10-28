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
const plots=new Map(),seekCalls=[];
const plotFactory=options=>{
  const plot={options,data:null,time:null,dataCalls:[],timeCalls:[],disposed:false,
    setData(data){this.data=data;this.dataCalls.push(data);},
    setTime(time){this.time=time;this.timeCalls.push(time);},
    dispose(){this.disposed=true;}};
  plots.set(options.key,plot);return plot;
};
const panels=new GeomagneticPanels({store,document:{getElementById:el},delay:0,plotFactory,onSeek:time=>seekCalls.push(time)});
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
for(const id of ['ae','dst']) {
  const plot=plots.get(id);
  assert.equal(plot.options.element,el(`index-${id}-plot`));
  assert.equal(plot.data.start,dayOf(t));assert.equal(plot.data.end,dayOf(t)+DAY);
  assert.equal(plot.data.records,actual[id],'Plots receive native records with original timestamps and bin boundaries');
  assert.equal(plot.time,t);assert.equal(plot.dataCalls.length,1);
}

panels.setTime(t+3599000);
assert.equal(text('index-ae-value'),'638');
assert.match(text('index-ae-time'),/12:59:00$/);
assert.equal(text('index-dst-value'),'-55','Dst remains the published hourly measurement through 12:59:59');
for(const plot of plots.values()) {
  assert.equal(plot.time,t+3599000,'Plot cursor follows the precise selected UTC second');
  assert.equal(plot.dataCalls.length,1,'Same-day scrubbing must not rebuild the complete series');
}
panels.setTime(t+3600000);
assert.equal(text('index-ae-value'),'675');
assert.equal(text('index-dst-value'),'-75');
assert.match(text('index-dst-time'),/13:30:00/);
assert.match(text('index-dst-interval'),/13:00:00, 14:00:00\)/);
assert.equal(plots.get('dst').dataCalls.length,1,'An hourly-bin boundary changes the cursor/readout, not daily chart geometry');

const missing=structuredClone(actual);
missing.ae=missing.ae.filter(s=>s.start!==t+3600000);
missing.dst=missing.dst.filter(s=>s.start!==t+3600000);
cache.set(dayOf(t),missing);panels.setTime(t+3600000);
assert.equal(text('index-ae-value'),'—');assert.equal(text('index-dst-value'),'—');
assert.match(text('index-dst-state'),/no record/);
assert.equal(text('index-dst-time'),'Source UTC: —');
assert.equal(plots.get('ae').data.records,missing.ae);
assert.equal(plots.get('dst').data.records,missing.dst);
assert.ok(!plots.get('dst').data.records.some(s=>s.start===t+3600000),'Absent bins stay absent in plot input');
const fill=structuredClone(actual);
Object.assign(fill.ae.find(s=>s.start===t),{value:null,status:'fill'});
fill.errors.dst='Network disabled';
cache.set(dayOf(t),fill);panels.setTime(t);
assert.equal(text('index-ae-value'),'—');assert.match(text('index-ae-state'),/fill/);
assert.equal(text('index-dst-value'),'—');assert.match(text('index-dst-state'),/retrieval failed/);
assert.equal(el('index-dst-state').title,'Network disabled');
assert.equal(plots.get('ae').data.records,fill.ae,'A fill record is preserved for renderer gap detection');
assert.equal(plots.get('ae').data.records.find(s=>s.start===t).value,null);
assert.equal(plots.get('dst').data.error,'Network disabled');
assert.equal(plots.get('dst').data.records.length,0,'A failed index clears its trace while the other index remains available');
cache.set(dayOf(t),actual);

// Slow prior-day results must not overwrite a newer selected day's source values.
panels.setTime(t-DAY);await tick();
assert.equal(text('index-ae-value'),'—','New uncached selections clear stale values immediately');
for(const plot of plots.values()) {
  assert.equal(plot.data.start,dayOf(t-DAY));assert.equal(plot.data.end,dayOf(t));
  assert.equal(plot.data.loading,true);assert.equal(plot.data.records.length,0,'No old-day trace is retained while the new day loads');
}
const loadingCounts=[...plots.values()].map(p=>p.dataCalls.length);
panels.setTime(t-DAY+60000);
assert.deepEqual([...plots.values()].map(p=>p.dataCalls.length),loadingCounts,'Cursor movement within a pending day does not repeatedly reset plot geometry');
panels.setTime(t+DAY);await tick();
assert.equal(pending[0].options.signal.aborted,true);
pending[1].resolve(later);await tick();
assert.match(text('index-ae-time'),/2015-03-18/);
for(const id of ['ae','dst']) {
  assert.equal(plots.get(id).data.records,later[id]);
  assert.equal(plots.get(id).data.start,dayOf(t+DAY));
  assert.equal(plots.get(id).time,t+DAY);
}
const current=text('index-ae-value');
const afterLaterCounts=[...plots.values()].map(p=>p.dataCalls.length);
pending[0].resolve(prior);await tick();
assert.equal(text('index-ae-value'),current);
assert.match(text('index-dst-time'),/2015-03-18/);
assert.deepEqual([...plots.values()].map(p=>p.dataCalls.length),afterLaterCounts,'Late responses cannot restore an old chart');
panels.setTime(t-DAY);await tick();
panels.setTime(t);
assert.equal(pending[2].options.signal.aborted,true);
pending[2].resolve(prior);await tick();
assert.equal(text('index-ae-value'),'83');
assert.match(text('index-dst-time'),/2015-03-17 12:30:00/);
for(const id of ['ae','dst']) assert.equal(plots.get(id).data.records,actual[id],'A return to the cached day restores its correct chart');

// Crossing UTC midnight changes both axes to the next day, using the same boundary.
cache.set(dayOf(t+DAY),later);
panels.setTime(dayOf(t+DAY)-1000);
for(const plot of plots.values()) assert.equal(plot.data.start,dayOf(t));
panels.setTime(dayOf(t+DAY));
for(const plot of plots.values()) {
  assert.equal(plot.data.start,dayOf(t+DAY));assert.equal(plot.data.end,dayOf(t+2*DAY));
  assert.equal(plot.time,dayOf(t+DAY));
}
plots.get('ae').options.onSeek(t+60000);
plots.get('dst').options.onSeek(t+3600000);
assert.deepEqual(seekCalls,[t+60000,t+3600000],'Plot navigation dispatches through the common application seek callback');
panels.dispose();
assert.ok([...plots.values()].every(p=>p.disposed),'Disposal cleans up both plot renderers');
console.log('PASS: real index values, source epochs, native bins, plot cursor synchronization, midnight axes, gap/failure clearing, concurrent selections, seek callbacks, and disposal.');
