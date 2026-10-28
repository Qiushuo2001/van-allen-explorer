/** Real ground-derived geomagnetic indices distributed by NASA OMNI/CDAWeb HAPI.
 * Native epoch is retained separately from each index's documented averaging bin.
 * This module does not interpolate, find a nearest value, or fill a missing record.
 */
export const HAPI_BASE='https://cdaweb.gsfc.nasa.gov/hapi';
const DAY=86400000;
export const INDEX_DEFINITIONS=Object.freeze({
  ae:Object.freeze({name:'AE',dataset:'OMNI_HRO_1MIN',parameter:'AE_INDEX',units:'nT',
    cadenceMs:60000,epochOffsetMs:0,epochConvention:'minute-start',fill:99999,
    qualityLevel:'Provisional',qualityStart:Date.parse('1990-01-01T00:00Z'),qualityEnd:Date.parse('2021-01-01T00:00Z'),
    qualityURL:'https://omniweb.gsfc.nasa.gov/html/omni_min_data.html',
    timeURL:'https://cdaweb.gsfc.nasa.gov/misc/NotesO.html#OMNI_HRO_1MIN'}),
  symh:Object.freeze({name:'SYM-H',dataset:'OMNI_HRO_1MIN',parameter:'SYM_H',units:'nT',
    cadenceMs:60000,epochOffsetMs:0,epochConvention:'minute-start',fill:99999,
    qualityLevel:'Provisional',qualityStart:Date.parse('1981-01-01T00:00Z'),qualityEnd:Date.parse('2026-10-01T00:00Z'),
    qualityURL:'https://omniweb.gsfc.nasa.gov/html/omni_min_data.html',
    timeURL:'https://cdaweb.gsfc.nasa.gov/misc/NotesO.html#OMNI_HRO_1MIN'})
});
const definition=key=>{
  if(!Object.hasOwn(INDEX_DEFINITIONS,key)) throw new Error(`Unknown index: ${key}`);
  return INDEX_DEFINITIONS[key];
};
const dayOf=t=>Math.floor(t/DAY)*DAY;
const iso=t=>new Date(t).toISOString().replace('.000Z','Z');

export function indexDataURL(key,start,end) {
  const d=definition(key);
  const params=new URLSearchParams({id:d.dataset,parameters:`Time,${d.parameter}`,
    'time.min':iso(start),'time.max':iso(end),format:'json',include:'header'});
  return `${HAPI_BASE}/data?${params}`;
}

/** Returns records, including explicit fill records with value=null. Throws on wrong
 * parameter, units, malformed rows, or inconsistent native timestamp convention.
 */
export function parseIndexData(raw,key) {
  const d=definition(key);
  if(raw?.status?.code===1201) return []; // HAPI successful query with no data.
  if(raw?.status?.code!==1200) throw new Error(`HAPI ${raw?.status?.code || 'invalid response'}: ${raw?.status?.message || 'Unknown error'}`);
  if(!Array.isArray(raw.parameters)||!Array.isArray(raw.data)) throw new Error('HAPI response lacks parameter metadata or records.');
  const ti=raw.parameters.findIndex(p=>p.name==='Time'),vi=raw.parameters.findIndex(p=>p.name===d.parameter);
  if(ti<0 || vi<0) throw new Error(`HAPI response does not contain Time and ${d.parameter}.`);
  const meta=raw.parameters[vi];
  if(meta.units!=='nT') throw new Error(`Unexpected units for ${d.parameter}: ${meta.units}`);
  const fill=Number(meta.fill);
  if(meta.fill===null || !Number.isFinite(fill)) throw new Error(`Missing fill-value metadata for ${d.parameter}.`);
  const records=new Map();
  for(const row of raw.data) {
    if(!Array.isArray(row)||row.length!==raw.parameters.length) throw new Error(`Malformed ${d.parameter} row.`);
    const sourceTime=row[ti],t=typeof sourceTime==='string' ? Date.parse(sourceTime) : NaN;
    if(!Number.isFinite(t)) throw new Error(`Invalid ${d.parameter} native timestamp.`);
    if((t-d.epochOffsetMs)%d.cadenceMs!==0) throw new Error(`Unexpected ${d.parameter} timestamp convention; expected ${d.epochConvention}.`);
    const rawValue=row[vi];
    const status=rawValue===fill ? 'fill' : typeof rawValue==='number' && Number.isFinite(rawValue) && Number.isInteger(rawValue) ? 'valid' : 'invalid';
    const sample={t,sourceTime,start:t-d.epochOffsetMs,end:t-d.epochOffsetMs+d.cadenceMs,
      value:status==='valid' ? rawValue : null,status};
    const prior=records.get(t);
    if(prior&&(prior.value!==sample.value||prior.status!==sample.status)) throw new Error(`Conflicting ${d.parameter} records at ${sourceTime}.`);
    records.set(t,sample);
  }
  return [...records.values()].sort((a,b)=>a.start-b.start);
}

