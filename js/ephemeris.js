/** NASA SSCWeb ephemerides. Rendering-independent; never propagates or interpolates positions. */
export const SSC_BASE = 'https://sscweb.gsfc.nasa.gov/WS/sscr/2';
// SSCWeb User Guide, section 1.3: the service convention is 6378.16 km per R_E.
export const EARTH_RADIUS_KM = 6378.16;
export const MISSION_START = Date.parse('2012-08-30T00:00:00Z');
export const MISSION_END = Date.parse('2019-10-18T23:59:59Z');
export const PROBES = Object.freeze([
  Object.freeze({id:'rbspa', name:'Probe A', label:'Van Allen Probe A', color:'#47d5ff',
    startMs:Date.parse('2012-08-30T09:25:59Z'), endMs:Date.parse('2019-10-18T01:00:00Z'),
    operationsEndMs:Date.parse('2019-10-18T23:59:59Z'), operationsEndPrecision:'day', cadenceMs:60000}),
  Object.freeze({id:'rbspb', name:'Probe B', label:'Van Allen Probe B', color:'#ffb45d',
    startMs:Date.parse('2012-08-30T09:25:59Z'), endMs:Date.parse('2019-07-19T01:00:00Z'),
    operationsEndMs:Date.parse('2019-07-19T17:27:00Z'), operationsEndPrecision:'second', cadenceMs:60000})
]);
const IDS = PROBES.map(p=>p.id);
const DAY = 86400000;
const FRAMES = ['GSE', 'GSM', 'GEO'];
const emptySeries = () => ({rbspa:[], rbspb:[]});
const frameName = frame => {
  const f=String(frame).toUpperCase();
  if (!FRAMES.includes(f)) throw new Error(`Unsupported coordinate system: ${frame}`);
  return f;
};

/** Jackson includes Java class names as two-element wrappers, including dates. */
export function unwrapSSC(value) {
  if (Array.isArray(value)) {
    if (value.length===2 && typeof value[0]==='string' &&
        /^(?:gov\.nasa\.|java\.|javax\.|\[L|\[D|\[F)/.test(value[0])) return unwrapSSC(value[1]);
    return value.map(unwrapSSC);
  }
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,unwrapSSC(v)]));
  return value;
}

function responseResult(raw) {
  const decoded=unwrapSSC(raw);
  return decoded?.Result ?? decoded;
}

/** Parse a raw SSC JSON locations response; API Cartesian values are kilometers.
 * Invalid samples are omitted, so their cadence break survives to splitSegments.
 * Only rbspa/rbspb are accepted, never their separately named predictive products.
 */
export function parseLocations(raw, requestedFrame='GSE') {
  const frame=frameName(requestedFrame), result=responseResult(raw), series=emptySeries();
  if (!result || !Array.isArray(result.Data)) {
    if (/NO_DATA|NO_SATELLITE/i.test(String(result?.StatusSubCode))) return series;
    throw new Error(`SSC response has no location array (${result?.StatusCode || 'invalid response'}).`);
  }
  if (result.StatusCode && !['SUCCESS','CONDITIONAL_SUCCESS'].includes(result.StatusCode)) {
    if (/NO_DATA|NO_SATELLITE/i.test(String(result.StatusSubCode))) return series;
    throw new Error(`SSC returned ${result.StatusCode}: ${result.StatusSubCode || ''}`);
  }
  for (const sat of result.Data) {
    if (!IDS.includes(sat.Id)) continue;
    const coordinates=(sat.Coordinates || []).find(c=>String(c.CoordinateSystem).toUpperCase()===frame);
    if (!coordinates) continue;
    const times=sat.Time, {X,Y,Z}=coordinates;
    if (![times,X,Y,Z].every(Array.isArray)) throw new Error(`Malformed ${sat.Id} ${frame} arrays.`);
    if (![X,Y,Z].every(a=>a.length===times.length)) throw new Error(`Misaligned ${sat.Id} ${frame} coordinate/time arrays.`);
    const probe=PROBES.find(p=>p.id===sat.Id), byTime=new Map();
    times.forEach((time,i)=>{
      const t=Date.parse(time), xyz=[X[i],Y[i],Z[i]];
      // Reject fill values, coercible strings, nulls and nonfinite values. Do not invent replacements.
      if (!Number.isFinite(t) || t<probe.startMs || t>probe.endMs ||
          !xyz.every(v=>typeof v==='number' && Number.isFinite(v) && Math.abs(v)<1e8)) return;
      const [x,y,z]=xyz.map(v=>v/EARTH_RADIUS_KM), r=Math.hypot(x,y,z);
      if (r===0) return;
      byTime.set(t,{t,x,y,z,r});
    });
    series[sat.Id]=[...byTime.values()].sort((a,b)=>a.t-b.t);
  }
  return series;
}

