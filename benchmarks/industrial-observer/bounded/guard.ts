import { at, hash, stepOf } from '../core';
import { contractBox, interval, intersect, minus, nextUp, plus, scale, type Strip } from './interval';
import type { BoundContract, BoundInputs, BoundReading, BoundResult, BoundReason, CalibrationEnvelope, Interval, StateBox } from '../../../src/types/bounded_observer';
import type { Pair } from '../../../src/types/observer_benchmark';

export const OPERATION = 'reference.two-tank-bounded-guard.v1' as const;
const check = (v: unknown, message: string): void => { if (!v) throw new TypeError(message); };
const finite = (v: number, upper = 1e6) => Number.isFinite(v) && Math.abs(v) <= upper;
function keys(v: object, expected: string[]): void {
  check(v && !Array.isArray(v) && Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k)), 'Unexpected record shape.');
}
/** Internal bounded reference API; no service or file ingestion endpoint. */
export function checkContract(c: BoundContract): void {
  keys(c, ['contractId','transition','initial','nuisanceDomain','processAbsLitres','lossIncrementAbs','biasIncrementAbs','measurementAbsLitres','maxSteps','contractionPasses','maxPrimaryAgeSeconds','maxReferenceAgeSeconds','precisionWidthLimits']);
  check(/^synthetic:[a-zA-Z0-9:._-]+$/.test(c.contractId), 'Not a synthetic contract.');
  check(Array.isArray(c.transition) && c.transition.length === 2 && c.transition.every(r => Array.isArray(r) && r.length === 2 && r.every(x => finite(x, 1))), 'Invalid dynamics.');
  check(Array.isArray(c.initial) && c.initial.length === 4 && Array.isArray(c.nuisanceDomain) && c.nuisanceDomain.length === 2, 'Invalid state dimensions.');
  [...c.initial, ...c.nuisanceDomain].forEach(interval);
  check([...c.initial,...c.nuisanceDomain].flat().every(x => finite(x)), 'Unbounded initial support.');
  for (const d of [0,1]) check(c.initial[d+2][0] >= c.nuisanceDomain[d][0] && c.initial[d+2][1] <= c.nuisanceDomain[d][1], 'Initial state exceeds physical envelope.');
  for (const [a,n] of [[c.processAbsLitres,2],[c.measurementAbsLitres,3],[c.precisionWidthLimits,4]] as const)
    check(Array.isArray(a) && a.length === n && a.every(x => finite(x) && x >= 0), 'Invalid error or precision budget.');
  check(c.precisionWidthLimits.every(v => v > 0) && [c.lossIncrementAbs,c.biasIncrementAbs].every(v => finite(v) && v >= 0), 'Invalid increment or width.');
  for (const [v,max] of [[c.maxSteps,256],[c.contractionPasses,64],[c.maxPrimaryAgeSeconds,256],[c.maxReferenceAgeSeconds,256]]) check(Number.isInteger(v) && v >= 1 && v <= max, 'Invalid time/work budget.');
}
export function sealCalibration(c: Omit<CalibrationEnvelope,'rowHash'>): CalibrationEnvelope { return {...c,rowHash:hash('synthetic-bounded-calibration.v1',c)}; }
export function sealReading(r: Omit<BoundReading,'rowHash'>): BoundReading { return {...r,rowHash:hash('synthetic-bounded-reading.v1',r)}; }
function checkCalibration(c: CalibrationEnvelope): void {
  keys(c, ['calibrationId','knownAt','calibratedAt','validThrough','offsetLitres','driftAbsLitresPerSecond','scope','rowHash']);
  const {rowHash,...body}=c;
  check(hash('synthetic-bounded-calibration.v1',body)===rowHash && /^synthetic:calibration:[a-zA-Z0-9:._-]+$/.test(c.calibrationId), 'Calibration identity/integrity mismatch.');
  interval(c.offsetLitres);
  const t=stepOf(c.calibratedAt), k=stepOf(c.knownAt), end=stepOf(c.validThrough);
  check(t<=k && t<=end && c.offsetLitres.every(x=>finite(x)) && finite(c.driftAbsLitresPerSecond) && c.driftAbsLitresPerSecond>=0 && c.scope==='synthetic_bound_assumption_not_physical_certificate','Invalid calibration envelope.');
}
export function selectRows(rows: readonly BoundReading[], cutoff: number): BoundReading[] {
  check(Array.isArray(rows) && rows.length<=768,'Oversized batch.');
  const ids=new Set<string>(), events=new Set<string>(), selected:BoundReading[]=[];
  for(const r of rows) {
    keys(r,['recordId','observedAt','knownAt','channel','valueLitres','calibrationId','rowHash']);
    const {rowHash,...body}=r; const observed=stepOf(r.observedAt), known=stepOf(r.knownAt);
    check(observed>=1 && observed<=256 && known>=observed && ['a','b','reference'].includes(r.channel) &&
      r.recordId===`synthetic:bound:${r.channel}:${observed}` && finite(r.valueLitres) &&
      (r.channel==='reference' ? typeof r.calibrationId==='string' : r.calibrationId===null),'Invalid measurement.');
    check(hash('synthetic-bounded-reading.v1',body)===rowHash,'Reading integrity mismatch.');
    const event=`${r.observedAt}:${r.channel}`;
    check(!ids.has(r.recordId) && !events.has(event),'Duplicate evidence.');ids.add(r.recordId);events.add(event);
    if(known<=cutoff)selected.push(r);
  }
  return selected.sort((a,b)=>a.observedAt.localeCompare(b.observedAt)||a.channel.localeCompare(b.channel));
}
const around = (value:number, radius:number):Interval => plus([value,value],[-radius,radius]);
const linear = (x:Interval[], weights:number[]):Interval => weights.reduce((sum,w,i)=>w===0?sum:plus(sum,scale(x[i],w)),[0,0] as Interval);
const strip = (n:number, entries:[number,number][], range:Interval):Strip => {
  const coefficients=Array(n).fill(0);for(const [i,c] of entries)coefficients[i]=c;return {coefficients,range};
};
export interface BoundStep { state:StateBox; calibrationOffset:Interval }
/** Joint previous/current state plus ONE shared calibration parameter. Projection
 * drops correlations conservatively. Contraction cannot invent a feasible point.
 */
