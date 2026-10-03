import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { at, replay, sealReading } from '../benchmarks/industrial-observer/core';
import { generateFixture } from '../benchmarks/industrial-observer/experiment';
import { makeModel, initialize, advance, condition, summarize, replaySwitching } from '../benchmarks/industrial-observer/switching/observer';
import { chol, checked, eye, intervals, mix, normalCdf, rank } from '../benchmarks/industrial-observer/switching/numerics';
import { fixture, gateDecision, protocol, trial, checkSelection } from '../benchmarks/industrial-observer/switching/experiment';
import type { Metrics } from '../benchmarks/industrial-observer/switching/experiment';
import type { Pair, TankReading } from '../src/types/observer_benchmark';
import type { SwitchingParameters } from '../src/types/switching_observer';

const p: SwitchingParameters = { ...protocol.fixedParameters, jumpProbability: 0.002 };
const close = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a-b) <= tolerance, `${a} != ${b}`);
const model = () => makeModel(generateFixture('full', 1, 24).model, p);
const reading = (overrides: Partial<Omit<TankReading, 'rowHash'>> = {}) => sealReading({
  recordId: 'synthetic:tank:b:1', observedAt: at(1), knownAt: at(1), sensor: 1, valueLitres: 3,
  noiseVarianceLitres2: 0.25, referenceVarianceLitres2: 0.25, ...overrides,
});
function compare(a: unknown, b: unknown): void {
  if (typeof a === 'number' && typeof b === 'number') close(a,b);
  else if (Array.isArray(a) && Array.isArray(b)) { assert.equal(a.length,b.length); a.forEach((v,i)=>compare(v,b[i])); }
  else if (a && b && typeof a === 'object' && typeof b === 'object') {
    for(const k of Object.keys(a)) compare((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]);
  } else assert.deepEqual(a,b);
}
describe('separate process loss and measurement bias', () => {
  it('appends the correct transition and measurement rows without mutating the base', () => {
    const base = generateFixture('full', 1, 24).model; const before = structuredClone(base); const m=makeModel(base,p);
    assert.deepEqual(m.transition[1],[0.04,0.95,-1,0]); assert.deepEqual(m.measurementRows[1],[0,1,0,1]);
    m.base.transition[0][0]=0.5; assert.deepEqual(base,before);
  });
  it('sensor bias changes the measurement prediction but not inventory dynamics', () => {
    const m=model();const x=initialize(m);x.components.forEach(c=>c.mean=[0,0,0,2]);
    compare(summarize(advance(m,x,[0,0],[])).state.mean,[0,0,0,2]);
  });
  it('positive loss removes volume and negative loss adds it', () => {
    const m=model();for(const loss of [-1,1]){const x=initialize(m);x.components.forEach(c=>c.mean=[0,0,loss,0]);
      const s=summarize(advance(m,x,[0,0],[])).state;close(s.mean[1],-loss);close(s.mean[2],loss);}
  });
  it('matches a hand-computed correction for H=[0,1,0,1]', () => {
    const s=checked([0,0,0,1],eye());const r=condition(s,[0,1,0,1],reading());
    close(r.state.mean[1],.8);close(r.state.mean[3],1.8);close(r.state.covariance[1][1],.6);close(r.state.covariance[1][3],-.4);
    close(r.logLikelihood,-.5*(Math.log(2*Math.PI*2.5)+4/2.5));
  });
  it('sums joint observation likelihoods without dependence on sensor order', () => {
    const m=model();const a=reading({sensor:0,recordId:'synthetic:tank:a:1',valueLitres:-2});const b=reading();
    compare(advance(m,initialize(m),[0,0],[a,b]),advance(m,initialize(m),[0,0],[b,a]));
  });
  it('rejects double-counted sensors in one update', () => assert.throws(()=>advance(model(),initialize(model()),[0,0],[reading(),reading()])));
  it('keeps finite posterior weights under extremely unlikely observations', () => {
    const m=model();const r=advance(m,initialize(m),[0,0],[reading({valueLitres:1e5})]);
    close(r.modeWeights.reduce((s,v)=>s+v,0),1);assert.ok(r.modeWeights.every(Number.isFinite));
  });
  it('checks derived model consistency instead of silently accepting changed H', () => {
    const m=model();m.measurementRows[1][3]=0;assert.throws(()=>replaySwitching(m,[[0,0]],[],1),/Mutated/);
  });
  for(const probability of [0,-1,.3,NaN,Infinity])it(`rejects invalid hazard ${probability}`,()=>assert.throws(()=>makeModel(model().base,{...p,jumpProbability:probability})));
  it('rejects swapped quiet and jump variances',()=>assert.throws(()=>makeModel(model().base,{...p,quietBiasVariance:3})));
});

