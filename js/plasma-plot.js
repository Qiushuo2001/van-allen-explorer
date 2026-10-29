/** Native spacecraft measurements. Lines provide sampled context, never interpolated values. */
import { snapPlotTime } from './index-plot.js?v=1.4.0';
import { PLASMA_SERIES_DEFINITIONS } from './plasma-series.js?v=1.6.0';

const SVG_NS='http://www.w3.org/2000/svg',MINUTE=60000,HOUR=3600000;
const PROBES=['rbspa','rbspb'],EMPTY=Object.freeze([]);
const probeName=probe=>probe==='rbspa'?'Probe A':'Probe B';
const probeClass=probe=>probe==='rbspa'?'pl-probe-a':'pl-probe-b';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const valid=record=>record?.status==='valid'&&finite(record.t)&&finite(record.value)&&record.value>=0;
const utc=time=>new Date(time).toISOString().slice(0,19).replace('T',' ');
const clock=time=>new Date(time).toISOString().slice(11,16);
const num=value=>Number(value.toFixed(3));
const sourceUTC=value=>String(value).replace('T',' ').replace(/Z$/,' UTC');
const offset=value=>`${value>0?'+':''}${(value/1000).toFixed(3)} s`;

export function plasmaPlotNumber(value) {
  if(!finite(value)) return '—';
  if(value===0) return '0';
  return Math.abs(value)<0.001||Math.abs(value)>=100000?value.toExponential(2):Number(value.toPrecision(3)).toString();
}

function domainFor(records) {
  let maximum=0;
  for(const record of records) maximum=Math.max(maximum,record.value);
  if(maximum===0) return {min:0,max:1,ticks:[0,.25,.5,.75,1]};
  const rough=maximum*1.04/4,power=10**Math.floor(Math.log10(rough));
  const fraction=rough/power,multiple=fraction<=1?1:fraction<=2?2:fraction<=5?5:10;
  const step=multiple*power,max=Math.ceil(maximum*1.04/step)*step;
  const ticks=Array.from({length:Math.round(max/step)+1},(_,i)=>i*step);
  return {min:0,max,ticks};
}

/** Retain every native point. Explicit bad rows and cadence gaps break each probe's path. */
export function plasmaPlotGeometry(series,key,start,end,{width=800,height=230}={}) {
  const definition=PLASMA_SERIES_DEFINITIONS[key];
  if(!definition||![start,end,width,height].every(Number.isFinite)||end<=start) throw new Error('Invalid plasma plot range, key or size.');
  const box={left:64,right:Math.max(65,width-18),top:24,bottom:height-48};
  const rows=Object.fromEntries(PROBES.map(probe=>[probe,(series?.[probe]||EMPTY).filter(r=>finite(r?.t)&&r.t>=start&&r.t<end)]));
  const domain=domainFor(PROBES.flatMap(probe=>rows[probe].filter(valid)));
  const x=time=>box.left+(time-start)/(end-start)*(box.right-box.left);
  const y=value=>box.bottom-value/domain.max*(box.bottom-box.top);
  const traces={};
  for(const probe of PROBES) {
    const segments=[];let segment=null,previous=null,count=0;
    for(const record of rows[probe]) {
      if(!valid(record)) {segment=null;previous=null;continue;}
      if(!segment||!previous||record.t<=previous.t||record.t-previous.t>definition.maxGapMs) {
        segment={records:[],path:`M${num(x(record.t))},${num(y(record.value))}`};segments.push(segment);
      } else segment.path+=`L${num(x(record.t))},${num(y(record.value))}`;
      segment.records.push(record);previous=record;count++;
    }
    const isolated=segments.filter(s=>s.records.length===1).map(s=>s.records[0]);
    const isolatedPath=isolated.map(r=>`M${num(x(r.t))},${num(y(r.value))}h0.001`).join('');
    traces[probe]={segments,isolated,isolatedPath,validCount:count,path:segments.filter(s=>s.records.length>1).map(s=>s.path).join('')};
  }
  const divisions=width<460?2:width<640?3:4;
  const xTicks=Array.from({length:divisions+1},(_,i)=>{
    const time=start+(end-start)*i/divisions;
    return {time,x:x(time),label:i===divisions&&clock(time)==='00:00'&&utc(time).slice(0,10)!==utc(start).slice(0,10)?'24:00':clock(time)};
  });
  return {start,end,width,height,box,domain,traces,xTicks,x,y};
}

