import { GeomagneticStore, lookupIndex } from './indices.js';

const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
const utc = t => new Date(t).toISOString().slice(0,19).replace('T',' ');
const dayOf = t => Math.floor(t / DAY) * DAY;
const kinds = {bundled:'Bundled NASA response',live:'Live NASA response',imported:'Imported NASA response',unavailable:'No response loaded'};

/** Global geomagnetic indices have their own availability and never depend on a probe's orbit. */
export class GeomagneticPanels {
  constructor({store = new GeomagneticStore(), document = globalThis.document, delay = 120} = {}) {
    this.store=store; this.document=document; this.delay=delay;
    this.time=null; this.pendingDay=null; this.version=0; this.controller=null; this.timer=null;
    this.$=id=>document.getElementById(id);
    this.$('indices-retry').addEventListener('click',()=>{ if(this.time!==null) this.setTime(this.time,{force:true}); });
  }

  setTime(t,{force=false}={}) {
    if(!Number.isFinite(t)) return;
    this.time=t;
    const cached=force ? null : this.store.peekDay(t);
    if(cached) {
      if(this.pendingDay!==null && this.pendingDay!==dayOf(t)) this.cancel();
      this.render(cached);
      return;
    }
    // Clear the previous time's values immediately, even during rapid slider movement.
    this.render(null,{loading:true});
    if(!force && this.pendingDay===dayOf(t)) return;
    this.cancel();
    this.pendingDay=dayOf(t);
    const version=this.version;
    const controller=this.controller=new AbortController();
    this.timer=setTimeout(async()=>{
      this.timer=null;
      try {
        const result=await this.store.getDay(t,{signal:controller.signal,force});
        if(version!==this.version || controller.signal.aborted || dayOf(this.time)!==result.dayStart) return;
        this.render(result);
      } catch(error) {
        if(version!==this.version || controller.signal.aborted) return;
        this.render(null,{error:error.message || String(error)});
      } finally {
        if(version===this.version) {this.pendingDay=null;this.controller=null;}
      }
    },this.delay);
  }

  render(day,{loading=false,error=null}={}) {
    for(const id of ['ae','dst']) {
      const lookup=day ? lookupIndex(day[id],this.time) : {sample:null,status:'missing'};
      const sample=lookup.sample;
      const source=day?.sources?.[id];
      const failure=error || day?.errors?.[id];
      const valid=lookup.status==='valid' && sample && !failure;
      const duration=id==='ae' ? MINUTE : HOUR;
      const binStart=sample?.start ?? Math.floor(this.time/duration)*duration;
      const binEnd=sample?.end ?? binStart+duration;
      const unit=id==='ae' ? 'Minute' : 'Hour';
      this.$(`index-${id}-value`).textContent=valid ? String(sample.value) : '—';
      this.$(`index-${id}-state`).textContent=loading ? 'Loading measurement…' : failure ? 'Unavailable · retrieval failed' :
        valid ? (id==='ae' ? 'Measured minute index' : 'Measured hourly index') :
        lookup.status==='fill' ? 'Unavailable · source fill value' :
        lookup.status==='invalid' ? 'Unavailable · invalid source record' : `Unavailable · no record for this ${unit.toLowerCase()}`;
      this.$(`index-${id}-state`).title=failure || '';
      this.$(`index-${id}-state`).classList.toggle('error-text',Boolean(failure));
      this.$(`index-${id}-time`).textContent=sample ? `Source UTC: ${utc(sample.t)}${id==='dst' ? ' (hour midpoint)' : ''}` : 'Source UTC: —';
      const endText=new Date(binStart).getUTCDate()===new Date(binEnd).getUTCDate() ? utc(binEnd).slice(11) : utc(binEnd);
      this.$(`index-${id}-interval`).textContent=`${sample ? unit : 'Requested '+unit.toLowerCase()} UTC: [${utc(binStart)}, ${endText})`;
      this.$(`index-${id}-interval`).title='The interval includes its start and excludes its end. The original source timestamp is shown separately.';
      const sourceLink=this.$(`index-${id}-source`);
      sourceLink.textContent='NASA OMNI · WDC Kyoto';
      sourceLink.href=source?.url || source?.infoURL || 'https://omniweb.gsfc.nasa.gov/';
      sourceLink.title=source ? `${source.dataset} / ${source.parameter}\nRetrieved: ${source.retrievedAt || 'not yet retrieved'}\n${source.url || source.infoURL || ''}` : 'NASA OMNI archive; indices produced by WDC for Geomagnetism, Kyoto.';
      this.$(`index-${id}-quality`).textContent=source?.quality?.label ? `Series status: ${source.quality.label}` : 'Series status: not yet loaded';
      this.$(`index-${id}-quality`).title=source?.quality ? `${source.quality.sourceURL || ''}\nVerified: ${source.quality.verifiedAt || 'unspecified'}\n${source.quality.note || ''}` : '';
      this.$(`index-${id}-origin`).textContent=source ? `${kinds[source.kind] || source.kind || 'NASA archive'} · ${source.dataset}` : '';
    }
    this.$('indices-section').setAttribute('aria-busy',String(loading));
    this.$('indices-retry').disabled=loading;
  }

  cancel() {
    ++this.version;
    clearTimeout(this.timer); this.timer=null;
    this.controller?.abort(); this.controller=null; this.pendingDay=null;
  }

  dispose() {this.cancel();}
}
