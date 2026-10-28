import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseIndexData,lookupIndex,GeomagneticStore,indexDataURL} from '../js/indices.js';

const base=new URL('../data/indices/',import.meta.url);
const manifest=JSON.parse((await readFile(new URL('manifest.json',base),'utf8')).replace(/^\uFEFF/,''));
const raw={},series={};
for(const key of ['ae','symh']) {
  const entry=manifest.chunks.find(c=>c.index===key),bytes=await readFile(new URL(entry.file,base));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,'Original NASA response hash matches manifest');
  raw[key]=JSON.parse(bytes);series[key]=parseIndexData(raw[key],key);
}
assert.equal(series.ae.length,4320);
assert.equal(series.symh.length,4320);
assert.equal(series.ae[0].t,Date.parse('2015-03-16T00:00Z'));
assert.equal(series.ae[0].value,25);
assert.equal(series.symh[0].t,Date.parse('2015-03-16T00:00Z'));
assert.equal(series.symh[0].value,10);
assert.equal(series.symh[0].start,Date.parse('2015-03-16T00:00Z'));
assert.equal(series.symh[0].end,Date.parse('2015-03-16T00:01Z'));
// Actual consecutive storm-day samples must stay distinct, even within one hour.
const noon=Date.parse('2015-03-17T12:00Z');
assert.equal(lookupIndex(series.symh,noon).sample.value,-47);
assert.equal(lookupIndex(series.symh,noon+59999).sample.value,-47);
assert.equal(lookupIndex(series.symh,noon+60000).sample.value,-46);
assert.equal(lookupIndex(series.symh,Date.parse('2015-03-17T12:59:59Z')).sample.value,-79);
assert.equal(lookupIndex(series.symh,Date.parse('2015-03-17T13:00Z')).sample.value,-80);
for(const key of ['ae','symh']) {
  for(const i of [0,10,series[key].length-1]) {
    assert.equal(series[key][i].sourceTime,raw[key].data[i][0]);
    assert.equal(series[key][i].value,raw[key].data[i][1]);
  }
  const first=series[key][0];
  assert.equal(lookupIndex(series[key],first.start).sample,first);
  assert.equal(lookupIndex(series[key],first.end-1).sample,first);
  assert.equal(lookupIndex(series[key],first.end).sample,series[key][1]);
  assert.equal(lookupIndex(series[key],first.start-1).status,'missing');
  assert.equal(lookupIndex(series[key],series[key].at(-1).end).status,'missing');
  const gap=[...series[key].slice(0,1),...series[key].slice(2)];
  assert.equal(lookupIndex(gap,first.end).status,'missing','No carrying values across absent records');
  const fill=structuredClone(raw[key]);fill.data[1][1]=99999;
  const fillSeries=parseIndexData(fill,key);
  assert.equal(lookupIndex(fillSeries,fillSeries[1].start).status,'fill');
  assert.equal(fillSeries[1].value,null);
  const nullValue=structuredClone(raw[key]);nullValue.data[1][1]=null;
  assert.equal(parseIndexData(nullValue,key)[1].status,'invalid','Null must not become zero');
}
const wrongTime=structuredClone(raw.symh);wrongTime.data[0][0]='2015-03-16T00:00:30Z';
assert.throws(()=>parseIndexData(wrongTime,'symh'),/timestamp convention/,'Non-minute HAPI epochs cannot silently become minute bins');
const wrongUnits=structuredClone(raw.ae);wrongUnits.parameters[1].units='T';
assert.throws(()=>parseIndexData(wrongUnits,'ae'),/units/);
const oldParameter=structuredClone(raw.symh);oldParameter.parameters[1].name='DST1800';
assert.throws(()=>parseIndexData(oldParameter,'symh'),/SYM_H/,'Hourly Dst must never be relabeled as SYM-H');
assert.deepEqual(parseIndexData({status:{code:1201,message:'No data'}},'ae'),[]);
assert.throws(()=>parseIndexData({status:{code:1400,message:'Bad request'}},'ae'),/1400/);
const day=Date.parse('2015-03-17T12:34:56Z');
let requests=0;
const store=new GeomagneticStore({fetchImpl:async url=>{
  requests++;
  const filename=String(url).split('/').at(-1);
  const text=await readFile(new URL(filename,base),'utf8');
  return {ok:true,json:async()=>JSON.parse(text.replace(/^\uFEFF/,''))};
}});
await store.initialize();
const local=await store.getDay(day);
assert.equal(local.ae.length,1440);assert.equal(local.symh.length,1440);
assert.equal(local.sources.ae.quality.level,'Provisional');assert.equal(local.sources.symh.quality.level,'Provisional');
assert.equal(local.errors.ae,null);assert.equal(local.sources.symh.kind,'bundled');
assert.equal(local.sources.symh.dataset,'OMNI_HRO_1MIN');
assert.equal(local.sources.symh.parameter,'SYM_H');
assert.equal(local.sources.symh.cadenceMs,60000);
assert.equal(local.sources.symh.epochConvention,'minute-start');
assert.equal(store.peekDay(day),local);
const priorRequests=requests;assert.equal(await store.getDay(day+60000),local);assert.equal(requests,priorRequests);
// A user's old downloaded manifest may still list Dst before supported chunks.
const legacyManifest=structuredClone(manifest);
legacyManifest.chunks.unshift({index:'dst',file:'retired-hourly-data.json'});
const migrated=new GeomagneticStore({fetchImpl:async url=>{
  const filename=String(url).split('/').at(-1);
  if(filename==='manifest.json') return {ok:true,json:async()=>legacyManifest};
  assert.notEqual(filename,'retired-hourly-data.json','Retired Dst is never fetched');
  const text=await readFile(new URL(filename,base),'utf8');
  return {ok:true,json:async()=>JSON.parse(text.replace(/^\uFEFF/,''))};
}});
const migratedDay=await migrated.getDay(day);
assert.equal(migratedDay.warnings.length,0);
assert.equal(migratedDay.ae.length,1440);
assert.equal(migratedDay.symh.length,1440);
assert.equal(migratedDay.sources.symh.kind,'bundled');
let failures=0;
const failed=new GeomagneticStore({fetchImpl:async()=>{failures++;throw new Error('Network disabled');}});
failed.initialized=true;
const failure=await failed.getDay(day);
assert.ok(failure.errors.ae);assert.ok(failure.errors.symh);assert.equal(failure.ae.length,0);
await failed.getDay(day);assert.equal(failures,2,'Failure is cached until explicit retry');
await failed.getDay(day,{force:true});assert.equal(failures,4);
const noData=new GeomagneticStore({fetchImpl:async()=>({ok:true,json:async()=>({status:{code:1201,message:'No data'}})})});
noData.initialized=true;
const none=await noData.getDay(day);assert.equal(none.errors.ae,null);assert.equal(none.ae.length,0);
const aborted=new AbortController();aborted.abort();
await assert.rejects(()=>store.getDay(day,{signal:aborted.signal}),{name:'AbortError'});
const pending=[];
const race=new GeomagneticStore({fetchImpl:url=>new Promise(resolve=>pending.push({url:String(url),resolve}))});
race.initialized=true;
const older=race.getDay(day);await Promise.resolve();
const newer=race.getDay(day,{force:true});await Promise.resolve();
assert.equal(pending.length,4);
for(const request of pending.slice(2)) request.resolve({ok:true,json:async()=>raw[request.url.includes('SYM_H')?'symh':'ae']});
const newResult=await newer;
for(const request of pending.slice(0,2)) request.resolve({ok:true,json:async()=>raw[request.url.includes('SYM_H')?'symh':'ae']});
await older;
assert.equal(race.peekDay(day),newResult,'Late older requests cannot overwrite a refreshed day');
assert.equal(new URL(indexDataURL('symh',0,86400000)).searchParams.get('parameters'),'Time,SYM_H');
console.log('PASS: authentic AE/SYM-H fixtures, native epochs, native minute bins, exact interval boundaries, fill vs absent vs failure, quality provenance, cache/retry and abort.');
