import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { at, hash } from '../benchmarks/industrial-observer/core';
import { generateFixture } from '../benchmarks/industrial-observer/experiment';
import { makeModel, replaySwitching } from '../benchmarks/industrial-observer/switching/observer';
import { apply, chol, dot, eye, rank } from '../benchmarks/industrial-observer/switching/numerics';
import { fixture, frozenParameters, observabilityDiagnostic, protocol, references, specification, trial } from '../benchmarks/industrial-observer/reference/experiment';
import { referenceRow, replayReference, sealReference, selectReferences } from '../benchmarks/industrial-observer/reference/observer';
import type { ReferenceReading, ReferenceSpecification } from '../src/types/reference_observer';

const close=(a:number,b:number,tol=1e-10)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const setup=(regime='nominal')=>{const f=fixture(regime,13001);return {f,m:makeModel(f.model,frozenParameters),ref:references(f,'independent_4s')};};
const run=(s:ReturnType<typeof setup>,t:number)=>replayReference(s.m,s.f.controls,s.f.readings,s.ref.rows,s.ref.spec,t);

describe('independent calibration versus redundant biased sensing',()=>{
 it('uses genuinely different observation rows without changing F, Q, modes or parameters',()=>{
  assert.deepEqual(referenceRow(specification()),[0,1,0,0]);assert.deepEqual(referenceRow(specification(true)),[0,1,0,1]);
  const s=setup(),before=JSON.stringify(s.m);run(s,8);assert.equal(JSON.stringify(s.m),before);
  assert.equal(s.m.initial.mean.length,4);assert.equal(s.m.modeNames.length,4);
 });
 it('exhibits the exact decoupled loss-bias null direction',()=>{
  const d=observabilityDiagnostic().find(x=>x.topology==='decoupled')!,v=d.decoupledNullDirection!;
  apply(d.model.transition,v).forEach((x,i)=>close(x,v[i]));
  d.primaryRows.forEach(row=>close(dot(row,v),0));d.sharedBiasRows.forEach(row=>close(dot(row,v),0));
  assert.ok(d.independentRows.some(row=>Math.abs(dot(row,v))>.5));
 });
 it('independent sensing resolves rank 3 to 4 while the common-bias monitor does not',()=>{
  const d=observabilityDiagnostic().find(x=>x.topology==='decoupled')!;
  assert.deepEqual(d.ranks,{primary:3,independent:4,sharedBias:3});
 });
 it('does not invent a rank deficiency in the already observable coupled model',()=>{
  assert.deepEqual(observabilityDiagnostic().find(x=>x.topology==='coupled')!.ranks,{primary:4,independent:4,sharedBias:4});
 });
 it('retains identical primary predictions for two null-displaced initial states',()=>{
  const d=observabilityDiagnostic().find(x=>x.topology==='decoupled')!;let a=[1,2,.2,-.3],b=a.map((x,i)=>x+2*d.decoupledNullDirection![i]);
  for(let t=0;t<16;t++){d.model.measurementRows.forEach(h=>close(dot(h,a),dot(h,b)));a=apply(d.model.transition,a);b=apply(d.model.transition,b);}
  close(dot(referenceRow(specification()),b)-dot(referenceRow(specification()),a),2);
 });
 it('separates fresh measurement noise from a common physical bias loading',()=>{
  const s=setup('bias_plateau'),a=references(s.f,'independent_4s'),b=references(s.f,'shared_bias_4s');
  const t=40,i=a.rows.findIndex(r=>r.observedAt===at(t));
  close(b.rows[i].valueLitres-a.rows[i].valueLitres,s.f.truth[t][3]);
  assert.notEqual(a.spec.calibrationId,b.spec.calibrationId);
 });
 it('labels calibration as a synthetic assumption rather than a physical certificate',()=>{
  const s=setup();assert.equal(run(s,8).referenceSpecification.calibrationStatus,'synthetic_known_offset_assumption');
  assert.equal(run(s,8).causalAttribution,'not_established');
 });
});

