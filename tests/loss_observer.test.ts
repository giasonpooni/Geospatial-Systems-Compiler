import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { at, replay, sealReading } from '../benchmarks/industrial-observer/core';
import { generateFixture, runScenario } from '../benchmarks/industrial-observer/experiment';
import { augmentLossModel, correctLoss, predictLoss, replayLoss } from '../benchmarks/industrial-observer/loss/observer';
import { cholesky3, nees3, rank3 } from '../benchmarks/industrial-observer/loss/numerics';
import { checkSelection, lossFixture, protocol, runTrial, HELD_OUT_REGIMES } from '../benchmarks/industrial-observer/loss/experiment';
import { runLossConsistency, LOSS_CONSISTENCY_BANDS } from '../benchmarks/industrial-observer/loss/consistency';
import { toLossObserverInspection } from '../src/lib/lossObserverInspection';
import type { GaussianLossState, LossExecution, LossParameters, Matrix3 } from '../src/types/loss_observer';
import type { Pair, TankReading } from '../src/types/observer_benchmark';

const parameters: LossParameters = { processVariance: 0.001, initialVariance: 0.04 };
const model = () => augmentLossModel(generateFixture('full', 1, 24).model, parameters);
const close = (a: number, b: number, tolerance = 1e-10) => assert.ok(Math.abs(a-b) <= tolerance, `${a} != ${b}`);
const reading = (overrides: Partial<Omit<TankReading, 'rowHash'>> = {}) => sealReading({
  recordId: 'synthetic:tank:b:1', observedAt: at(1), knownAt: at(1), sensor: 1,
  valueLitres: -1, noiseVarianceLitres2: 0.25, referenceVarianceLitres2: 0.25, ...overrides,
});
const envelope = (result: ReturnType<typeof replayLoss>): LossExecution => ({ executionId: 'synthetic-execution:test-1', result, verification: { status: 'not_verified', verificationId: null } });

describe('explicit loss state and covariance', () => {
  it('extends F/Q/prior without mutating the original model', () => {
    const base = generateFixture('full', 1, 24).model; const before = JSON.stringify(base);
    const m = augmentLossModel(base, parameters); m.base.transition[0][0] = 0.4;
    assert.equal(JSON.stringify(base), before); assert.equal(m.transition[1][2], -1);
    assert.equal(m.processCovariance[2][2], parameters.processVariance);
  });
  it('positive net outflow subtracts from tank B, negative adds to it', () => {
    const m = model(); const a = predictLoss({ ...m.initial, mean: [0, 0, 0.5] }, m, [0, 0]);
    const b = predictLoss({ ...m.initial, mean: [0, 0, -0.5] }, m, [0, 0]);
    assert.deepEqual(a.mean, [0, -0.5, 0.5]); assert.deepEqual(b.mean, [0, 0.5, -0.5]);
  });
  it('propagates state-loss cross covariance', () => {
    const m = model(); const p = predictLoss(m.initial, m, [0, 0]).covariance;
    close(p[1][2], -parameters.initialVariance); close(p[2][2], parameters.initialVariance+parameters.processVariance);
  });
  it('matches a hand-computed Joseph correction including reference variance', () => {
    const s: GaussianLossState = { mean: [0, 0, 0], covariance: [[1, 0, 0], [0, 1, -0.2], [0, -0.2, 1]] };
    const out = correctLoss(s, reading()); close(out.state.mean[1], -2/3); close(out.state.mean[2], 0.2/1.5);
    close(out.state.covariance[2][2], 1-0.04/1.5); close(out.innovation.varianceLitres2, 1.5);
    cholesky3(out.state.covariance);
  });
  it('allows a negative equivalent loss instead of imposing an unverified physical cause', () => {
    const m = model(); const p = predictLoss(m.initial, m, [0, 0]);
    assert.ok(correctLoss(p, reading({ valueLitres: 10 })).state.mean[2] < 0);
  });
  it('preserves the mixed-unit covariance and marginal volume block', () => {
    const f = generateFixture('full', 1, 24); const r = replayLoss(augmentLossModel(f.model, parameters), f.controls, f.readings, 24);
    assert.deepEqual(r.stateUnits, ['litres_deviation', 'litres_deviation', 'litres_per_second']);
    assert.deepEqual(r.volumeState.covariance, r.state.covariance.slice(0, 2).map(row => row.slice(0, 2)));
    assert.equal(r.interpretation, 'net_outflow_equivalent_not_causal_attribution');
  });
  it('whitens all three correlated state errors', () => {
    close(nees3({ mean: [0, 0, 0], covariance: [[2, 1, 0], [1, 2, 0], [0, 0, 4]] }, [1, 1, 2]), 5/3);
  });
  it('uses scale-independent covariance checks for mixed units', () => {
    cholesky3([[1e-10, 0, 0], [0, 1e5, 0], [0, 0, 0.01]]);
  });
  for (const variance of [-1, 0, NaN, Infinity]) {
    it(`rejects invalid disturbance variance ${variance}`, () => assert.throws(() => augmentLossModel(model().base, { ...parameters, processVariance: variance })));
  }
  for (const p of [[[1, 0, 0], [0, 1, 0], [0, 0, 0]], [[1, 2, 0], [2, 1, 0], [0, 0, 1]], [[1, 0, 0], [0.2, 1, 0], [0, 0, 1]]] as Matrix3[]) {
    it(`rejects invalid 3-state covariance ${JSON.stringify(p)}`, () => assert.throws(() => cholesky3(p)));
  }
  it('rejects stale derived model matrices', () => {
    const m = model(); m.transition[1][2] = 0;
    assert.throws(() => replayLoss(m, [[0, 0]], [], 1), /Inconsistent/);
  });
  it('rejects a malformed sensor or measurement variance', () => {
    assert.throws(() => correctLoss(model().initial, { ...reading(), sensor: 2 } as unknown as TankReading));
    assert.throws(() => correctLoss(model().initial, { ...reading(), referenceVarianceLitres2: -1 }));
  });
});

