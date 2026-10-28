/** Native-bin index plots. Horizontal steps represent the measured bin; no interpolation. */
import { lookupIndex } from './indices.js?v=1.4.0';

const SVG_NS='http://www.w3.org/2000/svg';
const MINUTE=60000,HOUR=3600000;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const valid=record=>record?.status==='valid'&&finite(record.value)&&finite(record.start)&&finite(record.end)&&record.end>record.start;
const utc=time=>new Date(time).toISOString().slice(0,19).replace('T',' ');
const clock=time=>new Date(time).toISOString().slice(11,16);
const num=value=>Number(value.toFixed(2));

/** Select only the actual source bin containing t, never a neighboring good value. */
export function indexPlotSample(records,time) {
  const found=lookupIndex(records,time);
  return found.status==='valid'&&valid(found.sample) ? found.sample : null;
}

/** Round a plot gesture to UTC minutes; the right-hand day boundary is exclusive. */
export function snapPlotTime(time,start,end) {
  if(![time,start,end].every(Number.isFinite)||end<=start) return null;
  const first=Math.ceil(start/MINUTE)*MINUTE,last=Math.ceil(end/MINUTE)*MINUTE-MINUTE;
  if(last<first) return null;
  return Math.max(first,Math.min(last,Math.round(time/MINUTE)*MINUTE));
}

function domainFor(records) {
  let minimum=0,maximum=0;
  for(const record of records) {minimum=Math.min(minimum,record.value);maximum=Math.max(maximum,record.value);}
  if(minimum===maximum) return {min:0,max:1,ticks:[0,1]};
  const span=maximum-minimum,rough=span/4,power=10**Math.floor(Math.log10(rough));
  const fraction=rough/power,multiple=fraction<=1?1:fraction<=2?2:fraction<=5?5:10;
  const step=Math.max(1,multiple*power);
  const min=minimum<0?Math.floor((minimum-span*.04)/step)*step:0;
  const max=maximum>0?Math.ceil((maximum+span*.04)/step)*step:0;
  const ticks=[];
  for(let value=min;value<=max+step*.001;value+=step) ticks.push(Object.is(value,-0)?0:value);
  return {min,max,ticks};
}

/** Geometry preserves each native bin and splits traces at every missing/invalid bin.
 * Missing spans are the complement of valid measurements, including absent rows.
 */
export function indexPlotGeometry(records,start,end,{width=800,height=210}={}) {
  if(![start,end,width,height].every(Number.isFinite)||end<=start) throw new Error('Invalid plot range or size.');
  const box={left:48,right:Math.max(49,width-18),top:23,bottom:height-47};
  const visible=(records||[]).filter(record=>valid(record)&&record.end>start&&record.start<end)
    .slice().sort((a,b)=>a.start-b.start);
  const domain=domainFor(visible);
  const x=time=>box.left+(time-start)/(end-start)*(box.right-box.left);
  const y=value=>box.bottom-(value-domain.min)/(domain.max-domain.min)*(box.bottom-box.top);
  const segments=[];
  let segment=null,previousEnd=null;
  for(const record of visible) {
    const a=Math.max(start,record.start),b=Math.min(end,record.end);
    // Overlapping bins are not a supported source convention; never join them.
    if(!segment||record.start!==previousEnd) {
      segment={records:[],path:`M${num(x(a))},${num(y(record.value))}`};segments.push(segment);
    } else segment.path+=`V${num(y(record.value))}`;
    segment.records.push(record);
    segment.path+=`H${num(x(b))}`;
    previousEnd=record.end;
  }
  const gaps=[];let covered=start;
  for(const record of visible) {
    const a=Math.max(start,record.start),b=Math.min(end,record.end);
    if(a>covered) gaps.push({start:covered,end:a});
    covered=Math.max(covered,b);
  }
  if(covered<end) gaps.push({start:covered,end});
  const divisions=width<460?2:width<640?3:4;
  const xTicks=Array.from({length:divisions+1},(_,i)=>{
    const time=start+(end-start)*i/divisions;
    const midnightEnd=i===divisions&&clock(time)==='00:00'&&utc(time).slice(0,10)!==utc(start).slice(0,10);
    return {time,x:x(time),label:midnightEnd?'24:00':clock(time)};
  });
  return {start,end,width,height,box,domain,segments,gaps,xTicks,x,y,validCount:visible.length};
}

