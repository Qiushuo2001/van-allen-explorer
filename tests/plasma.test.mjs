import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PlasmaStore,parsePlasma,nearestPlasma,selectPlasma,plasmaDataset,plasmaDataURL} from '../js/plasma.js';

const MINUTE=60000,DAY=86400000,t=Date.parse('2015-03-17T12:00:00Z'),dayStart=Date.parse('2015-03-17T00:00:00Z');
const base=new URL('../data/plasma/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
const raw={rbspa:{},rbspb:{}};
const localFetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(new URL(url),'utf8'))});
const store=new PlasmaStore({fetchImpl:localFetch});
const day=await store.getDay(t);
for(const probe of ['rbspa','rbspb']) for(const product of ['density','moments','field']) {
  const chunk=manifest.chunks.find(c=>c.probe===probe&&c.product===product&&Date.parse(c.start)<=dayStart-30000&&Date.parse(c.end)>=dayStart+DAY+30000);
  raw[probe][product]=JSON.parse(await readFile(new URL(chunk.file,base),'utf8'));
}
const close=(actual,expected,tolerance=1e-12)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);

test('Bundled plasma data retain NASA response hashes, native fields, and padded day coverage',async()=>{
  assert.equal(manifest.chunks.length,18);
  for(const chunk of manifest.chunks) {
    const bytes=await readFile(new URL(chunk.file,base));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),chunk.sha256);
    const parsed=parsePlasma(JSON.parse(bytes),chunk.product);
    assert.ok(parsed.length>0);
    assert.equal(chunk.dataset,plasmaDataset(chunk.probe,chunk.product));
    assert.equal(Date.parse(chunk.end)-Date.parse(chunk.start),DAY+60000);
  }
  for(const probe of ['rbspa','rbspb']) for(const product of ['density','moments','field']) {
    assert.equal(day.errors[probe][product],null);
    assert.equal(day.sources[probe][product].kind,'bundled');
    assert.ok(day.series[probe][product].every((record,i,list)=>!i||record.t>list[i-1].t));
  }
  assert.equal(day.dayStart,dayStart);assert.equal(day.dayEnd,dayStart+DAY);
});

test('Real noon samples preserve density, archive frequency ratio, anisotropy and partial electron beta',()=>{
  const {fields}=selectPlasma(day,'rbspb',t);
  assert.equal(fields.density.value,1750);assert.equal(fields.ratio.value,4.83);
  assert.equal(fields.density.sourceTime,'2015-03-17T11:59:58.799999936Z');
  close(fields.density.offsetMs,-1200,.001);
  close(fields.anisotropy.value,5352/2906);
  assert.equal(fields.anisotropy.sourceTime,'2015-03-17T11:59:55.160Z');
  assert.equal(fields.anisotropy.offsetMs,-4840);
  close(fields.beta.value,0.000020158029538541452,1e-16);
  assert.equal(fields.beta.sourceTime,fields.anisotropy.sourceTime);
  assert.equal(fields.beta.fieldTime,'2015-03-17T11:59:55.829385000Z');
  close(fields.beta.fieldOffsetMs,669.385,.001);
  assert.match(fields.beta.note,/HOPE partial electron pressure >=200 eV/);
  const withoutTotalDensity=structuredClone(day);
  withoutTotalDensity.series.rbspb.density=[];
  const independent=selectPlasma(withoutTotalDensity,'rbspb',t).fields;
  assert.equal(independent.density.value,null);
  assert.equal(independent.beta.value,fields.beta.value,'Beta must use the matching partial HOPE population, not total EMFISIS density');
  const a=selectPlasma(day,'rbspa',t).fields;
  assert.equal(a.density.value,null);assert.equal(a.density.status,'gap');
  assert.equal(a.ratio.value,null);assert.equal(a.anisotropy.value,null);assert.equal(a.anisotropy.status,'fill');
  assert.equal(a.beta.value,null,'An unavailable A sample does not borrow B values');
});