/** Returns an archived sample only. The caller must explicitly opt in to showing nearest.
 * Nearest is allowed within half a cadence AND only between two contiguous samples.
 * offsetMs = source timestamp minus requested timestamp. No extrapolation at boundaries.
 */
export function sampleAt(series,t,cadenceMs=60000) {
  const none=reason=>({sample:null,exact:false,offsetMs:null,reason});
  if (!series?.length || !Number.isFinite(t)) return none('no-data');
  let lo=0,hi=series.length;
  while(lo<hi) { const mid=(lo+hi)>>>1; if(series[mid].t<t) lo=mid+1; else hi=mid; }
  if (series[lo]?.t===t) return {sample:series[lo],exact:true,offsetMs:0,reason:'exact'};
  if (lo===0 || lo===series.length) return none('outside-coverage');
  const before=series[lo-1],after=series[lo];
  if (after.t-before.t>cadenceMs+1) return none('gap');
  const sample=t-before.t<=after.t-t ? before : after;
  if (Math.abs(sample.t-t)>cadenceMs/2) return none('gap');
  return {sample,exact:false,offsetMs:sample.t-t,reason:'nearest'};
}

/** Polyline segments connect adjacent real samples only. No line crosses a missing cadence. */
export function splitSegments(series,cadenceMs=60000) {
  const segments=[]; let current=[];
  for (const point of series || []) {
    if (current.length && (point.t-current.at(-1).t>cadenceMs+1 || point.t<=current.at(-1).t)) {
      segments.push(current); current=[];
    }
    current.push(point);
  }
  if(current.length) segments.push(current);
  return segments;
}