describe('chronological replay and retained identity', () => {
  it('matches delayed replay at measurement time against on-time replay at the same final cutoff', () => {
    const m = model(); const controls: Pair[] = [[0, 0], [0, 0], [0, 0]];
    const on = replayLoss(m, controls, [reading()], 3);
    const late = replayLoss(m, controls, [reading({ knownAt: at(3) })], 3);
    assert.deepEqual(late.state, on.state); assert.equal(late.assimilation.delayedRows, 1);
    assert.notEqual(late.evidenceHash, on.evidenceHash);
  });
  it('future-known values and future controls cannot change earlier output', () => {
    const m = model(); const cs: Pair[] = [[0, 0], [0, 0], [1, 1]];
    const a = replayLoss(m, cs, [reading({ knownAt: at(3) })], 2);
    const b = replayLoss(m, [[0, 0], [0, 0], [99, 99]], [reading({ knownAt: at(3), valueLitres: -30 })], 2);
    assert.equal(a.resultHash, b.resultHash); assert.equal(a.assimilation.usedRows, 0);
  });
  it('never rewrites previously retained cutoffs', () => {
    const m = model(); const cs: Pair[] = [[0, 0], [0, 0], [0, 0]]; const rs = [reading({ knownAt: at(3) })];
    const a = replayLoss(m, cs, rs, 2); const before = JSON.stringify(a); replayLoss(m, cs, rs, 3);
    assert.equal(JSON.stringify(a), before);
  });
  it('preserves frozen input rows and hashes', () => {
    const f = generateFixture('full', 1, 24); const hashes = f.readings.map(r => r.rowHash); f.readings.forEach(Object.freeze);
    replayLoss(augmentLossModel(f.model, parameters), f.controls, f.readings, 24);
    assert.deepEqual(f.readings.map(r => r.rowHash), hashes);
  });
  it('ignores arrival archive ordering', () => {
    const f = generateFixture('staggered', 1, 24); const m = augmentLossModel(f.model, parameters);
    assert.deepEqual(replayLoss(m, f.controls, f.readings, 24), replayLoss(m, f.controls, [...f.readings].reverse(), 24));
  });
  it('refuses duplicate events and changed row content', () => {
    const m = model(); const r = reading();
    assert.throws(() => replayLoss(m, [[0, 0]], [r, r], 1));
    assert.throws(() => replayLoss(m, [[0, 0]], [{ ...r, valueLitres: 2 }], 1));
  });
  it('refuses invalid cutoff chronology and missing controls', () => {
    assert.throws(() => replayLoss(model(), [], [], 1));
    assert.throws(() => replayLoss(model(), [[0, 0]], [reading({ knownAt: at(0) })], 1));
    assert.throws(() => replayLoss(model(), [], [], -1));
  });
  it('matches base evidence identity while separating model, operation and result identity', () => {
    const f = generateFixture('full', 1, 24); const b = replay(f.model, f.controls, f.readings, 24);
    const a = replayLoss(augmentLossModel(f.model, parameters), f.controls, f.readings, 24);
    assert.equal(a.evidenceHash, b.evidenceHash); assert.notEqual(a.modelHash, b.modelHash);
    assert.notEqual(a.operationId, b.operationId); assert.notEqual(a.resultHash, b.resultHash);
  });
});

