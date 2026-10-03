import protocol from './protocol.json';
import { apply, at, hash, requireCondition as check, sealReading, selectReadings, stepOf } from '../core';
import { generateFixture } from '../experiment';
import { random, matchedFixture, nees } from '../switching/consistency';
import { initialize, makeModel, summarize } from '../switching/observer';
import { eye, mul, rank } from '../switching/numerics';
import { advanceReference, referenceRow, replayReference, sealReference, selectReferences } from './observer';
import type { Pair, TankModel, TankReading } from '../../../src/types/observer_benchmark';
import type { SwitchingParameters } from '../../../src/types/switching_observer';
import type { ReferenceReading, ReferenceResult, ReferenceSpecification } from '../../../src/types/reference_observer';

export { protocol };
export const frozenParameters: SwitchingParameters = { ...protocol.frozenParameters, lossJumpCoupling: 1 };
export const protocolHash = () => hash('synthetic-reference-protocol.v1', protocol);
export type Arm = 'none' | 'independent_4s' | 'shared_bias_4s' | 'independent_1s' | 'initial_only';
export interface ReferenceFixture {
  regime: string; seed: number; model: TankModel; controls: Pair[];
  readings: TankReading[]; truth: number[][]; referenceNoise: number[];
}
export function specification(shared = false): ReferenceSpecification {
  return { calibrationId: shared ? 'synthetic:calibration:b:shared-bias-v1' : 'synthetic:calibration:b:independent-v1',
    loading: shared ? 'tank_b_plus_primary_bias' : 'tank_b', noiseFamily: 'synthetic:reference:b:iid',
    varianceLitres2: protocol.referenceVarianceLitres2, calibrationStatus: 'synthetic_known_offset_assumption' };
}
function disturbance(regime: string, t: number): Pair {
  switch(regime) {
    case 'loss_step': return [t<23 ? 0 : t<71 ? .45 : -.2, 0];
    case 'bias_plateau': return [0,t<29 ? 0 : t<75 ? -1.6 : .85];
    case 'mixed_jumps': case 'decoupled_mixed': return [t<18 ? 0 : t<62 ? .55 : -.35,t<40 ? 0 : t<80 ? 1.4 : -1];
    case 'slow_drift': return [t<20 ? 0 : Math.min(.65,.01*(t-20)), t<12 ? 0 : -.025*(t-12)];
    case 'delayed_primary': return [t<35 ? 0 : .7,t<54 ? 0 : -1.2];
    case 'primary_blackout': case 'all_blackout': return [t<43 ? 0 : .6,t<48 ? 0 : 1.3];
    default: return [0,0];
  }
}
/** Separate seeded noise stream; all measurement arms share truth and primary rows. */
export function fixture(regime: string, seed: number): ReferenceFixture {
  check(protocol.regimes.includes(regime), 'Unknown reference regime.');
  const source = generateFixture('full',seed,protocol.steps), model = structuredClone(source.model);
  if(regime==='decoupled_mixed') model.transition=[[.97,0],[0,.97]];
  const controls: Pair[] = [], truth: number[][] = [[...source.truth[0],0,0]];
  const rng = random((seed ^ 0x9e3779b9) >>> 0);
  const referenceNoise = Array.from({length:protocol.steps+1},()=>Math.sqrt(protocol.referenceVarianceLitres2)*rng.normal());
  for(let t=1;t<=protocol.steps;t++) {
    const old=apply(source.model.transition,source.truth[t-1]);
    const w=source.truth[t].map((v,d)=>v-old[d]-source.controls[t-1][d]);
    const u:Pair=[.28*Math.cos(t/6)+(t>=26&&t<64?.6:0), .3*Math.sin(t/13)-.1]; controls.push(u);
    const lb=disturbance(regime,t), x=apply(model.transition,[truth[t-1][0],truth[t-1][1]]);
    truth.push([x[0]+u[0]+w[0],x[1]+u[1]+w[1]-lb[0],...lb]);
  }
  const readings=source.readings.flatMap(r=>{
    const t=stepOf(r.observedAt);
    if(['primary_blackout','all_blackout'].includes(regime)&&t>=34&&t<=67)return [];
    if(regime==='delayed_primary'&&t%(r.sensor===0?2:4)!==0)return [];
    const delay=regime==='delayed_primary'?(r.sensor===0?2:4):0;
    const {rowHash:_ignored,...draft}=r;
    return [sealReading({...draft,knownAt:at(t+delay),valueLitres:truth[t][r.sensor]+(r.valueLitres-source.truth[t][r.sensor])+(r.sensor===1?truth[t][3]:0)})];
  });
  return {regime,seed,model,controls,readings,truth,referenceNoise};
}
export function references(f: ReferenceFixture, arm: Arm, fault: 'none'|'mislabeled_shared_bias'='none', delay=0): {rows:ReferenceReading[];spec:ReferenceSpecification} {
  check(protocol.arms.includes(arm),'Unknown measurement arm.');
  check(Number.isInteger(delay)&&delay>=0&&delay<=8,'Invalid reference delay.');
  const spec=specification(arm==='shared_bias_4s'), rows:ReferenceReading[]=[];
  for(let t=1;t<=f.controls.length;t++) {
    const eligible=arm==='independent_1s' || (arm==='initial_only' ? t===4 : arm!=='none'&&t%4===0);
    if(!eligible || (f.regime==='all_blackout'&&t>=34&&t<=67))continue;
    rows.push(sealReference({recordId:`synthetic:reference:b:${t}`,observedAt:at(t),knownAt:at(t+delay),
      valueLitres:f.truth[t][1]+((arm==='shared_bias_4s'||fault==='mislabeled_shared_bias')?f.truth[t][3]:0)+f.referenceNoise[t],
      varianceLitres2:spec.varianceLitres2,calibrationId:spec.calibrationId,noiseFamily:spec.noiseFamily}));
  }
  return {rows,spec};
}
export interface Metrics {
  volumeRmse:number; lossRmse:number; biasRmse:number;
  volumeCoverage:number; lossCoverage:number; biasCoverage:number;
  meanVolumeWidth:number; meanLossWidth:number; meanBiasWidth:number;
  meanAbsoluteLossBiasCorrelation:number;
}
export interface ExampleRow {step:number;result:ReferenceResult;evaluationTruth:number[]}
export function trial(f:ReferenceFixture, arm:Arm, retain=false, fault:'none'|'mislabeled_shared_bias'='none') {
  const m=makeModel(f.model,frozenParameters), ref=references(f,arm,fault);
  const immediate=!retain&&f.readings.every(r=>r.knownAt===r.observedAt)&&ref.rows.every(r=>r.knownAt===r.observedAt);
  const p=immediate?selectReadings(f.readings,f.controls.length):[], q=immediate?selectReferences(ref.rows,ref.spec,f.controls.length):[];
  let current=initialize(m),pi=0,qi=0;
  const error=[0,0,0,0], coverage=[0,0,0,0], widths=[0,0,0,0];let correlation=0;
  const series:ExampleRow[]=[];
  for(let t=1;t<=f.controls.length;t++) {
    if(immediate) {
      const batch:TankReading[]=[];
      while(pi<p.length&&stepOf(p[pi].observedAt)===t)batch.push(p[pi++]);
      const r=qi<q.length&&stepOf(q[qi].observedAt)===t?q[qi++]:undefined;
      current=advanceReference(m,current,f.controls[t-1],batch,r,ref.spec);
    }
    const result=immediate?summarize(current):replayReference(m,f.controls,f.readings,ref.rows,ref.spec,t);
    for(let d=0;d<4;d++) {
      error[d]+=(result.state.mean[d]-f.truth[t][d])**2;
      coverage[d]+=Number(f.truth[t][d]>=result.interval95[d][0]&&f.truth[t][d]<=result.interval95[d][1]);
      widths[d]+=result.interval95[d][1]-result.interval95[d][0];
    }
    const cov=result.state.covariance;correlation+=Math.abs(cov[2][3]/Math.sqrt(cov[2][2]*cov[3][3]));
    if(retain)series.push({step:t,result:result as ReferenceResult,evaluationTruth:[...f.truth[t]]});
  }
  const n=f.controls.length;
  const metrics:Metrics={volumeRmse:Math.sqrt((error[0]+error[1])/(2*n)),lossRmse:Math.sqrt(error[2]/n),biasRmse:Math.sqrt(error[3]/n),
    volumeCoverage:(coverage[0]+coverage[1])/(2*n),lossCoverage:coverage[2]/n,biasCoverage:coverage[3]/n,
    meanVolumeWidth:(widths[0]+widths[1])/(2*n),meanLossWidth:widths[2]/n,meanBiasWidth:widths[3]/n,meanAbsoluteLossBiasCorrelation:correlation/n};
  return {metrics,series,referenceCount:ref.rows.length,fixtureHash:hash('synthetic-reference-fixture.v1',f),referenceHash:hash('synthetic-reference-arm.v1',ref)};
}
export function aggregate(rows:readonly Metrics[]):Metrics {
  check(rows.length>0,'Empty metrics.');const result:Record<string,number>={};
  for(const k of Object.keys(rows[0]) as (keyof Metrics)[]) {
    const rms=k.endsWith('Rmse'), mean=rows.reduce((s,r)=>s+(rms?r[k]**2:r[k]),0)/rows.length;
    result[k]=rms?Math.sqrt(mean):mean;
  }
  return result as unknown as Metrics;
}
/** No fitting or model selection: this experiment changes evidence, not capacity. */
export function evaluate() {
  const seeds=Array.from({length:protocol.heldOutSeeds.count},(_,i)=>protocol.heldOutSeeds.start+i);
  const regimes=protocol.regimes.map(regime=>{
    const fixtures=seeds.map(seed=>fixture(regime,seed));
    const arms=(protocol.arms as Arm[]).map(arm=>{
      const trials=fixtures.map(f=>{const t=trial(f,arm);return {seed:f.seed,...t,series:undefined};});
      // Drop absent optional series before content hashing; no undefined JSON fields.
      return {arm,metrics:aggregate(trials.map(t=>t.metrics)),trials:trials.map(({series:_unused,...t})=>t)};
    });
    return {regime,arms};
  });
  const armMetric=(regime:string,arm:Arm)=>regimes.find(r=>r.regime===regime)!.arms.find(a=>a.arm===arm)!.metrics;
  const changed=regimes.filter(r=>r.regime!=='nominal');
  const pooled=(arm:Arm)=>aggregate(changed.map(r=>armMetric(r.regime,arm)));
  const baseline=pooled('none'), independent=pooled('independent_4s'), nominal=armMetric('nominal','independent_4s'), nominalBase=armMetric('nominal','none');
  const ratios={volume:independent.volumeRmse/baseline.volumeRmse,loss:independent.lossRmse/baseline.lossRmse,bias:independent.biasRmse/baseline.biasRmse,
    nominal:nominal.volumeRmse/nominalBase.volumeRmse,width:independent.meanVolumeWidth/baseline.meanVolumeWidth};
  const gates={nominal:ratios.nominal<=protocol.gates.nominalRmseRatioMaximum,
    volume:ratios.volume<=protocol.gates.changedVolumeRmseRatioMaximum,loss:ratios.loss<=protocol.gates.changedLossRmseRatioMaximum,
    bias:ratios.bias<=protocol.gates.changedBiasRmseRatioMaximum,
    everyChangedCoverage:changed.every(r=>armMetric(r.regime,'independent_4s').volumeCoverage>=protocol.gates.eachChangedCoverageMinimum),
    width:ratios.width<=protocol.gates.meanWidthRatioMaximum};
  const differences=seeds.map((_,i)=>changed.reduce((s,r)=>s+r.arms.find(a=>a.arm==='independent_4s')!.trials[i].metrics.volumeRmse-r.arms.find(a=>a.arm==='none')!.trials[i].metrics.volumeRmse,0)/changed.length);
  const mean=differences.reduce((a,b)=>a+b,0)/seeds.length;
  const standardError=Math.sqrt(differences.reduce((s,x)=>s+(x-mean)**2,0)/(seeds.length-1)/seeds.length);
  const faulty=seeds.map(seed=>trial(fixture('bias_plateau',seed),'independent_4s',false,'mislabeled_shared_bias').metrics);
  return {schema:'synthetic-reference-evaluation.v1',protocolHash:protocolHash(),frozenParameters,seeds,regimes,
    combined:{baseline,independent,ratios},gates,
    pairedVolumeDifference:{mean,standardError,replicationUnit:'seed_block_across_regimes',blocks:seeds.length},
    falseIndependenceDiagnostic:{regime:'bias_plateau',metrics:aggregate(faulty),role:'fault_injection_not_an_acceptance_case'},
    status:Object.values(gates).every(Boolean)?'benchmark_gates_passed_not_promoted':'benchmark_gate_failed_not_promoted',
    comparison:'same_frozen_observer_different_measurement_packages_not_model_superiority'};
}
/** Algebraic indistinguishability witness and independent-channel rank test. */
export function observabilityDiagnostic() {
  const records=['coupled','decoupled'].map(topology=>{
    const base=generateFixture('full',13000,12).model;if(topology==='decoupled')base.transition=[[.97,0],[0,.97]];
    const model=makeModel(base,frozenParameters), primary:number[][]=[], extra:number[][]=[], shared:number[][]=[];let power=eye();
    for(let t=0;t<8;t++) { primary.push(...mul(model.measurementRows,power));if(t%4===0){extra.push(mul([referenceRow(specification())],power)[0]);shared.push(mul([referenceRow(specification(true))],power)[0]);}power=mul(power,model.transition); }
    const witness=[0,1,-.03,-1];
    return {topology,model,primaryRows:primary,independentRows:extra,sharedBiasRows:shared,
      ranks:{primary:rank(primary),independent:rank([...primary,...extra]),sharedBias:rank([...primary,...shared])},
      decoupledNullDirection:topology==='decoupled'?witness:null,
      note:'Finite-horizon initial-state rank under known model; not current-state precision or field calibration.'};
  });return records;
}
export function gaussianCheck() {
  const rows=Array.from({length:protocol.gaussianCheck.count},(_,i)=>{
    const seed=protocol.gaussianCheck.startSeed+i,f=matchedFixture(seed,frozenParameters,true),spec=specification(),rng=random((seed^0x632be5ab)>>>0);
    const ref:ReferenceReading[]=[];
    for(let t=1;t<=f.controls.length;t++) {
      const noise=.5*rng.normal();if(t%4===0)ref.push(sealReference({recordId:`synthetic:reference:b:${t}`,observedAt:at(t),knownAt:at(t),valueLitres:f.truth[t][1]+noise,
        varianceLitres2:spec.varianceLitres2,calibrationId:spec.calibrationId,noiseFamily:spec.noiseFamily}));
    }
    const result=replayReference(f.model,f.controls,f.readings,ref,spec,f.controls.length);
    return {seed,fixture:{model:f.model,controls:f.controls,readings:f.readings,references:ref,spec,truth:f.truth},result,nees:nees(result.state.mean,result.state.covariance,f.truth[f.truth.length-1])};
  });
  return {schema:'synthetic-reference-gaussian-check.v1',protocol:protocol.gaussianCheck,meanNees:rows.reduce((s,r)=>s+r.nees,0)/rows.length,
    scope:'Identical-mode Gaussian limit only; does not erase PR20 fixed-reference failure.',rows};
}
