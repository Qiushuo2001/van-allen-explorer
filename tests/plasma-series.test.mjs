import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PlasmaStore,nearestPlasma,selectPlasma} from '../js/plasma.js';
import {buildPlasmaSeries,PLASMA_SERIES_DEFINITIONS} from '../js/plasma-series.js';

const DAY=86400000,time=Date.parse('2015-03-17T12:00:00Z');
const store=new PlasmaStore({fetchImpl:async url=>({ok:true,json:async()=>JSON.parse(await readFile(new URL(url),'utf8'))})});
const day=await store.getDay(time);
const history=buildPlasmaSeries(day);
const find=(series,sourceTime)=>series.find(record=>record.sourceTime===sourceTime);

test('Plasma history retains every native source epoch, quality state, and day-edge padding',()=>{
  for(const probe of ['rbspa','rbspb']) for(const [key,definition] of Object.entries(PLASMA_SERIES_DEFINITIONS)) {
    const original=day.series[probe][definition.product],series=history[key][probe];
    assert.equal(series.length,original.length,'No native measurements are downsampled or duplicated');
    assert.deepEqual(series.map(record=>record.t),original.map(record=>record.t));
    assert.deepEqual(series.map(record=>record.sourceTime),original.map(record=>record.sourceTime));
    assert.ok(series.every((record,i)=>record.offsetMs===0&&(!i||record.t>series[i-1].t)));
    assert.deepEqual(series.filter(record=>record.t<day.dayStart||record.t>=day.dayEnd).map(record=>record.t),
      original.filter(record=>record.t<day.dayStart||record.t>=day.dayEnd).map(record=>record.t),'All available padding is retained; source gaps are not filled');
    assert.ok(series.some(record=>record.t%60000!==0),'Epochs are not snapped to ephemeris minutes');
  }
  assert.equal(buildPlasmaSeries(day),history,'Playback must reuse prepared series for an unchanged day');
});

test('Actual density, native ratio and derived HOPE quantities agree with the selected-value path',()=>{
  const density=find(history.density.rbspb,'2015-03-17T11:59:58.799999936Z');
  const ratio=find(history.ratio.rbspb,density.sourceTime);
  const anisotropy=find(history.anisotropy.rbspb,'2015-03-17T11:59:55.160Z');
  const beta=find(history.beta.rbspb,anisotropy.sourceTime);
  assert.equal(density.value,1750);assert.equal(ratio.value,4.83);
  assert.equal(anisotropy.value,5352/2906);
  assert.ok(Math.abs(beta.value-0.000020158029538541452)<1e-16);
  assert.equal(beta.fieldTime,'2015-03-17T11:59:55.829385000Z');
  assert.ok(Math.abs(beta.fieldOffsetMs-669.385)<.001);
  for(const probe of ['rbspa','rbspb']) for(const key of Object.keys(history)) {
    const records=history[key][probe];
    for(const record of [records[0],records[Math.floor(records.length/2)],records.at(-1)]) {
      const expected=selectPlasma(day,probe,record.t).fields[key];
      assert.equal(record.value,expected.value);assert.equal(record.status,expected.status);
    }
  }
});

test('Fill, bad quality and absent native rows stay available to distinguish line breaks from valid data',()=>{
  const missing=structuredClone(day);
  const target=nearestPlasma(missing.series.rbspb.moments,time,'moments').sample;
  target.values.e_T_flag=1;
  const density=nearestPlasma(missing.series.rbspb.density,time,'density').sample;
  density.values.density=null;density.statuses.density='fill';
  const priorDensityCount=missing.series.rbspb.density.length;
  const removed=missing.series.rbspb.density.splice(25,1)[0];
  const series=buildPlasmaSeries(missing);
  assert.equal(series.density.rbspb.length,priorDensityCount-1,'Absent rows are not replaced by estimated samples');
  assert.ok(!series.density.rbspb.some(record=>record.t===removed.t));
  assert.equal(find(series.density.rbspb,density.sourceTime).status,'fill');
  assert.equal(find(series.density.rbspb,density.sourceTime).value,null);
  assert.equal(find(series.ratio.rbspb,density.sourceTime).value,4.83,'An independent valid field survives');
  for(const key of ['anisotropy','beta']) {
    const record=find(series[key].rbspb,target.sourceTime);
    assert.equal(record.status,'quality');assert.equal(record.value,null);
  }
  assert.ok(series.anisotropy.rbspa.some(record=>record.status==='fill'),'Genuine Probe A HOPE fill rows are retained');
  const aDensity=series.density.rbspa;
  assert.ok(aDensity.some((record,i)=>i&&record.t-aDensity[i-1].t>PLASMA_SERIES_DEFINITIONS.density.maxGapMs),'The real density gap stays an actual epoch separation');
});

test('Magnetic-field gaps and flags reject beta at the original HOPE epoch without changing anisotropy',()=>{
  const flagged=structuredClone(day),moment=nearestPlasma(flagged.series.rbspb.moments,time,'moments').sample;
  const field=nearestPlasma(flagged.series.rbspb.field,moment.t,'field').sample;
  field.values.magInvalid=1;
  const series=buildPlasmaSeries(flagged),beta=find(series.beta.rbspb,moment.sourceTime);
  assert.equal(beta.status,'quality');assert.equal(beta.value,null);assert.equal(beta.t,moment.t);
  assert.equal(beta.fieldTime,field.sourceTime);
  assert.equal(find(series.anisotropy.rbspb,moment.sourceTime).value,5352/2906);
  const gap=structuredClone(day);
  gap.series.rbspb.field=gap.series.rbspb.field.filter(record=>Math.abs(record.t-moment.t)>5000);
  assert.equal(find(buildPlasmaSeries(gap).beta.rbspb,moment.sourceTime).status,'gap');
});

test('Product failures remove only affected histories; refreshed and adjacent days produce separate cached series',async()=>{
  const failed=structuredClone(day);failed.errors.rbspa.density='HTTP 503';failed.errors.rbspb.field='HTTP 503';
  const series=buildPlasmaSeries(failed);
  assert.equal(series.density.rbspa.length,0);assert.equal(series.ratio.rbspa.length,0);
  assert.ok(series.anisotropy.rbspa.length>0);
  assert.equal(series.beta.rbspb.length,0);assert.ok(series.anisotropy.rbspb.length>0);assert.ok(series.density.rbspb.length>0);
  const fresh=buildPlasmaSeries(structuredClone(day));assert.notEqual(fresh,history);assert.deepEqual(fresh,history);
  const nextDay=await store.getDay(time+DAY),next=buildPlasmaSeries(nextDay);
  assert.notEqual(next,history);
  for(const probe of ['rbspa','rbspb']) for(const key of Object.keys(history)) {
    assert.ok(next[key][probe].every(record=>record.t>=nextDay.dayStart-30000&&record.t<nextDay.dayEnd+30000));
    const overlap=history[key][probe].filter(record=>record.t>=nextDay.dayStart-30000);
    for(const original of overlap) {
      const duplicate=next[key][probe].find(record=>record.t===original.t);
      assert.ok(duplicate);assert.equal(duplicate.value,original.value);assert.equal(duplicate.status,original.status);
    }
  }
});