describe('missingness, observability and model limits', () => {
  it('with no sensors, volume means remain model-only and loss uncertainty grows', () => {
    const f = generateFixture('no_sensors', 4, 24); const m = augmentLossModel(f.model, parameters);
    const a = replayLoss(m, f.controls, [], 24); const b = replay(f.model, f.controls, [], 24);
    assert.deepEqual(a.volumeState.mean, b.state.mean); assert.equal(a.state.mean[2], 0);
    assert.equal(a.lossSupport, 'model_only'); assert.equal(a.initialStateInformationRank, 0);
    close(a.state.covariance[2][2], parameters.initialVariance+24*parameters.processVariance);
    assert.equal(a.innovations.length, 0); cholesky3(a.state.covariance);
  });
  it('tank A cannot reveal tank B loss through absent coupling', () => {
    const f = generateFixture('unobserved_b', 3, 24); const m = augmentLossModel(f.model, parameters);
    const a = replayLoss(m, f.controls, f.readings, 24); const b = replayLoss(m, f.controls, [], 24);
    assert.equal(a.lossSupport, 'unobserved'); assert.equal(a.initialStateInformationRank, 1);
    close(a.state.mean[2], b.state.mean[2]); close(a.state.covariance[2][2], b.state.covariance[2][2]);
  });
  it('full sensing gives rank three but still only indirect loss support', () => {
    const f = generateFixture('full', 2, 24); const r = replayLoss(augmentLossModel(f.model, parameters), f.controls, f.readings, 24);
    assert.equal(r.initialStateInformationRank, 3); assert.equal(r.lossSupport, 'indirect_estimate');
  });
  it('rank routine handles zero, duplicate and independent rows', () => {
    assert.equal(rank3([]), 0); assert.equal(rank3([[1, 0, 0], [2, 0, 0]]), 1);
    assert.equal(rank3([[1, 0, 0], [0, 1, 0], [0, 0, 1]]), 3);
  });
  it('retains positive covariance through a blackout', () => {
    const f = generateFixture('blackout', 2, 96); const m = augmentLossModel(f.model, parameters);
    const a = replayLoss(m, f.controls, f.readings, 31); const b = replayLoss(m, f.controls, f.readings, 64);
    cholesky3(b.state.covariance); assert.ok(b.state.covariance[2][2] > a.state.covariance[2][2]);
  });
  it('original model-mismatch failure remains present as a baseline', () => {
    const r = runScenario('model_mismatch', 17, 96);
    assert.ok(r.metrics.rmseLitres.kalman > r.metrics.rmseLitres.holdLast);
    assert.ok(r.metrics.marginalCoverage95 < 0.8);
  });
});

