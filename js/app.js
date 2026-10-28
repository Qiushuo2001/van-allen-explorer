import { EphemerisStore, PROBES, MISSION_START, MISSION_END, sampleAt } from './ephemeris.js';
import { OrbitScene } from './scene.js';
import { GeomagneticPanels } from './index-panels.js';

const $ = id => document.getElementById(id);
const HOUR = 3600000, DAY = 24 * HOUR, MINUTE = 60000;
const FRAME_INFO = {
  gse: 'Geocentric Solar Ecliptic. +X points toward the Sun; +Z toward ecliptic north.',
  gsm: 'Geocentric Solar Magnetospheric. +X points toward the Sun; the dipole axis lies in the XZ plane.',
  geo: 'Geographic, Earth-fixed. +X crosses the equator at Greenwich; +Z points toward geographic north.'
};
const iso = t => new Date(t).toISOString();
const inputTime = t => iso(t).slice(0, 19);
const utcText = t => iso(t).replace('T', ' ').replace('.000Z', ' UTC');
const parseTime = value => value ? Date.parse(value + 'Z') : NaN;
const clamp = t => Math.max(MISSION_START, Math.min(MISSION_END, t));
const fmtDate = t => new Intl.DateTimeFormat('en-GB', {timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'}).format(t).toUpperCase();
const fmtTick = t => `${iso(t).slice(0,10)} ${iso(t).slice(11,16)}`;
const store = new EphemerisStore();
const geomagnetic = new GeomagneticPanels();
const state = {
  time: Date.parse('2015-03-17T12:00:00Z'), frame:'gse', windowMs:6*HOUR,
  intervalStart:Date.parse('2015-03-17T00:00:00Z'), intervalEnd:Date.parse('2015-03-18T00:00:00Z'),
  scope:'interval', data:null, loading:false, playing:false, nearest:false,
  speed:900, accumulator:0, lastFrame:0, requestId:0, controller:null, initWarnings:[]
};
let scene;
try { scene = new OrbitScene($('scene')); }
catch (error) { $('scene-error').textContent = error.message; $('scene-error').classList.remove('hidden'); }

for (const id of ['selected-time','interval-start','interval-end']) {
  $(id).min = inputTime(MISSION_START);
  $(id).max = inputTime(MISSION_END);
}

function setPlaying(playing) {
  state.playing = playing; state.accumulator = 0; state.lastFrame = performance.now();
  $('play-icon').textContent = playing ? 'Ⅱ' : '▶';
  $('play-label').textContent = playing ? 'Pause' : 'Play';
  $('play').setAttribute('aria-pressed',String(playing));
}

function syncTime() {
  $('selected-time').value = inputTime(state.time);
  $('time-display').replaceChildren(document.createTextNode(fmtDate(state.time) + ' '));
  const clock = document.createElement('span'); clock.textContent = iso(state.time).slice(11,19);
  $('time-display').append(clock);
  const a = state.scope === 'mission' ? MISSION_START : state.intervalStart;
  const b = state.scope === 'mission' ? MISSION_END : state.intervalEnd;
  $('timeline').min = String(a / 1000); $('timeline').max = String(b / 1000);
  // Represent picker-selected seconds exactly; slider gestures snap separately.
  $('timeline').step = '1';
  $('timeline').value = String(Math.max(a,Math.min(b,state.time))/1000);
  $('timeline').setAttribute('aria-valuetext', utcText(state.time));
  $('timeline').title = utcText(state.time);
  $('timeline-start').textContent = fmtTick(a);
  $('timeline-mid').textContent = fmtTick(a + (b-a)/2);
  $('timeline-end').textContent = fmtTick(b);
  $('scope-mission').classList.toggle('active',state.scope==='mission');
  $('scope-interval').classList.toggle('active',state.scope==='interval');
  $('scope-mission').setAttribute('aria-pressed',String(state.scope==='mission'));
  $('scope-interval').setAttribute('aria-pressed',String(state.scope==='interval'));
  $('frame-badge').innerHTML = `${state.frame.toUpperCase()} · R<sub>E</sub>`;
  $('frame-description').textContent = FRAME_INFO[state.frame];
  $('dialog-frame-details').textContent = FRAME_INFO[state.frame] + ' +Y completes the right-handed coordinate system. The rings mark 2, 4 and 6 Earth radii in the selected XY plane; illumination is for display only.';
  scene?.setFrame(state.frame.toUpperCase());
  geomagnetic.setTime(state.time);
}

function unavailableReason(probe, result) {
  if (state.time < probe.startMs) return 'Before first archived ephemeris';
  if (state.time > probe.operationsEndMs) return 'Spacecraft operations ended';
  if (state.time > probe.endMs) return 'After last archived ephemeris';
  if (state.loading && (!state.data || state.data.frame.toLowerCase() !== state.frame || state.time < state.data.start || state.time > state.data.end)) return 'Loading requested ephemeris…';
  if (result?.reason === 'nearest') return 'Between samples · no exact position';
  if (state.data?.provenance.errors.length) return 'Data unavailable · request failed';
  if (result?.reason === 'gap') return 'Data gap · marker hidden';
  return 'No archived sample at this time';
}

function updatePositions() {
  const valid = state.data && state.data.frame.toLowerCase() === state.frame;
  const series = valid ? state.data.series : {rbspa:[],rbspb:[]};
  const positions = {};
  for (const probe of PROBES) {
    const result = sampleAt(series[probe.id], state.time, probe.cadenceMs);
    const sample = result.exact || state.nearest ? result.sample : null;
    positions[probe.id] = sample;
    $('card-'+probe.id).classList.toggle('missing', !sample);
    for (const axis of ['x','y','z']) $(axis+'-'+probe.id).textContent = sample ? sample[axis].toFixed(4) : '—';
    $('r-'+probe.id).innerHTML = `${sample ? Math.hypot(sample.x,sample.y,sample.z).toFixed(4) : '—'} <small>R<sub>E</sub></small>`;
    $('status-'+probe.id).textContent = sample ? (result.exact ? 'Exact archived sample' : `Nearest sample · ${result.offsetMs > 0 ? '+' : ''}${result.offsetMs/1000} s from selection`) : unavailableReason(probe,result);
    $('time-'+probe.id).textContent = sample ? `Sample UTC: ${iso(sample.t).slice(0,19).replace('T',' ')}` : 'Sample UTC: —';
  }
  scene?.setData({series, positions, time:state.time, windowMs:state.windowMs, maxGapMs:60001});
}

function reportSource() {
  if (!state.data) return;
  const p = state.data.provenance;
  const kinds = [...new Set(p.sources.map(s=>s.kind))];
  const names = {bundled:'Bundled NASA response',live:'Live NASA response',imported:'Imported source file'};
  const n = Object.values(state.data.series).reduce((sum,v)=>sum+v.length,0);
  let text = kinds.map(k=>names[k]).join(' + ') || 'No data loaded';
  text += ` · ${n.toLocaleString()} samples in loaded window.`;
  if (p.errors.length) text += ` ${p.errors.length} request(s) failed. Coverage is incomplete; use Refresh or import a dataset.`;
  if (p.warnings.length) text += ' ' + p.warnings.join(' ');
  $('data-status').textContent = text;
  $('data-status').title = [...p.sources.map(s=>`${s.url || s.file}\nRetrieved: ${s.retrievedAt || 'unknown'}`), ...p.errors].join('\n\n');
  $('data-status').classList.toggle('error-text',p.errors.length>0);
  $('export-button').disabled = !p.sources.length;
}

function hasRange() {
  return state.data && state.data.frame.toLowerCase()===state.frame &&
    state.data.start <= Math.max(MISSION_START,state.time-state.windowMs) &&
    state.data.end >= Math.min(MISSION_END,state.time+state.windowMs);
}

async function loadData(force=false) {
  if (!force && hasRange()) {
    // A seek can return to the retained window while a different window is loading.
    // Invalidate that request so its eventual result cannot replace the current data.
    if (state.loading) {
      ++state.requestId;
      state.controller?.abort();
      state.loading=false;
      $('loading').classList.add('hidden');
      $('play').disabled=false;
    }
    updatePositions(); return;
  }
  const requestId = ++state.requestId;
  state.controller?.abort();
  const controller = state.controller = new AbortController();
  state.loading = true; $('loading').classList.remove('hidden');
  $('loading-text').textContent = 'Retrieving archived positions…';
  updatePositions();
  // Keep a buffer so playback needs another request only when it approaches a loaded edge.
  const buffer = 3*HOUR;
  const start = Math.max(MISSION_START,state.time-state.windowMs-buffer);
  const end = Math.min(MISSION_END,state.time+state.windowMs+buffer);
  try {
    const data = await store.loadRange(start,end,state.frame,{signal:controller.signal});
    if (requestId !== state.requestId) return;
    state.data = data;
    reportSource();
    if (data.provenance.errors.length && state.playing) {
      setPlaying(false);
      $('interval-message').textContent = 'Playback paused because retrieval failed. Refresh or import data before continuing.';
      $('interval-message').classList.add('error-text');
    }
  } catch (error) {
    if (requestId !== state.requestId || controller.signal.aborted) return;
    $('data-status').textContent = 'Unable to retrieve data: ' + error.message;
    $('data-status').classList.add('error-text');
    setPlaying(false);
  } finally {
    if (requestId === state.requestId) {
      state.loading = false; $('loading').classList.add('hidden');
      $('play').disabled = false;
      updatePositions();
    }
  }
}

let seekTimer;
function seek(t,{pause=true,debounce=false}={}) {
  if (!Number.isFinite(t)) return;
  if (pause) setPlaying(false);
  state.time = clamp(Math.round(t/1000)*1000);
  // Keep the selected time and slider synchronized when seeking outside the active playback interval.
  if (state.scope==='interval' && (state.time<state.intervalStart || state.time>state.intervalEnd)) state.scope='mission';
  syncTime(); updatePositions(); clearTimeout(seekTimer);
  if (debounce) seekTimer = setTimeout(()=>loadData(),180);
  else void loadData();
}

$('selected-time').addEventListener('change',event=>{
  const t=parseTime(event.target.value);
  if (!Number.isFinite(t) || t<MISSION_START || t>MISSION_END) {
    event.target.setCustomValidity('Choose a UTC time from 30 August 2012 through 18 October 2019.');
    event.target.reportValidity(); return;
  }
  event.target.setCustomValidity(''); seek(t);
});
$('selected-time').addEventListener('input',event=>event.target.setCustomValidity(''));
$('timeline').addEventListener('input',event=>{
  const slider=event.target;
  const minute=Math.round(Number(slider.value)/60)*MINUTE;
  const time=Math.max(Number(slider.min)*1000,Math.min(Number(slider.max)*1000,minute));
  seek(time,{debounce:true});
});
$('timeline').addEventListener('change',()=>{clearTimeout(seekTimer); void loadData();});
$('scope-mission').addEventListener('click',()=>{state.scope='mission';syncTime();});
$('scope-interval').addEventListener('click',()=>{
  state.scope='interval';
  if (state.time<state.intervalStart || state.time>state.intervalEnd) seek(state.intervalStart);
  else syncTime();
});
$('step-back').addEventListener('click',()=>seek(Math.ceil(state.time/MINUTE)*MINUTE-MINUTE));
$('step-forward').addEventListener('click',()=>seek(Math.floor(state.time/MINUTE)*MINUTE+MINUTE));
$('frame').addEventListener('change',event=>{
  setPlaying(false); state.frame=event.target.value; state.data=null;
  syncTime(); updatePositions(); void loadData();
});
$('window').addEventListener('change',event=>{state.windowMs=Number(event.target.value)*HOUR;updatePositions();void loadData();});
$('nearest').addEventListener('change',event=>{state.nearest=event.target.checked;updatePositions();});
$('speed').addEventListener('change',event=>{state.speed=Number(event.target.value);state.accumulator=0;});
$('retry').addEventListener('click',()=>{void loadData(true);});
$('play').addEventListener('click',()=>{
  if (state.playing) {setPlaying(false);return;}
  const messages=[];
  // A picker/mission-timeline seek can leave the previous playback interval.
  // Move that interval forward from the selection, never seek back to its start.
  if (state.time<state.intervalStart || state.time>=state.intervalEnd) {
    if (state.time>=MISSION_END) {
      $('interval-message').textContent='The mission date range ends here. Select an earlier time to play forward.';
      $('interval-message').classList.remove('error-text');
      return;
    }
    const duration=state.intervalEnd-state.intervalStart;
    state.intervalStart=state.time;
    state.intervalEnd=Math.min(MISSION_END,state.time+duration);
    $('interval-start').value=inputTime(state.intervalStart);
    $('interval-end').value=inputTime(state.intervalEnd);
    messages.push('Playback interval moved to the selected UTC time.');
  }
  state.scope='interval';syncTime();
  // The archive has a one-minute cadence. Retaining a seconds offset here would
  // make every playback frame fall between samples in the default exact mode.
  const nextMinute=Math.ceil(state.time/MINUTE)*MINUTE;
  if (nextMinute>=state.intervalEnd) {
    messages.push('No UTC sample minute remains before the interval ends. Extend the interval or select an earlier time.');
    $('interval-message').textContent=messages.join(' ');
    $('interval-message').classList.remove('error-text');
    return;
  }
  if (nextMinute!==state.time) {
    seek(nextMinute);
    messages.push('Playback starts at the next UTC minute, using archived samples only.');
  }
  $('interval-message').textContent=messages.join(' ') || 'Playback advances through archived minutes; it does not propagate an orbit.';
  $('interval-message').classList.remove('error-text');
  clearTimeout(seekTimer);
  setPlaying(true);
  void loadData();
});

function applyInterval() {
  const a=parseTime($('interval-start').value),b=parseTime($('interval-end').value);
  if (!Number.isFinite(a)||!Number.isFinite(b)||b<=a||a<MISSION_START||b>MISSION_END) {
    $('interval-message').textContent='Use a valid start before end, both within the mission dates.';
    $('interval-message').classList.add('error-text');return;
  }
  state.intervalStart=a;state.intervalEnd=b;state.scope='interval';setPlaying(false);
  $('interval-message').textContent='Interval applied. Data load in small windows as playback advances.';
  $('interval-message').classList.remove('error-text');
  seek(Math.max(a,Math.min(b,state.time)));
}
$('apply-interval').addEventListener('click',applyInterval);
$('center-day').addEventListener('click',()=>{
  const start=Math.floor(state.time/DAY)*DAY;
  $('interval-start').value=inputTime(Math.max(MISSION_START,start));
  $('interval-end').value=inputTime(Math.min(MISSION_END,start+DAY));
  applyInterval();
});

for (const probe of PROBES) $('show-'+probe.id).addEventListener('change',event=>scene?.setVisibility(probe.id,event.target.checked));
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click',()=>{
  scene?.setView(button.dataset.view);
  for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('active',b===button);
});
$('reset-view').addEventListener('click',()=>{
  scene?.resetView();
  for(const b of document.querySelectorAll('[data-view]')) b.classList.toggle('active',b.dataset.view==='oblique');
});
$('about-button').addEventListener('click',()=>$('about-dialog').showModal());
$('close-about').addEventListener('click',()=>$('about-dialog').close());
$('about-dialog').addEventListener('click',event=>{if(event.target===$('about-dialog')) {const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom) event.target.close();}});

