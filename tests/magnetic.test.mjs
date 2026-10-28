import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {MagneticStore,parseMagnetic,magneticRequest,MAGNETIC_URL} from '../js/magnetic.js';
import {unwrapSSC,EARTH_RADIUS_KM,PROBES,sampleAt} from '../js/ephemeris.js';

const DAY=86400000,t=Date.parse('2015-03-17T12:00:00Z');
const read=async file=>JSON.parse(await readFile(new URL('../data/magnetic/'+file,import.meta.url),'utf8'));
const manifest=await read('manifest.json'),raw=await read('ssc-magnetic-20150317.json');
const source=unwrapSSC(raw).Result,series=parseMagnetic(raw);
const noData={StatusCode:'SUCCESS',StatusSubCode:'NO_DATA',Data:[]};
const localFetch=async url=>({ok:true,json:()=>read(String(url).split('/').at(-1))});

test('Magnetic fixtures retain source hashes and NASA centered-dipole relations',async()=>{
  for(const chunk of manifest.chunks) {
    const bytes=await readFile(new URL('../data/magnetic/'+chunk.file,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),chunk.sha256);
    const original=unwrapSSC(JSON.parse(bytes)).Result,parsed=parseMagnetic(JSON.parse(bytes));
    for(const p of PROBES) {
      assert.equal(parsed[p.id].length,1441);
      const sat=original.Data.find(s=>s.Id===p.id),sm=sat.Coordinates.find(c=>c.CoordinateSystem==='SM');
      for(const i of [0,360,720,1080,1440]) {
        const s=parsed[p.id][i];
        assert.equal(s.t,Date.parse(sat.Time[i]));
        assert.equal(s.l,sat.DipoleLValue[i]);
        assert.equal(s.mlt,sm.LocalTime[i]);assert.equal(s.mlat,sm.Latitude[i]);
        const dipoleRelation=(sat.RadialLength[i]/EARTH_RADIUS_KM)/Math.cos(s.mlat*Math.PI/180)**2;
        assert.ok(Math.abs(s.l-dipoleRelation)<1e-6,'NASA dipole L is distinct from radial distance and consistent with SM latitude');
      }
    }
  }
});

test('Known magnetic values are original NASA samples, with exact UTC lookup',()=>{
  const a=sampleAt(series.rbspa,t).sample,b=sampleAt(series.rbspb,t).sample;
  assert.deepEqual(a,{t,l:5.436705026485413,mlt:23.375833333333333,mlat:-11.212715});
  assert.deepEqual(b,{t,l:2.4408671501607464,mlt:16.869444444444444,mlat:-13.869411});
  assert.equal(sampleAt(series.rbspa,t+22000).exact,false);
  const gap=series.rbspa.filter(s=>s.t!==t);
  assert.equal(sampleAt(gap,t).reason,'gap');
});

test('Invalid fields stay missing; wrong frames, misaligned arrays and conflicts are rejected',()=>{
  const broken=structuredClone(source),sat=broken.Data[0],sm=sat.Coordinates[0];
  sat.DipoleLValue[0]=null;sm.LocalTime[0]=1e31;sm.Latitude[0]='12';
  const row=parseMagnetic(broken).rbspa[0];
  assert.deepEqual([row.l,row.mlt,row.mlat],[null,null,null]);
  sm.LocalTime[0]=24;assert.equal(parseMagnetic(broken).rbspa[0].mlt,0,'24 h wraps to magnetic midnight');
  delete sat.DipoleLValue;assert.equal(parseMagnetic(broken).rbspa[20].l,null);
  sm.CoordinateSystem='GSM';assert.throws(()=>parseMagnetic(broken),/Missing SM/);
  sm.CoordinateSystem='SM';sm.Latitude.pop();assert.throws(()=>parseMagnetic(broken),/Misaligned/);
  const duplicate=structuredClone(source);duplicate.Data[0].Time[1]=duplicate.Data[0].Time[0];
  assert.throws(()=>parseMagnetic(duplicate),/Conflicting/);
});

test('No-data and post-operation data cannot invent magnetic coordinates',()=>{
  assert.deepEqual(parseMagnetic(noData),{rbspa:[],rbspb:[]});
  const invalid=structuredClone(source);
  invalid.Data[0].Id='rbspapred';
  invalid.Data[1].Time=invalid.Data[1].Time.map(()=> '2019-08-01T00:00:00Z');
  assert.deepEqual(parseMagnetic(invalid),{rbspa:[],rbspb:[]});
  assert.throws(()=>parseMagnetic({StatusCode:'ERROR'}),/Invalid/);
});

test('Bundled daily loading and request schema use explicit magnetic fields',async()=>{
  const store=new MagneticStore({fetchImpl:localFetch});
  const day=await store.getDay(t);
  assert.equal(day.source.kind,'bundled');assert.equal(day.error,null);
  assert.equal(day.series.rbspa.find(s=>s.t===t).l,5.436705026485413);
  assert.equal(await store.getDay(t),day);
  const xml=magneticRequest(t,t+DAY);
  for(const part of ['<CoordinateSystem>Sm</CoordinateSystem>','<Component>Lat</Component>','<Component>Local_Time</Component>','<DipoleLValue>true</DipoleLValue>','<ResolutionFactor>1</ResolutionFactor>']) assert.ok(xml.includes(part));
  assert.ok(!xml.includes('rbspapred'));
  assert.throws(()=>magneticRequest(t,t+2*DAY));
});

test('Live POST and failed retrieval are explicit, cached, and refreshable',async()=>{
  let fail=true,calls=[];
  const store=new MagneticStore({fetchImpl:async(url,options)=>{
    if(String(url).endsWith('manifest.json')) return {ok:true,json:async()=>({format:manifest.format,chunks:[]})};
    calls.push({url,options});
    if(fail) throw new Error('NASA unreachable');
    return {ok:true,json:async()=>raw};
  }});
  const missing=await store.getDay(t);
  assert.match(missing.error,/unreachable/);assert.deepEqual(missing.series,{rbspa:[],rbspb:[]});
  await store.getDay(t);assert.equal(calls.length,1);
  fail=false;const refreshed=await store.getDay(t,{force:true});
  assert.equal(refreshed.error,null);assert.equal(refreshed.source.kind,'live');
  assert.equal(calls[1].url,MAGNETIC_URL);assert.equal(calls[1].options.method,'POST');
  assert.equal(calls[1].options.headers['Content-Type'],'application/xml');
  assert.match(calls[1].options.body,/2015-03-17T00:00:00/);
});

test('Aborted retrieval cannot overwrite the magnetic cache',async()=>{
  let complete;
  const store=new MagneticStore({fetchImpl:async url=>{
    if(String(url).endsWith('manifest.json')) return {ok:true,json:async()=>({format:manifest.format,chunks:[]})};
    return new Promise(resolve=>{complete=()=>resolve({ok:true,json:async()=>raw});});
  }});
  await store.initialize();
  const controller=new AbortController(),pending=store.getDay(t,{signal:controller.signal});
  while(!complete) await new Promise(resolve=>setTimeout(resolve,0));
  controller.abort();complete();
  await assert.rejects(pending,/Aborted|aborted/);assert.equal(store.peekDay(t),null);
});
