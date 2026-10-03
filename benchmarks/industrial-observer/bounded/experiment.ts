import protocol from './protocol.json';
import { at, hash, stepOf } from '../core';
import { random } from '../switching/consistency';
import { boundSeries, replayBound, sealCalibration, sealReading, type BoundSnapshot } from './guard';
import type { BoundContract, BoundInputs, BoundReading, CalibrationEnvelope } from '../../../src/types/bounded_observer';
import type { Pair } from '../../../src/types/observer_benchmark';

export { protocol };
export const protocolHash=()=>hash('synthetic-bounded-protocol.v1',protocol);
export function contract(decoupled=false):BoundContract {
  const c=structuredClone(protocol.contract) as BoundContract;
  if(decoupled)c.transition=[[.97,0],[0,.97]];
  return c;
}
export function certificate(expiry=96,exact=false):CalibrationEnvelope {
  return sealCalibration({calibrationId:'synthetic:calibration:bounded-v1',knownAt:at(0),calibratedAt:at(0),validThrough:at(expiry),
    offsetLitres:exact?[0,0]:[-protocol.calibration.offsetBoundLitres,protocol.calibration.offsetBoundLitres],
    driftAbsLitresPerSecond:exact?0:protocol.calibration.driftAbsLitresPerSecond,
    scope:'synthetic_bound_assumption_not_physical_certificate'});
}
export interface Fixture {
  regime:string;seed:number;input:BoundInputs;truth:number[][];calibrationOffset:number;calibrationDrift:number[];
}
function targets(regime:string,t:number):Pair {
  if(regime==='nominal_offset')return [0,0];
  if(regime==='bounded_jumps')return [t<23?0:t<61?.18:0,t<35?0:t<70?.27:0];
  const loss=t<16?0:Math.min(.65,(t-16)*.011);
  const bias=t<11?0:t<60?-(t-11)*.024:-1.176+(t-60)*.016;
  return [loss,bias];
}
/** Fresh bounded-noise workload. The normal/Gaussian benchmark is NOT silently
 * relabelled as bounded: its source and tests are unchanged. Probability and
 * containment answer different questions; no iid assumption enters the guard.
 */