/** Look up only the actual source bin containing selected UTC, using [start,end).
 * 'missing' means no record; 'fill' means the source supplied its missing-value flag.
 */
export function lookupIndex(series,t) {
  if(!Array.isArray(series)||!Number.isFinite(t)) return {sample:null,status:'missing'};
  let lo=0,hi=series.length;
  while(lo<hi) { const mid=(lo+hi)>>>1; if(series[mid].start<=t) lo=mid+1; else hi=mid; }
  const sample=series[lo-1];
  return sample && t>=sample.start && t<sample.end ? {sample,status:sample.status} : {sample:null,status:'missing'};
}

function sourceInfo(key,t,chunk={}) {
  const d=definition(key),known=t>=d.qualityStart&&t<d.qualityEnd;
  const level=known ? d.qualityLevel : 'Not specified';
  return {dataset:d.dataset,parameter:d.parameter,kind:chunk.kind || 'unavailable',url:chunk.url || null,
    file:chunk.file || null,retrievedAt:chunk.retrievedAt || null,units:d.units,cadenceMs:d.cadenceMs,
    epochConvention:d.epochConvention,infoURL:`${HAPI_BASE}/info?id=${d.dataset}&parameters=Time,${d.parameter}`,fill:d.fill,
    quality:{level,label:`${level} (period-level; no per-record flag)`,sourceURL:d.qualityURL,verifiedAt:'2026-10-28',
      note:key==='symh' ? 'NASA high-resolution OMNI availability documentation labels SYM-H from 1981 through 2026-09-30 provisional. This is the native minute SYM-H index from Kyoto, not interpolated Dst.' : 'NASA high-resolution OMNI availability documentation labels AE from 1990 through 2020 provisional.'}};
}

export class GeomagneticStore {
  constructor({fetchImpl=globalThis.fetch?.bind(globalThis),dataBase=new URL('../data/indices/',import.meta.url)}={}) {
    this.fetch=fetchImpl;this.dataBase=String(dataBase);this.chunks=[];this.cache=new Map();
    this.generations=new Map();this.initialized=false;this.initialization=null;this.warnings=[];this.maxDays=48;
  }

