import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { at, hash } from '../benchmarks/industrial-observer/core';
import { contractBox, divide, nextUp, nextDown, plus, minus, scale } from '../benchmarks/industrial-observer/bounded/interval';
import { boundSeries, checkContract, replayBound, sealCalibration, sealReading, selectRows } from '../benchmarks/industrial-observer/bounded/guard';
import { certificate, contract, fixture, metrics, protocol } from '../benchmarks/industrial-observer/bounded/experiment';
import type { BoundInputs, CalibrationEnvelope, Interval } from '../src/types/bounded_observer';

function quiet(steps=16):BoundInputs {
 const c=contract(true);c.initial=[[-1,1],[-1,1],[-.1,.1],[-1,1]];
 c.lossIncrementAbs=0;c.biasIncrementAbs=0;c.processAbsLitres=[0,0];c.measurementAbsLitres=[0,0,0];
 const cal=certificate(96);const {rowHash:_hash,...draft}=cal;
 const calibration=sealCalibration({...draft,driftAbsLitresPerSecond:0});
 const readings=Array.from({length:steps},(_,i)=>['a','b','reference'].map(channel=>sealReading({
  recordId:`synthetic:bound:${channel}:${i+1}`,observedAt:at(i+1),knownAt:at(i+1),channel:channel as 'a'|'b'|'reference',valueLitres:0,
  calibrationId:channel==='reference'?calibration.calibrationId:null}))).flat();
 return {contract:c,calibration,controls:Array.from({length:steps},()=>[0,0]),readings};
}
const within=(x:number,i:Interval)=>x>=i[0]&&x<=i[1];

describe('directed binary64 arithmetic and linear strips',()=>{
 it('steps on both sides of zero and ±one',()=>{
  assert.equal(nextUp(0),Number.MIN_VALUE);assert.equal(nextDown(0),-Number.MIN_VALUE);
  assert.equal(nextUp(-0),Number.MIN_VALUE);assert.ok(nextDown(1)<1&&nextUp(1)>1);
  assert.equal(nextUp(-Infinity),-Number.MAX_VALUE);assert.equal(nextDown(Infinity),Number.MAX_VALUE);
 });
 it('handles endpoint infinities without a NaN repair',()=>{
  assert.equal(nextUp(Infinity),Infinity);assert.equal(nextDown(-Infinity),-Infinity);assert.ok(Number.isNaN(nextUp(NaN)));
 });
 it('retains underflow and rounding residuals',()=>{
  const r=scale([Number.MIN_VALUE,Number.MIN_VALUE],.5);assert.ok(r[0]<=0&&r[1]>=Number.MIN_VALUE);
  assert.ok(within(.3,plus([.1,.1],[.2,.2])));
 });
 it('handles negative coefficients and division',()=>{
  assert.ok(within(-6,scale([1,3],-2)));assert.ok(within(-2,scale([1,3],-2)));
  const r=divide([2,6],-2);assert.ok(within(-3,r)&&within(-1,r));
 });
 it('never substitutes an epsilon for a zero divisor or overflow',()=>{
  assert.throws(()=>divide([0,1],0));assert.throws(()=>scale([Number.MAX_VALUE,Number.MAX_VALUE],2));
 });
 it('contracts a hand-solved box without removing feasible corners',()=>{
  const r=contractBox([[0,10],[0,10]],[{coefficients:[1,1],range:[3,4]}],4)!;
  assert.ok(r[0][1]<=4.00000000000001&&r[1][1]<=4.00000000000001);
  for(const [x,y] of [[0,3],[4,0],[2,2]])assert.ok(within(x,r[0])&&within(y,r[1]));
 });
 it('identifies empty strips without resetting to the prior',()=>{
  assert.equal(contractBox([[0,1]],[{coefficients:[1],range:[2,3]}],1),null);
  assert.equal(contractBox([[0,1]],[{coefficients:[0],range:[2,3]}],1),null);
 });
 it('handles equalities and a negative observation row',()=>{
  const r=contractBox([[-10,10]],[{coefficients:[-2],range:[4,4]}],2)!;assert.ok(within(-2,r[0]));
 });
 it('retains caller-owned frozen boxes',()=>{
  const x:Interval[]=[[0,1],[1,2]];x.forEach(Object.freeze);Object.freeze(x);
  contractBox(x,[{coefficients:[1,-1],range:[-1,0]}],2);assert.deepEqual(x,[[0,1],[1,2]]);
 });
 for(const bad of [NaN,Infinity,-1])it(`rejects invalid error bound ${bad}`,()=>{
  const c=contract();c.lossIncrementAbs=bad;assert.throws(()=>checkContract(c));
 });
});

