/** Measured Van Allen Probes electron plasma products from NASA CDAWeb HAPI.
 * Source rows, quality flags, and UTC epochs are retained; no temporal interpolation.
 */
import { PROBES } from './ephemeris.js';

export const PLASMA_BASE='https://cdaweb.gsfc.nasa.gov/hapi';
const DAY=86400000,PADDING=30000;
const iso=t=>new Date(t).toISOString().replace('.000Z','Z');
const dayOf=t=>Math.floor(t/DAY)*DAY;
const PROBE_IDS=PROBES.map(p=>p.id);
const PRODUCTS=['density','moments','field'];
export const PLASMA_DEFINITIONS=Object.freeze({
  density:Object.freeze({parameters:'Time,bmag,fce,fpe,wpe_over_wce,density',maxOffsetMs:3500,maxGapMs:7010,
    fields:{bmag:['nT'],fce:['Hz'],fpe:['Hz'],wpe_over_wce:[null],density:['cm**-3','cm^-3','cm!u-3!n']}}),
  moments:Object.freeze({parameters:'Time,Tpar_e_200,Tperp_e_200,Dens_e_200,e_T_flag,e_Tperp_flag,e_Dens_flag',maxOffsetMs:12500,maxGapMs:25000,
    fields:{Tpar_e_200:['eV'],Tperp_e_200:['eV'],Dens_e_200:['cm!u-3!n','cm**-3','cm^-3'],e_T_flag:['(0=OK)'],e_Tperp_flag:['(0=OK)'],e_Dens_flag:['(0=OK)']}}),
  field:Object.freeze({parameters:'Time,Magnitude,calState,magInvalid,magFill',maxOffsetMs:2010,maxGapMs:4010,
    fields:{Magnitude:['nT'],calState:[null],magInvalid:[null],magFill:[null]}})
});
// Bounds pinned to the accompanying HAPI metadata. stopDate is reported to seconds,
// so retain its final second; native-row matching still determines actual availability.
export const PLASMA_AVAILABILITY=Object.freeze({
  rbspa:{density:['2012-09-15T00:00:03Z','2019-10-12T23:50:15Z'],moments:['2012-10-25T00:00:23Z','2019-10-14T13:53:22Z'],field:['2012-08-30T22:54:52Z','2019-10-14T12:30:28Z']},
  rbspb:{density:['2012-09-15T00:00:02Z','2019-07-15T20:16:48Z'],moments:['2012-10-26T00:00:20Z','2019-07-16T16:37:53Z'],field:['2012-09-01T00:00:03Z','2019-07-16T16:35:28Z']}
});
const coverage=(probe,product)=>({start:Date.parse(PLASMA_AVAILABILITY[probe][product][0]),end:Date.parse(PLASMA_AVAILABILITY[probe][product][1])+1000});
const def=product=>{
  if(!Object.hasOwn(PLASMA_DEFINITIONS,product)) throw new Error(`Unknown plasma product: ${product}`);
  return PLASMA_DEFINITIONS[product];
};
export function plasmaDataset(probeId,product) {
  if(!PROBE_IDS.includes(probeId)) throw new Error(`Unknown probe: ${probeId}`);
  def(product);const letter=probeId==='rbspa'?'A':'B';
  return product==='density'?`RBSP-${letter}_DENSITY_EMFISIS-L4`:product==='moments'?`RBSP${letter}_REL04_ECT-HOPE-MOM-L3@1`:`RBSP-${letter}_MAGNETOMETER_4SEC-GSE_EMFISIS-L3`;
}
export function plasmaDataURL(probeId,product,start,end) {
  if(![start,end].every(Number.isFinite)||end<=start) throw new Error('Invalid plasma interval.');
  const params=new URLSearchParams({id:plasmaDataset(probeId,product),parameters:def(product).parameters,
    'time.min':iso(start),'time.max':iso(end),format:'json',include:'header'});
  return `${PLASMA_BASE}/data?${params}`;
}