export function advanceBound(previous:BoundStep, contract:BoundContract, control:Pair,
  measurements:readonly BoundReading[], calibration:CalibrationEnvelope|null, tick:number):BoundStep|null {
  const old=previous.state, f=contract.transition;
  const loss=intersect(plus(old[2],[-contract.lossIncrementAbs,contract.lossIncrementAbs]),contract.nuisanceDomain[0]);
  const bias=intersect(plus(old[3],[-contract.biasIncrementAbs,contract.biasIncrementAbs]),contract.nuisanceDomain[1]);
  if(!loss||!bias)return null;
  const a=plus(linear(old,[f[0][0],f[0][1],0,0]),around(control[0],contract.processAbsLitres[0]));
  const b=plus(minus(linear(old,[f[1][0],f[1][1],0,0]),loss),around(control[1],contract.processAbsLitres[1]));
  const joint:Interval[]=[...old,a,b,loss,bias,previous.calibrationOffset];
  const strips:Strip[]=[
    strip(9,[[4,1],[0,-f[0][0]],[1,-f[0][1]]],around(control[0],contract.processAbsLitres[0])),
    strip(9,[[5,1],[0,-f[1][0]],[1,-f[1][1]],[6,1]],around(control[1],contract.processAbsLitres[1])),
    strip(9,[[6,1],[2,-1]],[-contract.lossIncrementAbs,contract.lossIncrementAbs]),
    strip(9,[[7,1],[3,-1]],[-contract.biasIncrementAbs,contract.biasIncrementAbs]),
  ];
  for(const r of measurements) {
    if(r.channel==='a')strips.push(strip(9,[[4,1]],around(r.valueLitres,contract.measurementAbsLitres[0])));
    else if(r.channel==='b')strips.push(strip(9,[[5,1],[7,1]],around(r.valueLitres,contract.measurementAbsLitres[1])));
    else {
      check(calibration,'Reference lacks known calibration.');
      const age=tick-stepOf(calibration!.calibratedAt);
      const drift=nextUp(calibration!.driftAbsLitresPerSecond*age);
      const radius=nextUp(contract.measurementAbsLitres[2]+drift);
      strips.push(strip(9,[[5,1],[8,1]],around(r.valueLitres,radius)));
    }
  }
  const contracted=contractBox(joint,strips,contract.contractionPasses);
  return contracted?{state:contracted.slice(4,8) as StateBox,calibrationOffset:contracted[8]}:null;
}
function decisions(state:StateBox|null, c:BoundContract, last:[string|null,string|null,string|null], calibration:CalibrationEnvelope|null, cutoff:number):BoundResult['axisDecisions'] {
  const ages=last.map(v=>v===null?Infinity:cutoff-stepOf(v));
  return ([0,1,2,3] as const).map(axis=>{
    const reasons:BoundReason[]=[];
    if(!state)reasons.push('inconsistent_assumptions');
    else {
      if((axis===0 && ages[0]>c.maxPrimaryAgeSeconds)||(axis===3 && ages[1]>c.maxPrimaryAgeSeconds)||
        (axis===2 && c.transition[1][0]!==0 && ages[0]>c.maxPrimaryAgeSeconds))reasons.push('no_recent_primary');
      if(axis>0) {
        if(!calibration)reasons.push('calibration_unavailable');
        else if(cutoff>stepOf(calibration.validThrough))reasons.push('calibration_expired');
        if(ages[2]>c.maxReferenceAgeSeconds)reasons.push('no_recent_reference');
      }
      if(nextUp(state[axis][1]-state[axis][0])>c.precisionWidthLimits[axis])reasons.push('insufficient_precision');
    }
    return {axis,action:reasons.length?'abstain':'within_precision_budget',reasons};
  });
}
/** Full as-known replay. No future data, estimator truth, scenario ID or training
 * enters the computation. Invalid inputs throw; contradictory evidence yields
 * an explicit null enclosure, never a reset or a discarded contradictory row.
 */
