import { PlasmaStore, selectPlasma } from './plasma.js?v=1.6.0';
import { buildPlasmaSeries } from './plasma-series.js?v=1.6.0';
import { PlasmaPlot } from './plasma-plot.js?v=1.6.0';
import { PROBES } from './ephemeris.js';

const DAY=86400000,dayOf=t=>Math.floor(t/DAY)*DAY;
const KEYS=['density','ratio','anisotropy','beta'];
const EMPTY_RECORDS=Object.freeze([]);
const EMPTY_SERIES=Object.freeze({rbspa:EMPTY_RECORDS,rbspb:EMPTY_RECORDS});
const DEPENDENCIES={density:['density'],ratio:['density'],anisotropy:['moments'],beta:['moments','field']};
const SOURCE_LABELS={density:'EMFISIS density',moments:'HOPE electron moments',field:'EMFISIS magnetic field'};
const SOURCE_KINDS={bundled:'Bundled NASA response',live:'Live NASA response',unavailable:'No response loaded'};
const utc=value=>typeof value==='string' ? value.replace('T',' ').replace(/Z$/,' UTC') : new Date(value).toISOString().replace('T',' ').replace(/Z$/,' UTC');
const offset=value=>`${value>0?'+':''}${(value/1000).toFixed(3)} s`;

export function formatPlasmaValue(value,key) {
  if(typeof value!=='number'||!Number.isFinite(value)) return '—';
  if(value!==0&&((key==='beta'&&Math.abs(value)<0.001)||Math.abs(value)>=1e6)) return value.toExponential(2);
  return Number(value.toPrecision(3)).toString();
}

function fieldNote(field,key,{full=false}={}) {
  const parts=[];
  if(field?.note&&(full||field.status!=='valid')) parts.push(field.note);
  if(field?.sourceTime) parts.push(`Source: ${utc(field.sourceTime)}${Number.isFinite(field.offsetMs)?` (${offset(field.offsetMs)} from selection)`:''}`);
  if(key==='beta'&&field?.fieldTime) parts.push(`|B|: ${utc(field.fieldTime)}${Number.isFinite(field.fieldOffsetMs)?` (${offset(field.fieldOffsetMs)} from HOPE)`:''}`);
  return parts.join(' · ')||'No usable source measurement at this time.';
}

/** Instrument plasma measurements follow selected UTC independently of orbit availability.
 * The data layer alone selects native samples, applies quality flags, and derives moments.
 */
