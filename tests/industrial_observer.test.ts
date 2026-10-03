import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apply, at, correct, hash, nees, positiveDefinite, predict, replay, sealReading, selectReadings, stepOf } from '../benchmarks/industrial-observer/core';
import { CONSISTENCY_BANDS, SCENARIOS, consistencyDecision, generateFixture, holdLast, neighborMean, runConsistencySweep, runScenario } from '../benchmarks/industrial-observer/experiment';
import { toObserverInspection } from '../src/lib/observerInspection';
import type { Matrix2, ObserverExecution, Pair, TankModel, TankReading } from '../src/types/observer_benchmark';

const model = (): TankModel => ({ transition: [[1, 0], [0, 1]], processCovariance: [[0.1, 0], [0, 0.1]], initial: { mean: [0, 0], covariance: [[1, 0], [0, 1]] } });
function reading(overrides: Partial<Omit<TankReading, 'rowHash'>> = {}): TankReading {
  return sealReading({ recordId: 'synthetic:tank:a:1', observedAt: at(1), knownAt: at(1), sensor: 0, valueLitres: 1, noiseVarianceLitres2: 0.25, referenceVarianceLitres2: 0.25, ...overrides });
}
const envelope = (result: ReturnType<typeof replay>, id = 'test-1'): ObserverExecution => ({ executionId: `synthetic-execution:${id}`, result, verification: { status: 'not_verified', verificationId: null } });
const close = (x: number, y: number, tolerance = 1e-10) => assert.ok(Math.abs(x-y) < tolerance, `${x} != ${y}`);

describe('two-tank numerical contract', () => {
  it('matches a hand-computed prediction', () => {
    const p = predict(model().initial, model(), [2, -1]);
    assert.deepEqual(p.mean, [2, -1]); close(p.covariance[0][0], 1.1);
  });
  it('includes independent reference uncertainty in the gain and innovation', () => {
    const r = correct(model().initial, reading());
    close(r.innovation.varianceLitres2, 1.5); close(r.state.mean[0], 2/3); close(r.state.covariance[0][0], 1/3);
    close(r.innovation.normalizedSquared, 2/3);
  });
  it('retains cross-covariance rather than treating state components independently', () => {
    const s = { mean: [0, 0] as Pair, covariance: [[1, 0.5], [0.5, 1]] as Matrix2 };
    const r = correct(s, reading()).state;
    close(r.mean[1], 1/3); close(r.covariance[0][1], 1/6);
  });
  it('computes NEES by whitening including correlation', () => {
    close(nees({ mean: [0, 0], covariance: [[2, 1], [1, 2]] }, [1, 1]), 2/3);
  });
  it('preserves frozen inputs', () => {
    const m = model(); const initial = structuredClone(m.initial); const r = reading();
    Object.freeze(m.initial.mean); m.initial.covariance.forEach(Object.freeze); Object.freeze(m.initial.covariance); Object.freeze(r);
    predict(m.initial, m, [0, 0]); correct(m.initial, r);
    assert.deepEqual(m.initial, initial);
  });
  it('respects the declared deterministic inventory balance including drain', () => {
    const f = generateFixture('full'); const x: Pair = [5, -2]; const y = apply(f.model.transition, x);
    close(y[0]+y[1], 0.99*(x[0]+x[1]));
  });
  for (const p of [[[0, 0], [0, 1]], [[1, 2], [2, 1]], [[1, 0], [0.1, 1]], [[NaN, 0], [0, 1]]] as Matrix2[]) {
    it(`refuses invalid covariance ${JSON.stringify(p)}`, () => assert.throws(() => positiveDefinite(p)));
  }
  for (const variance of [-1, 0, NaN, Infinity]) {
    it(`refuses invalid measurement variance ${variance}`, () => assert.throws(() => correct(model().initial, { ...reading(), noiseVarianceLitres2: variance })));
  }
  it('refuses a negative reference uncertainty', () => assert.throws(() => correct(model().initial, { ...reading(), referenceVarianceLitres2: -1 })));
  it('refuses malformed dimensions and sensor IDs', () => {
    assert.throws(() => correct(model().initial, { ...reading(), sensor: 2 } as unknown as TankReading));
    assert.throws(() => predict(model().initial, model(), [0] as unknown as Pair));
  });
});