export function replayBound(input:BoundInputs, cutoff:number):BoundResult {
  const {contract:c,calibration,controls,readings}=input;
  keys(input,['contract','calibration','controls','readings']);checkContract(c);checkCalibration(calibration);
  check(Number.isInteger(cutoff)&&cutoff>=0&&cutoff<=c.maxSteps&&Array.isArray(controls)&&controls.length>=cutoff&&controls.length<=c.maxSteps,'Invalid cutoff/controls.');
  const prefix=controls.slice(0,cutoff);
  prefix.forEach(u=>check(Array.isArray(u)&&u.length===2&&u.every(x=>finite(x)),'Invalid control.'));
  const selected=selectRows(readings,cutoff);
  const cal=stepOf(calibration.knownAt)<=cutoff?calibration:null;
  const valid=(r:BoundReading)=>r.channel!=='reference'||!!(cal&&r.calibrationId===cal.calibrationId&&stepOf(r.observedAt)>=stepOf(cal.calibratedAt)&&stepOf(r.observedAt)<=stepOf(cal.validThrough));
  const accepted=selected.filter(valid), ignored=selected.filter(r=>!valid(r));
  let current:BoundStep|null={state:structuredClone(c.initial),calibrationOffset:cal?[...cal.offsetLitres]:[0,0]};
  const last:[string|null,string|null,string|null]=[null,null,null];let cursor=0,firstInconsistentAt:string|null=null;
  for(let t=1;t<=cutoff;t++) {
    if(!current)break;
    const batch:BoundReading[]=[];
    while(cursor<accepted.length&&stepOf(accepted[cursor].observedAt)===t) {
      const r=accepted[cursor++];batch.push(r);last[r.channel==='a'?0:r.channel==='b'?1:2]=r.observedAt;
    }
    current=advanceBound(current,c,prefix[t-1],batch,cal,t);
    if(!current)firstInconsistentAt=at(t);
  }
  const body:Omit<BoundResult,'resultHash'>={
    schema:'synthetic-bounded-uncertainty-result.v1',operationId:OPERATION,valueKind:'synthetic',asOf:at(cutoff),
    assumptionHash:hash('synthetic-bound-contract.v1',c),calibrationHash:cal?.rowHash??null,
    evidenceHash:hash('synthetic-bound-evidence.v1',{controls:prefix,accepted:accepted.map(r=>r.rowHash),unsupported:ignored.map(r=>r.rowHash)}),
    bounds:current?.state??null,sharedCalibrationOffset:current&&cal?current.calibrationOffset:null,
    boundBasis:'conditional_bounded_error_enclosure_not_probability',probability:null,
    feasibility:current?'not_disproved':'inconsistent',firstInconsistentAt,lastObservedAt:last,
    axisDecisions:decisions(current?.state??null,c,last,cal,cutoff),
    accounting:{selectedRows:selected.length,assimilatedRows:cursor,unsupportedReferenceRows:ignored.length,unprocessedRows:accepted.length-cursor,delayedRows:selected.filter(r=>r.knownAt!==r.observedAt).length},
    physicalAssumptionsVerified:false,
  };
  return {...body,resultHash:hash('synthetic-bound-result.v1',body)};
}