describe('development/holdout boundary and numerical regressions', () => {
  it('keeps development and held-out seed ranges disjoint', () => {
    assert.ok(protocol.developmentSeeds.start+protocol.developmentSeeds.count <= protocol.heldOutSeeds.start);
    assert.ok(protocol.heldOutSeeds.start+protocol.heldOutSeeds.count <= protocol.consistency.startSeed);
    assert.equal(protocol.promotion.startsWith('never_auto_promote'), true);
  });
  it('excludes held-out failure regimes from tuning', () => {
    for (const r of HELD_OUT_REGIMES.filter(x => x !== 'nominal')) assert.ok(!protocol.developmentRegimes.includes(r));
  });
  it('fast forward evaluation agrees with full replay', () => {
    const f = lossFixture('development_step', 2); const fast = runTrial(f, parameters).metrics; const full = runTrial(f, parameters, true).metrics;
    for (const key of Object.keys(fast) as (keyof typeof fast)[]) close(fast[key], full[key]);
  });
  it('no-loss synthetic fixture preserves original baseline numerics', () => {
    const f = lossFixture('nominal', 17); const original = runScenario('full', 17, 96);
    close(runTrial(f, parameters).metrics.baselineRmse, original.metrics.rmseLitres.kalman);
  });
  it('recovers the development loss without changing the baseline model', () => {
    const r = runTrial(lossFixture('development_step', 17), parameters).metrics;
    assert.ok(r.augmentedRmse < r.baselineRmse*0.5);
  });
  it('keeps future evaluation truth out of estimator arguments', () => {
    const f = lossFixture('ramp', 1000); const m = augmentLossModel(f.model, parameters);
    const before = replayLoss(m, f.controls, f.readings, 20);
    f.truth[90] = [999, 999, 999];
    assert.deepEqual(replayLoss(m, f.controls, f.readings, 20), before);
  });
  it('rejects altered selection artifacts', () => {
    assert.throws(() => checkSelection({ schema: 'bad', selectionHash: '0'.repeat(64) } as never));
  });
  it('rejects unknown regimes', () => assert.throws(() => lossFixture('hidden' as never, 1)));
  it('three-state matched-model consistency passes both tails', () => {
    const r = runLossConsistency(parameters); assert.equal(r.neesDecision, 'within_band'); assert.equal(r.nisDecision, 'within_band');
    assert.ok(r.meanNees3 > LOSS_CONSISTENCY_BANDS.nees3[0]); assert.ok(r.meanNees3 < LOSS_CONSISTENCY_BANDS.nees3[1]);
  });
});

describe('read-only retained result inspection', () => {
  const get = () => { const f = generateFixture('full', 1, 24); return envelope(replayLoss(augmentLossModel(f.model, parameters), f.controls, f.readings, 24)); };
  it('projects three labelled states without raw observations', () => {
    const v = toLossObserverInspection(get()); assert.equal(v.rows.length, 3); assert.equal(v.rows[2].unit, 'litres_per_second');
    assert.ok(!JSON.stringify(v).includes('innovations')); assert.equal(v.verification.status, 'not_verified');
    assert.equal(v.integrityStatus, 'format_checked_not_cryptographically_verified');
  });
  it('does not import solver or file/network dependencies', () => {
    const source = readFileSync('src/lib/lossObserverInspection.ts', 'utf8');
    assert.ok(!/from\s+['"].*(?:benchmarks|engine|node:)/.test(source));
  });
  it('rejects non-synthetic result labels', () => {
    const e = get(); assert.throws(() => toLossObserverInspection({ ...e, result: { ...e.result, valueKind: 'official_record' } } as never));
  });
  it('rejects falsely verified metadata', () => {
    const e = get(); assert.throws(() => toLossObserverInspection({ ...e, verification: { status: 'verified', verificationId: 'test' } } as never));
  });
  it('rejects inconsistent intervals or invalid covariance', () => {
    const a = get(); a.result.interval95[2][0] = -100; assert.throws(() => toLossObserverInspection(a));
    const b = get(); b.result.state.covariance[2][2] = -1; assert.throws(() => toLossObserverInspection(b));
  });
  it('keeps execution identity out of deterministic result identity', () => {
    const a = get(); const b = { ...a, executionId: 'synthetic-execution:test-2' };
    assert.notEqual(toLossObserverInspection(a).executionId, toLossObserverInspection(b).executionId);
    assert.equal(toLossObserverInspection(a).resultHash, toLossObserverInspection(b).resultHash);
  });
});