/** Selection is supplied by the data layer, so hover and playback share its quality/gap rules. */
export class PlasmaPlot {
  constructor({element,key,document=globalThis.document,onSeek=()=>{}}) {
    if(!element||!PLASMA_SERIES_DEFINITIONS[key]) throw new Error('PlasmaPlot needs an element and a supported plasma quantity.');
    this.element=element;this.key=key;this.definition=PLASMA_SERIES_DEFINITIONS[key];this.document=document;this.onSeek=onSeek;
    this.time=null;this.data=null;this.geometry=null;this.width=800;this.height=230;this.hoverTime=null;
    element.classList.add('plasma-plot');element.tabIndex=0;element.setAttribute('role','group');
    element.setAttribute('aria-label',`${this.definition.label} time-series plot for both probes. Click to choose UTC time. Arrow keys move one minute; Shift plus an arrow moves one hour. Home and End select the first and last minute.`);
    this.svg=this.node('svg',{class:'plasma-plot-svg',width:'100%',height:this.height,role:'img','aria-label':`${this.definition.label} versus UTC time for Probe A and Probe B`});
    this.title=this.node('title',{},`${this.definition.label} versus UTC time`);this.description=this.node('desc');this.base=this.node('g');
    this.cursor=this.node('line',{class:'plot-cursor'});this.cursorLabel=this.node('text',{class:'plot-cursor-label',y:14});
    this.hover=this.node('line',{class:'plot-hover'});
    this.cursorPoints=Object.fromEntries(PROBES.map(probe=>[probe,this.node('circle',{class:`plasma-point ${probeClass(probe)}`,r:4})]));
    this.hoverPoints=Object.fromEntries(PROBES.map(probe=>[probe,this.node('circle',{class:`plasma-point ${probeClass(probe)}`,r:3})]));
    this.svg.append(this.title,this.description,this.base,this.cursor,this.cursorLabel,...Object.values(this.cursorPoints),this.hover,...Object.values(this.hoverPoints));
    this.status=document.createElement('div');this.status.className='plasma-plot-status';
    this.statuses=Object.fromEntries(PROBES.map(probe=>{const node=document.createElement('span');node.className=probeClass(probe);this.status.append(node);return [probe,node];}));
    this.inspection=document.createElement('div');this.inspection.className='plasma-plot-inspection';this.inspection.setAttribute('aria-live','off');
    this.inspectionRows=Object.fromEntries(PROBES.map(probe=>{
      const row=document.createElement('div');row.className='plasma-plot-inspection-row';
      const value=document.createElement('strong');value.className=`plasma-inspection-value ${probeClass(probe)}`;
      const time=document.createElement('span');time.className='plasma-inspection-time';row.append(value,time);this.inspection.append(row);return [probe,{row,value,time}];
    }));
    this.hint=document.createElement('p');this.hint.className='plasma-plot-hint';this.hint.textContent='Hover to inspect · Click to select time · Arrow keys: 1 min · Shift + arrow: 1 hour';
    element.replaceChildren(this.svg,this.status,this.inspection,this.hint);
    this.handlers={pointermove:event=>{const time=this.pointerTime(event);if(time!==null)this.inspect(time);else this.clearInspection();},pointerleave:()=>this.clearInspection(),click:event=>{const time=this.pointerTime(event);if(time!==null)this.seek(time);},keydown:event=>this.keydown(event),blur:()=>this.clearInspection()};
    for(const type of ['pointermove','pointerleave','click']) this.svg.addEventListener(type,this.handlers[type]);
    element.addEventListener('keydown',this.handlers.keydown);element.addEventListener('blur',this.handlers.blur);
    if(globalThis.ResizeObserver){this.observer=new globalThis.ResizeObserver(()=>this.resize());this.observer.observe(element);}
    this.hide(this.cursor);this.hide(this.cursorLabel);this.clearInspection();Object.values(this.cursorPoints).forEach(node=>this.hide(node));
  }
  node(tag,attributes={},text) {
    const node=this.document.createElementNS(SVG_NS,tag);
    for(const [key,value] of Object.entries(attributes)) node.setAttribute(key,String(value));
    if(text!==undefined)node.textContent=String(text);return node;
  }
  hide(node,hidden=true){node.style.display=hidden?'none':'';}
  resize(){const width=Math.max(240,Math.round(this.element.getBoundingClientRect?.().width||this.element.clientWidth||800));if(width!==this.width){this.width=width;if(this.data)this.draw();}}
  setData({series,start,end,loading=false,errors={},error=null,select=null}) {
    const nextErrors=Object.fromEntries(PROBES.map(probe=>[probe,error||errors?.[probe]||null]));
    const old=this.data,changed=!old||old.series!==series||old.start!==start||old.end!==end||old.loading!==loading||PROBES.some(probe=>old.errors[probe]!==nextErrors[probe]);
    this.data={series:series||{},start,end,loading,errors:nextErrors,select};
    if(!changed){this.setTime(this.time);if(this.hoverTime!==null)this.inspect(this.hoverTime);return;}
    this.width=Math.max(240,Math.round(this.element.getBoundingClientRect?.().width||this.element.clientWidth||800));this.draw();
  }
  draw() {
    const {series,start,end,loading,errors}=this.data;
    const visible=Object.fromEntries(PROBES.map(probe=>[probe,loading||errors[probe]?EMPTY:series?.[probe]||EMPTY]));
    const g=this.geometry=plasmaPlotGeometry(visible,this.key,start,end,{width:this.width,height:this.height});
    this.svg.setAttribute('viewBox',`0 0 ${g.width} ${g.height}`);this.base.replaceChildren();
    this.description.textContent=`${this.definition.label} native measurements on ${utc(start).slice(0,10)} UTC. Probe A: ${g.traces.rbspa.validCount} valid samples; Probe B: ${g.traces.rbspb.validCount}. Lines connect adjacent valid samples only; gaps and rejected values remain unconnected. Readouts use actual source records without interpolation.`;
    const {box}=g;
    for(const value of g.domain.ticks){const y=g.y(value);this.base.append(this.node('line',{class:value===0?'plot-grid-line plot-zero-line':'plot-grid-line',x1:box.left,x2:box.right,y1:y,y2:y}));this.base.append(this.node('text',{class:'plot-tick',x:box.left-8,y:y+4,'text-anchor':'end'},plasmaPlotNumber(value)));}
    this.base.append(this.node('line',{class:'plot-axis-line',x1:box.left,x2:box.left,y1:box.top,y2:box.bottom}));
    this.base.append(this.node('line',{class:'plot-axis-line',x1:box.left,x2:box.right,y1:box.bottom,y2:box.bottom}));
    for(const tick of g.xTicks){this.base.append(this.node('line',{class:'plot-axis-line',x1:tick.x,x2:tick.x,y1:box.bottom,y2:box.bottom+5}));this.base.append(this.node('text',{class:'plot-tick',x:tick.x,y:box.bottom+20,'text-anchor':tick.time===start?'start':tick.time===end?'end':'middle'},tick.label));}
    this.base.append(this.node('text',{class:'plot-axis-label',x:box.left-8,y:14,'text-anchor':'end'},this.key==='density'?'cm⁻³':this.key==='beta'?'βe':'ratio'));
    this.base.append(this.node('text',{class:'plot-axis-label',x:(box.left+box.right)/2,y:g.height-5,'text-anchor':'middle'},`Time (UTC) · ${utc(start).slice(0,10)}`));
    for(const probe of PROBES){const trace=g.traces[probe];if(trace.path)this.base.append(this.node('path',{class:`plasma-trace ${probeClass(probe)}`,d:trace.path,fill:'none','vector-effect':'non-scaling-stroke'}));if(trace.isolatedPath)this.base.append(this.node('path',{class:`plasma-trace plasma-isolated ${probeClass(probe)}`,d:trace.isolatedPath,fill:'none','vector-effect':'non-scaling-stroke'}));
      const status=this.statuses[probe];status.textContent=loading?`${probeName(probe)}: loading…`:errors[probe]?`${probeName(probe)}: retrieval failed`:!trace.validCount?`${probeName(probe)}: no valid measurements this day`:'';status.title=errors[probe]||'';this.hide(status,!status.textContent);
    }
    this.element.setAttribute('aria-busy',String(loading));this.setTime(this.time);this.clearInspection();
  }
  selection(probe,time){if(!this.data||this.data.loading||this.data.errors[probe]||typeof this.data.select!=='function')return null;return this.data.select(probe,time);}
  placeMarker(node,field,selectedTime) {
    const g=this.geometry,t=finite(field?.t)?field.t:finite(selectedTime)&&finite(field?.offsetMs)?selectedTime+field.offsetMs:field?.sourceTime?Date.parse(field.sourceTime):NaN;
    const visible=field?.status==='valid'&&finite(field.value)&&field.value>=0&&finite(t)&&t>=g.start&&t<g.end&&field.value<=g.domain.max;
    this.hide(node,!visible);if(visible){node.setAttribute('cx',String(g.x(t)));node.setAttribute('cy',String(g.y(field.value)));}
  }
  setTime(time) {
    this.time=time;const g=this.geometry,visible=g&&finite(time)&&time>=g.start&&time<g.end;
    this.hide(this.cursor,!visible);this.hide(this.cursorLabel,!visible);
    if(!visible){Object.values(this.cursorPoints).forEach(node=>this.hide(node));return;}
    const x=g.x(time);for(const [key,value] of Object.entries({x1:x,x2:x,y1:g.box.top,y2:g.box.bottom}))this.cursor.setAttribute(key,String(value));
    this.cursorLabel.setAttribute('x',String(x));this.cursorLabel.setAttribute('text-anchor',x>g.box.right-65?'end':x<g.box.left+65?'start':'middle');this.cursorLabel.textContent=utc(time).slice(11);
    for(const probe of PROBES)this.placeMarker(this.cursorPoints[probe],this.selection(probe,time),time);
  }
  pointerTime(event) {
    if(!this.geometry)return null;const rect=this.svg.getBoundingClientRect(),g=this.geometry;if(!rect.width||!rect.height)return null;
    const x=(event.clientX-rect.left)/rect.width*g.width,y=(event.clientY-rect.top)/rect.height*g.height;
    if(x<g.box.left||x>g.box.right||y<g.box.top||y>g.box.bottom)return null;
    return Math.min(g.end-1,g.start+(x-g.box.left)/(g.box.right-g.box.left)*(g.end-g.start));
  }
  inspect(time) {
    const g=this.geometry;if(!g)return;this.hoverTime=time;this.hide(this.hover,false);const x=g.x(time);
    for(const [key,value] of Object.entries({x1:x,x2:x,y1:g.box.top,y2:g.box.bottom}))this.hover.setAttribute(key,String(value));
    for(const probe of PROBES){const field=this.selection(probe,time),row=this.inspectionRows[probe];this.placeMarker(this.hoverPoints[probe],field,time);
      row.value.textContent=`${probeName(probe)} · ${field?.status==='valid'?plasmaPlotNumber(field.value)+(this.definition.units?' '+this.definition.units:''):this.data.loading?'Loading':this.data.errors[probe]?'Retrieval failed':'No measurement'}`;
      const parts=[];if(field?.sourceTime)parts.push(`Source UTC: ${sourceUTC(field.sourceTime)}${finite(field.offsetMs)?` (${offset(field.offsetMs)})`:''}`);
      if(this.key==='beta'&&field?.fieldTime)parts.push(`|B| UTC: ${sourceUTC(field.fieldTime)}${finite(field.fieldOffsetMs)?` (${offset(field.fieldOffsetMs)} from HOPE)`:''}`);
      if(field?.status!=='valid')parts.push(field?.note||this.data.errors[probe]||`At ${utc(time)} UTC`);
      row.time.textContent=parts.join(' · ');row.time.title=field?.note||this.data.errors[probe]||'';
    }
  }
  clearInspection(){this.hoverTime=null;this.hide(this.hover);Object.values(this.hoverPoints).forEach(node=>this.hide(node));for(const probe of PROBES){this.inspectionRows[probe].value.textContent=probeName(probe);this.inspectionRows[probe].time.textContent='Hover over the plot to inspect native measurements.';this.inspectionRows[probe].time.title='';}}
  seek(time){if(this.geometry){const selected=snapPlotTime(time,this.geometry.start,this.geometry.end);if(selected!==null)this.onSeek(selected);}}
  keydown(event){if(!this.geometry)return;const g=this.geometry,current=finite(this.time)?this.time:g.start;let target;if(event.key==='ArrowLeft'||event.key==='ArrowRight')target=current+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?HOUR:MINUTE);else if(event.key==='Home')target=g.start;else if(event.key==='End')target=g.end-1;else return;event.preventDefault();this.seek(target);}
  dispose(){this.observer?.disconnect();for(const type of ['pointermove','pointerleave','click'])this.svg.removeEventListener(type,this.handlers[type]);this.element.removeEventListener('keydown',this.handlers.keydown);this.element.removeEventListener('blur',this.handlers.blur);}
}