/** Reject incorrect fields/units and preserve fill/flag rows for conservative selection. */
export function parsePlasma(raw,product) {
  const d=def(product);
  if(raw?.status?.code===1201) return [];
  if(raw?.status?.code!==1200) throw new Error(`HAPI ${raw?.status?.code||'invalid response'}: ${raw?.status?.message||'Unknown error'}`);
  if(!Array.isArray(raw.parameters)||!Array.isArray(raw.data)) throw new Error('Plasma response lacks metadata or records.');
  const indices={},fills={};
  for(const [name,units] of Object.entries({Time:['UTC'],...d.fields})) {
    const i=raw.parameters.findIndex(p=>p.name===name),meta=raw.parameters[i];
    if(i<0) throw new Error(`Missing ${product} parameter ${name}.`);
    if(!units.includes(meta.units)) throw new Error(`Unexpected ${name} units: ${meta.units}.`);
    if(name!=='Time'&&(meta.fill===null||meta.fill===undefined||!Number.isFinite(Number(meta.fill)))) throw new Error(`Missing ${name} fill metadata.`);
    indices[name]=i;fills[name]=Number(meta.fill);
  }
  const byTime=new Map();
  for(const row of raw.data) {
    if(!Array.isArray(row)||row.length!==raw.parameters.length) throw new Error(`Malformed ${product} source row.`);
    const sourceTime=row[indices.Time];
    const wholeMilliseconds=typeof sourceTime==='string'&&/Z$/.test(sourceTime)?Date.parse(sourceTime):NaN;
    const fraction=typeof sourceTime==='string'?sourceTime.match(/\.(\d+)Z$/)?.[1]:null;
    // Preserve sub-millisecond information for offsets; keep the original UTC string verbatim.
    const t=wholeMilliseconds+(fraction?.length>3?Number('0.'+fraction.slice(3)):0);
    if(!Number.isFinite(t)) throw new Error(`Invalid ${product} UTC epoch.`);
    const values={},statuses={};
    for(const name of Object.keys(d.fields)) {
      const value=row[indices[name]],fill=value===fills[name]||value==='NaN';
      const flag=/flag$/.test(name)||['calState','magInvalid','magFill'].includes(name);
      const valid=typeof value==='number'&&Number.isFinite(value)&&!fill&&
        (flag?Number.isInteger(value)&&value>=0:value>0&&(product!=='moments'||value<=1e6));
      values[name]=valid?value:null;statuses[name]=fill?'fill':valid?'valid':'invalid';
    }
    const sample={t,sourceTime,values,statuses};
    const old=byTime.get(t);
    if(old&&JSON.stringify(old)!==JSON.stringify(sample)) throw new Error(`Conflicting ${product} rows at ${sourceTime}.`);
    byTime.set(t,sample);
  }
  return [...byTime.values()].sort((a,b)=>a.t-b.t);
}

/** Match one real source row, including bad rows. Bounds are app policies, not averaging bins. */
export function nearestPlasma(records,time,product) {
  const policy=def(product);
  if(!Array.isArray(records)||!records.length||!Number.isFinite(time)) return {sample:null,status:'missing',note:'No source record near the selected UTC.'};
  let lo=0,hi=records.length;
  while(lo<hi) {const mid=(lo+hi)>>>1;if(records[mid].t<time) lo=mid+1;else hi=mid;}
  if(records[lo]?.t===time) return {sample:records[lo],status:'valid',offsetMs:0,note:'Exact native source epoch.'};
  const before=records[lo-1],after=records[lo];
  if(!before||!after) return {sample:null,status:'gap',note:'No bracketing source records; no extrapolation.'};
  if(after.t-before.t>policy.maxGapMs) return {sample:null,status:'gap',note:'Source gap exceeds the conservative matching limit.'};
  const sample=time-before.t<=after.t-time?before:after,offsetMs=sample.t-time;
  if(Math.abs(offsetMs)>policy.maxOffsetMs) return {sample:null,status:'gap',note:'No native sample within the conservative matching tolerance.'};
  return {sample,status:'valid',offsetMs,note:`Nearest native sample within ${policy.maxOffsetMs/1000} s; no interpolation.`};
}
const emptyField=(status,note,extra={})=>({value:null,status,note,sourceTime:null,offsetMs:null,...extra});
const sampleExtra=(matched)=>({sourceTime:matched.sample?.sourceTime??null,offsetMs:matched.offsetMs??null});
function failedValue(matched,names,flags=[]) {
  const record=matched.sample;
  if(!record) return emptyField(matched.status,matched.note);
  for(const name of [...names,...flags]) {
    if(record.statuses[name]!=='valid') return emptyField(record.statuses[name],`${name}: ${record.statuses[name]} source value.`,sampleExtra(matched));
  }
  const flagged=flags.filter(name=>record.values[name]!==0);
  return flagged.length?emptyField('quality',`Source quality flags reject this sample: ${flagged.map(name=>`${name}=${record.values[name]}`).join(', ')}.`,sampleExtra(matched)):null;
}
function fieldResult(value,matched,note) {
  return Number.isFinite(value)&&value>0?{value,status:'valid',note:`${note} ${matched.note}`,...sampleExtra(matched)}:
    emptyField('invalid','Derived value is nonfinite or nonpositive.',sampleExtra(matched));
}
function sourceInfo(probe,product,chunk={}) {
  const dataset=plasmaDataset(probe,product);
  return {dataset,url:chunk.url||null,kind:chunk.kind||'unavailable',retrievedAt:chunk.retrievedAt||null,
    infoURL:`${PLASMA_BASE}/info?${new URLSearchParams({id:dataset,parameters:def(product).parameters})}`};
}