test('Nearest matching is bounded, bracketed and never skips a bad source row',()=>{
  const source=day.series.rbspb.density;
  const chosen=nearestPlasma(source,t,'density');
  assert.equal(chosen.sample.sourceTime,'2015-03-17T11:59:58.799999936Z');
  const isolated=[chosen.sample];
  assert.equal(nearestPlasma(isolated,t,'density').sample,null,'No extrapolation from an isolated sample');
  assert.equal(nearestPlasma(isolated,chosen.sample.t,'density').sample,chosen.sample,'Exact source epochs remain available');
  const rows=[{t:t-3000},{t:t+5000}];
  assert.equal(nearestPlasma(rows,t,'density').status,'gap','No matching across an 8-second gap');
  const bad=structuredClone(day),record=bad.series.rbspb.density.find(r=>r.t===chosen.sample.t);
  record.values.density=null;record.statuses.density='fill';
  const fields=selectPlasma(bad,'rbspb',t).fields;
  assert.equal(fields.density.status,'fill');assert.equal(fields.density.value,null);
  assert.equal(fields.density.sourceTime,chosen.sample.sourceTime,'A good neighbor cannot replace the closest fill record');
  assert.equal(fields.ratio.value,4.83,'Independent fields retain valid archived values');
});

test('HOPE and EMFISIS quality flags gate their own derived quantities',()=>{
  const matched=nearestPlasma(day.series.rbspb.moments,t,'moments').sample;
  for(const flag of ['e_T_flag','e_Tperp_flag','e_Dens_flag']) {
    const flagged=structuredClone(day);
    flagged.series.rbspb.moments.find(r=>r.t===matched.t).values[flag]=1;
    const fields=selectPlasma(flagged,'rbspb',t).fields;
    assert.equal(fields.beta.status,'quality');assert.equal(fields.beta.value,null);
    assert.equal(fields.anisotropy.value,flag==='e_Dens_flag'?5352/2906:null);
    assert.equal(fields.density.value,1750);
  }
  for(const flag of ['calState','magInvalid','magFill']) {
    const flagged=structuredClone(day),field=nearestPlasma(flagged.series.rbspb.field,matched.t,'field').sample;
    field.values[flag]=1;
    const fields=selectPlasma(flagged,'rbspb',t).fields;
    assert.equal(fields.beta.status,'quality');assert.equal(fields.beta.value,null);
    assert.match(fields.beta.note,new RegExp(flag+'=1'));
    assert.equal(fields.anisotropy.value,5352/2906);
  }
  const gap=structuredClone(day);
  gap.series.rbspb.field=gap.series.rbspb.field.filter(r=>Math.abs(r.t-matched.t)>5000);
  assert.equal(selectPlasma(gap,'rbspb',t).fields.beta.status,'gap');
});

test('Plasma parser rejects wrong parameters, units, bad rows, and preserves explicit fill/invalid states',()=>{
  const wrong=structuredClone(raw.rbspb.moments);wrong.parameters.find(p=>p.name==='Tpar_e_200').units='K';
  assert.throws(()=>parsePlasma(wrong,'moments'),/units/);
  const wrongPopulation=structuredClone(raw.rbspb.moments);wrongPopulation.parameters.find(p=>p.name==='Tpar_e_200').name='Tpar_p_200';
  assert.throws(()=>parsePlasma(wrongPopulation,'moments'),/Tpar_e_200/);
  const fixture=structuredClone(raw.rbspb.moments);fixture.data=fixture.data.slice(0,3);
  const i=fixture.parameters.findIndex(p=>p.name==='Dens_e_200');
  fixture.data[0][i]='NaN';fixture.data[1][i]=null;fixture.data[2][i]=1e9;
  const parsed=parsePlasma(fixture,'moments');
  assert.equal(parsed[0].statuses.Dens_e_200,'fill');assert.equal(parsed[1].statuses.Dens_e_200,'invalid');assert.equal(parsed[2].statuses.Dens_e_200,'invalid');
  const duplicate=structuredClone(raw.rbspb.density);duplicate.data=duplicate.data.slice(0,1);duplicate.data.push([...duplicate.data[0]]);duplicate.data[1][1]+=1;
  assert.throws(()=>parsePlasma(duplicate,'density'),/Conflicting/);
  assert.deepEqual(parsePlasma({status:{code:1201}},'field'),[]);
});

