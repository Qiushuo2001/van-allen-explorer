import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PlasmaPanels, formatPlasmaValue } from '../js/plasma-panels.js';
import { PlasmaStore } from '../js/plasma.js';

const DAY=86400000,t=Date.parse('2015-03-17T12:00:00Z'),dayOf=time=>Math.floor(time/DAY)*DAY;
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const keys=['density','ratio','anisotropy','beta'];
const missing=()=>({value:null,status:'missing',note:'No native sample within the permitted time window.',sourceTime:null,offsetMs:null});
const field=(value,sourceTime,note='Native source quality accepted.')=>({value,status:'valid',sourceTime,offsetMs:Date.parse(sourceTime)-t,note});
const source=kind=>({dataset:`TEST_${kind}`,kind:'bundled',url:`https://cdaweb.gsfc.nasa.gov/hapi/data?id=TEST_${kind}`,retrievedAt:'2026-10-28T00:00:00Z'});
function sampleDay(time=t) {
  const day={dayStart:dayOf(time),dayEnd:dayOf(time)+DAY,errors:{rbspa:{},rbspb:{}},selections:{
    rbspa:{fields:Object.fromEntries(keys.map(key=>[key,missing()])),sources:Object.fromEntries(['density','moments','field'].map(key=>[key,source(key)]))},
    rbspb:{fields:{density:field(1750,'2015-03-17T11:59:58.799999936Z','No per-record quality flag is supplied.'),
      ratio:field(4.83,'2015-03-17T11:59:58.799999936Z'),
      anisotropy:field(5352/2906,'2015-03-17T11:59:55.160Z','Derived from HOPE electron temperatures ≥200 eV.'),
      beta:{...field(0.0000198,'2015-03-17T11:59:55.160Z','Scalar beta of the HOPE electron population ≥200 eV.'),fieldTime:'2015-03-17T11:59:54.001Z',fieldOffsetMs:-1159}},
      sources:Object.fromEntries(['density','moments','field'].map(key=>[key,source(key)]))}
  }};
  day.plotSeries=Object.fromEntries(keys.map(key=>[key,Object.fromEntries(['rbspa','rbspb'].map(probe=>[probe,[{t:Date.parse(day.selections[probe].fields[key].sourceTime)||time,...day.selections[probe].fields[key]}]]))]));
  return day;
}
function harness({cached=true}={}) {
  const elements=new Map(),el=id=>{
    if(!elements.has(id)) elements.set(id,{textContent:'',title:'',href:'',disabled:false,listeners:{},attributes:{},classes:new Set(),
      classList:{toggle(name,on){const node=elements.get(id);if(on) node.classes.add(name);else node.classes.delete(name);}},
      setAttribute(name,value){this.attributes[name]=String(value);},
      addEventListener(type,fn){this.listeners[type]=fn;},removeEventListener(type){delete this.listeners[type];}});
    return elements.get(id);
  };
  const day=sampleDay(),cache=new Map(cached?[[dayOf(t),day]]:[]),requests=[],selectionCalls=[];
  const store={peekDay:time=>cache.get(dayOf(time))||null,getDay:(time,options)=>new Promise((resolve,reject)=>requests.push({time,options,resolve,reject}))};
  const selectImpl=(day,probe,time)=>{selectionCalls.push({day,probe,time});return day.selections[probe];};
  const plots=new Map(),seriesCalls=[],seekCalls=[];
  const plotFactory=options=>{
    const plot={options,inputs:[],times:[],disposed:false,setData(input){this.data=input;this.inputs.push(input);},setTime(time){this.time=time;this.times.push(time);},dispose(){this.disposed=true;}};
    plots.set(options.key,plot);return plot;
  };
  const seriesImpl=day=>{seriesCalls.push(day);return day.plotSeries;};
  const panels=new PlasmaPanels({store,document:{getElementById:el},delay:0,selectImpl,seriesImpl,plotFactory,onSeek:time=>seekCalls.push(time)});
  return {panels,day,cache,requests,selectionCalls,seriesCalls,plots,plotFactory,seekCalls,el,text:id=>el(id).textContent};
}