describe('mixture uncertainty and numerical integrity', () => {
  it('includes between-component spread in the reported covariance',()=>{
    const a=checked([0,0,0,-2],eye()),b=checked([0,0,0,2],eye());const c=mix([a,b],[.5,.5]);
    assert.equal(c.mean[3],0);close(c.covariance[3][3],5);close(c.covariance[0][0],1);
  });
  it('uses row-to-column transition semantics with a nonsymmetric mode matrix',()=>{
    const m=model();m.modeTransition=[[.7,.1,.1,.1],[.2,.6,.1,.1],[.1,.2,.6,.1],[.1,.1,.2,.6]];
    const x=initialize(m);x.modeWeights=[.1,.2,.3,.4];const out=advance(m,x,[0,0],[]);
    compare(out.modeWeights,[.18,.23,.29,.30]);
  });
  it('identical modes collapse to the same Gaussian and leave weights at their prior',()=>{
    const m=makeModel(model().base,{...p,jumpLossVariance:p.quietLossVariance,jumpBiasVariance:p.quietBiasVariance});
    const r=advance(m,initialize(m),[0,0],[reading()]);r.components.forEach(c=>compare(c,r.components[0]));
    compare(r.modeWeights,m.modeTransition[0]);compare(summarize(r).state,r.components[0]);
  });
  it('calculates equal-tail mixture intervals rather than Gaussian moment bands',()=>{
    const a=checked([0,0,0,-4],eye()),b=checked([0,0,0,4],eye());const range=intervals([a,b],[.5,.5])[3];
    const cdf=(x:number)=>(normalCdf(x+4)+normalCdf(x-4))/2;
    close(cdf(range[0]),.025,1e-10);close(cdf(range[1]),.975,1e-10);
    assert.ok(range[1]<1.959963984540054*Math.sqrt(17));
  });
  it('normal CDF handles symmetry and tails',()=>{
    close(normalCdf(0),.5);close(normalCdf(-2)+normalCdf(2),1);
    assert.ok(normalCdf(8)>.99999999);assert.ok(normalCdf(-8)<1e-8);
  });
  it('supports covariance scales with different physical units',()=>chol([[1e-10,0,0,0],[0,1e5,0,0],[0,0,1e-4,0],[0,0,0,1]]));
  for(const kind of ['negative','asymmetric','singular'])it(`rejects ${kind} covariance`,()=>{
    const p=eye();if(kind==='negative')p[2][2]=-1;if(kind==='asymmetric')p[0][1]=.1;if(kind==='singular')p[2][2]=0;
    assert.throws(()=>chol(p));
  });
  it('rejects invalid weights rather than normalizing malformed configuration',()=>assert.throws(()=>mix([checked([0,0,0,0],eye())],[.9])));
});