function compactDate(ms) { return new Date(ms).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'); }
export function locationsURL(start,end,frame='GSE') {
  return `${SSC_BASE}/locations/rbspa,rbspb/${compactDate(start)},${compactDate(end)}/${frameName(frame).toLowerCase()}/?resolutionFactor=1`;
}

function sourceFrames(raw) {
  const frames=new Set();
  for (const sat of responseResult(raw)?.Data || []) {
    for (const c of sat.Coordinates || []) if(FRAMES.includes(String(c.CoordinateSystem).toUpperCase())) frames.add(String(c.CoordinateSystem).toUpperCase());
  }
  return [...frames];
}

function mergeSeries(list,start,end) {
  const out=emptySeries();
  for (const id of IDS) {
    const merged=new Map();
    for (const series of list) for (const point of series[id] || []) if(point.t>=start && point.t<=end) merged.set(point.t,point);
    out[id]=[...merged.values()].sort((a,b)=>a.t-b.t);
  }
  return out;
}

function unionCovers(ranges,start,end) {
  let cursor=start;
  for(const [a,b] of ranges.sort((x,y)=>x[0]-y[0])) {
    if(a>cursor) return false;
    if(b>=cursor) cursor=b;
    if(cursor>=end) return true;
  }
  return false;
}

export class EphemerisStore {
  constructor({fetchImpl=globalThis.fetch?.bind(globalThis),dataBase=new URL('../data/',import.meta.url)}={}) {
    this.fetch=fetchImpl; this.dataBase=String(dataBase); this.chunks=[]; this.metadata=PROBES;
    this.initialized=false; this.initWarnings=[]; this.maxLiveChunks=48;
  }

  async initialize() {
    if(this.initialized) return {metadata:this.metadata,warnings:this.initWarnings};
    try {
      const manifest=await this._fetchJSON(new URL('manifest.json',this.dataBase));
      if(manifest.format!=='van-allen-ssc-manifest-v1' || !Array.isArray(manifest.chunks)) throw new Error('Unrecognized local data manifest.');
      for(const chunk of manifest.chunks) {
        const start=Date.parse(chunk.start),end=Date.parse(chunk.end);
        if(!Number.isFinite(start)||!Number.isFinite(end)||start>end) continue;
        this.chunks.push({...chunk,start,end,frames:chunk.frames.map(frameName),kind:'bundled',raw:null,parsed:{}});
      }
    } catch(error) { this.initWarnings.push(`Local sample data unavailable: ${error.message}`); }
    this.initialized=true;
    return {metadata:this.metadata,warnings:this.initWarnings};
  }

  async _fetchJSON(url,signal) {
    const controller=new AbortController();
    const abort=()=>controller.abort(signal.reason);
    if(signal?.aborted) abort(); else signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>controller.abort(new DOMException('Data request timed out after 30 s.','TimeoutError')),30000);
    try {
      const response=await this.fetch(url,{headers:{Accept:'application/json'},signal:controller.signal});
      if(!response.ok) throw new Error(`HTTP ${response.status}${response.headers.get('Retry-After') ? `; retry after ${response.headers.get('Retry-After')} seconds` : ''}`);
      return await response.json();
    } finally {clearTimeout(timeout); signal?.removeEventListener('abort',abort);}
  }

  async _getChunk(chunk,frame,signal) {
    if(!chunk.raw) chunk.raw=await this._fetchJSON(new URL(chunk.file,this.dataBase),signal);
    if(!chunk.parsed[frame]) chunk.parsed[frame]=parseLocations(chunk.raw,frame);
    return chunk.parsed[frame];
  }

  /** One UTC day per live request; loaded chunks reused in memory. Up to 32 days per call.
   * A service failure returns available real data plus provenance.errors. It never fabricates
   * coverage or changes a sample timestamp. An aborted caller receives AbortError.
   */
  async loadRange(start,end,frame='GSE',{signal}={}) {
    frame=frameName(frame);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start>end) throw new Error('Invalid requested time interval.');
    if(end-start>32*DAY) throw new Error('Load at most 32 days at a time; playback loads later windows as needed.');
    await this.initialize();
    const provenance={sources:[],errors:[],warnings:[...this.initWarnings],frame,sourceCadenceMs:60000,partial:false};
    const collected=[],covered={rbspa:[],rbspb:[]};
    const markCoverage=(chunk,parsed)=>{
      for(const id of IDS) {
        // A bare imported response may contain just one probe, or interior gaps.
        // Only its contiguous sample spans suppress additional live requests.
        const ranges=chunk.kind==='imported' ? splitSegments(parsed[id]).map(s=>[s[0].t,s.at(-1).t]) : [[chunk.start,chunk.end]];
        covered[id].push(...ranges);
      }
    };
    const rangeCovered=(a,b)=>PROBES.every(probe=>{
      const lo=Math.max(a,probe.startMs),hi=Math.min(b,probe.endMs);
      return lo>hi || unionCovers(covered[probe.id],lo,hi);
    });
    for(const chunk of [...this.chunks]) {
      if(chunk.end<start || chunk.start>end || !chunk.frames.includes(frame)) continue;
      try {
        const parsed=await this._getChunk(chunk,frame,signal);
        collected.push(parsed);
        markCoverage(chunk,parsed);
        provenance.sources.push(this._source(chunk));
      } catch(error) {
        if(signal?.aborted) throw error;
        provenance.errors.push(`${chunk.file || chunk.url}: ${error.message}`);
      }
    }
    const firstDay=Math.floor(Math.max(start,MISSION_START)/DAY)*DAY;
    const lastTime=Math.min(end,MISSION_END);
    for(let day=firstDay;day<=lastTime;day+=DAY) {
      const a=Math.max(day,start,MISSION_START),b=Math.min(day+DAY,end,MISSION_END);
      if(a>b || rangeCovered(a,b)) continue;
      if(signal?.aborted) throw new DOMException('Aborted','AbortError');
      const fetchStart=Math.max(day,MISSION_START),fetchEnd=Math.min(day+DAY,MISSION_END);
      const url=locationsURL(fetchStart,fetchEnd,frame);
      try {
        const raw=await this._fetchJSON(url,signal), parsed=parseLocations(raw,frame);
        const chunk={start:fetchStart,end:fetchEnd,frames:[frame],kind:'live',url,
          retrievedAt:new Date().toISOString(),raw,parsed:{[frame]:parsed}};
        this.chunks.push(chunk); collected.push(parsed); markCoverage(chunk,parsed);
        provenance.sources.push(this._source(chunk));
        const result=responseResult(raw);
        if(result.StatusCode==='CONDITIONAL_SUCCESS') provenance.warnings.push(`SSC conditional success: ${result.StatusSubCode || 'Some data unavailable'}`);
      } catch(error) {
        if(signal?.aborted) throw error;
        provenance.errors.push(`${new Date(fetchStart).toISOString().slice(0,10)} ${frame}: ${error.message}`);
      }
    }
    // Bound live response memory; local/imported datasets remain available.
    const live=this.chunks.filter(c=>c.kind==='live');
    if(live.length>this.maxLiveChunks) { const old=new Set(live.slice(0,live.length-this.maxLiveChunks)); this.chunks=this.chunks.filter(c=>!old.has(c)); }
    provenance.partial=provenance.errors.length>0;
    return {series:mergeSeries(collected,start,end),provenance,frame,start,end};
  }

  _source(chunk) {
    return {kind:chunk.kind,url:chunk.url || null,file:chunk.file || null,retrievedAt:chunk.retrievedAt || null,
      start:new Date(chunk.start).toISOString(),end:new Date(chunk.end).toISOString()};
  }

  /** Accept a downloader bundle or a raw SSC JSON response. Imported origin is user supplied. */
  importBundle(raw,{name='Imported SSC JSON'}={}) {
    const entries=raw?.format==='van-allen-ssc-bundle-v1' ? raw.chunks : [{raw}];
    if(!Array.isArray(entries)) throw new Error('Bundle must contain a chunks array.');
    const prepared=[];
    for(const entry of entries) {
      const frames=sourceFrames(entry.raw),parsed={};
      if(!frames.length) throw new Error('No supported SSC coordinate frames in imported file.');
      for(const frame of frames) parsed[frame]=parseLocations(entry.raw,frame);
      const timestamps=Object.values(parsed[frames[0]]).flat().map(p=>p.t);
      if(!timestamps.length) throw new Error('Imported file has no valid mission samples.');
      // Bounds aid lookup; loadRange separately checks contiguous per-probe coverage.
      let start=Infinity,end=-Infinity; for(const t of timestamps) {start=Math.min(start,t);end=Math.max(end,t);}
      prepared.push({start,end,frames,raw:entry.raw,parsed,kind:'imported',file:name,
        url:entry.request?.url || null,retrievedAt:entry.request?.retrievedAt || null});
    }
    this.chunks.push(...prepared);
    return {chunks:prepared.length,samples:prepared.reduce((n,c)=>n+Object.values(c.parsed[c.frames[0]]).reduce((sum,a)=>sum+a.length,0),0)};
  }

  async importFiles(files) {
    let chunks=0,samples=0;
    for(const file of Array.from(files)) {
      const result=this.importBundle(JSON.parse(await file.text()),{name:file.name});
      chunks+=result.chunks; samples+=result.samples;
    }
    return {chunks,samples};
  }

  /** Preserve the original SSC response bodies; no resampling or coordinate rewriting. */
  exportBundle() {
    return {format:'van-allen-ssc-bundle-v1',source:'NASA SPDF SSCWeb',chunks:this.chunks.filter(c=>c.raw).map(c=>({
      request:{url:c.url || null,retrievedAt:c.retrievedAt || null,start:new Date(c.start).toISOString(),
        end:new Date(c.end).toISOString(),frames:c.frames},raw:c.raw
    }))};
  }
}
