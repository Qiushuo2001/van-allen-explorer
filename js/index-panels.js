import { GeomagneticStore, lookupIndex } from './indices.js?v=1.4.0';
import { IndexPlot } from './index-plot.js?v=1.4.0';

const MINUTE = 60000, DAY = 86400000;
const utc = t => new Date(t).toISOString().slice(0,19).replace('T',' ');
const dayOf = t => Math.floor(t / DAY) * DAY;
const EMPTY_RECORDS=Object.freeze([]);
const kinds = {bundled:'Bundled NASA response',live:'Live NASA response',imported:'Imported NASA response',unavailable:'No response loaded'};

/** Global geomagnetic indices have their own availability and never depend on a probe's orbit. */
export class GeomagneticPanels {
  constructor({store = new GeomagneticStore(), document = globalThis.document, delay = 120,
    onSeek=()=>{}, plotFactory=options=>new IndexPlot(options)} = {}) {
    this.store=store; this.document=document; this.delay=delay;
    this.time=null; this.pendingDay=null; this.version=0; this.controller=null; this.timer=null;
    this.$=id=>document.getElementById(id);
    this.plotInputs=new Map();
    this.plots=Object.fromEntries(['ae','symh'].map(key=>[key,plotFactory({element:this.$(`index-${key}-plot`),key,document,onSeek})]));
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
    const start=day?.dayStart ?? dayOf(this.time),end=day?.dayEnd ?? start+DAY;
    this.$('indices-day').textContent=`${new Date(start).toISOString().slice(0,10)} · 00:00–24:00 UTC`;
    for(const id of ['ae','symh']) {
      const lookup=day ? lookupIndex(day[id],this.time) : {sample:null,status:'missing'};
      const sample=lookup.sample;
      const source=day?.sources?.[id];
      const failure=error || day?.errors?.[id];
      // Geometry depends on the loaded day, never on the moving playback cursor.
      const input={records:failure?EMPTY_RECORDS:(day?.[id]??EMPTY_RECORDS),start,end,loading,error:failure||null};
      const previous=this.plotInputs.get(id);
      if(!previous||Object.keys(input).some(key=>input[key]!==previous[key])) {
        this.plots[id].setData(input);this.plotInputs.set(id,input);
      }
      this.plots[id].setTime(this.time);
      const valid=lookup.status==='valid' && sample && !failure;
      const binStart=sample?.start ?? Math.floor(this.time/MINUTE)*MINUTE;
      const binEnd=sample?.end ?? binStart+MINUTE;
      const unit='Minute';
      this.$(`index-${id}-value`).textContent=valid ? String(sample.value) : '—';
      this.$(`index-${id}-state`).textContent=loading ? 'Loading measurement…' : failure ? 'Unavailable · retrieval failed' :
        valid ? 'Measured minute index' :
        lookup.status==='fill' ? 'Unavailable · source fill value' :
        lookup.status==='invalid' ? 'Unavailable · invalid source record' : `Unavailable · no record for this ${unit.toLowerCase()}`;
      this.$(`index-${id}-state`).title=failure || '';
      this.$(`index-${id}-state`).classList.toggle('error-text',Boolean(failure));
      this.$(`index-${id}-time`).textContent=sample ? `Source UTC: ${utc(sample.t)}` : 'Source UTC: —';
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

  dispose() {this.cancel();for(const plot of Object.values(this.plots)) plot.dispose();}
}
