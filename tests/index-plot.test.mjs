import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseIndexData} from '../js/indices.js';
import {IndexPlot,indexPlotGeometry,indexPlotSample,snapPlotTime} from '../js/index-plot.js';

const MINUTE=60000,HOUR=3600000,DAY=24*HOUR;
const start=Date.parse('2015-03-17T00:00:00Z'),end=start+DAY;
const load=async key=>parseIndexData(JSON.parse(await readFile(new URL(`../data/indices/${key}-20150316-20150319.json`,import.meta.url),'utf8')),key)
  .filter(record=>record.start>=start&&record.start<end);
const ae=await load('ae'),dst=await load('dst');

test('Real AE/Dst plots retain every source bin and include both signs and zero',()=>{
  const a=indexPlotGeometry(ae,start,end),d=indexPlotGeometry(dst,start,end);
  assert.equal(a.validCount,1440);assert.equal(d.validCount,24);
  assert.equal(a.segments.length,1);assert.equal(d.segments.length,1);
  assert.equal(a.segments[0].records.length,1440,'No downsampling removes AE peaks');
  assert.equal(d.segments[0].records.length,24);
  assert.equal(a.gaps.length,0);assert.equal(d.gaps.length,0);
  assert.equal(a.domain.min,0);assert.ok(a.domain.max>=2298);
  assert.ok(d.domain.min<=-234&&d.domain.max>=45,'Dst axis includes positive and negative measurements');
  assert.ok(d.domain.ticks.includes(0));
  assert.equal(d.xTicks.at(-1).label,'24:00','The last tick means the next midnight');
  assert.equal(indexPlotGeometry(ae,start,end,{width:320}).xTicks.length,3);
});

test('Hourly Dst paths are horizontal across their bin and vertical at the hourly boundary',()=>{
  const records=dst.filter(s=>s.start>=start+12*HOUR&&s.start<start+14*HOUR);
  const g=indexPlotGeometry(records,start+12*HOUR,start+14*HOUR);
  assert.equal(records[0].value,-55);assert.equal(records[1].value,-75);
  assert.equal(records[0].t,start+12.5*HOUR,'Original epoch is the hour midpoint');
  assert.equal(g.segments.length,1);
  assert.match(g.segments[0].path,/^M[\d.,-]+H[\d.]+V[\d.-]+H[\d.]+$/,'There is no diagonal/smoothed line between hourly measurements');
  assert.equal(indexPlotSample(records,start+12*HOUR).value,-55);
  assert.equal(indexPlotSample(records,start+13*HOUR-1).value,-55);
  assert.equal(indexPlotSample(records,start+13*HOUR).value,-75);
  assert.equal(indexPlotSample(records,start+14*HOUR),null);
});

test('Omitted, filled and invalid bins break paths and create explicit gaps',()=>{
  for(const type of ['omitted','fill','invalid']) {
    const records=structuredClone(dst);
    if(type==='omitted') records.splice(12,1);
    else Object.assign(records[12],{status:type,value:null});
    const g=indexPlotGeometry(records,start,end);
    assert.equal(g.validCount,23);assert.equal(g.segments.length,2);
    assert.deepEqual(g.gaps,[{start:start+12*HOUR,end:start+13*HOUR}]);
    assert.equal(indexPlotSample(records,start+12.5*HOUR),null,'No preceding/following valid measurement fills the gap');
  }
  const only=dst.slice(6,9),g=indexPlotGeometry(only,start,end);
  assert.deepEqual(g.gaps,[{start,end:start+6*HOUR},{start:start+9*HOUR,end}]);
});

test('Zero values remain measurements; absent/all-invalid days contain no data path',()=>{
  const zero={...dst[0],value:0,status:'valid'};
  const g=indexPlotGeometry([zero],start,end);
  assert.equal(g.validCount,1);assert.ok(g.segments[0].path);
  assert.equal(indexPlotSample([zero],zero.start).value,0);
  for(const records of [[],[{...zero,value:null,status:'fill'}],[{...zero,value:NaN}]]) {
    const empty=indexPlotGeometry(records,start,end);
    assert.equal(empty.segments.length,0);assert.deepEqual(empty.gaps,[{start,end}]);
    assert.ok(Number.isFinite(empty.y(0)));
  }
});