describe('knowledge time, replay and accounting', () => {
  it('has exact timestamp round trips and rejects ambiguous timestamps', () => {
    for (let i = 0; i < 265; i += 1) assert.equal(stepOf(at(i)), i);
    assert.throws(() => stepOf('2026-01-01')); assert.throws(() => stepOf('2026-02-30T00:00:00.000Z'));
  });
  it('does not consume future-known observations', () => {
    const rs = [reading({ knownAt: at(3) })];
    assert.equal(replay(model(), [[0, 0], [0, 0]], rs, 2).assimilation.usedRows, 0);
  });
  it('replays delayed readings at measurement time, not arrival time', () => {
    const rs = [reading({ knownAt: at(3) })];
    const result = replay(model(), [[0, 0], [0, 0], [0, 0]], rs, 3);
    // At t=1, P=1.1; update by R=.5; then two prediction steps.
    close(result.state.mean[0], 1.1/1.6);
    close(result.state.covariance[0][0], 1.1*0.5/1.6+0.2);
    assert.equal(result.assimilation.delayedRows, 1);
  });
  it('preserves a prior as-known result when later evidence arrives', () => {
    const m = model(); const cs: Pair[] = [[0, 0], [0, 0], [0, 0]];
    const r = reading({ knownAt: at(3) }); const first = replay(m, cs, [r], 2);
    const copy = JSON.stringify(first); replay(m, cs, [r], 3);
    assert.equal(JSON.stringify(first), copy);
  });
  it('future observation values and future controls cannot change the earlier result hash', () => {
    const cs: Pair[] = [[0, 0], [0, 0], [50, 50]];
    const first = replay(model(), cs, [reading({ knownAt: at(3) })], 2);
    const other = replay(model(), [[0, 0], [0, 0], [-50, -50]], [reading({ knownAt: at(3), valueLitres: 99 })], 2);
    assert.equal(first.resultHash, other.resultHash);
  });
  it('reordering the arrival archive leaves the same replay result', () => {
    const f = generateFixture('staggered', 19, 24);
    assert.deepEqual(replay(f.model, f.controls, f.readings, 24), replay(f.model, f.controls, [...f.readings].reverse(), 24));
  });
  it('rejects duplicate record IDs and duplicate sensor-time events', () => {
    const r = reading(); assert.throws(() => selectReadings([r, r], 1));
    assert.throws(() => selectReadings([r, reading({ recordId: 'synthetic:tank:a:2' })], 1));
  });
  it('detects altered evidence content without rewriting row hashes', () => {
    const r = reading(); r.valueLitres += 1;
    assert.throws(() => selectReadings([r], 1));
  });
  it('rejects invalid chronology and missing controls', () => {
    assert.throws(() => selectReadings([reading({ knownAt: at(0) })], 1));
    assert.throws(() => replay(model(), [], [], 1));
  });
  it('binds model and evidence identity independently', () => {
    const m = model(); const a = replay(m, [[0, 0]], [reading()], 1);
    m.transition[0][0] = 0.9; const b = replay(m, [[0, 0]], [reading()], 1);
    assert.notEqual(a.modelHash, b.modelHash); assert.equal(a.evidenceHash, b.evidenceHash);
    assert.notEqual(a.resultHash, b.resultHash);
  });
  it('keeps execution identity separate from result content', () => {
    const r = replay(model(), [[0, 0]], [reading()], 1);
    const a = envelope(r, 'one'); const b = envelope(r, 'two');
    assert.notEqual(a.executionId, b.executionId); assert.equal(a.result.resultHash, b.result.resultHash);
    assert.equal(a.verification.verificationId, null);
  });
  it('has canonical object-order-independent hashing', () => assert.equal(hash('test', { a: 1, b: 2 }), hash('test', { b: 2, a: 1 })));
});

