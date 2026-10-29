import { MagneticStore, MAGNETIC_DOC, MAGNETIC_MODEL } from './magnetic.js';
import { PROBES, sampleAt } from './ephemeris.js';

const DAY=86400000,dayOf=t=>Math.floor(t/DAY)*DAY;
const utc=t=>new Date(t).toISOString().slice(0,19).replace('T',' ');

/** Match magnetic records to each plotted spacecraft sample, including its explicit nearest offset. */
export class MagneticPanels {
  constructor({store=new MagneticStore(),document=globalThis.document,delay=120}={}) {
    this.store=store;this.$=id=>document.getElementById(id);this.delay=delay;
    this.selection={time:null,positions:{}};this.day=null;this.pendingDay=null;this.version=0;
    this.$('magnetic-retry').addEventListener('click',()=>this.setSelection(this.selection,{force:true}));
  }
  setSelection(selection,{force=false}={}) {
    this.selection=selection;
    const targets=PROBES.map(p=>selection.positions[p.id]?.t).filter(Number.isFinite);
    this.day=targets.length ? dayOf(Math.min(...targets)) : null;
    if(this.day===null) {this.cancel();this.render(null);return;}
    const cached=force?null:this.store.peekDay(this.day);
    if(cached) {
      if(this.pendingDay!==null&&this.pendingDay!==this.day) this.cancel();
      this.render(cached);return;
    }
    this.render(null,{loading:true});
    if(!force&&this.pendingDay===this.day) return;
    this.cancel();this.pendingDay=this.day;
    const day=this.day,version=this.version,controller=this.controller=new AbortController();
    this.timer=setTimeout(async()=>{
      try {
        const result=await this.store.getDay(day,{signal:controller.signal,force});
        if(version!==this.version||controller.signal.aborted||this.day!==day) return;
        this.render(result);
      } catch(error) {
        if(version===this.version&&!controller.signal.aborted) this.render(null,{error:error.message});
      } finally {if(version===this.version) {this.pendingDay=null;this.controller=null;}}
    },this.delay);
  }
  render(day,{loading=false,error=null}={}) {
    for(const p of PROBES) {
      const target=this.selection.positions[p.id]?.t;
      const lookup=day&&Number.isFinite(target) ? sampleAt(day.series[p.id],target) : null;
      const failure=error||day?.error;
      const sample=lookup?.exact&&!failure ? lookup.sample : null;
      for(const key of ['l','mlt','mlat']) {
        const value=sample?.[key];
        const formatted=Number.isFinite(value) ?
          (key==='mlt'?(Math.round(value*1000)/1000)%24:value).toFixed(key==='mlat'?2:3) : '—';
        // The scene and inspector share the same source sample and formatting.
        this.$(`${key}-${p.id}`).textContent=formatted;
        this.$(`scene-${key}-${p.id}`).textContent=formatted;
      }
      const status=this.$(`magnetic-status-${p.id}`),source=day?.source;
      status.textContent=!Number.isFinite(target) ? 'No position sample selected' : loading ? 'Loading magnetic coordinates…' :
        failure ? 'Magnetic data unavailable · retrieval failed' : !sample ? 'No magnetic record at this sample UTC' :
        ['l','mlt','mlat'].some(k=>sample[k]===null) ? 'Some magnetic values are missing' : 'NASA SSCWeb · centered dipole';
      status.title=failure||`${MAGNETIC_MODEL}\n${source?.kind||''} response · Retrieved: ${source?.retrievedAt||'not loaded'}\n${source?.url||''}`;
      status.classList.toggle('error-text',Boolean(failure&&Number.isFinite(target)));
      this.$(`magnetic-time-${p.id}`).textContent=sample ? `Magnetic UTC: ${utc(sample.t)}` : 'Magnetic UTC: —';
      const model=this.$(`magnetic-model-${p.id}`);model.href=MAGNETIC_DOC;
      model.title='L: SSCWeb centered-dipole L-value. MLT: Solar Magnetic local time in hours. MLAT: spacecraft latitude in SM, in degrees.';
      this.$(`scene-magnetic-${p.id}`).title=`${status.textContent}\n${this.$(`magnetic-time-${p.id}`).textContent}\n${model.title}${failure ? '\n'+failure : ''}`;
    }
    this.$('magnetic-retry').disabled=loading||this.day===null;
  }
  cancel() {++this.version;clearTimeout(this.timer);this.controller?.abort();this.controller=null;this.pendingDay=null;}
  dispose() {this.cancel();}
}