test('Plot gestures select whole UTC minutes with an exclusive day end',()=>{
  assert.equal(snapPlotTime(start+22999,start,end),start);
  assert.equal(snapPlotTime(start+38000,start,end),start+MINUTE);
  assert.equal(snapPlotTime(end,start,end),end-MINUTE);
  assert.equal(snapPlotTime(start-DAY,start,end),start);
  assert.equal(snapPlotTime(NaN,start,end),null);
});

class FakeNode {
  constructor(tag='div') {this.tag=tag;this.attributes={};this.children=[];this.style={};this.listeners={};this.textContent='';this.classList={add(){}};this.clientWidth=800;}
  setAttribute(key,value) {this.attributes[key]=String(value);}
  append(...nodes) {this.children.push(...nodes);}
  replaceChildren(...nodes) {this.children=[...nodes];}
  addEventListener(type,fn) {this.listeners[type]=fn;}
  removeEventListener(type) {delete this.listeners[type];}
  getBoundingClientRect() {return {left:0,top:0,width:this.clientWidth,height:210};}
}
const document={createElement:tag=>new FakeNode(tag),createElementNS:(_ns,tag)=>new FakeNode(tag)};

test('Renderer updates selected cursor without rebuilding source geometry and discloses original Dst epoch',()=>{
  const element=new FakeNode(),selections=[];
  const plot=new IndexPlot({element,key:'dst',document,onSeek:t=>selections.push(t)});
  plot.setData({records:dst,start,end});
  const geometry=plot.geometry,baseNodes=plot.base.children;
  plot.setTime(start+12*HOUR+22000);
  assert.equal(plot.geometry,geometry);assert.equal(plot.base.children,baseNodes);
  assert.equal(plot.cursorLabel.textContent,'12:00:22');
  assert.equal(plot.cursorPoint.style.display,'');
  plot.setData({records:dst,start,end});assert.equal(plot.geometry,geometry,'Repeated identical day data are not redrawn');
  plot.inspect(start+12*HOUR+22*MINUTE);
  assert.equal(plot.inspectionValue.textContent,'Dst -55 nT');
  assert.match(plot.inspectionTime.textContent,/Source UTC: 2015-03-17 12:30:00 \(hour midpoint\)/);
  assert.match(plot.inspectionTime.textContent,/Bin \[2015-03-17 12:00:00, 2015-03-17 13:00:00\)/);
  plot.clearInspection();assert.match(plot.inspectionValue.textContent,/Hover to inspect/);
  let prevented=false;
  plot.keydown({key:'ArrowRight',shiftKey:true,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(selections.at(-1),start+13*HOUR);
  plot.keydown({key:'End',preventDefault(){}});assert.equal(selections.at(-1),end-MINUTE);
  plot.dispose();assert.equal(Object.keys(element.listeners).length,0);
});

test('Loading/failure clears old traces; missing selected bins hide only the value marker',()=>{
  const plot=new IndexPlot({element:new FakeNode(),key:'ae',document});
  plot.setData({records:ae,start,end});plot.setTime(start+12*HOUR);
  assert.equal(plot.cursorPoint.style.display,'');
  plot.setData({records:ae,start,end,loading:true});
  assert.equal(plot.geometry.segments.length,0);assert.equal(plot.cursorPoint.style.display,'none');
  assert.match(plot.status.textContent,/Loading/);
  plot.setData({records:ae,start,end,error:'NASA unreachable'});
  assert.equal(plot.geometry.segments.length,0);assert.match(plot.status.textContent,/retrieval failed/);
  const gap=ae.filter(s=>s.start!==start+12*HOUR);
  plot.setData({records:gap,start,end});
  assert.equal(plot.cursor.style.display,'');assert.equal(plot.cursorPoint.style.display,'none');
  plot.inspect(start+12*HOUR+20000);
  assert.equal(plot.inspectionValue.textContent,'No measurement');
  plot.dispose();
});