export interface BoundSnapshot {
  step:number; bounds:StateBox|null; sharedCalibrationOffset:Interval|null;
  axisDecisions:BoundResult['axisDecisions']; firstInconsistentAt:string|null;
}
/** Incremental as-known evaluation with bounded rewind on delayed evidence.
 * Checkpoints before the earliest newly known observation are unchanged; only
 * its suffix is replayed. Retained earlier as-known outputs are never mutated.
 * A late calibration certificate uses the simple full-replay path instead.
 */
export function boundSeries(input:BoundInputs):BoundSnapshot[] {
  const steps=input.controls.length;
  if(stepOf(input.calibration.knownAt)!==0)
    return Array.from({length:steps},(_,i)=>{const r=replayBound(input,i+1);return {step:i+1,bounds:r.bounds,sharedCalibrationOffset:r.sharedCalibrationOffset,axisDecisions:r.axisDecisions,firstInconsistentAt:r.firstInconsistentAt};});
  replayBound(input,0);const selected=selectRows(input.readings,steps);
  const c=input.contract,cal=input.calibration;
  check(steps<=c.maxSteps,'Oversized control archive.');
  input.controls.forEach(u=>check(Array.isArray(u)&&u.length===2&&u.every(x=>finite(x)),'Invalid control.'));
  type Checkpoint={current:BoundStep|null;last:[string|null,string|null,string|null];first:string|null};
  const cache:Checkpoint[]=[{current:{state:structuredClone(c.initial),calibrationOffset:[...cal.offsetLitres]},last:[null,null,null],first:null}];
  const byObserved=new Map<number,BoundReading[]>(),series:BoundSnapshot[]=[];
  for(let t=1;t<=steps;t++) {
    let start=t;
    for(const r of selected.filter(r=>stepOf(r.knownAt)===t)) {
      const observed=stepOf(r.observedAt);
      if(r.channel==='reference'&&(r.calibrationId!==cal.calibrationId||observed<stepOf(cal.calibratedAt)||observed>stepOf(cal.validThrough)))continue;
      const batch=byObserved.get(observed)??[];batch.push(r);batch.sort((a,b)=>a.channel.localeCompare(b.channel));byObserved.set(observed,batch);
      start=Math.min(start,observed);
    }
    for(let k=start;k<=t;k++) {
      const previous=cache[k-1],last=[...previous.last] as Checkpoint['last'];let current=previous.current,first=previous.first;
      if(current) {
        const batch=byObserved.get(k)??[];
        for(const r of batch)last[r.channel==='a'?0:r.channel==='b'?1:2]=r.observedAt;
        current=advanceBound(current,c,input.controls[k-1],batch,cal,k);
        if(!current)first=at(k);
      }
      cache[k]={current,last,first};
    }
    const {current,last,first}=cache[t];
    series.push({step:t,bounds:current?.state??null,sharedCalibrationOffset:current?.calibrationOffset??null,
      axisDecisions:decisions(current?.state??null,c,last,cal,t),firstInconsistentAt:first});
  }
  return series;
}