export class IndexPlot {
  constructor({element,key,document=globalThis.document,onSeek=()=>{}}) {
    if(!element||!['ae','symh'].includes(key)) throw new Error('IndexPlot needs an element and AE/SYM-H key.');
    this.element=element;this.key=key;this.name=key==='ae'?'AE':'SYM-H';this.document=document;this.onSeek=onSeek;
    this.time=null;this.data=null;this.geometry=null;this.hoverTime=null;this.width=800;this.height=210;
    this.element.classList.add('index-plot');this.element.tabIndex=0;
    this.element.setAttribute('role','group');
    this.element.setAttribute('aria-label',`${this.name} time-series plot. Click to choose time. Arrow keys move one minute; Shift plus an arrow moves one hour. Home and End select the first and last minute.`);
    this.svg=this.node('svg',{class:'index-plot-svg',width:'100%',height:this.height,role:'img','aria-label':`${this.name}, nT versus UTC time`});
    this.title=this.node('title',{},`${this.name} index, nT versus UTC time`);
    this.description=this.node('desc');this.base=this.node('g');
    this.cursor=this.node('line',{class:'plot-cursor'});
    this.cursorPoint=this.node('circle',{class:'plot-cursor-point',r:4});
    this.cursorLabel=this.node('text',{class:'plot-cursor-label',y:14});
    this.hover=this.node('line',{class:'plot-hover'});
    this.hoverPoint=this.node('circle',{class:'plot-hover-point',r:3});
    this.svg.append(this.title,this.description,this.base,this.cursor,this.cursorPoint,this.cursorLabel,this.hover,this.hoverPoint);
    this.status=document.createElement('p');this.status.className='plot-status';
    this.inspection=document.createElement('div');this.inspection.className='plot-inspection';
    this.inspection.setAttribute('aria-live','off');
    this.inspectionValue=document.createElement('strong');this.inspectionValue.className='plot-inspection-value';
    this.inspectionTime=document.createElement('span');this.inspectionTime.className='plot-inspection-time';
    this.inspection.append(this.inspectionValue,this.inspectionTime);
    this.element.replaceChildren(this.svg,this.status,this.inspection);
    this.handlers={
      pointermove:event=>{const time=this.pointerTime(event);if(time!==null) this.inspect(time);else this.clearInspection();},
      pointerleave:()=>this.clearInspection(),
      click:event=>{const time=this.pointerTime(event);if(time!==null) this.seek(time);},
      keydown:event=>this.keydown(event),
      blur:()=>this.clearInspection(),
    };
    for(const type of ['pointermove','pointerleave','click']) this.svg.addEventListener(type,this.handlers[type]);
    this.element.addEventListener('keydown',this.handlers.keydown);this.element.addEventListener('blur',this.handlers.blur);
    const ResizeObserverClass=globalThis.ResizeObserver;
    if(ResizeObserverClass) {this.observer=new ResizeObserverClass(()=>this.resize());this.observer.observe(this.element);}
    this.clearInspection();this.hide(this.cursor);this.hide(this.cursorPoint);this.hide(this.cursorLabel);
  }
  node(tag,attributes={},text) {
    const node=this.document.createElementNS(SVG_NS,tag);
    for(const [key,value] of Object.entries(attributes)) node.setAttribute(key,String(value));
    if(text!==undefined) node.textContent=String(text);
    return node;
  }
  hide(node,hidden=true) {node.style.display=hidden?'none':'';}
  resize() {
    const actual=this.element.getBoundingClientRect?.().width||this.element.clientWidth||800;
    const width=Math.max(240,Math.round(actual));
    if(width===this.width) return;
    this.width=width;if(this.data) this.draw();
  }
  setData({records,start,end,loading=false,error=null}) {
    const old=this.data;
    if(old&&old.records===records&&old.start===start&&old.end===end&&old.loading===loading&&old.error===error) return;
    this.data={records:records||[],start,end,loading,error};
    this.width=Math.max(240,Math.round(this.element.getBoundingClientRect?.().width||this.element.clientWidth||800));
    this.clearInspection();this.draw();
  }
  draw() {
    const {records,start,end,loading,error}=this.data;
    const g=this.geometry=indexPlotGeometry(loading||error?[]:records,start,end,{width:this.width,height:this.height});
    this.svg.setAttribute('viewBox',`0 0 ${g.width} ${g.height}`);
    this.base.replaceChildren();
    this.description.textContent=`${this.name} native minute bins on ${utc(start).slice(0,10)} UTC. Steps are constant within the source bin; gaps remain unconnected. ${g.validCount} valid bins displayed.`;
    const {box}=g;
    for(const gap of g.gaps) this.base.append(this.node('rect',{class:'plot-gap',x:g.x(gap.start),y:box.top,width:g.x(gap.end)-g.x(gap.start),height:box.bottom-box.top}));
    for(const value of g.domain.ticks) {
      const y=g.y(value);
      this.base.append(this.node('line',{class:value===0?'plot-grid-line plot-zero-line':'plot-grid-line',x1:box.left,x2:box.right,y1:y,y2:y}));
      this.base.append(this.node('text',{class:'plot-tick',x:box.left-9,y:y+4,'text-anchor':'end'},value));
    }
    this.base.append(this.node('line',{class:'plot-axis-line',x1:box.left,x2:box.left,y1:box.top,y2:box.bottom}));
    this.base.append(this.node('line',{class:'plot-axis-line',x1:box.left,x2:box.right,y1:box.bottom,y2:box.bottom}));
    for(const tick of g.xTicks) {
      this.base.append(this.node('line',{class:'plot-axis-line',x1:tick.x,x2:tick.x,y1:box.bottom,y2:box.bottom+5}));
      this.base.append(this.node('text',{class:'plot-tick',x:tick.x,y:box.bottom+20,'text-anchor':tick.time===start?'start':tick.time===end?'end':'middle'},tick.label));
    }
    this.base.append(this.node('text',{class:'plot-axis-label',x:box.left-9,y:14,'text-anchor':'end'},'nT'));
    this.base.append(this.node('text',{class:'plot-axis-label',x:(box.left+box.right)/2,y:g.height-5,'text-anchor':'middle'},`Time (UTC) · ${utc(start).slice(0,10)}`));
    for(const segment of g.segments) this.base.append(this.node('path',{class:'plot-trace',d:segment.path,fill:'none','vector-effect':'non-scaling-stroke'}));
    this.status.textContent=loading?'Loading index history…':error?'Index history unavailable · retrieval failed':!g.validCount?'No valid measurements for this UTC day':'';
    this.status.title=error||'';this.status.style.display=this.status.textContent?'':'none';
    this.element.setAttribute('aria-busy',String(loading));
    this.setTime(this.time);this.clearInspection();
  }
  setTime(time) {
    this.time=time;
    const g=this.geometry,visible=g&&Number.isFinite(time)&&time>=g.start&&time<g.end;
    this.hide(this.cursor,!visible);this.hide(this.cursorLabel,!visible);
    if(!visible) {this.hide(this.cursorPoint);return;}
    const x=g.x(time);
    for(const [key,value] of Object.entries({x1:x,x2:x,y1:g.box.top,y2:g.box.bottom})) this.cursor.setAttribute(key,String(value));
    this.cursorLabel.setAttribute('x',String(Math.max(g.box.left,Math.min(g.box.right,x))));
    this.cursorLabel.setAttribute('text-anchor',x>g.box.right-65?'end':x<g.box.left+65?'start':'middle');
    this.cursorLabel.textContent=utc(time).slice(11);
    const sample=!this.data.loading&&!this.data.error?indexPlotSample(this.data.records,time):null;
    this.hide(this.cursorPoint,!sample);
    if(sample) {this.cursorPoint.setAttribute('cx',String(x));this.cursorPoint.setAttribute('cy',String(g.y(sample.value)));}
  }
  pointerTime(event) {
    if(!this.geometry) return null;
    const rect=this.svg.getBoundingClientRect(),g=this.geometry;
    if(!rect.width||!rect.height) return null;
    const x=(event.clientX-rect.left)/rect.width*g.width,y=(event.clientY-rect.top)/rect.height*g.height;
    if(x<g.box.left||x>g.box.right||y<g.box.top||y>g.box.bottom) return null;
    return Math.min(g.end-1,g.start+(x-g.box.left)/(g.box.right-g.box.left)*(g.end-g.start));
  }
  inspect(time) {
    const g=this.geometry;if(!g) return;
    this.hoverTime=time;
    const sample=!this.data.loading&&!this.data.error?indexPlotSample(this.data.records,time):null;
    const x=g.x(time);this.hide(this.hover,false);
    for(const [key,value] of Object.entries({x1:x,x2:x,y1:g.box.top,y2:g.box.bottom})) this.hover.setAttribute(key,String(value));
    this.hide(this.hoverPoint,!sample);
    if(sample) {
      this.hoverPoint.setAttribute('cx',String(x));this.hoverPoint.setAttribute('cy',String(g.y(sample.value)));
      this.inspectionValue.textContent=`${this.name} ${sample.value} nT`;
      this.inspectionTime.textContent=`Source UTC: ${utc(sample.t)} · Bin [${utc(sample.start)}, ${utc(sample.end)})`;
    } else {
      this.inspectionValue.textContent=this.data.loading?'Loading measurements':this.data.error?'Retrieval failed':'No measurement';
      this.inspectionTime.textContent=`At ${utc(time)} UTC · No value is interpolated or carried across a gap.`;
    }
  }
  clearInspection() {
    this.hoverTime=null;this.hide(this.hover);this.hide(this.hoverPoint);
    this.inspectionValue.textContent='Hover to inspect · click to select time';
    this.inspectionTime.textContent='Arrow keys: 1 minute · Shift + arrow: 1 hour';
  }
  seek(time) {
    if(!this.geometry) return;
    const selected=snapPlotTime(time,this.geometry.start,this.geometry.end);
    if(selected!==null) this.onSeek(selected);
  }
  keydown(event) {
    if(!this.geometry) return;
    const g=this.geometry,current=Number.isFinite(this.time)?this.time:g.start;
    let target;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight') target=current+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?HOUR:MINUTE);
    else if(event.key==='Home') target=g.start;
    else if(event.key==='End') target=g.end-1;
    else return;
    event.preventDefault();this.seek(target);
  }
  dispose() {
    this.observer?.disconnect();
    for(const type of ['pointermove','pointerleave','click']) this.svg.removeEventListener(type,this.handlers[type]);
    this.element.removeEventListener('keydown',this.handlers.keydown);this.element.removeEventListener('blur',this.handlers.blur);
  }
}
