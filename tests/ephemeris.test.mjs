import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseLocations,unwrapSSC,sampleAt,splitSegments,EARTH_RADIUS_KM,EphemerisStore,PROBES} from '../js/ephemeris.js';

const fixture=await readFile(new URL('../data/ssc-20150316-20150319.json',import.meta.url));
const raw=JSON.parse(fixture);
const manifest=JSON.parse((await readFile(new URL('../data/manifest.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
assert.equal(createHash('sha256').update(fixture).digest('hex'),manifest.chunks.find(c=>c.file==='ssc-20150316-20150319.json').sha256,'Raw downloaded fixture has not changed');
const result=unwrapSSC(raw).Result;
const gse=parseLocations(raw,'GSE'),gsm=parseLocations(raw,'GSM'),geo=parseLocations(raw,'GEO');
for(const {id} of PROBES) {
  assert.equal(gse[id].length,4321);
  assert.equal(gse[id][0].t,Date.parse('2015-03-16T00:00Z'));
  assert.equal(gse[id].at(-1).t,Date.parse('2015-03-19T00:00Z'));
  const source=result.Data.find(s=>s.Id===id), coordinates=source.Coordinates.find(c=>c.CoordinateSystem==='GSE');
  for(const i of [0,720,2000,4320]) {
    assert.equal(gse[id][i].x,coordinates.X[i]/EARTH_RADIUS_KM);
    assert.equal(gse[id][i].y,coordinates.Y[i]/EARTH_RADIUS_KM);
    assert.equal(gse[id][i].z,coordinates.Z[i]/EARTH_RADIUS_KM);
    // SSC frame outputs contain finite numerical transform precision (~6.5e-8 R_E here).
    assert.ok(Math.abs(gse[id][i].r-gsm[id][i].r)<1e-6,'Rotation preserves radius to 6.4 m');
    assert.ok(Math.abs(gse[id][i].r-geo[id][i].r)<1e-6,'Rotation preserves radius to 6.4 m');
  }
}
const t=gse.rbspa[100].t;
assert.equal(sampleAt(gse.rbspa,t).sample,gse.rbspa[100]);
assert.equal(sampleAt(gse.rbspa,t).exact,true);
assert.equal(sampleAt(gse.rbspa,t+20000).offsetMs,-20000);
assert.equal(sampleAt(gse.rbspa,t+40000).offsetMs,20000);
assert.equal(sampleAt(gse.rbspa,gse.rbspa[0].t-1).sample,null);
assert.equal(sampleAt(gse.rbspa,gse.rbspa.at(-1).t+1).sample,null);
const gap=[...gse.rbspa.slice(0,101),...gse.rbspa.slice(102)];
assert.equal(sampleAt(gap,t+20000).reason,'gap');
assert.equal(splitSegments(gap).length,2);
const broken=structuredClone(result);
broken.Data[0].Coordinates.find(c=>c.CoordinateSystem==='GSE').X[100]=null;
assert.equal(parseLocations(broken,'GSE').rbspa.length,4320,'Null does not become zero');
const malformed=structuredClone(result);
malformed.Data[0].Coordinates[0].X.pop();
assert.throws(()=>parseLocations(malformed,'GEO'),/Misaligned/);
const wrongFrame=parseLocations(raw,'GSE');
assert.notEqual(wrongFrame.rbspa[0].y,geo.rbspa[0].y,'Frames are selected, not merely relabeled');
assert.throws(()=>parseLocations(raw,'UNSUPPORTED'),/Unsupported/);
assert.deepEqual(parseLocations({StatusCode:'ERROR',StatusSubCode:'NO_DATA_FOUND'},'GSE'),{rbspa:[],rbspb:[]});
// A failed live request outside fixture cannot reuse or extrapolate the fixture.
const offline=new EphemerisStore({fetchImpl:async()=>{throw new Error('Network disabled for test');}});
offline.initialized=true;
offline.importBundle(raw,{name:'fixture'});
const cached=await offline.loadRange(Date.parse('2015-03-17'),Date.parse('2015-03-18'),'GSE');
assert.equal(cached.series.rbspa.length,1441);
assert.equal(cached.provenance.sources[0].kind,'imported');
assert.equal(cached.provenance.errors.length,0);
const absent=await offline.loadRange(Date.parse('2015-03-20'),Date.parse('2015-03-20T01:00Z'),'GSE');
assert.equal(absent.series.rbspa.length,0);
assert.equal(absent.provenance.partial,true);
assert.ok(absent.provenance.errors.length>0);
const onlyA=structuredClone(result);
onlyA.Data=onlyA.Data.filter(s=>s.Id==='rbspa');
const incomplete=new EphemerisStore({fetchImpl:async()=>{throw new Error('Network disabled for test');}});
incomplete.initialized=true;
incomplete.importBundle(onlyA);
const partial=await incomplete.loadRange(Date.parse('2015-03-17'),Date.parse('2015-03-17T01:00Z'),'GSE');
assert.equal(partial.series.rbspa.length,61);
assert.equal(partial.series.rbspb.length,0);
assert.ok(partial.provenance.errors.length>0,'A-only imports do not claim B coverage or suppress retrieval');
const importedAgain=new EphemerisStore();
importedAgain.initialized=true;
assert.equal(importedAgain.importBundle(offline.exportBundle()).samples,8642,'Export preserves original samples for import');
console.log('PASS: authentic fixture/hash, units, timestamps, frames, radial invariance, gaps, nulls, malformed data, sample selection, and offline coverage.');
