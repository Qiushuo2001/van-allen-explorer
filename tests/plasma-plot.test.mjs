import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PlasmaStore,selectPlasma} from '../js/plasma.js';
import {buildPlasmaSeries,PLASMA_SERIES_DEFINITIONS} from '../js/plasma-series.js';
import {PlasmaPlot,plasmaPlotGeometry,plasmaPlotNumber} from '../js/plasma-plot.js';

const MINUTE=60000,HOUR=3600000,DAY=24*HOUR;
const start=Date.parse('2015-03-17T00:00:00Z'),end=start+DAY,noon=start+12*HOUR;
const store=new PlasmaStore({fetchImpl:async url=>({ok:true,json:async()=>JSON.parse(await readFile(new URL(url),'utf8'))})});
const day=await store.getDay(noon),history=buildPlasmaSeries(day);
const definition=key=>PLASMA_SERIES_DEFINITIONS[key];

test('Real plasma charts retain every native point and break each probe independently at gaps',()=>{
  for(const key of Object.keys(history)) {
    const g=plasmaPlotGeometry(history[key],key,start,end);
    assert.equal(g.xTicks.at(-1).label,'24:00');assert.equal(g.domain.min,0);
    for(const probe of ['rbspa','rbspb']) {
      const expected=history[key][probe].filter(r=>r.t>=start&&r.t<end&&r.status==='valid');
      const plotted=g.traces[probe].segments.flatMap(s=>s.records);
      assert.deepEqual(plotted,expected,'Every valid native point is plotted without averaging or resampling');
      assert.equal(g.traces[probe].validCount,expected.length);
      for(const segment of g.traces[probe].segments) {
        for(let i=1;i<segment.records.length;i++) assert.ok(segment.records[i].t-segment.records[i-1].t<=definition(key).maxGapMs);
      }
      assert.ok(g.traces[probe].segments.length>1,'Real missing or rejected data break the daily trace');
    }
  }
});

test('Explicit fill and quality rows break paths; missing epochs cannot connect across a cadence gap',()=>{
  const source=history.density.rbspb.filter(r=>r.t>=start&&r.t<end&&r.status==='valid').slice(0,4);
  assert.ok(source.every((r,i)=>!i||r.t-source[i-1].t<=7010));
  for(const status of ['fill','quality','invalid']) {
    const records=source.map(r=>({...r}));records[1]={...records[1],status,value:null};
    const g=plasmaPlotGeometry({rbspa:records,rbspb:source},'density',start,end);
    assert.equal(g.traces.rbspa.segments.length,2);assert.equal(g.traces.rbspa.isolated.length,1);
    assert.equal(g.traces.rbspb.segments.length,1,'Probe A rejection does not break Probe B');
    assert.equal(g.traces.rbspa.validCount,3);assert.ok(g.traces.rbspa.isolatedPath,'An isolated real point remains visible');
  }
  const omitted=[source[0],source[2],source[3]];
  assert.equal(plasmaPlotGeometry({rbspa:omitted},'density',start,end).traces.rbspa.segments.length,2);
});

test('Small electron beta has a finite scientific axis and native epoch placement',()=>{
  const records=history.beta.rbspb.filter(r=>r.t>=noon-30000&&r.t<noon+30000&&r.status==='valid');
  const g=plasmaPlotGeometry({rbspb:records},'beta',noon-30000,noon+30000);
  assert.ok(records.length>=2);assert.ok(g.domain.max<.001);assert.equal(g.domain.min,0);
  assert.ok(g.domain.ticks.every(value=>Number.isFinite(g.y(value))));
  assert.ok(g.domain.ticks.slice(1).every(value=>plasmaPlotNumber(value).includes('e-')));
  assert.equal(g.traces.rbspb.segments[0].records[0].t,records[0].t);
  assert.notEqual(records[0].t%MINUTE,0,'Source epochs are not snapped to minutes');
  assert.match(g.traces.rbspb.path,/L/);assert.doesNotMatch(g.traces.rbspb.path,/[CQ]/,'No smoothing curves are introduced');
});

test('Empty and all-rejected histories remain empty, and day boundaries do not extrapolate',()=>{
  const source=history.ratio.rbspb;
  const g=plasmaPlotGeometry({rbspb:source},'ratio',start,end,{width:320});
  assert.equal(g.xTicks.length,3);
  assert.ok(g.traces.rbspb.segments.every(s=>s.records.every(r=>r.t>=start&&r.t<end)));
  const empty=plasmaPlotGeometry({rbspa:source.map(r=>({...r,value:null,status:'fill'})),rbspb:[]},'ratio',start,end);
  assert.equal(empty.traces.rbspa.validCount,0);assert.equal(empty.traces.rbspb.path,'');assert.ok(Number.isFinite(empty.y(0)));
  assert.equal(plasmaPlotNumber(0),'0');assert.equal(plasmaPlotNumber(null),'—');
});