describe('as-known replay, missingness and identifiability', () => {
  it('late data replay at observation time matches on-time final state',()=>{
    const m=model(),cs:Pair[]=[[0,0],[0,0],[0,0]];
    const a=replaySwitching(m,cs,[reading()],3),b=replaySwitching(m,cs,[reading({knownAt:at(3)})],3);
    compare(a.state,b.state);compare(a.modeWeights,b.modeWeights);assert.notEqual(a.evidenceHash,b.evidenceHash);
  });
  it('future-known values and future controls cannot change earlier result hashes',()=>{
    const m=model();const a=replaySwitching(m,[[0,0],[0,0],[1,1]],[reading({knownAt:at(3)})],2);
    const b=replaySwitching(m,[[0,0],[0,0],[50,50]],[reading({knownAt:at(3),valueLitres:999})],2);
    assert.equal(a.resultHash,b.resultHash);assert.equal(a.assimilation.usedRows,0);
  });
  it('refuses stale hashes, duplicate events and missing controls',()=>{
    const m=model(),r=reading();assert.throws(()=>replaySwitching(m,[[0,0]],[{...r,valueLitres:0}],1));
    assert.throws(()=>replaySwitching(m,[[0,0]],[r,r],1));assert.throws(()=>replaySwitching(m,[],[],1));
  });
  it('preserves frozen evidence and earlier retained results',()=>{
    const m=model(),r=reading({knownAt:at(3)});Object.freeze(r);const cs:Pair[]=[[0,0],[0,0],[0,0]];
    const a=replaySwitching(m,cs,[r],2),text=JSON.stringify(a);replaySwitching(m,cs,[r],3);assert.equal(JSON.stringify(a),text);
  });
  it('reversing the archive leaves state and content identity unchanged',()=>{
    const f=generateFixture('staggered',11,24),m=makeModel(f.model,p);
    assert.deepEqual(replaySwitching(m,f.controls,f.readings,24),replaySwitching(m,f.controls,[...f.readings].reverse(),24));
  });
  it('no sensors propagate only the model, not fictitious observations',()=>{
    const f=generateFixture('no_sensors',11,24),m=makeModel(f.model,p),r=replaySwitching(m,f.controls,[],24);
    const base=replay(f.model,f.controls,[],24);compare(r.state.mean.slice(0,2),base.state.mean);
    assert.equal(r.lossSupport,'model_only');assert.equal(r.biasSupport,'model_only');assert.equal(r.initialStateInformationRank,0);
    assert.deepEqual(r.lastObservedAt,[null,null]);assert.equal(r.assimilation.usedRows,0);chol(r.state.covariance);
    assert.ok(r.state.covariance[2][2]>m.initial.covariance[2][2]);
  });
  it('decoupled sensors cannot separately identify loss and sensor-B bias',()=>{
    const f=generateFixture('full',11,24);f.model.transition=[[.97,0],[0,.97]];const r=replaySwitching(makeModel(f.model,p),f.controls,f.readings,24);
    assert.equal(r.initialStateInformationRank,3);assert.equal(r.lossSupport,'not_identifiable');assert.equal(r.biasSupport,'not_identifiable');
  });
  it('sensor A alone with no coupling does not observe sensor-B bias or loss',()=>{
    const f=generateFixture('unobserved_b',11,24),r=replaySwitching(makeModel(f.model,p),f.controls,f.readings,24);
    assert.equal(r.initialStateInformationRank,1);assert.equal(r.lossSupport,'not_identifiable');assert.equal(r.biasSupport,'not_identifiable');
  });
  it('full coupled sensing gives structural rank four, not a causal certificate',()=>{
    const f=generateFixture('full',11,24),r=replaySwitching(makeModel(f.model,p),f.controls,f.readings,24);
    assert.equal(r.initialStateInformationRank,4);assert.equal(r.causalAttribution,'not_established');assert.equal(r.modeWeightMeaning,'model_conditional_not_fault_probability');
  });
  it('retains evidence identity across model versions',()=>{
    const f=generateFixture('full',11,24),a=replaySwitching(makeModel(f.model,p),f.controls,f.readings,24),b=replay(f.model,f.controls,f.readings,24);
    assert.equal(a.evidenceHash,b.evidenceHash);assert.notEqual(a.modelHash,b.modelHash);assert.notEqual(a.operationId,b.operationId);
  });
  it('computes row rank without counting duplicate information twice',()=>{
    assert.equal(rank([[1,0,0,0],[2,0,0,0]]),1);assert.equal(rank(eye()),4);assert.equal(rank([]),0);
  });
});

describe('fresh splits, fixed protocol and unrelaxed gates',()=>{
  it('uses disjoint development, holdout, and consistency seeds beyond prior splits',()=>{
    assert.ok(protocol.developmentSeeds.start>2255);assert.ok(protocol.developmentSeeds.start+protocol.developmentSeeds.count<=protocol.heldOutSeeds.start);
    assert.ok(protocol.heldOutSeeds.start+protocol.heldOutSeeds.count<=protocol.consistency.firstSeed);
    for(const r of protocol.heldOutRegimes.filter(r=>r!=='nominal'))assert.ok(!protocol.developmentRegimes.includes(r));
  });
  it('forward evaluation and bounded replay agree on a development fixture',()=>{
    const f=fixture('dev_joint',3000);f.controls=f.controls.slice(0,16);f.truth=f.truth.slice(0,17);f.readings=f.readings.filter(r=>r.observedAt<=at(16));
    compare(trial(f,p).metrics,trial(f,p,true).metrics);
  });
  it('keeps synthetic truth outside estimator arguments',()=>{
    const f=fixture('dev_joint',3000),m=makeModel(f.model,p),a=replaySwitching(m,f.controls,f.readings,10);
    f.truth[90]=[999,999,999,999];assert.deepEqual(replaySwitching(m,f.controls,f.readings,10),a);
  });
  it('refuses modified or incomplete selection artifacts',()=>assert.throws(()=>checkSelection({schema:'bad',selectionHash:'x'} as never)));
  const metrics:Metrics={baselineRmse:1,lossOnlyRmse:1,switchingRmse:.8,baselineCoverage:.95,lossOnlyCoverage:.95,switchingCoverage:.95,
    baselineWidth:1,lossOnlyWidth:1,switchingWidth:1,lossRmse:.1,biasRmse:.1,lossCoverage:.95,biasCoverage:.95};
  const rows=()=>['nominal','bias_drift','loss_pulse_reversal'].map(regime=>({regime,metrics:{...metrics}}));
  it('does not relax the nominal no-degradation gate',()=>{
    const r=rows();r[0].metrics.switchingRmse=1.001;assert.equal(gateDecision(r).gates.nominalNoDegradation,false);
  });
  it('cannot hide one poorly covered regime in an aggregate',()=>{
    const r=rows();r[2].metrics.switchingCoverage=.89;assert.equal(gateDecision(r).gates.eachChangedCoverage,false);
  });
  it('cannot pass by expanding intervals without limit',()=>{
    const r=rows();r.forEach(x=>{x.metrics.switchingCoverage=1;x.metrics.switchingWidth=3;});assert.equal(gateDecision(r).gates.widthBudget,false);
  });
  it('passing benchmark gates still does not promote the model',()=>assert.equal(gateDecision(rows()).status,'benchmark_gates_passed_not_promoted'));
});