describe('shared systematic uncertainty rather than iid noise',()=>{
 it('retains the common-offset gauge after repeated exact measurements',()=>{
  const q=quiet(96),r=replayBound(q,96);
  // Decoupled null direction: [0, delta, -.03 delta, -delta], c=-delta.
  // Both ±.4 displacements produce the same zero primary and reference outputs.
  assert.ok(r.bounds);for(const sign of [-1,1]){
   assert.ok(within(sign*.4,r.bounds![1]));assert.ok(within(-sign*.012,r.bounds![2]));assert.ok(within(-sign*.4,r.bounds![3]));
  }
  assert.ok(r.bounds![1][1]-r.bounds![1][0]>=.8-1e-12);
  assert.ok(within(-.4,r.sharedCalibrationOffset!)&&within(.4,r.sharedCalibrationOffset!));
 });
 it('contrasts a known-zero calibration with an uncertain shared offset',()=>{
  const q=quiet();const broad=replayBound(q,16);q.calibration=certificate(96,true);const zero=replayBound(q,16);
  assert.ok(broad.bounds![1][1]-broad.bounds![1][0]>.79);
  assert.ok(zero.bounds![1][1]-zero.bounds![1][0]<1e-10);
 });
 it('treats drift as accumulated bound, not per-sample independent variance',()=>{
  const q=quiet();const staticResult=replayBound(q,16);q.calibration=certificate();
  const drifting=replayBound(q,16);assert.ok(drifting.bounds![1][1]-drifting.bounds![1][0]>=staticResult.bounds![1][1]-staticResult.bounds![1][0]);
 });
 it('does not use a future-known calibration envelope',()=>{
  const q=quiet();const {rowHash:_hash,...d}=q.calibration;q.calibration=sealCalibration({...d,knownAt:at(20)});
  const a=replayBound(q,10);q.calibration=sealCalibration({...d,knownAt:at(20),offsetLitres:[-100,100]});
  const b=replayBound(q,10);assert.deepEqual(a,b);assert.equal(a.calibrationHash,null);
  assert.equal(a.accounting.unsupportedReferenceRows,10);
 });
 it('never treats an expired reference sample as newly calibrated',()=>{
  const q=quiet();q.calibration=certificate(8);const r=replayBound(q,16);
  assert.equal(r.accounting.unsupportedReferenceRows,8);assert.equal(r.lastObservedAt[2],at(8));
  assert.ok(r.axisDecisions[1].reasons.includes('calibration_expired'));
 });
 it('retains old valid reference evidence after expiry but abstains for its target',()=>{
  const q=quiet();q.calibration=certificate(8);const r=replayBound(q,16);
  assert.equal(r.accounting.assimilatedRows,40);assert.ok(r.bounds);assert.equal(r.axisDecisions[1].action,'abstain');
 });
 it('does not claim a feasible box verifies its calibration',()=>{
  const r=replayBound(quiet(),16);assert.equal(r.feasibility,'not_disproved');
  assert.equal(r.physicalAssumptionsVerified,false);assert.equal(r.probability,null);
 });
});