export function fixture(regime:string,seed:number,referencePeriod=4):Fixture {
  if (![1,4].includes(referencePeriod)) throw new TypeError("Unsupported reference budget.");
  if(!protocol.regimes.includes(regime)||!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new TypeError('Unknown bounded fixture.');
  const c=contract(regime==='decoupled_drift'), rng=random(seed), noise=()=>2*rng.uniform()-1;
  const offset=noise()*.38, driftSign=noise()<0?-1:1;
  const truth:number[][]=[[noise()*.8,noise()*.8,0,0]],controls:Pair[]=[],readings:BoundReading[]=[],drift:number[]=[0];
  const calibration=certificate(regime==='expired_calibration'?48:96);
  for(let t=1;t<=protocol.steps;t++) {
    const u:Pair=[.4*Math.sin(t/8)+.1,.2*Math.cos(t/13)];controls.push(u);
    const [loss,bias]=targets(regime,t),old=truth[t-1],f=c.transition;
    // Only bounded support is asserted. Dependence can be arbitrary.
    const shared=noise()*.2,independent=noise()*.15;
    const process:Pair=[shared+independent,-shared+independent];
    truth.push([f[0][0]*old[0]+f[0][1]*old[1]+u[0]+process[0],f[1][0]*old[0]+f[1][1]*old[1]+u[1]-loss+process[1],loss,bias]);
    drift.push(regime==='reference_drift'||regime==='expired_calibration'?driftSign*.0028*t:0);
    const values=[truth[t][0]+noise()*.5,truth[t][1]+bias+noise()*.7,truth[t][1]+offset+drift[t]+noise()*.35];
    if(regime==='all_blackout'&&t>=31&&t<=66)continue;
    for(const channel of ['a','b','reference'] as const) {
      if(channel==='reference'&&t%referencePeriod!==0)continue;
      const i=channel==='a'?0:channel==='b'?1:2;
      readings.push(sealReading({recordId:`synthetic:bound:${channel}:${t}`,observedAt:at(t),knownAt:at(t+(regime==='delayed_reference'&&channel==='reference'?3:0)),
        channel,valueLitres:values[i],calibrationId:channel==='reference'?calibration.calibrationId:null}));
    }
  }
  return {regime,seed,input:{contract:c,calibration,controls,readings},truth,calibrationOffset:offset,calibrationDrift:drift};
}
export interface Metrics {
  allStateContainment:number;axisContainment:number[];volumeBudgetAvailability:number;allAxesBudgetAvailability:number;
  axisBudgetAvailability:number[];meanWidths:number[];maxWidths:number[];inconsistentCutoffs:number;cutoffs:number;
  containmentAmongBudgetDecisions:number|null;abstentionCount:number;
}
export function metrics(series:BoundSnapshot[],truth:readonly number[][]):Metrics {
  if(truth.length!==series.length+1||!series.length)throw new TypeError('Evaluation length mismatch.');
  const covered=[0,0,0,0], available=[0,0,0,0],widths=[0,0,0,0],maxWidths=[0,0,0,0];
  let joint=0,vol=0,all=0,inconsistent=0,budgetCount=0,budgetCovered=0,finiteBoxes=0;
  for(const r of series) {
    if(!r.bounds){inconsistent++;continue;}
    finiteBoxes++;const within=truth[r.step].map((v,d)=>v>=r.bounds![d][0]&&v<=r.bounds![d][1]);
    if(within.every(Boolean))joint++;
    for(let d=0;d<4;d++) {
      covered[d]+=Number(within[d]);const width=r.bounds[d][1]-r.bounds[d][0];widths[d]+=width;maxWidths[d]=Math.max(maxWidths[d],width);
      if(r.axisDecisions[d].action==='within_precision_budget'){available[d]++;budgetCount++;budgetCovered+=Number(within[d]);}
    }
    vol+=Number(r.axisDecisions.slice(0,2).every(d=>d.action==='within_precision_budget'));
    all+=Number(r.axisDecisions.every(d=>d.action==='within_precision_budget'));
  }
  const n=series.length;
  return {allStateContainment:joint/n,axisContainment:covered.map(v=>v/n),volumeBudgetAvailability:vol/n,allAxesBudgetAvailability:all/n,
    axisBudgetAvailability:available.map(v=>v/n),meanWidths:widths.map(v=>finiteBoxes?v/finiteBoxes:0),maxWidths,inconsistentCutoffs:inconsistent,cutoffs:n,
    containmentAmongBudgetDecisions:budgetCount?budgetCovered/budgetCount:null,abstentionCount:4*n-budgetCount};
}
export function runFixture(f:Fixture,retain=false) {
  const series=boundSeries(f.input), m=metrics(series,f.truth), final=replayBound(f.input,f.input.controls.length);
  const exactInput={...f.input,calibration:certificate(stepOf(f.input.calibration.validThrough),true)};
  const exact=boundSeries(exactInput);
  return {regime:f.regime,seed:f.seed,metrics:m,zeroCalibrationAblation:metrics(exact,f.truth),final,
    fixtureHash:hash('synthetic-bounded-fixture.v1',f),series:retain?series:null};
}
export function stress(seed:number) {
  const f=fixture('nominal_offset',seed);
  const corrupt=(kind:string)=>{
    const input=structuredClone(f.input);
    input.readings=input.readings.map(r=>{
      if(r.channel!=='reference'||stepOf(r.observedAt)<32)return r;
      const {rowHash:_unused,...draft}=r;
      return sealReading({...draft,valueLitres:r.valueLitres+(kind==='impossible_measurement'?100:1.2)});
    });
    const series=boundSeries(input);
    return {case:kind,seed,firstInconsistentAt:series.find(r=>!r.bounds)?.step??null,
      acceptedAfterFault:series.filter(r=>r.step>=32&&r.axisDecisions.some(a=>a.action==='within_precision_budget')).length,
      note:'Out-of-envelope source semantics; detection is not guaranteed by interval consistency.'};
  };
  const jump=structuredClone(f);let delta:Pair=[0,0];
  for(let t=1;t<=protocol.steps;t++) {
    const F=jump.input.contract.transition;
    delta=[F[0][0]*delta[0]+F[0][1]*delta[1],F[1][0]*delta[0]+F[1][1]*delta[1]-(t>=32?1.8:0)];
    jump.truth[t][0]+=delta[0];jump.truth[t][1]+=delta[1];jump.truth[t][2]=t>=32?1.8:0;
    jump.input.readings=jump.input.readings.map(r=>{
      if(stepOf(r.observedAt)!==t)return r;const {rowHash:_unused,...draft}=r;
      return sealReading({...draft,valueLitres:r.valueLitres+delta[r.channel==='a'?0:1]});
    });
  }
  const j=boundSeries(jump.input);
  return [corrupt('reference_error_outside_certificate'),corrupt('impossible_measurement'),
    {case:'unknown_jump_outside_rate_bound',seed,firstInconsistentAt:j.find(r=>!r.bounds)?.step??null,
      acceptedAfterFault:j.filter(r=>r.step>=32&&r.axisDecisions.some(a=>a.action==='within_precision_budget')).length,
      note:'1.8 L/s unknown loss violates both increment and physical operating bounds; no completeness claim.'}];
}
export function evaluate() {
  const seeds=Array.from({length:protocol.heldOutSeeds.count},(_,i)=>protocol.heldOutSeeds.start+i);
  const regimes=protocol.regimes.map(regime=>{
    const trials=seeds.map(seed=>runFixture(fixture(regime,seed)));
    const frequentReference=seeds.map(seed=>{const f=fixture(regime,seed,1);return {seed,metrics:metrics(boundSeries(f.input),f.truth)};});
    const mean=(f:(r:typeof trials[number])=>number)=>trials.reduce((s,r)=>s+f(r),0)/trials.length;
    return {regime,trials,frequentReference,summary:{allStateContainment:mean(r=>r.metrics.allStateContainment),
      volumeBudgetAvailability:mean(r=>r.metrics.volumeBudgetAvailability),allAxesBudgetAvailability:mean(r=>r.metrics.allAxesBudgetAvailability),
      meanWidths:[0,1,2,3].map(d=>mean(r=>r.metrics.meanWidths[d])),
      axisBudgetAvailability:[0,1,2,3].map(d=>mean(r=>r.metrics.axisBudgetAvailability[d])),
      frequentReferenceVolumeAvailability:frequentReference.reduce((s,r)=>s+r.metrics.volumeBudgetAvailability,0)/seeds.length,
      frequentReferenceContainment:frequentReference.reduce((s,r)=>s+r.metrics.allStateContainment,0)/seeds.length,
      zeroCalibrationContainment:mean(r=>r.zeroCalibrationAblation.allStateContainment),
      zeroCalibrationInconsistentFraction:mean(r=>r.zeroCalibrationAblation.inconsistentCutoffs/r.metrics.cutoffs)}};
  });
  const examples=protocol.regimes.map(regime=>{const f=fixture(regime,seeds[0]);return {fixture:f,...runFixture(f,true)};});
  const blackout=examples.find(e=>e.regime==='all_blackout')!;
  const blackoutRows=blackout.series!.filter(r=>r.step>=39&&r.step<=66);
  const gates={conditionalContainment:regimes.every(r=>r.trials.every(t=>t.metrics.allStateContainment===1)),
    staleBlackoutAbstention:blackoutRows.every(r=>r.axisDecisions.every(a=>a.action==='abstain')),
    expiredReferencesExcluded:examples.find(e=>e.regime==='expired_calibration')!.final.accounting.unsupportedReferenceRows===12,
    usefulVolumeAvailability:regimes.filter(r=>!['all_blackout','expired_calibration'].includes(r.regime)).every(r=>r.summary.volumeBudgetAvailability>=protocol.gates.minimumNonOutageVolumeAvailability)};
  return {schema:'synthetic-bounded-experiment.v1',protocolHash:protocolHash(),regimes,examples,gates,
    experimentStatus:Object.values(gates).every(Boolean)?'conditional_reference_checks_passed_not_promoted':'reference_gate_failed_not_promoted',
    stress: Array.from({length:protocol.stressSeeds.count},(_,i)=>stress(protocol.stressSeeds.start+i)).flat(),
    probability:null, scope:protocol.scope};
}