describe('persistent interval-coupled variant and presentation',()=>{
  it('couples a within-interval jump into the volume-loss covariance',()=>{
    const m=makeModel(model().base,{...p,lossJumpCoupling:1,modePersistence:.95});
    close(m.processCovariances[1][1][1],m.base.processCovariance[1][1]+p.jumpLossVariance);
    close(m.processCovariances[1][1][2],-p.jumpLossVariance);chol(m.processCovariances[1]);
  });
  it('persistent modes retain their prior without fabricating measurement evidence',()=>{
    const m=makeModel(model().base,{...p,lossJumpCoupling:1,modePersistence:.95});
    compare(advance(m,initialize(m),[0,0],[]).modeWeights,m.modeTransition[0]);
    assert.ok(m.modeTransition[0][0]>.99);
  });
  it('rejects invalid persistence or loss timing',()=>{
    assert.throws(()=>makeModel(model().base,{...p,modePersistence:1}));
    assert.throws(()=>makeModel(model().base,{...p,lossJumpCoupling:2} as never));
  });
  it('keeps the second development and held-out protocol separated',async()=>{
    const v=await import('../benchmarks/industrial-observer/switching/experiment_v2');
    assert.ok(v.protocol.developmentSeeds.start>5015);
    assert.ok(v.protocol.heldOutSeeds.start>v.protocol.developmentSeeds.start+v.protocol.developmentSeeds.count);
    assert.equal(v.protocol.noPostHoldoutRetuning,true);
    for(const r of v.protocol.heldOutRegimes.filter(r=>r!=='nominal'))assert.ok(!v.protocol.developmentRegimes.includes(r));
  });
  it('reports structural support separately from a stale current update',async()=>{
    const view=await import('../src/lib/switchingObserverInspection');const f=generateFixture('blackout',11,96);
    const r=replaySwitching(makeModel(f.model,p),f.controls,f.readings,50);
    const e={executionId:'synthetic-execution:one',result:r,verification:{status:'not_verified' as const,verificationId:null}};
    const v=view.toSwitchingObserverInspection(e);assert.equal(v.currentUpdateStatus,'prediction_only');assert.equal(v.rows.length,4);
    assert.equal(v.causalAttribution,'not_established');assert.equal(v.verification.verificationId,null);
    assert.equal(v.integrityStatus,'format_checked_not_cryptographically_verified');
  });
  it('rejects non-synthetic or falsely verified retained envelopes',async()=>{
    const {toSwitchingObserverInspection:view}=await import('../src/lib/switchingObserverInspection');
    const r=replaySwitching(model(),[[0,0]],[],1),e={executionId:'synthetic-execution:one',result:r,verification:{status:'not_verified' as const,verificationId:null}};
    assert.throws(()=>view({...e,result:{...r,valueKind:'official_record'}} as never));
    assert.throws(()=>view({...e,verification:{status:'verified',verificationId:'x'}} as never));
  });
  it('imports no execution module into the GSC inspector',async()=>{
    const {readFileSync}=await import('node:fs');const src=readFileSync('src/lib/switchingObserverInspection.ts','utf8');
    assert.ok(!/from\s+['"].*(?:benchmarks|engine|node:)/.test(src));
  });
});
