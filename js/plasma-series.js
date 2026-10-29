/** Native plasma history for plotting; no resampling, averaging, or interpolation.
 * Each chart record is evaluated by the same quality/physics path as its readout.
 */
import { PLASMA_DEFINITIONS, selectPlasma } from './plasma.js?v=1.6.0';
import { PROBES } from './ephemeris.js';

export const PLASMA_SERIES_DEFINITIONS=Object.freeze({
  density:Object.freeze({product:'density',maxGapMs:PLASMA_DEFINITIONS.density.maxGapMs,label:'Electron density',units:'cm⁻³'}),
  ratio:Object.freeze({product:'density',maxGapMs:PLASMA_DEFINITIONS.density.maxGapMs,label:'f_pe / f_ce',units:'dimensionless'}),
  anisotropy:Object.freeze({product:'moments',maxGapMs:PLASMA_DEFINITIONS.moments.maxGapMs,label:'Electron anisotropy',units:'T⊥ / T∥'}),
  beta:Object.freeze({product:'moments',maxGapMs:PLASMA_DEFINITIONS.moments.maxGapMs,label:'Scalar electron beta',units:'dimensionless'})
});

const GROUPS=[{product:'density',keys:['density','ratio']},{product:'moments',keys:['anisotropy','beta']}];
const createSeries=()=>Object.fromEntries(Object.keys(PLASMA_SERIES_DEFINITIONS).map(key=>[key,Object.fromEntries(PROBES.map(probe=>[probe.id,[]]))]));
const cache=new WeakMap();

/** Build once per immutable PlasmaStore day response. Preserve all native rows,
 * including rejected values, so renderers can break lines at their source epochs.
 * Day-edge padding remains available; the renderer clips to its visible UTC day.
 * Refreshed responses have a new identity and receive fresh series automatically.
 */
export function buildPlasmaSeries(day) {
  if(!day||typeof day!=='object') return createSeries();
  if(cache.has(day)) return cache.get(day);
  const result=createSeries();
  for(const probe of PROBES) {
    for(const {product,keys} of GROUPS) {
      if(day.errors?.[probe.id]?.[product]) continue;
      const records=day.series?.[probe.id]?.[product]||[];
      const activeKeys=keys.filter(key=>key!=='beta'||!day.errors?.[probe.id]?.field);
      for(const record of records) {
        const selected=selectPlasma(day,probe.id,record.t);
        for(const key of activeKeys) {
          result[key][probe.id].push({...selected.fields[key],t:record.t,sourceTime:record.sourceTime,offsetMs:0});
        }
      }
    }
  }
  cache.set(day,result);
  return result;
}