describe('row identity, uncertainty and chronology',()=>{
 it('rejects a copied-primary noise family rather than accepting it as an independent source',()=>{
  const s=setup(),{rowHash:_ignored,...r}=s.ref.rows[0];
  const copy=sealReference({...r,noiseFamily:'synthetic:primary:b:noise'});
  assert.throws(()=>selectReferences([copy],s.ref.spec,8));
 });
 it('rejects duplicate reference samples and counts accepted rows once',()=>{
  const s=setup();assert.throws(()=>selectReferences([s.ref.rows[0],s.ref.rows[0]],s.ref.spec,8));
  const r=run(s,8);assert.equal(r.assimilation.referenceRows,2);assert.equal(r.assimilation.usedRows,r.assimilation.primaryRows+2);
 });
 it('rejects modified values with stale hashes',()=>{
  const s=setup();assert.throws(()=>selectReferences([{...s.ref.rows[0],valueLitres:20}],s.ref.spec,8));
 });
 it('rejects a reference carrying the wrong calibration identity',()=>{
  const s=setup(),{rowHash:_ignored,...r}=s.ref.rows[0];
  assert.throws(()=>selectReferences([sealReference({...r,calibrationId:'synthetic:other'})],s.ref.spec,8));
 });
 for(const value of [0,-1,NaN,Infinity])it(`rejects invalid declared reference variance ${value}`,()=>{
  assert.throws(()=>referenceRow({...specification(),varianceLitres2:value}));
 });
 it('refuses row uncertainty differing from the supplied calibration specification',()=>{
  const s=setup(),{rowHash:_ignored,...r}=s.ref.rows[0];assert.throws(()=>selectReferences([sealReference({...r,varianceLitres2:.01})],s.ref.spec,8));
 });
 it('rejects unknown specification fields and unknown loading',()=>{
  assert.throws(()=>referenceRow({...specification(),extra:true} as ReferenceSpecification));
  assert.throws(()=>referenceRow({...specification(),loading:'arbitrary'} as unknown as ReferenceSpecification));
 });
 it('cannot assimilate a reading before its measurement time',()=>{
  const s=setup(),{rowHash:_ignored,...r}=s.ref.rows[0];assert.throws(()=>selectReferences([sealReference({...r,knownAt:at(3)})],s.ref.spec,8));
 });
 it('does not use a reference until knownAt',()=>{
  const s=setup();s.ref=references(s.f,'initial_only','none',3);
  assert.equal(run(s,6).assimilation.referenceRows,0);assert.equal(run(s,7).assimilation.referenceRows,1);
 });
 it('a delayed reference is applied at measurement time via replay',()=>{
  const s=setup(),on=references(s.f,'initial_only'),late=references(s.f,'initial_only','none',3);
  const a=replayReference(s.m,s.f.controls,s.f.readings,on.rows,on.spec,8),b=replayReference(s.m,s.f.controls,s.f.readings,late.rows,late.spec,8);
  assert.deepEqual(a.state,b.state);assert.deepEqual(a.modeWeights,b.modeWeights);assert.notEqual(a.evidenceHash,b.evidenceHash);
 });
 it('future-known reference values and future controls cannot alter earlier result identity',()=>{
  const s=setup();s.ref=references(s.f,'initial_only','none',4);const a=run(s,6);
  const {rowHash:_ignored,...r}=s.ref.rows[0];s.ref.rows=[sealReference({...r,valueLitres:99})];s.f.controls[80]=[999,999];
  assert.equal(run(s,6).resultHash,a.resultHash);
 });
 it('earlier results are not rewritten when late references become eligible',()=>{
  const s=setup();s.ref=references(s.f,'initial_only','none',4);const a=run(s,6),before=JSON.stringify(a);run(s,9);assert.equal(JSON.stringify(a),before);
 });
 it('input ordering leaves posterior content unchanged',()=>{
  const s=setup('delayed_primary'),a=run(s,12);s.f.readings.reverse();s.ref.rows.reverse();assert.deepEqual(run(s,12),a);
 });
 it('keeps frozen source rows, controls and reference specifications unchanged',()=>{
  const s=setup(),before=JSON.stringify(s);s.ref.rows.forEach(Object.freeze);s.f.readings.forEach(Object.freeze);Object.freeze(s.ref.spec);run(s,12);assert.equal(JSON.stringify(s),before);
 });
 it('separates evidence and measurement-model identity from process-model identity',()=>{
  const s=setup(),a=run(s,8),b=replaySwitching(s.m,s.f.controls,s.f.readings,8);
  assert.equal(a.modelHash,b.modelHash);assert.equal(a.primaryEvidenceHash,b.evidenceHash);assert.notEqual(a.evidenceHash,b.evidenceHash);assert.notEqual(a.operationId,b.operationId);
 });
});

