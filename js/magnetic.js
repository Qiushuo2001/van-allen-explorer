/** NASA SSCWeb centered-dipole coordinates at definitive ephemeris epochs.
 * Values are supplied by NASA; no field model, orbit propagation, or interpolation runs here.
 */
import { SSC_BASE, PROBES, unwrapSSC } from './ephemeris.js';

export const MAGNETIC_URL=`${SSC_BASE}/locations`;
export const MAGNETIC_MODEL='SSCWeb centered dipole / Solar Magnetic (SM)';
export const MAGNETIC_DOC='https://sscweb.gsfc.nasa.gov/users_guide/Appendix_C.shtml';
const DAY=86400000, dayOf=t=>Math.floor(t/DAY)*DAY;
const empty=()=>Object.fromEntries(PROBES.map(p=>[p.id,[]]));
const iso=t=>new Date(t).toISOString();

/** XML follows NASA's DataRequest schema; request the magnetic quantities explicitly. */
export function magneticRequest(start,end) {
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>DAY) throw new Error('Use a magnetic-data interval of at most one day.');
  return `<DataRequest xmlns="http://sscweb.gsfc.nasa.gov/schema"><TimeInterval><Start>${iso(start)}</Start><End>${iso(end)}</End></TimeInterval>`+
    PROBES.map(p=>`<Satellites><Id>${p.id}</Id><ResolutionFactor>1</ResolutionFactor></Satellites>`).join('')+
    '<OutputOptions><AllLocationFilters>true</AllLocationFilters>'+
    ['Lat','Local_Time'].map(c=>`<CoordinateOptions><CoordinateSystem>Sm</CoordinateSystem><Component>${c}</Component></CoordinateOptions>`).join('')+
    '<ValueOptions><RadialDistance>true</RadialDistance><BFieldStrength>false</BFieldStrength><DipoleLValue>true</DipoleLValue><DipoleInvLat>false</DipoleInvLat></ValueOptions><MinMaxPoints>2</MinMaxPoints></OutputOptions></DataRequest>';
}

export function parseMagnetic(raw) {
  const decoded=unwrapSSC(raw), result=decoded?.Result ?? decoded, series=empty();
  if(/NO_DATA|NO_SATELLITE/i.test(String(result?.StatusSubCode))) return series;
  if(!['SUCCESS','CONDITIONAL_SUCCESS'].includes(result?.StatusCode)||!Array.isArray(result.Data)) throw new Error('Invalid SSC magnetic-data response.');
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  for(const sat of result.Data) {
    const probe=PROBES.find(p=>p.id===sat.Id);
    if(!probe) continue;
    const sm=sat.Coordinates?.find(c=>c.CoordinateSystem==='SM');
    if(!sm||!Array.isArray(sat.Time)) throw new Error(`Missing SM coordinates or timestamps for ${sat.Id}.`);
    const fields={l:sat.DipoleLValue,mlt:sm.LocalTime,mlat:sm.Latitude};
    for(const [key,values] of Object.entries(fields)) {
      if(values!==undefined&&(!Array.isArray(values)||values.length!==sat.Time.length)) throw new Error(`Misaligned ${sat.Id} ${key} records.`);
    }
    const byTime=new Map();
    sat.Time.forEach((timestamp,i)=>{
      const t=typeof timestamp==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(timestamp) ? Date.parse(timestamp) : NaN;
      if(!Number.isFinite(t)||t<probe.startMs||t>probe.endMs) return;
      const l=fields.l?.[i], mlt=fields.mlt?.[i], mlat=fields.mlat?.[i];
      const sample={t,l:finite(l)&&l>0&&l<1e8 ? l : null,
        mlt:finite(mlt)&&mlt>=0&&mlt<=24 ? mlt%24 : null,
        mlat:finite(mlat)&&Math.abs(mlat)<=90 ? mlat : null};
      const prior=byTime.get(t);
      if(prior&&['l','mlt','mlat'].some(k=>prior[k]!==sample[k])) throw new Error(`Conflicting magnetic records for ${sat.Id} at ${timestamp}.`);
      byTime.set(t,sample);
    });
    series[sat.Id]=[...byTime.values()].sort((a,b)=>a.t-b.t);
  }
  return series;
}

export class MagneticStore {
  constructor({fetchImpl=globalThis.fetch?.bind(globalThis),dataBase=new URL('../data/magnetic/',import.meta.url)}={}) {
    this.fetch=fetchImpl;this.dataBase=String(dataBase);this.chunks=[];this.cache=new Map();
    this.generations=new Map();this.initialization=null;this.maxDays=48;
  }
  async fetchJSON(url,{signal,body}={}) {
    const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
    if(signal?.aborted) abort(); else signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>controller.abort(new DOMException('Magnetic-data request timed out.','TimeoutError')),30000);
    try {
      const response=await this.fetch(url,{signal:controller.signal,method:body?'POST':'GET',
        headers:body?{Accept:'application/json','Content-Type':'application/xml'}:{Accept:'application/json'},...(body?{body}:{})});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }
  async initialize() {
    if(!this.initialization) this.initialization=(async()=>{
      try {
        const manifest=await this.fetchJSON(new URL('manifest.json',this.dataBase));
        if(manifest.format!=='van-allen-magnetic-manifest-v1') throw new Error('Invalid magnetic-data manifest.');
        this.chunks=(manifest.chunks||[]).map(c=>({...c,start:Date.parse(c.start),end:Date.parse(c.end)}))
          .filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start);
      } catch { /* Live retrieval remains available when there is no usable local manifest. */ }
    })();
    return this.initialization;
  }
  peekDay(t) {return this.cache.get(dayOf(t))||null;}
  async getDay(t,{signal,force=false}={}) {
    if(!Number.isFinite(t)) throw new Error('Invalid magnetic-data time.');
    if(signal?.aborted) throw new DOMException('Aborted','AbortError');
    const start=dayOf(t),end=start+DAY;
    if(!force&&this.cache.has(start)) return this.cache.get(start);
    await this.initialize();
    if(signal?.aborted) throw new DOMException('Aborted','AbortError');
    const generation=(this.generations.get(start)||0)+1;this.generations.set(start,generation);
    const result={dayStart:start,dayEnd:end,series:empty(),source:null,error:null};
    const chunk=[...this.chunks].reverse().find(c=>c.start<=start&&c.end>=end);
    try {
      let raw;
      if(chunk&&!force) {
        try {
          raw=await this.fetchJSON(new URL(chunk.file,this.dataBase),{signal});
          result.series=parseMagnetic(raw);
          result.source={...chunk,kind:'bundled'};
        } catch(error) {if(signal?.aborted) throw error;}
      }
      if(!result.source) {
        raw=await this.fetchJSON(MAGNETIC_URL,{signal,body:magneticRequest(start,end)});
        result.series=parseMagnetic(raw);
        result.source={kind:'live',url:MAGNETIC_URL,start:iso(start),end:iso(end),retrievedAt:iso(Date.now())};
      }
      for(const p of PROBES) result.series[p.id]=result.series[p.id].filter(s=>s.t>=start&&s.t<=end);
    } catch(error) {
      if(signal?.aborted) throw error;
      result.error=error.message||String(error);
    }
    if(signal?.aborted) throw new DOMException('Aborted','AbortError');
    if(this.generations.get(start)===generation) {
      this.cache.delete(start);this.cache.set(start,result);
      while(this.cache.size>this.maxDays) {const oldest=this.cache.keys().next().value;this.cache.delete(oldest);this.generations.delete(oldest);}
    }
    return result;
  }
}