$('import-button').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',async event=>{
  setPlaying(false);
  try {
    const result=await store.importFiles(event.target.files);
    $('import-status').textContent=`Imported ${result.samples.toLocaleString()} real source samples in ${result.chunks} chunk(s). Select a covered UTC time.`;
    $('import-status').classList.remove('error-text');
    state.data=null; await loadData(true);
  } catch(error) { $('import-status').textContent='Import failed: '+error.message; $('import-status').classList.add('error-text'); }
  event.target.value='';
});
$('export-button').addEventListener('click',()=>{
  const bundle=store.exportBundle();
  const url=URL.createObjectURL(new Blob([JSON.stringify(bundle)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=`van-allen-ssc-${iso(state.time).slice(0,10)}.json`;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  $('import-status').textContent='Exported loaded source responses and provenance. Import this file to reuse them offline.';
});

function animate(now) {
  const delta=state.lastFrame ? Math.min((now-state.lastFrame)/1000,.25) : 0;
  state.lastFrame=now;
  if(state.playing && !state.loading && !document.hidden) {
    state.accumulator+=delta*state.speed*1000;
    if(state.accumulator>=MINUTE) {
      const steps=Math.floor(state.accumulator/MINUTE);
      state.accumulator-=steps*MINUTE;
      let t=state.time+steps*MINUTE;
      if(t>=state.intervalEnd) {
        if($('loop').checked) {
          const firstMinute=Math.ceil(state.intervalStart/MINUTE)*MINUTE;
          t=firstMinute<state.intervalEnd ? firstMinute : state.intervalStart;
        }
        else {t=state.intervalEnd;setPlaying(false);}
      }
      seek(t,{pause:false});
    }
  }
  requestAnimationFrame(animate);
}
document.addEventListener('visibilitychange',()=>{state.lastFrame=performance.now();});
window.addEventListener('beforeunload',()=>{state.controller?.abort();scene?.dispose();geomagnetic.dispose();});

syncTime();
requestAnimationFrame(animate);
try { const init=await store.initialize();state.initWarnings=init.warnings;await loadData(); }
catch(error) { $('data-status').textContent=error.message;$('loading').classList.add('hidden'); }
