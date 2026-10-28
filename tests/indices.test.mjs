import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseIndexData,lookupIndex,GeomagneticStore,indexDataURL} from '../js/indices.js';

const base=new URL('../data/indices/',import.meta.url);
const manifest=JSON.parse((await readFile(new URL('manifest.json',base),'utf8')).replace(/^\uFEFF/,''));
const raw={},series={};
for(const key of ['ae','dst']) {
  const entry=manifest.chunks.find(c=>c.index===key),bytes=await readFile(new URL(entry.file,base));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,'Original NASA response hash matches manifest');
  raw[key]=JSON.parse(bytes);series[key]=parseIndexData(raw[key],key);
}
assert.equal(series.ae.length,4320);
assert.equal(series.dst.length,72);
assert.equal(series.ae[0].t,Date.parse('2015-03-16T00:00Z'));
assert.equal(series.ae[0].value,25);
assert.equal(series.dst[0].t,Date.parse('2015-03-16T00:30Z'));
assert.equal(series.dst[0].value,4);
assert.equal(series.dst[0].start,Date.parse('2015-03-16T00:00Z'));
assert.equal(series.dst[0].end,Date.parse('2015-03-16T01:00Z'));
for(const key of ['ae','dst']) {
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
const wrongTime=structuredClone(raw.dst);wrongTime.data[0][0]='2015-03-16T00:00:00Z';
assert.throws(()=>parseIndexData(wrongTime,'dst'),/timestamp convention/,'Wrong HAPI epoch cannot be silently treated as midpoint');
const wrongUnits=structuredClone(raw.ae);wrongUnits.parameters[1].units='T';
assert.throws(()=>parseIndexData(wrongUnits,'ae'),/units/);
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
assert.equal(local.ae.length,1440);assert.equal(local.dst.length,24);
assert.equal(local.sources.ae.quality.level,'Provisional');assert.equal(local.sources.dst.quality.level,'Final');
assert.equal(local.errors.ae,null);assert.equal(local.sources.dst.kind,'bundled');
assert.equal(store.peekDay(day),local);
const priorRequests=requests;assert.equal(await store.getDay(day+60000),local);assert.equal(requests,priorRequests);
let failures=0;
const failed=new GeomagneticStore({fetchImpl:async()=>{failures++;throw new Error('Network disabled');}});
failed.initialized=true;
const failure=await failed.getDay(day);
assert.ok(failure.errors.ae);assert.ok(failure.errors.dst);assert.equal(failure.ae.length,0);
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
for(const request of pending.slice(2)) request.resolve({ok:true,json:async()=>raw[request.url.includes('DST1800')?'dst':'ae']});
const newResult=await newer;
for(const request of pending.slice(0,2)) request.resolve({ok:true,json:async()=>raw[request.url.includes('DST1800')?'dst':'ae']});
await older;
assert.equal(race.peekDay(day),newResult,'Late older requests cannot overwrite a refreshed day');
assert.equal(new URL(indexDataURL('dst',0,86400000)).searchParams.get('parameters'),'Time,DST1800');
console.log('PASS: authentic AE/Dst fixtures, native epochs, hourly midpoint bins, exact interval boundaries, fill vs absent vs failure, quality provenance, cache/retry and abort.');