test('Plasma cards preserve per-field availability, source epochs, units context and independent probes',()=>{
  const h=harness();h.panels.setTime(t);
  assert.equal(h.text('plasma-density-rbspa'),'—');
  assert.equal(h.text('plasma-density-rbspb'),'1750');
  assert.equal(h.text('plasma-ratio-rbspb'),'4.83');
  assert.equal(h.text('plasma-anisotropy-rbspb'),'1.84');
  assert.equal(h.text('plasma-beta-rbspb'),'1.98e-5');
  assert.match(h.text('plasma-density-note-rbspb'),/11:59:58\.799999936 UTC \(-1\.201 s from selection\)/);
  assert.match(h.text('plasma-anisotropy-note-rbspb'),/11:59:55\.160 UTC \(-4\.840 s from selection\)/);
  assert.match(h.text('plasma-beta-note-rbspb'),/\|B\|: 2015-03-17 11:59:54\.001 UTC \(-1\.159 s from HOPE\)/);
  assert.doesNotMatch(h.text('plasma-beta-note-rbspb'),/HOPE electron population ≥200 eV/,'Valid notes reserve space for source times');
  assert.match(h.el('plasma-beta-note-rbspb').title,/HOPE electron population ≥200 eV/,'Full provenance remains in the tooltip');
  assert.match(h.el('plasma-density-note-rbspb').title,/No per-record quality flag/);
  assert.equal(h.el('plasma-source-moments-rbspb').href,h.day.selections.rbspb.sources.moments.url);
  assert.match(h.el('plasma-source-density-rbspb').title,/Bundled NASA response/);
  assert.match(h.text('plasma-status-rbspb'),/4 \/ 4/);
  assert.match(h.text('plasma-status-rbspa'),/No usable/);
  assert.match(h.text('plasma-time'),/2015-03-17 12:00:00\.000 UTC/);
  assert.equal(h.el('plasma-section').attributes['aria-busy'],'false');
  h.day.selections.rbspb.fields.beta={...missing(),status:'error',note:'Magnetic field retrieval failed.'};
  h.panels.setTime(t+22000);
  assert.equal(h.text('plasma-density-rbspb'),'1750','A field-service failure does not remove density');
  assert.equal(h.text('plasma-anisotropy-rbspb'),'1.84','Anisotropy does not depend on field retrieval');
  assert.equal(h.text('plasma-beta-rbspb'),'—');
  assert.match(h.text('plasma-status-rbspb'),/3 \/ 4/);
  assert.ok(h.el('plasma-beta-note-rbspb').classes.has('error-text'));
  assert.equal(h.selectionCalls.at(-1).time,t+22000,'Cached scrubbing reselects the precise requested UTC');
  assert.equal(h.requests.length,0);
  h.panels.dispose();
});

test('A new day immediately clears plasma values; late responses cannot restore stale measurements',async()=>{
  const h=harness();h.panels.setTime(t);
  h.panels.setTime(t-DAY);
  for(const probe of ['rbspa','rbspb']) for(const key of keys) assert.equal(h.text(`plasma-${key}-${probe}`),'—');
  assert.match(h.text('plasma-density-note-rbspb'),/Loading/);
  assert.equal(h.el('plasma-retry').disabled,true);
  assert.equal(h.el('plasma-section').attributes['aria-busy'],'true');
  await tick();
  h.panels.setTime(t-DAY+1000);await tick();
  assert.equal(h.requests.length,1,'Scrubbing within the pending day shares one request');
  h.panels.setTime(t+DAY);await tick();
  assert.equal(h.requests[0].options.signal.aborted,true);
  const later=sampleDay(t+DAY);later.selections.rbspb.fields.density.value=246;
  h.requests[1].resolve(later);await tick();
  assert.equal(h.text('plasma-density-rbspb'),'246');
  const calls=h.selectionCalls.length;
  h.requests[0].resolve(sampleDay(t-DAY));await tick();
  assert.equal(h.text('plasma-density-rbspb'),'246');assert.equal(h.selectionCalls.length,calls);
  h.panels.setTime(t-DAY);await tick();
  h.panels.setTime(t);
  assert.equal(h.requests[2].options.signal.aborted,true);
  h.requests[2].resolve(sampleDay(t-DAY));await tick();
  assert.equal(h.text('plasma-density-rbspb'),'1750','Returning to a cached day keeps its own source values');
  h.panels.dispose();
});