export class PlasmaPanels {
  constructor({store=new PlasmaStore(),document=globalThis.document,delay=120,selectImpl=selectPlasma,
    seriesImpl=buildPlasmaSeries,onSeek=()=>{},plotFactory=options=>new PlasmaPlot(options)}={}) {
    this.store=store;this.$=id=>document.getElementById(id);this.delay=delay;this.select=selectImpl;this.buildSeries=seriesImpl;
    this.plotDay=null;this.plotSeries=null;this.plotInputs=new Map();
    this.plots=Object.fromEntries(KEYS.map(key=>[key,plotFactory({element:this.$(`plasma-${key}-plot`),key,document,onSeek})]));
    this.time=null;this.pendingDay=null;this.version=0;this.controller=null;this.timer=null;this.disposed=false;
    this.retry=()=>{if(this.time!==null) this.setTime(this.time,{force:true});};
    this.$('plasma-retry').addEventListener('click',this.retry);
  }
  setTime(time,{force=false}={}) {
    if(this.disposed||!Number.isFinite(time)) return;
    this.time=time;
    // During a forced refresh, cached values from the previous request stay cleared.
    if(!force&&this.pendingDay===dayOf(time)) {this.render(null,{loading:true});return;}
    const cached=force?null:this.store.peekDay(time);
    if(cached) {if(this.pendingDay!==null) this.cancel();this.render(cached);return;}
    this.cancel();this.render(null,{loading:true});
    this.pendingDay=dayOf(time);
    const version=this.version,controller=this.controller=new AbortController();
    this.timer=setTimeout(async()=>{
      this.timer=null;
      try {
        const result=await this.store.getDay(time,{signal:controller.signal,force});
        if(version!==this.version||controller.signal.aborted||this.disposed||dayOf(this.time)!==result.dayStart) return;
        this.render(result);
      } catch(error) {
        if(version!==this.version||controller.signal.aborted||this.disposed) return;
        this.render(null,{error:error.message||String(error)});
      } finally {if(version===this.version) {this.pendingDay=null;this.controller=null;}}
    },this.delay);
  }
  render(day,{loading=false,error=null}={}) {
    this.$('plasma-time').textContent=`Selected: ${utc(this.time)}`;
    const start=day?.dayStart??dayOf(this.time),end=day?.dayEnd??start+DAY;
    this.$('plasma-day').textContent=`${new Date(start).toISOString().slice(0,10)} · 00:00–24:00 UTC`;
    const usable=day&&!loading&&!error?day:null;
    if(usable!==this.plotDay) {
      this.plotDay=usable;this.plotSeries=usable?this.buildSeries(usable):null;
    }
    for(const key of KEYS) {
      const errors=Object.fromEntries(PROBES.map(probe=>[probe.id,error||
        DEPENDENCIES[key].map(product=>day?.errors?.[probe.id]?.[product]).filter(Boolean).join('; ')||null]));
      const previous=this.plotInputs.get(key);
      if(!previous||previous.day!==usable||previous.start!==start||previous.end!==end||previous.loading!==loading||
        PROBES.some(probe=>previous.errors[probe.id]!==errors[probe.id])) {
        const native=this.plotSeries?.[key]??EMPTY_SERIES;
        const input={day:usable,start,end,loading,errors,
          series:Object.fromEntries(PROBES.map(probe=>[probe.id,errors[probe.id]?EMPTY_RECORDS:(native[probe.id]??EMPTY_RECORDS)])),
          select:usable?(probe,time)=>this.select(usable,probe,time)?.fields?.[key]??null:()=>null};
        this.plots[key].setData(input);this.plotInputs.set(key,input);
      }
      this.plots[key].setTime(this.time);
    }
    for(const probe of PROBES) {
      const selected=day&&!loading&&!error?this.select(day,probe.id,this.time):null;
      let available=0,failed=false;
      for(const key of KEYS) {
        const field=selected?.fields?.[key];
        const valid=field?.status==='valid'&&typeof field.value==='number'&&Number.isFinite(field.value);
        const failure=Boolean(error)||field?.status==='error';
        if(valid) available++;
        failed||=failure;
        this.$(`plasma-${key}-${probe.id}`).textContent=valid?formatPlasmaValue(field.value,key):'—';
        const note=this.$(`plasma-${key}-note-${probe.id}`);
        note.textContent=loading?'Loading instrument measurements…':error?`Unavailable · retrieval failed: ${error}`:fieldNote(field,key);
        note.title=field?fieldNote(field,key,{full:true}):note.textContent;
        note.classList.toggle('error-text',failure);
      }
      const status=this.$(`plasma-status-${probe.id}`);
      status.textContent=loading?'Loading plasma conditions…':error?'Unavailable · retrieval failed':
        available===4?'4 / 4 quantities available':available?`${available} / 4 quantities available · partial coverage`:
        failed?'Unavailable · retrieval failed':'No usable plasma measurements at selection';
      status.classList.toggle('error-text',failed&&available===0);
      for(const [key,label] of Object.entries(SOURCE_LABELS)) {
        const source=selected?.sources?.[key],link=this.$(`plasma-source-${key}-${probe.id}`);
        link.textContent=label;
        link.href=source?.url||source?.infoURL||'https://cdaweb.gsfc.nasa.gov/hapi';
        link.title=source?`${source.dataset||label}\n${SOURCE_KINDS[source.kind]||source.kind||'NASA archive'}\nRetrieved: ${source.retrievedAt||'not loaded'}\n${source.url||source.infoURL||''}`:'Source details will appear when this date loads.';
      }
    }
    this.$('plasma-section').setAttribute('aria-busy',String(loading));
    this.$('plasma-retry').disabled=loading;
  }
  cancel() {
    ++this.version;clearTimeout(this.timer);this.timer=null;
    this.controller?.abort();this.controller=null;this.pendingDay=null;
  }
  dispose() {this.disposed=true;this.cancel();this.$('plasma-retry').removeEventListener('click',this.retry);for(const plot of Object.values(this.plots)) plot.dispose();}
}