describe('replay, preservation and abstention',()=>{
 it('late measurements reproduce on-time posterior bounds once known',()=>{
  const q=quiet();const on=replayBound(q,16);q.readings=q.readings.map(r=>{
   const {rowHash:_h,...d}=r;return r.observedAt===at(4)?sealReading({...d,knownAt:at(7)}):r;
  });const delayed=replayBound(q,16);assert.deepEqual(on.bounds,delayed.bounds);assert.notEqual(on.evidenceHash,delayed.evidenceHash);
 });
 it('future observation values and controls cannot change earlier identity',()=>{
  const q=quiet();const a=replayBound(q,8);q.controls[15]=[99,99];
  q.readings=q.readings.map(r=>{const {rowHash:_h,...d}=r;return r.observedAt===at(16)?sealReading({...d,valueLitres:100}):r;});
  assert.deepEqual(a,replayBound(q,8));
 });
 it('reordering the archive does not change results',()=>{
  const q=quiet(),a=replayBound(q,16);q.readings.reverse();assert.deepEqual(a,replayBound(q,16));
 });
 it('rejects duplicated and altered evidence',()=>{
  const q=quiet();assert.throws(()=>selectRows([...q.readings,q.readings[0]],16));
  q.readings[0].valueLitres=99;assert.throws(()=>replayBound(q,16));
 });
 it('rejects a stale calibration hash',()=>{const q=quiet();q.calibration.offsetLitres=[-1,1];assert.throws(()=>replayBound(q,16));});
 it('unknown calibration ID is accounted as unsupported, not silently applied',()=>{
  const q=quiet();q.readings=q.readings.map(r=>{const {rowHash:_h,...d}=r;return r.channel==='reference'?sealReading({...d,calibrationId:'synthetic:calibration:other'}):r;});
  assert.equal(replayBound(q,16).accounting.unsupportedReferenceRows,16);
 });
 it('latches inconsistent assumptions rather than discarding the contradictory row',()=>{
  const q=quiet();const {rowHash:_h,...d}=q.readings[0];q.readings[0]=sealReading({...d,valueLitres:100});
  for(const t of [1,8,16]){
   const r=replayBound(q,t);assert.equal(r.bounds,null);assert.equal(r.firstInconsistentAt,at(1));assert.ok(r.axisDecisions.every(d=>d.action==='abstain'));
   const a=r.accounting;assert.equal(a.selectedRows,a.assimilatedRows+a.unsupportedReferenceRows+a.unprocessedRows);
  }
 });
 it('no sensing keeps conditional bounds but all decisions abstain',()=>{
  const q=quiet();q.readings=[];const r=replayBound(q,16);assert.ok(r.bounds);assert.ok(r.axisDecisions.every(d=>d.action==='abstain'));
 });
 it('outage bounds grow instead of becoming zero-width or last-good confidence',()=>{
  const f=fixture('all_blackout',22000);const a=replayBound(f.input,30),b=replayBound(f.input,60);
  assert.ok(b.bounds![1][1]-b.bounds![1][0]>a.bounds![1][1]-a.bounds![1][0]);assert.ok(b.axisDecisions.every(d=>d.action==='abstain'));
 });
 it('frozen inputs and earlier retained results remain unchanged',()=>{
  const q=quiet();const a=replayBound(q,8),text=JSON.stringify(q);q.readings.forEach(Object.freeze);const rtext=JSON.stringify(a);
  replayBound(q,16);assert.equal(JSON.stringify(q),text);assert.equal(JSON.stringify(a),rtext);
 });
 it('changes assumption identity without renaming evidence',()=>{
  const q=quiet(),a=replayBound(q,16);q.contract.precisionWidthLimits[0]=2;const b=replayBound(q,16);
  assert.notEqual(a.assumptionHash,b.assumptionHash);assert.equal(a.evidenceHash,b.evidenceHash);
 });
 it('matches the immediate-data fast path against every chronological replay',()=>{
  const f=fixture('primary_drift',22001),series=boundSeries(f.input);
  for(let t=1;t<=96;t++)assert.deepEqual(series[t-1].bounds,replayBound(f.input,t).bounds);
 });
 for(const regime of protocol.regimes)it(`contains all four synthetic states for ${regime}`,()=>{
  const f=fixture(regime,22002);assert.equal(metrics(boundSeries(f.input),f.truth).allStateContainment,1);
 });
 it('rewind checkpoints reproduce every delayed-evidence full replay exactly',()=>{
  const f=fixture('delayed_reference',22001),series=boundSeries(f.input);
  for(let t=1;t<=96;t++){
   const replay=replayBound(f.input,t);assert.deepEqual(series[t-1].bounds,replay.bounds);
   assert.deepEqual(series[t-1].axisDecisions,replay.axisDecisions);
   assert.deepEqual(series[t-1].sharedCalibrationOffset,replay.sharedCalibrationOffset);
  }
 });
 it('one-second control uses the same truth and coincident noise draws',()=>{
  const a=fixture('reference_drift',22000,4),b=fixture('reference_drift',22000,1);assert.deepEqual(a.truth,b.truth);
  for(const r of a.input.readings)assert.deepEqual(r,b.input.readings.find(x=>x.recordId===r.recordId));
 });
 it('does not claim probabilities or modify old operation identifiers',()=>{
  const src=readFileSync('benchmarks/industrial-observer/bounded/guard.ts','utf8');
  assert.ok(!src.includes('covariance'));assert.ok(!src.includes('replayReference('));
  assert.equal(replayBound(quiet(),16).boundBasis,'conditional_bounded_error_enclosure_not_probability');
 });
 it('reports errors at abstained times rather than removing them from containment',()=>{
  const f=fixture('nominal_offset',22000),s=boundSeries(f.input);f.truth[96][1]=1e5;
  assert.ok(metrics(s,f.truth).allStateContainment<1);assert.equal(metrics(s,f.truth).cutoffs,96);
 });
 it('uses a new split without fitting on evaluation outcomes',()=>{
  assert.ok(protocol.heldOutSeeds.start>15255);assert.ok(protocol.stressSeeds.start>protocol.heldOutSeeds.start+protocol.heldOutSeeds.count);
  assert.equal(protocol.noFitting,true);assert.equal(hash('protocol',protocol),hash('protocol',JSON.parse(JSON.stringify(protocol))));
 });
});
