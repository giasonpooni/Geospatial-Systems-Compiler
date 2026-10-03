import protocol from './protocol_v2.json';
import { aggregate, fixture as previousFixture, trial, type Fixture, type Metrics, type Regime } from './experiment';
import { apply, at, hash, requireCondition as check, sealReading, stepOf } from '../core';
import { generateFixture } from '../experiment';
import type { Pair } from '../../../src/types/observer_benchmark';
import type { SwitchingParameters } from '../../../src/types/switching_observer';
export { protocol };
export const protocolHash = () => hash('synthetic-switching-protocol.v2', protocol);
function disturbances(regime: string, t: number): Pair {
  switch(regime) {
    case 'flow_flip': return [t>=16 && t<53 ? .8 : t>=53 ? -.6 : 0, 0];
    case 'sawtooth_flow': return [t<8 ? 0 : 1.1*((t-8)%23)/22,0];
    case 'short_offset_pulses': return [0,t>=30 && t<42 ? 2.1 : t>=72 && t<86 ? -.7 : 0];
    case 'offset_ramp_reset': return [0,t<10 ? 0 : t<68 ? -.02*(t-10) : 1.2];
    case 'overlapping_changes': return [t<17 ? 0 : t<64 ? .4 : 1, t<39 ? 0 : t<77 ? 2 : -.8];
    case 'delayed_offset_flow': return [t>=26 ? -.55 : 0,t>=47 ? 1.9 : 0];
    case 'unseen_blackout_change': return [t>=50 ? .85 : 0,t>=57 ? -1.1 : 0];
    default: return [0,0];
  }
}
/** New held-out amplitudes, controls, timing and masks; no prior holdout reuse. */
export function fixture(regime: string, seed: number): Fixture {
  check(protocol.heldOutRegimes.includes(regime),'Unknown v2 regime.');
  if(regime==='nominal')return previousFixture('nominal',seed);
  const f=generateFixture('full',seed,protocol.steps);const controls:Pair[]=[];const truth:number[][]=[[...f.truth[0],0,0]];
  for(let t=1;t<=protocol.steps;t++) {
    const old=apply(f.model.transition,f.truth[t-1]);const noise=f.truth[t].map((v,d)=>v-old[d]-f.controls[t-1][d]);
    const u:Pair=[.25*Math.sin(t/4)+(t>33&&t<76?.9:0),.4*Math.cos(t/17)-.2];controls.push(u);
    const change=disturbances(regime,t);const mean=apply(f.model.transition,[truth[t-1][0],truth[t-1][1]]);
    // The loss is active during this interval, matching the coupled jump covariance.
    truth.push([mean[0]+u[0]+noise[0],mean[1]+u[1]+noise[1]-change[0],...change]);
  }
  const readings=f.readings.flatMap(r=>{
    const t=stepOf(r.observedAt);
    if(regime==='unseen_blackout_change'&&t>=36&&t<=69)return [];
    if(regime==='delayed_offset_flow'&&t%(r.sensor===0?3:5)!==0)return [];
    const delay=regime==='delayed_offset_flow'?(r.sensor===0?1:5):0;
    const {rowHash:_hash,...draft}=r;
    return [sealReading({...draft,knownAt:at(t+delay),valueLitres:truth[t][r.sensor]+(r.valueLitres-f.truth[t][r.sensor])+(r.sensor===1?truth[t][3]:0)})];
  });return {regime,seed,model:f.model,controls,readings,truth};
}
export function selectDevelopment() {
  // Previously inspected v1 regimes may be development data, never fresh holdout.
  const fixtures=protocol.developmentRegimes.map(regime=>Array.from({length:protocol.developmentSeeds.count},(_,i)=>previousFixture(regime as Regime,protocol.developmentSeeds.start+i)));
  const candidates=protocol.candidates.map(c=>{
    const parameters:SwitchingParameters={...protocol.fixedParameters,lossJumpCoupling:1,...c};
    const regimes=fixtures.map(fs=>({regime:fs[0].regime,metrics:aggregate(fs.map(f=>trial(f,parameters).metrics))}));
    const n=regimes[0].metrics;const score=regimes.slice(1).reduce((s,r)=>s+r.metrics.switchingRmse**2,0)/(regimes.length-1);
    return {parameters,regimes,score,eligible:n.switchingRmse<=1.15*n.baselineRmse};
  });
  const eligible=candidates.filter(c=>c.eligible);const best=(eligible.length?eligible:candidates).slice().sort((a,b)=>a.score-b.score)[0];
  const body={schema:'synthetic-switching-selection.v2',protocolHash:protocolHash(),parameters:best.parameters,selectionEligible:eligible.length>0,candidates,fixtureHashes:fixtures.flat().map(f=>hash('synthetic-switching-fixture.v1',f))};
  return {...body,selectionHash:hash('synthetic-switching-selection.v2',body)};
}
export type Selection=ReturnType<typeof selectDevelopment>;
export function checkSelection(s:Selection) {
  const {selectionHash,...body}=s;
  check(s.schema==='synthetic-switching-selection.v2'&&s.protocolHash===protocolHash()&&hash('synthetic-switching-selection.v2',body)===selectionHash,'V2 selection integrity mismatch.');
  const eligible=s.candidates.filter(c=>c.eligible);const best=(eligible.length?eligible:s.candidates).slice().sort((a,b)=>a.score-b.score)[0];
  check(best&&hash('p',best.parameters)===hash('p',s.parameters)&&s.selectionEligible===(eligible.length>0),'Inconsistent v2 selection.');
}
export function evaluate(selection:Selection) {
  checkSelection(selection);
  const regimes=protocol.heldOutRegimes.map(regime=>{
    const trials=Array.from({length:protocol.heldOutSeeds.count},(_,i)=>{
      const seed=protocol.heldOutSeeds.start+i;const r=trial(fixture(regime,seed),selection.parameters);return {seed,fixtureHash:r.fixtureHash,metrics:r.metrics};
    });return {regime,metrics:aggregate(trials.map(t=>t.metrics)),trials};
  });
  const nominal=regimes[0].metrics,changed=regimes.slice(1);const combined=aggregate(changed.map(r=>r.metrics));
  const biases=aggregate(regimes.filter(r=>['short_offset_pulses','offset_ramp_reset'].includes(r.regime)).map(r=>r.metrics));
  const g=protocol.gates;
  const gates={nominalNoDegradation:nominal.switchingRmse<=nominal.baselineRmse*g.nominalRmseRatioMaximum,
    changedError:combined.switchingRmse<=combined.lossOnlyRmse*g.changedRegimeRmseRatioToLossMaximum,
    eachChangedCoverage:changed.every(r=>r.metrics.switchingCoverage>=g.eachChangedRegimeCoverageMinimum),
    biasError:biases.switchingRmse<=biases.baselineRmse*g.biasRegimeRmseRatioToBaselineMaximum,
    widthBudget:combined.switchingWidth<=combined.lossOnlyWidth*g.intervalWidthRatioToLossMaximum};
  const blocks=Array.from({length:protocol.heldOutSeeds.count},(_,i)=>changed.reduce((s,r)=>s+r.trials[i].metrics.switchingRmse-r.trials[i].metrics.lossOnlyRmse,0)/changed.length);
  const mean=blocks.reduce((s,v)=>s+v,0)/blocks.length;const se=Math.sqrt(blocks.reduce((s,v)=>s+(v-mean)**2,0)/(blocks.length-1)/blocks.length);
  return {schema:'synthetic-switching-heldout.v2',protocolHash:protocolHash(),selectionHash:selection.selectionHash,parameters:selection.parameters,selectionEligible:selection.selectionEligible,
    regimes,combined,biases,gates,overallStatus:selection.selectionEligible&&Object.values(gates).every(Boolean)?'benchmark_gates_passed_not_promoted':'benchmark_gate_failed_not_promoted',
    pairedRmseDifference:{mean,standardError:se,blocks:blocks.length,unitOfReplication:'seed_block_across_regimes'}};
}