/** Electron beta uses HOPE's own partial density/temperatures, never total EMFISIS density. */
export function selectPlasma(day,probeId,time) {
  const probe=PROBES.find(p=>p.id===probeId);
  if(!probe) throw new Error(`Unknown probe: ${probeId}`);
  const sources=Object.fromEntries(PRODUCTS.map(key=>[key,day?.sources?.[probeId]?.[key]||sourceInfo(probeId,key)]));
  const fields=Object.fromEntries(['density','ratio','anisotropy','beta'].map(key=>[key,emptyField('missing','No plasma response loaded.')]));
  if(!Number.isFinite(time)||time<probe.startMs||time>probe.operationsEndMs) {
    for(const key of Object.keys(fields)) fields[key]=emptyField('outside','Outside spacecraft mission operations.');
    return {fields,sources};
  }
  const get=(product,target=time)=>{
    const bounds=coverage(probeId,product);
    if(target<bounds.start||target>=bounds.end) return {sample:null,status:'missing',note:'Outside this instrument product’s published coverage.'};
    return day?.errors?.[probeId]?.[product]?
      {sample:null,status:'error',note:`${product} retrieval failed: ${day.errors[probeId][product]}`}:
      nearestPlasma(day?.series?.[probeId]?.[product],target,product);
  };
  const density=get('density');
  fields.density=failedValue(density,['density'])||fieldResult(density.sample.values.density,density,'EMFISIS L4 total electron density inferred from wave spectra. No per-record quality flag supplied.');
  fields.ratio=failedValue(density,['wpe_over_wce'])||fieldResult(density.sample.values.wpe_over_wce,density,'Archived EMFISIS wpe/wce (= fpe/fce); no per-record quality flag supplied.');
  const moments=get('moments'),temperatureNames=['Tpar_e_200','Tperp_e_200'],temperatureFlags=['e_T_flag','e_Tperp_flag'];
  const temperatureFailure=failedValue(moments,temperatureNames,temperatureFlags);
  fields.anisotropy=temperatureFailure||fieldResult(moments.sample.values.Tperp_e_200/moments.sample.values.Tpar_e_200,moments,'HOPE electron Tperp/Tpar, partial moments >=200 eV (apogee mode). Temperature flags = 0.');
  const momentFailure=failedValue(moments,[...temperatureNames,'Dens_e_200'],[...temperatureFlags,'e_Dens_flag']);
  if(momentFailure) fields.beta={...momentFailure,fieldTime:null,fieldOffsetMs:null};
  else {
    const field=get('field',moments.sample.t),fieldFailure=failedValue(field,['Magnitude'],['calState','magInvalid','magFill']);
    if(fieldFailure) fields.beta=emptyField(fieldFailure.status,`Electron beta unavailable: ${fieldFailure.note}`,{
      ...sampleExtra(moments),fieldTime:field.sample?.sourceTime??null,fieldOffsetMs:field.offsetMs??null});
    else {
      const v=moments.sample.values,B=field.sample.values.Magnitude*1e-9;
      const beta=2*(4*Math.PI*1e-7)*(v.Dens_e_200*1e6)*1.602176634e-19*(v.Tpar_e_200+2*v.Tperp_e_200)/(3*B*B);
      fields.beta={...fieldResult(beta,moments,'Scalar electron beta from HOPE partial electron pressure >=200 eV and measured EMFISIS |B|. All temperature/density and magnetic flags = 0.'),
        fieldTime:field.sample.sourceTime,fieldOffsetMs:field.offsetMs};
    }
  }
  return {fields,sources};
}

