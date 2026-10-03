import { randomUUID } from 'node:crypto';
import type { GaussianState, Matrix2, ObserverExecution, ObserverResult, Pair, TankModel, TankReading } from '../../src/types/observer_benchmark';
import { apply, at, hash, nees, positiveDefinite, predict, replay, requireCondition, sealReading, selectReadings, stepOf } from './core';

export const SCENARIOS = ['full', 'staggered', 'blackout', 'no_sensors', 'unobserved_b', 'model_mismatch'] as const;
export type Scenario = typeof SCENARIOS[number];
export interface Fixture {
  scenario: Scenario; seed: number; steps: number; model: TankModel;
  controls: Pair[]; readings: TankReading[]; truth: Pair[];
}
function rng(seed: number): () => number {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let z = Math.imul(state ^ (state >>> 15), 1 | state);
    z ^= z + Math.imul(z ^ (z >>> 7), 61 | z);
    return (((z ^ (z >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2*Math.PI*uniform());
}
function gaussian(covariance: Matrix2, normal: () => number): Pair {
  positiveDefinite(covariance);
  const a = Math.sqrt(covariance[0][0]); const b = covariance[1][0]/a;
  const u = normal(); const v = normal();
  return [a*u, b*u + Math.sqrt(covariance[1][1]-b*b)*v];
}
/** All observations are generated here. No arbitrary record/file/provider input. */
export function generateFixture(scenario: Scenario, seed = 17, steps = 96): Fixture {
  requireCondition(SCENARIOS.includes(scenario), 'Unknown synthetic scenario.');
  requireCondition(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'Invalid seed.');
  requireCondition(Number.isInteger(steps) && steps >= 12 && steps <= 256, 'Expected 12..256 steps.');
  const decoupled = scenario === 'unobserved_b';
  const model: TankModel = {
    transition: decoupled ? [[0.97, 0], [0, 0.97]] : [[0.95, 0.04], [0.04, 0.95]],
    processCovariance: decoupled ? [[0.04, 0], [0, 0.04]] : [[0.04, -0.012], [-0.012, 0.04]],
    initial: { mean: [0, 0], covariance: [[4, 0], [0, 4]] },
  };
  const normal = rng(seed);
  const controls: Pair[] = []; const readings: TankReading[] = [];
  const truth: Pair[] = [gaussian(model.initial.covariance, normal)];
  for (let t = 1; t <= steps; t += 1) {
    const control: Pair = [0.6*Math.sin(t/9) + (t >= 16 && t <= 36 ? 0.8 : 0), 0.2*Math.cos(t/7)];
    controls.push(control);
    const predicted = apply(model.transition, truth[t-1]);
    const processNoise = gaussian(model.processCovariance, normal);
    const unmodelledLoss = scenario === 'model_mismatch' && t > Math.floor(steps/2) ? -0.65 : 0;
    truth.push([predicted[0]+control[0]+processNoise[0], predicted[1]+control[1]+processNoise[1]+unmodelledLoss]);
    for (const sensor of [0, 1] as const) {
      const noiseVarianceLitres2 = sensor === 0 ? 0.25 : 0.64;
      const referenceVarianceLitres2 = 0.04;
      // Draw before masking: counterfactual masks share exactly the same truth/noise.
      // Reference errors are independent per reading, NOT a persistent calibration bias.
      const valueLitres = truth[t][sensor] + Math.sqrt(noiseVarianceLitres2)*normal() + Math.sqrt(referenceVarianceLitres2)*normal();
      const absent = scenario === 'no_sensors' || (decoupled && sensor === 1) ||
        (scenario === 'blackout' && t >= Math.floor(steps/3) && t <= Math.floor(2*steps/3)) ||
        (scenario === 'staggered' && t % (sensor === 0 ? 2 : 3) !== 0);
      if (absent) continue;
      const delay = scenario === 'staggered' ? (sensor === 0 ? 1 : 3) : 0;
      readings.push(sealReading({ recordId: `synthetic:tank:${sensor === 0 ? 'a' : 'b'}:${t}`, observedAt: at(t), knownAt: at(t+delay), sensor, valueLitres, noiseVarianceLitres2, referenceVarianceLitres2 }));
    }
  }
  return { scenario, seed, steps, model, controls, readings, truth };
}
export function holdLast(fixture: Pick<Fixture, 'readings' | 'model'>, cutoff: number): Pair {
  const values: Pair = [...fixture.model.initial.mean];
  for (const r of selectReadings(fixture.readings, cutoff)) values[r.sensor] = r.valueLitres;
  return values;
}
export function neighborMean(fixture: Pick<Fixture, 'readings' | 'model'>, cutoff: number): Pair {
  const values = holdLast(fixture, cutoff);
  if (fixture.model.transition[0][1] === 0 && fixture.model.transition[1][0] === 0) return values;
  return [(values[0]+values[1])/2, (values[0]+values[1])/2];
}
export interface Metrics {
  rmseLitres: { holdLast: number; neighborMean: number; modelOnly: number; kalman: number };
  marginalCoverage95: number;
  meanNees: number;
  meanNisFinalReplay: number | null;
  /** Time samples are dependent; these summaries are descriptive, not iid tests. */
  timeSeriesStatus: 'descriptive_correlated_samples';
}
export interface ScenarioRun {
  scenario: Scenario; seed: number; steps: number; execution: ObserverExecution;
  metrics: Metrics; estimates: ObserverResult[]; truthForEvaluationOnly: Pair[];
  baselineSeries: { holdLast: Pair[]; neighborMean: Pair[]; modelOnly: Pair[] };
}
export function evaluate(truth: readonly Pair[], estimates: readonly ObserverResult[], hold: readonly Pair[], neighbor: readonly Pair[], prediction: readonly Pair[]): Metrics {
  requireCondition(estimates.length > 0 && truth.length === estimates.length+1 && hold.length === estimates.length && neighbor.length === estimates.length && prediction.length === estimates.length, 'Evaluation length mismatch.');
  let h = 0; let g = 0; let p = 0; let k = 0; let covered = 0; let totalNees = 0;
  estimates.forEach((estimate, index) => {
    const actual = truth[index+1]; totalNees += nees(estimate.state, actual);
    for (const d of [0, 1]) {
      h += (hold[index][d]-actual[d])**2; g += (neighbor[index][d]-actual[d])**2;
      p += (prediction[index][d]-actual[d])**2; k += (estimate.state.mean[d]-actual[d])**2;
      const [lo, hi] = estimate.interval95Litres[d];
      if (actual[d] >= lo && actual[d] <= hi) covered += 1;
    }
  });
  const count = 2*estimates.length;
  const innovations = estimates[estimates.length-1].innovations;
  return { rmseLitres: { holdLast: Math.sqrt(h/count), neighborMean: Math.sqrt(g/count), modelOnly: Math.sqrt(p/count), kalman: Math.sqrt(k/count) }, marginalCoverage95: covered/count,
    meanNees: totalNees/estimates.length, meanNisFinalReplay: innovations.length ? innovations.reduce((s, r) => s+r.normalizedSquared, 0)/innovations.length : null,
    timeSeriesStatus: 'descriptive_correlated_samples' };
}
export function runScenario(scenario: Scenario, seed = 17, steps = 96): ScenarioRun {
  const f = generateFixture(scenario, seed, steps);
  const estimates: ObserverResult[] = []; const hold: Pair[] = []; const neighbor: Pair[] = []; const prediction: Pair[] = [];
  let predictionState = structuredClone(f.model.initial);
  for (let t = 1; t <= steps; t += 1) {
    // The estimator gets model, controls and readings, never f.truth or scenario.
    estimates.push(replay(f.model, f.controls, f.readings, t));
    hold.push(holdLast(f, t)); neighbor.push(neighborMean(f, t));
    predictionState = predict(predictionState, f.model, f.controls[t-1]); prediction.push(predictionState.mean);
  }
  return { scenario, seed, steps, execution: { executionId: `synthetic-execution:${randomUUID()}`, result: estimates[steps-1], verification: { status: 'not_verified', verificationId: null } },
    metrics: evaluate(f.truth, estimates, hold, neighbor, prediction), estimates, truthForEvaluationOnly: f.truth, baselineSeries: { holdLast: hold, neighborMean: neighbor, modelOnly: prediction } };
}

// Predeclared two-sided 99% bands: scipy.stats.chi2.ppf([.005,.995], df)/256.
// One terminal statistic per independent seeded replicate, not repeated time samples.
export const CONSISTENCY_BANDS = {
  nees: [1.692701962807257, 2.3366341977202647],
  nis: [0.7870060854055189, 1.2423177882649463],
} as const;
export function consistencyDecision(value: number, band: readonly [number, number]): 'below_band' | 'within_band' | 'above_band' {
  requireCondition(Number.isFinite(value) && value >= 0, 'Invalid consistency statistic.');
  return value < band[0] ? 'below_band' : value > band[1] ? 'above_band' : 'within_band';
}
export function runConsistencySweep(): { replications: 256; terminalStep: 64; meanNees: number; meanNis: number; bands: typeof CONSISTENCY_BANDS; neesDecision: string; nisDecision: string; digest: string } {
  let totalNees = 0; let totalNis = 0; const terminal: { nees: number; nis: number }[] = [];
  for (let seed = 0; seed < 256; seed += 1) {
    const f = generateFixture('full', seed, 64);
    const result = replay(f.model, f.controls, f.readings, 64);
    const innovation = result.innovations.find(r => r.recordId === 'synthetic:tank:a:64');
    requireCondition(innovation, 'Expected terminal sensor A innovation.');
    const e = nees(result.state, f.truth[64]); const n = innovation.normalizedSquared;
    totalNees += e; totalNis += n; terminal.push({ nees: e, nis: n });
  }
  const meanNees = totalNees/256; const meanNis = totalNis/256;
  return { replications: 256, terminalStep: 64, meanNees, meanNis, bands: CONSISTENCY_BANDS,
    neesDecision: consistencyDecision(meanNees, CONSISTENCY_BANDS.nees), nisDecision: consistencyDecision(meanNis, CONSISTENCY_BANDS.nis), digest: hash('synthetic-consistency-sweep.v1', terminal) };
}