describe('synthetic experiments and read-only inspection', () => {
  it('generates repeatable fixtures and changes them with seed', () => {
    assert.deepEqual(generateFixture('full', 1, 24), generateFixture('full', 1, 24));
    assert.notDeepEqual(generateFixture('full', 1, 24).truth, generateFixture('full', 2, 24).truth);
  });
  it('counterfactual missingness does not change underlying truth', () => {
    const truth = generateFixture('full', 7, 24).truth;
    for (const s of ['staggered', 'blackout', 'no_sensors'] as const) assert.deepEqual(generateFixture(s, 7, 24).truth, truth);
  });
  it('retains all positive covariance diagonals through a long blackout', () => {
    const f = generateFixture('blackout', 3, 96);
    const start = replay(f.model, f.controls, f.readings, 31); const end = replay(f.model, f.controls, f.readings, 64);
    positiveDefinite(end.state.covariance);
    assert.ok(end.state.covariance[0][0] > start.state.covariance[0][0]);
    assert.ok(end.state.covariance[1][1] > start.state.covariance[1][1]);
  });
  it('reports rank zero and no invented observations when every sensor is missing', () => {
    const f = generateFixture('no_sensors', 1, 24); const r = replay(f.model, f.controls, f.readings, 24);
    assert.equal(r.informationRank, 0); assert.equal(r.assimilation.usedRows, 0);
    assert.deepEqual(r.lastObservedAt, [null, null]); assert.equal(r.innovations.length, 0);
    assert.ok(toObserverInspection(envelope(r)).rows.every(row => row.support === 'unobserved'));
  });
  it('marks the decoupled hidden tank unobserved, not observed by proximity', () => {
    const f = generateFixture('unobserved_b', 1, 24); const r = replay(f.model, f.controls, f.readings, 24);
    assert.equal(r.informationRank, 1); assert.equal(toObserverInspection(envelope(r)).rows[1].support, 'unobserved');
    const noData = replay(f.model, f.controls, [], 24);
    close(r.state.mean[1], noData.state.mean[1]); close(r.state.covariance[1][1], noData.state.covariance[1][1]);
  });
  it('flags old measurements as prediction-only', () => {
    const r = replay(model(), [[0, 0], [0, 0]], [reading()], 2);
    const row = toObserverInspection(envelope(r)).rows[0];
    assert.equal(row.support, 'prediction_only'); assert.equal(row.ageSeconds, 1);
  });
  it('does not pass innovations, truth or raw observations to the inspection view', () => {
    const f = generateFixture('full', 1, 24); const view = toObserverInspection(envelope(replay(f.model, f.controls, f.readings, 24)));
    const text = JSON.stringify(view);
    for (const key of ['innovations', 'truth', 'noiseVarianceLitres2', 'rowHash']) assert.ok(!text.includes(key));
    assert.equal(view.verification.status, 'not_verified');
  });
  it('refuses an inconsistent retained interval', () => {
    const r = replay(model(), [[0, 0]], [reading()], 1); r.interval95Litres[0][0] = -100;
    assert.throws(() => toObserverInspection(envelope(r)));
  });
  it('refuses non-synthetic envelopes without silently relabeling them', () => {
    const r = replay(model(), [[0, 0]], [reading()], 1);
    assert.throws(() => toObserverInspection(envelope({ ...r, valueKind: 'official_record' } as unknown as typeof r)));
  });
  it('does not import scientific execution into the view module', () => {
    const source = readFileSync('src/lib/observerInspection.ts', 'utf8');
    assert.ok(!/from\s+['"].*(?:benchmarks|engine|node:)/.test(source));
  });
  it('runs baselines on exactly the same available evidence', () => {
    const f = generateFixture('staggered', 1, 24);
    assert.deepEqual(holdLast(f, 1), [0, 0]); assert.deepEqual(neighborMean(f, 1), [0, 0]);
  });
  for (const scenario of SCENARIOS) {
    it(`executes ${scenario} with finite metrics`, () => {
      const r = runScenario(scenario, 17, 24);
      assert.ok(Object.values(r.metrics.rmseLitres).every(Number.isFinite));
      assert.ok(r.metrics.marginalCoverage95 >= 0 && r.metrics.marginalCoverage95 <= 1);
      assert.equal(r.metrics.timeSeriesStatus, 'descriptive_correlated_samples');
      assert.equal(r.estimates.length, 24);
    });
  }
  it('exposes indirect support only when dynamics and observations give rank two', () => {
    const f = generateFixture('full', 1, 24);
    const r = replay(f.model, f.controls, f.readings.filter(x => x.sensor === 0), 24);
    assert.equal(r.informationRank, 2);
    assert.equal(toObserverInspection(envelope(r)).rows[1].support, 'indirect_estimate');
  });
  it('matches model-only predictions exactly when no measurements exist', () => {
    const r = runScenario('no_sensors', 17, 24);
    close(r.metrics.rmseLitres.modelOnly, r.metrics.rmseLitres.kalman);
  });
  it('exposes rather than conceals failure under an unmodelled loss', () => {
    const r = runScenario('model_mismatch', 17, 96);
    assert.ok(r.metrics.rmseLitres.kalman > r.metrics.rmseLitres.holdLast);
    assert.ok(r.metrics.marginalCoverage95 < 0.8);
    assert.ok(r.metrics.meanNees > 10);
    assert.equal(r.execution.verification.status, 'not_verified');
  });
  it('rejects unknown scenarios and out-of-bounds budgets', () => {
    assert.throws(() => generateFixture('unknown' as never));
    assert.throws(() => generateFixture('full', -1)); assert.throws(() => generateFixture('full', 1, 257));
  });
});

describe('independent-replication consistency checks', () => {
  it('uses both tails so over-wide uncertainty cannot look automatically good', () => {
    assert.equal(consistencyDecision(0.2, CONSISTENCY_BANDS.nees), 'below_band');
    assert.equal(consistencyDecision(2, CONSISTENCY_BANDS.nees), 'within_band');
    assert.equal(consistencyDecision(20, CONSISTENCY_BANDS.nees), 'above_band');
  });
  it('passes the predeclared terminal NEES and NIS bands under the matched model', () => {
    const r = runConsistencySweep();
    assert.equal(r.replications, 256); assert.equal(r.terminalStep, 64);
    assert.equal(r.neesDecision, 'within_band'); assert.equal(r.nisDecision, 'within_band');
  });
});