test('Independent retrieval failures clear only affected values; mission ends remain unavailable',()=>{
  const failed=structuredClone(day);failed.errors.rbspb.field='Network disabled';
  let fields=selectPlasma(failed,'rbspb',t).fields;
  assert.equal(fields.beta.status,'error');assert.equal(fields.beta.value,null);
  assert.equal(fields.density.value,1750);assert.equal(fields.anisotropy.value,5352/2906);
  failed.errors.rbspb.density='No response';
  fields=selectPlasma(failed,'rbspb',t).fields;
  assert.equal(fields.density.status,'error');assert.equal(fields.ratio.status,'error');
  assert.equal(fields.anisotropy.value,5352/2906);
  const ended=selectPlasma(day,'rbspb',Date.parse('2019-07-20T00:00Z'));
  assert.ok(Object.values(ended.fields).every(f=>f.value===null&&f.status==='outside'));
});

test('Store caches failures until refresh and generates correctly padded live HAPI queries',async()=>{
  const requests=[];
  const remote=new PlasmaStore({fetchImpl:async url=>{requests.push(String(url));throw new Error('Offline');}});remote.initialized=true;
  const failed=await remote.getDay(t);
  assert.equal(requests.length,6);assert.equal(failed.errors.rbspa.field,'Offline');
  await remote.getDay(t+MINUTE);assert.equal(requests.length,6);
  await remote.getDay(t,{force:true});assert.equal(requests.length,12);
  const url=new URL(requests.find(s=>s.includes('RBSPB_REL04')));
  assert.equal(url.searchParams.get('id'),'RBSPB_REL04_ECT-HOPE-MOM-L3@1');
  assert.equal(url.searchParams.get('time.min'),'2015-03-16T23:59:30Z');assert.equal(url.searchParams.get('time.max'),'2015-03-18T00:00:30Z');
  assert.equal(new URL(plasmaDataURL('rbspa','density',0,MINUTE)).searchParams.get('parameters'),'Time,bmag,fce,fpe,wpe_over_wce,density');
});

test('Aborted and superseded plasma retrievals cannot replace a newer cached day',async()=>{
  const pending=[];
  const remote=new PlasmaStore({fetchImpl:(url,{signal})=>new Promise((resolve,reject)=>{
    pending.push({url:String(url),resolve});signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  })});remote.initialized=true;
  const older=remote.getDay(t);await Promise.resolve();const newer=remote.getDay(t,{force:true});await Promise.resolve();
  const complete=job=>{
    const id=new URL(job.url).searchParams.get('id'),probe=id.includes('RBSP-A')||id.includes('RBSPA_')?'rbspa':'rbspb';
    const product=id.includes('DENSITY')?'density':id.includes('HOPE')?'moments':'field';
    job.resolve({ok:true,json:async()=>raw[probe][product]});
  };
  assert.equal(pending.length,12);pending.slice(6).forEach(complete);const fresh=await newer;pending.slice(0,6).forEach(complete);await older;
  assert.equal(remote.peekDay(t),fresh);
  const controller=new AbortController();const canceled=remote.getDay(t+DAY,{signal:controller.signal});await Promise.resolve();controller.abort();
  await assert.rejects(canceled,{name:'AbortError'});assert.equal(remote.peekDay(t+DAY),null);
});


test('Published source coverage and successful no-data responses are missing data, not retrieval failures',async()=>{
  let requests=0;
  const empty=new PlasmaStore({fetchImpl:async()=>{requests++;return {ok:true,json:async()=>({status:{code:1201,message:'No data'}})};}});empty.initialized=true;
  const response=await empty.getDay(t);
  assert.equal(requests,6);
  assert.ok(Object.values(selectPlasma(response,'rbspb',t).fields).every(f=>f.value===null&&f.status==='missing'));
  const early=await empty.getDay(Date.parse('2012-08-30T12:00:00Z'));
  assert.equal(requests,7,'Only A magnetometer has published coverage on this date');
  assert.equal(early.errors.rbspb.field,null);
  const earlyFields=selectPlasma(early,'rbspa',Date.parse('2012-08-30T12:00:00Z')).fields;
  assert.equal(earlyFields.density.status,'missing');assert.match(earlyFields.density.note,/published coverage/);
  const late=await empty.getDay(Date.parse('2019-10-16T12:00:00Z'));
  assert.equal(requests,7,'No network request beyond all instrument products’ published coverage');
  assert.equal(late.errors.rbspa.density,null);
  assert.ok(Object.values(selectPlasma(late,'rbspa',Date.parse('2019-10-16T12:00:00Z')).fields).every(f=>f.value===null&&f.status==='missing'));
});