test('Refresh clears cached measurements throughout the request; failures and disposal stay explicit',async()=>{
  const h=harness();h.panels.setTime(t);
  h.el('plasma-retry').listeners.click();await tick();
  assert.equal(h.requests[0].options.force,true);
  h.panels.setTime(t+1000);
  assert.equal(h.text('plasma-density-rbspb'),'—','Playback cannot restore the stale cache while refreshing');
  h.requests[0].reject(new Error('Network disabled'));await tick();
  assert.equal(h.text('plasma-density-rbspb'),'—');
  assert.match(h.text('plasma-density-note-rbspb'),/retrieval failed: Network disabled/);
  assert.equal(h.el('plasma-retry').disabled,false);
  h.el('plasma-retry').listeners.click();await tick();
  h.panels.dispose();
  assert.equal(h.requests[1].options.signal.aborted,true);
  assert.equal(h.el('plasma-retry').listeners.click,undefined);
  h.requests[1].resolve(sampleDay());await tick();
  assert.equal(h.text('plasma-density-rbspb'),'—');
  h.panels.setTime(t);
  assert.equal(h.text('plasma-density-rbspb'),'—','Disposed panels cannot resume fetching/rendering');
});

test('Plasma formatting keeps small beta visible and missing values distinct from zero',()=>{
  assert.equal(formatPlasmaValue(1.984e-5,'beta'),'1.98e-5');
  assert.equal(formatPlasmaValue(0.006789,'beta'),'0.00679');
  assert.equal(formatPlasmaValue(5352/2906,'anisotropy'),'1.84');
  assert.equal(formatPlasmaValue(null,'density'),'—');
  assert.equal(formatPlasmaValue(NaN,'density'),'—');
  assert.equal(formatPlasmaValue(0,'density'),'0');
});

test('Real NASA default-day measurements render Probe B and preserve Probe A data gaps',async()=>{
  const store=new PlasmaStore({fetchImpl:async url=>{
    const sourceURL=new URL(url);
    assert.equal(sourceURL.protocol,'file:','Bundled verification must not fall back to a live request');
    return {ok:true,json:async()=>JSON.parse(await readFile(sourceURL,'utf8'))};
  }});
  const day=await store.getDay(t);
  for(const probe of ['rbspa','rbspb']) for(const product of ['density','moments','field']) assert.equal(day.errors[probe][product],null);
  const h=harness();h.panels.dispose();
  const panels=new PlasmaPanels({store,document:{getElementById:h.el},delay:0,plotFactory:h.plotFactory});
  panels.setTime(t);
  assert.equal(h.text('plasma-density-rbspb'),'1750');
  assert.equal(h.text('plasma-ratio-rbspb'),'4.83');
  assert.equal(h.text('plasma-anisotropy-rbspb'),'1.84');
  assert.equal(h.text('plasma-beta-rbspb'),'2.02e-5');
  assert.match(h.text('plasma-density-note-rbspb'),/11:59:58\.799999936 UTC \(-1\.200 s from selection\)/);
  assert.match(h.text('plasma-beta-note-rbspb'),/11:59:55\.160 UTC \(-4\.840 s from selection\)/);
  assert.match(h.text('plasma-beta-note-rbspb'),/11:59:55\.829385.*UTC \(\+0\.669 s from HOPE\)/);
  assert.match(h.el('plasma-source-moments-rbspb').title,/RBSPB_REL04_ECT-HOPE-MOM-L3@1/);
  for(const key of keys) assert.equal(h.text(`plasma-${key}-rbspa`),'—');
  assert.match(h.text('plasma-density-note-rbspa'),/gap/i);
  assert.match(h.text('plasma-anisotropy-note-rbspa'),/fill/i);
  for(const key of keys) {
    const plot=h.plots.get(key);
    assert.equal(plot.data.start,dayOf(t));assert.equal(plot.data.end,dayOf(t)+DAY);
    assert.ok(plot.data.series.rbspb.length>1000,'The plot receives native samples instead of resampled minute values');
    const selected=plot.data.select('rbspb',t);
    assert.equal(formatPlasmaValue(selected.value,key),h.text(`plasma-${key}-rbspb`),'Plot hover uses the same native-source lookup as the readout');
  }
  const dataRefs=[...h.plots.values()].map(plot=>plot.data);
  panels.setTime(t+1000);
  assert.deepEqual([...h.plots.values()].map(plot=>plot.data),dataRefs,'Playback only moves plot cursors');
  panels.dispose();
  assert.ok([...h.plots.values()].every(plot=>plot.disposed));
});