describe('regressions, missing measurements and fresh experimental split',()=>{
 it('no-reference execution reproduces the frozen baseline posterior exactly',()=>{
  const s=setup('delayed_primary');s.ref.rows=[];const a=run(s,12),b=replaySwitching(s.m,s.f.controls,s.f.readings,12);
  assert.deepEqual(a.state,b.state);assert.deepEqual(a.components,b.components);assert.deepEqual(a.interval95,b.interval95);assert.deepEqual(a.modeWeights,b.modeWeights);
 });
 it('no measurements reports model-only support and zero samples',()=>{
  const s=setup();s.f.readings=[];s.ref.rows=[];const r=run(s,12);
  assert.equal(r.lossSupport,'model_only');assert.equal(r.biasSupport,'model_only');assert.equal(r.assimilation.usedRows,0);assert.equal(r.initialStateInformationRank,0);chol(r.state.covariance);
 });
 it('reference without primary B cannot identify sensor B bias',()=>{
  const s=setup('decoupled_mixed');s.f.readings=s.f.readings.filter(r=>r.sensor===0);const r=run(s,12);
  assert.equal(r.lossSupport,'structurally_identifiable');assert.equal(r.biasSupport,'not_identifiable');assert.equal(r.initialStateInformationRank,3);
 });
 it('removes the reference as well as primary sensors during all-blackout',()=>{
  const s=setup('all_blackout');assert.ok(!s.ref.rows.some(r=>r.observedAt>=at(34)&&r.observedAt<=at(67)));
  const r=run(s,60);assert.equal(r.lastReferenceObservedAt,at(32));assert.ok(r.lastObservedAt.every(t=>t!==null&&t<=at(33)));chol(r.state.covariance);
 });
 it('one early calibration is not reported as a fresh measurement later',()=>{
  const s=setup();s.ref=references(s.f,'initial_only');const r=run(s,40);
  assert.equal(r.assimilation.referenceRows,1);assert.equal(r.lastReferenceObservedAt,at(4));
 });
 it('shared-bias monitor preserves the decoupled ambiguity',()=>{
  const s=setup('decoupled_mixed');s.ref=references(s.f,'shared_bias_4s');const r=run(s,12);
  assert.equal(r.initialStateInformationRank,3);assert.equal(r.lossSupport,'not_identifiable');assert.equal(r.biasSupport,'not_identifiable');
 });
 it('all arms share the same primary evidence and truth rather than regenerating easier trajectories',()=>{
  const f=fixture('mixed_jumps',13002),before=hash('test',f);
  for(const arm of protocol.arms)references(f,arm as 'none');assert.equal(hash('test',f),before);
 });
 it('fixes all process parameters and reserves genuinely unused seed ranges',()=>{
  assert.equal(protocol.heldOutSeeds.start,14000);assert.equal(protocol.heldOutSeeds.count,16);assert.ok(protocol.gaussianCheck.startSeed>14015);
  assert.equal(frozenParameters.jumpProbability,.02);assert.equal(frozenParameters.modePersistence,.95);assert.equal(protocol.selection.startsWith('none;'),true);
 });
 it('fast evaluation matches full chronological replay',()=>{
  const f=fixture('nominal',13003);f.controls=f.controls.slice(0,12);f.readings=f.readings.filter(r=>r.observedAt<=at(12));f.truth=f.truth.slice(0,13);
  const fast=trial(f,'independent_4s').metrics,slow=trial(f,'independent_4s',true).metrics;
  for(const k of Object.keys(fast) as (keyof typeof fast)[])close(fast[k],slow[k]);
 });
 it('truth used only by the evaluator cannot change the observer result',()=>{
  const s=setup(),a=run(s,12);s.f.truth[12]=[99,99,99,99];assert.deepEqual(run(s,12),a);
 });
 it('keeps the new numerical module outside all application routes',()=>{
  const source=readFileSync('benchmarks/industrial-observer/reference/observer.ts','utf8');assert.ok(!/fetch\(|readFileSync|app\/api/.test(source));
 });
});