export class PlasmaStore {
  constructor({fetchImpl=globalThis.fetch?.bind(globalThis),dataBase=new URL('../data/plasma/',import.meta.url)}={}) {
    this.fetch=fetchImpl;this.dataBase=String(dataBase);this.chunks=[];this.cache=new Map();this.generations=new Map();
    this.initialized=false;this.initialization=null;this.warnings=[];this.maxDays=24;
  }
  async _fetchJSON(url,signal) {
    const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
    if(signal?.aborted) abort();else signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>controller.abort(new DOMException('Plasma request timed out after 25 s.','TimeoutError')),25000);
    try {
      const response=await this.fetch(url,{headers:{Accept:'application/json'},signal:controller.signal});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }
  async initialize() {
    if(this.initialized) return {warnings:[...this.warnings]};
    if(this.initialization) return this.initialization;
    this.initialization=(async()=>{
      try {
        const manifest=await this._fetchJSON(new URL('manifest.json',this.dataBase));
        if(manifest.format!=='van-allen-plasma-manifest-v1'||!Array.isArray(manifest.chunks)) throw new Error('Unrecognized plasma manifest.');
        for(const chunk of manifest.chunks) {
          if(!PROBE_IDS.includes(chunk.probe)||!PRODUCTS.includes(chunk.product)) continue;
          const start=Date.parse(chunk.start),end=Date.parse(chunk.end);
          if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||typeof chunk.file!=='string') throw new Error('Invalid plasma chunk.');
          if(chunk.dataset!==plasmaDataset(chunk.probe,chunk.product)) throw new Error('Unexpected bundled plasma dataset.');
          this.chunks.push({...chunk,start,end,kind:'bundled',records:null});
        }
      } catch(error) {this.warnings.push(`Bundled plasma samples unavailable: ${error.message}`);}
      this.initialized=true;return {warnings:[...this.warnings]};
    })();
    return this.initialization;
  }
  peekDay(t) {return this.cache.get(dayOf(t))||null;}
  async _load(probe,product,start,end,signal) {
    const bounds=coverage(probe,product);
    if(end<=bounds.start||start>=bounds.end) return {records:[],source:sourceInfo(probe,product),warning:null};
    const chunk=[...this.chunks].reverse().find(c=>c.probe===probe&&c.product===product&&c.start<=start&&c.end>=end);
    let warning=null;
    if(chunk) {
      try {
        if(!chunk.records) chunk.records=parsePlasma(await this._fetchJSON(new URL(chunk.file,this.dataBase),signal),product);
        return {records:chunk.records.filter(r=>r.t>=start&&r.t<end),source:sourceInfo(probe,product,chunk),warning};
      } catch(error) {if(signal?.aborted) throw error;warning=`Bundled ${probe} ${product} unavailable: ${error.message}`;}
    }
    const url=plasmaDataURL(probe,product,start,end),raw=await this._fetchJSON(url,signal);
    return {records:parsePlasma(raw,product).filter(r=>r.t>=start&&r.t<end),source:sourceInfo(probe,product,{kind:'live',url,retrievedAt:new Date().toISOString()}),warning};
  }
  async getDay(t,{signal,force=false}={}) {
    if(!Number.isFinite(t)) throw new Error('Invalid plasma selection time.');
    if(signal?.aborted) throw new DOMException('Aborted','AbortError');
    const dayStart=dayOf(t),dayEnd=dayStart+DAY;
    if(!force&&this.cache.has(dayStart)) return this.cache.get(dayStart);
    await this.initialize();
    if(signal?.aborted) throw new DOMException('Aborted','AbortError');
    const generation=(this.generations.get(dayStart)||0)+1;this.generations.set(dayStart,generation);
    const result={dayStart,dayEnd,series:{},sources:{},errors:{},warnings:[...this.warnings]};
    const jobs=[];
    for(const probe of PROBE_IDS) {
      result.series[probe]={};result.sources[probe]={};result.errors[probe]={};
      for(const product of PRODUCTS) {
        result.series[probe][product]=[];result.sources[probe][product]=sourceInfo(probe,product);result.errors[probe][product]=null;
        jobs.push({probe,product});
      }
    }
    const outcomes=await Promise.allSettled(jobs.map(({probe,product})=>this._load(probe,product,dayStart-PADDING,dayEnd+PADDING,signal)));
    if(signal?.aborted) throw new DOMException('Aborted','AbortError');
    outcomes.forEach((outcome,i)=>{
      const {probe,product}=jobs[i];
      if(outcome.status==='fulfilled') {
        result.series[probe][product]=outcome.value.records;result.sources[probe][product]=outcome.value.source;
        if(outcome.value.warning) result.warnings.push(outcome.value.warning);
      } else result.errors[probe][product]=outcome.reason?.message||String(outcome.reason);
    });
    if(this.generations.get(dayStart)===generation) {
      this.cache.delete(dayStart);this.cache.set(dayStart,result);
      while(this.cache.size>this.maxDays) {const oldest=this.cache.keys().next().value;this.cache.delete(oldest);this.generations.delete(oldest);}
    }
    return result;
  }
}