class FakeNode {
  constructor(tag='div'){this.tag=tag;this.attributes={};this.children=[];this.style={};this.listeners={};this.textContent='';this.classList={add(){}};this.clientWidth=800;}
  setAttribute(key,value){this.attributes[key]=String(value);}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  addEventListener(type,fn){this.listeners[type]=fn;}
  removeEventListener(type){delete this.listeners[type];}
  getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:230};}
}
const document={createElement:tag=>new FakeNode(tag),createElementNS:(_ns,tag)=>new FakeNode(tag)};
const inputFor=key=>({series:history[key],start,end,select:(probe,time)=>selectPlasma(day,probe,time).fields[key]});

test('Playback moves only the cursor and native-source markers; beta hover retains both instrument epochs',()=>{
  const plot=new PlasmaPlot({element:new FakeNode(),key:'beta',document});
  const input=inputFor('beta');plot.setData(input);plot.setTime(noon);
  const geometry=plot.geometry,nodes=plot.base.children;
  assert.equal(plot.cursorPoints.rbspa.style.display,'none','Default A gap cannot produce an interpolated point');
  assert.equal(plot.cursorPoints.rbspb.style.display,'');
  assert.ok(Number(plot.cursorPoints.rbspb.attributes.cx)<Number(plot.cursor.attributes.x1),'Native B point precedes selected noon');
  const selected=selectPlasma(day,'rbspb',noon).fields.beta;
  assert.equal(Number(plot.cursorPoints.rbspb.attributes.cx),geometry.x(noon+selected.offsetMs));
  plot.setTime(noon+MINUTE);assert.equal(plot.geometry,geometry);assert.equal(plot.base.children,nodes);
  plot.setData(input);assert.equal(plot.geometry,geometry,'Same input does not rebuild geometry');
  plot.inspect(noon);
  assert.match(plot.inspectionRows.rbspb.value.textContent,/2\.02e-5/);
  assert.match(plot.inspectionRows.rbspb.time.textContent,/2015-03-17 11:59:55\.160 UTC/);
  assert.match(plot.inspectionRows.rbspb.time.textContent,/2015-03-17 11:59:55\.829385000 UTC/);
  assert.match(plot.inspectionRows.rbspa.value.textContent,/No measurement/);
  plot.dispose();
});

test('Loading clears every trace; one probe retrieval failure retains the other probe and its readout',()=>{
  const plot=new PlasmaPlot({element:new FakeNode(),key:'density',document});
  const input=inputFor('density');plot.setData(input);plot.setTime(noon);
  plot.setData({...input,loading:true});
  assert.equal(plot.geometry.traces.rbspa.validCount,0);assert.equal(plot.geometry.traces.rbspb.validCount,0);
  assert.equal(plot.cursorPoints.rbspb.style.display,'none');assert.match(plot.statuses.rbspb.textContent,/loading/);
  plot.setData({...input,errors:{rbspa:'NASA request failed'}});
  assert.equal(plot.geometry.traces.rbspa.validCount,0);assert.ok(plot.geometry.traces.rbspb.validCount>0);
  assert.equal(plot.statuses.rbspa.title,'NASA request failed');assert.equal(plot.cursorPoints.rbspb.style.display,'');
  plot.inspect(noon);assert.match(plot.inspectionRows.rbspa.value.textContent,/Retrieval failed/);assert.match(plot.inspectionRows.rbspb.value.textContent,/1750/);
  plot.dispose();
});

test('Pointer and keyboard gestures choose UTC minutes and clean up event handlers',()=>{
  const element=new FakeNode(),selections=[];
  const plot=new PlasmaPlot({element,key:'ratio',document,onSeek:time=>selections.push(time)});
  plot.setData(inputFor('ratio'));plot.setTime(noon);
  const g=plot.geometry;
  plot.svg.listeners.click({clientX:g.x(noon+38000),clientY:g.box.top+10});assert.equal(selections.at(-1),noon+MINUTE);
  let prevented=false;plot.keydown({key:'ArrowRight',shiftKey:true,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(selections.at(-1),noon+HOUR);
  plot.keydown({key:'End',preventDefault(){}});assert.equal(selections.at(-1),end-MINUTE);
  plot.keydown({key:'Home',preventDefault(){}});assert.equal(selections.at(-1),start);
  const count=selections.length;plot.svg.listeners.click({clientX:0,clientY:0});assert.equal(selections.length,count);
  plot.dispose();assert.equal(Object.keys(element.listeners).length,0);assert.equal(Object.keys(plot.svg.listeners).length,0);
});