test('Four plots share daily UTC axes, retain native rows and dispatch navigation without rebuilding during playback',()=>{
  const h=harness();h.panels.setTime(t);
  assert.match(h.text('plasma-day'),/2015-03-17 · 00:00–24:00 UTC/);
  assert.equal(h.seriesCalls.length,1,'Prepare the day once for all four plots');
  for(const key of keys) {
    const plot=h.plots.get(key);
    assert.equal(plot.options.element,h.el(`plasma-${key}-plot`));
    assert.equal(plot.data.series.rbspb,h.day.plotSeries[key].rbspb,'Original native rows reach the renderer unchanged');
    assert.equal(plot.data.start,dayOf(t));assert.equal(plot.data.end,dayOf(t)+DAY);
    assert.equal(plot.time,t);assert.equal(plot.inputs.length,1);
    assert.equal(plot.data.select('rbspb',t),h.day.selections.rbspb.fields[key]);
  }
  h.panels.setTime(t+22000);
  assert.equal(h.seriesCalls.length,1,'Playback does not rederive daily histories');
  for(const plot of h.plots.values()) {
    assert.equal(plot.inputs.length,1,'Playback does not rebuild daily geometry');
    assert.equal(plot.time,t+22000,'All cursors retain the exact selected second');
  }
  h.plots.get('density').options.onSeek(t+60000);
  h.plots.get('beta').options.onSeek(t+3600000);
  assert.deepEqual(h.seekCalls,[t+60000,t+3600000]);
  h.panels.dispose();assert.ok([...h.plots.values()].every(plot=>plot.disposed));
});

test('Failed products clear only dependent probe histories; midnight and stale loads update plot axes safely',async()=>{
  const h=harness();h.panels.setTime(t);
  const next=sampleDay(t);next.errors.rbspa.density='Density unavailable';next.errors.rbspb.field='Field unavailable';
  h.cache.set(dayOf(t),next);h.panels.setTime(t);
  assert.equal(h.plots.get('density').data.series.rbspa.length,0);
  assert.equal(h.plots.get('ratio').data.series.rbspa.length,0);
  assert.equal(h.plots.get('density').data.errors.rbspa,'Density unavailable');
  assert.equal(h.plots.get('density').data.series.rbspb,next.plotSeries.density.rbspb);
  assert.equal(h.plots.get('anisotropy').data.series.rbspb,next.plotSeries.anisotropy.rbspb);
  assert.equal(h.plots.get('beta').data.series.rbspb.length,0);
  assert.equal(h.plots.get('beta').data.errors.rbspb,'Field unavailable');
  const midnight=dayOf(t)+DAY;
  h.panels.setTime(midnight);
  for(const plot of h.plots.values()) {
    assert.equal(plot.data.start,midnight);assert.equal(plot.data.end,midnight+DAY);
    assert.equal(plot.data.loading,true);assert.equal(plot.data.series.rbspa.length,0);assert.equal(plot.data.series.rbspb.length,0);
  }
  await tick();h.panels.setTime(t);assert.equal(h.requests[0].options.signal.aborted,true);
  const inputs=[...h.plots.values()].map(plot=>plot.inputs.length);
  h.requests[0].resolve(sampleDay(midnight));await tick();
  assert.deepEqual([...h.plots.values()].map(plot=>plot.inputs.length),inputs,'A stale next-day response cannot replace current plots');
  assert.equal(h.plots.get('density').data.start,dayOf(t));
  h.panels.dispose();
});