  async initialize() {
    if(this.initialized) return {warnings:[...this.warnings]};
    if(this.initialization) return this.initialization;
    this.initialization=(async()=>{
      try {
        const manifest=await this._fetchJSON(new URL('manifest.json',this.dataBase));
        if(manifest.format!=='van-allen-indices-manifest-v1'||!Array.isArray(manifest.chunks)) throw new Error('Unrecognized index-data manifest.');
        for(const c of manifest.chunks) {
          // Older local bundles can retain hourly Dst. Skip retired/unknown series
          // so they cannot block supported AE/SYM-H chunks later in the manifest.
          if(!Object.hasOwn(INDEX_DEFINITIONS,c.index)) continue;
          const start=Date.parse(c.start),end=Date.parse(c.end);
          if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start) throw new Error('Invalid index-data chunk bounds.');
          this.chunks.push({...c,start,end,kind:'bundled',records:null});
        }
      } catch(error) {this.warnings.push(`Local index samples unavailable: ${error.message}`);}
      this.initialized=true;
      return {warnings:[...this.warnings]};
    })();
    return this.initialization;
  }

  async _fetchJSON(url,signal) {
    const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
    if(signal?.aborted) abort(); else signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>controller.abort(new DOMException('Index request timed out after 25 s.','TimeoutError')),25000);
    try {
      const response=await this.fetch(url,{headers:{Accept:'application/json'},signal:controller.signal});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }

  peekDay(t) {return this.cache.get(dayOf(t)) || null;}

  async _loadIndex(key,dayStart,signal) {
    const dayEnd=dayStart+DAY;
    // The downloader appends refreshed/new chunks, so newer local downloads take precedence.
    const chunk=[...this.chunks].reverse().find(c=>c.index===key&&c.start<=dayStart&&c.end>=dayEnd);
    let localError=null;
    if(chunk) {
      try {
        if(!chunk.records) chunk.records=parseIndexData(await this._fetchJSON(new URL(chunk.file,this.dataBase),signal),key);
        return {records:chunk.records.filter(r=>r.start>=dayStart&&r.start<dayEnd),source:sourceInfo(key,dayStart,chunk),warning:null};
      } catch(error) {
        if(signal?.aborted) throw error;
        localError=`Bundled ${definition(key).name} unavailable: ${error.message}`;
      }
    }
    const url=indexDataURL(key,dayStart,dayEnd),raw=await this._fetchJSON(url,signal);
    const records=parseIndexData(raw,key).filter(r=>r.start>=dayStart&&r.start<dayEnd);
    return {records,source:sourceInfo(key,dayStart,{kind:'live',url,retrievedAt:new Date().toISOString()}),warning:localError};
  }

  /** Retrieve one UTC day. Failed days are cached to avoid request storms; force:true retries.
   * Independent index errors remain distinguishable from a successful query with no record.
   * Aborted/outdated requests cannot overwrite another request's cached day.
   */
  async getDay(t,{signal,force=false}={}) {
    if(!Number.isFinite(t)) throw new Error('Invalid selected time for geomagnetic indices.');
    if(signal?.aborted) throw new DOMException('Aborted','AbortError');
    const dayStart=dayOf(t),dayEnd=dayStart+DAY;
    if(!force&&this.cache.has(dayStart)) return this.cache.get(dayStart);
    await this.initialize();
    if(signal?.aborted) throw new DOMException('Aborted','AbortError');
    const generation=(this.generations.get(dayStart)||0)+1;this.generations.set(dayStart,generation);
    const result={dayStart,dayEnd,ae:[],symh:[],sources:{ae:sourceInfo('ae',t),symh:sourceInfo('symh',t)},
      errors:{ae:null,symh:null},warnings:[...this.warnings]};
    const outcomes=await Promise.allSettled(['ae','symh'].map(key=>this._loadIndex(key,dayStart,signal)));
    if(signal?.aborted) throw new DOMException('Aborted','AbortError');
    outcomes.forEach((outcome,i)=>{
      const key=['ae','symh'][i];
      if(outcome.status==='fulfilled') {
        result[key]=outcome.value.records;result.sources[key]=outcome.value.source;
        if(outcome.value.warning) result.warnings.push(outcome.value.warning);
      } else result.errors[key]=outcome.reason?.message || String(outcome.reason);
    });
    if(this.generations.get(dayStart)===generation) {
      this.cache.delete(dayStart);this.cache.set(dayStart,result);
      while(this.cache.size>this.maxDays) {const oldest=this.cache.keys().next().value;this.cache.delete(oldest);this.generations.delete(oldest);}
    }
    return result;
  }
}
