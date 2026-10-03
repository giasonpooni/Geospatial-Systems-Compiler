import protocol from './protocol.json';
import { apply, correct, predict, selectReadings, hash, nees, replay, requireCondition, sealReading, stepOf } from '../core';
import { generateFixture, holdLast } from '../experiment';
import type { Pair, TankModel, TankReading } from '../../../src/types/observer_benchmark';
import type { LossParameters, Triple } from '../../../src/types/loss_observer';
import { augmentLossModel, correctLoss, predictLoss, replayLoss } from './observer';

export const DEVELOPMENT_REGIMES = ['nominal', 'development_step'] as const;
export const HELD_OUT_REGIMES = ['nominal', 'small_step', 'ramp', 'reversal', 'intermittent', 'delayed_step', 'blackout_step', 'sensor_bias'] as const;
export type Regime = typeof DEVELOPMENT_REGIMES[number] | typeof HELD_OUT_REGIMES[number];
export { protocol };
export const protocolHash = () => hash('synthetic-loss-protocol.v1', protocol);
export interface LossFixture {
  regime: Regime; seed: number; model: TankModel; controls: Pair[]; readings: TankReading[];
  /** Evaluation only: no observer function takes this field. */
  truth: Triple[];
}
function prescribedLoss(regime: Regime, t: number): number {
  switch (regime) {
    case 'development_step': return t >= 48 ? 0.65 : 0;
    case 'small_step': return t >= 20 ? 0.3 : 0;
    case 'ramp': return t < 20 ? 0 : Math.min(0.8, (t-20)*0.016);
    case 'reversal': return t < 24 ? 0 : t < 64 ? 0.7 : -0.3;
    case 'intermittent': return (t >= 24 && t < 44) || (t >= 64 && t < 84) ? 0.6 : 0;
    case 'delayed_step': return t >= 30 ? 0.85 : 0;
    case 'blackout_step': return t >= 24 ? 0.5 : 0;
    default: return 0;
  }
}
/** Reuses original noise draws so changing the regime does not change the noise. */
export function lossFixture(regime: Regime, seed: number): LossFixture {
  requireCondition([...DEVELOPMENT_REGIMES, ...HELD_OUT_REGIMES].includes(regime), 'Unknown loss regime.');
  const f = generateFixture(regime === 'delayed_step' ? 'staggered' : regime === 'blackout_step' ? 'blackout' : 'full', seed, protocol.steps);
  const controls: Pair[] = []; const truth: Triple[] = [[...f.truth[0], prescribedLoss(regime, 0)]];
  const shiftedControl = !['nominal', 'development_step'].includes(regime);
  for (let t = 1; t <= protocol.steps; ++t) {
    const oldPrediction = apply(f.model.transition, f.truth[t-1]);
    const noise: Pair = [0, 1].map(d => f.truth[t][d]-oldPrediction[d]-f.controls[t-1][d]) as Pair;
    const u: Pair = shiftedControl ? [0.35*Math.cos(t/5)+(t >= 40 && t <= 70 ? 0.9 : 0), -0.3*Math.sin(t/11)] : [...f.controls[t-1]];
    controls.push(u);
    const prediction = apply(f.model.transition, [truth[t-1][0], truth[t-1][1]]);
    truth.push([prediction[0]+u[0]+noise[0], prediction[1]+u[1]+noise[1]-truth[t-1][2], prescribedLoss(regime, t)]);
  }
  const readings = f.readings.map(r => {
    const t = stepOf(r.observedAt); const { rowHash: _ignored, ...draft } = r;
    return sealReading({ ...draft, valueLitres: truth[t][r.sensor]+(r.valueLitres-f.truth[t][r.sensor])+
      (regime === 'sensor_bias' && r.sensor === 1 && t >= 48 ? 1.5 : 0) });
  });
  return { regime, seed, model: f.model, controls, readings, truth };
}
export interface TrialMetrics {
  baselineRmse: number; augmentedRmse: number; holdLastRmse: number;
  baselineCoverage: number; augmentedCoverage: number;
  baselineMeanNees: number; augmentedVolumeMeanNees: number;
  baselineIntervalWidth: number; augmentedIntervalWidth: number;
  lossRmse: number; lossCoverage: number; lossIntervalWidth: number;
  sampleCount: number;
}
export interface TrialSeriesRow {
  step: number; baseline: ReturnType<typeof replay>; augmented: ReturnType<typeof replayLoss>; evaluationTruth: Triple;
}
export function runTrial(f: LossFixture, parameters: LossParameters, retainSeries = false): { metrics: TrialMetrics; series: TrialSeriesRow[]; fixtureHash: string } {
  const model = augmentLossModel(f.model, parameters);
  const sums = { baseline: 0, augmented: 0, hold: 0, bc: 0, ac: 0, bn: 0, an: 0, bw: 0, aw: 0, le: 0, lc: 0, lw: 0 };
  const series: TrialSeriesRow[] = [];
  // Immediate observations permit one forward pass. Delayed evidence still uses
  // the bounded chronological replay. Equivalence is checked against replay.
  const immediate = !retainSeries && f.readings.every(r => r.knownAt === r.observedAt);
  const rows = immediate ? selectReadings(f.readings, f.controls.length) : [];
  let cursor = 0; let bs = structuredClone(f.model.initial); let as = structuredClone(model.initial);
  for (let t = 1; t <= f.controls.length; ++t) {
    // The estimator receives no regime, seed, loss schedule or evaluation truth.
    if (immediate) {
      bs = predict(bs, f.model, f.controls[t-1]); as = predictLoss(as, model, f.controls[t-1]);
      while (cursor < rows.length && stepOf(rows[cursor].observedAt) === t) {
        const r = rows[cursor++]; bs = correct(bs, r).state; as = correctLoss(as, r).state;
      }
    }
    const interval = (mean: number[], covariance: number[][]) => mean.map((v, d) => {
      const width = 1.959963984540054*Math.sqrt(covariance[d][d]); return [v-width, v+width] as Pair;
    });
    const b = immediate ? { state: bs, interval95Litres: interval(bs.mean, bs.covariance) } : replay(f.model, f.controls, f.readings, t);
    const a = immediate ? { state: as, interval95: interval(as.mean, as.covariance), volumeState: {
      mean: [as.mean[0], as.mean[1]] as Pair,
      covariance: [[as.covariance[0][0], as.covariance[0][1]], [as.covariance[1][0], as.covariance[1][1]]] as import('../../../src/types/observer_benchmark').Matrix2,
    } } : replayLoss(model, f.controls, f.readings, t);
    const h = holdLast({ model: f.model, readings: f.readings }, t);
    const truth = f.truth[t];
    sums.bn += nees(b.state, [truth[0], truth[1]]); sums.an += nees(a.volumeState, [truth[0], truth[1]]);
    for (const d of [0, 1]) {
      sums.baseline += (b.state.mean[d]-truth[d])**2; sums.augmented += (a.state.mean[d]-truth[d])**2; sums.hold += (h[d]-truth[d])**2;
      sums.bc += Number(truth[d] >= b.interval95Litres[d][0] && truth[d] <= b.interval95Litres[d][1]);
      sums.ac += Number(truth[d] >= a.interval95[d][0] && truth[d] <= a.interval95[d][1]);
      sums.bw += b.interval95Litres[d][1]-b.interval95Litres[d][0]; sums.aw += a.interval95[d][1]-a.interval95[d][0];
    }
    sums.le += (a.state.mean[2]-truth[2])**2;
    sums.lc += Number(truth[2] >= a.interval95[2][0] && truth[2] <= a.interval95[2][1]);
    sums.lw += a.interval95[2][1]-a.interval95[2][0];
    if (retainSeries) series.push({ step: t, baseline: b as ReturnType<typeof replay>, augmented: a as ReturnType<typeof replayLoss>, evaluationTruth: truth });
  }
  const steps = f.controls.length; const n = steps*2;
  return { fixtureHash: hash('synthetic-loss-fixture.v1', f), series, metrics: {
    baselineRmse: Math.sqrt(sums.baseline/n), augmentedRmse: Math.sqrt(sums.augmented/n), holdLastRmse: Math.sqrt(sums.hold/n),
    baselineCoverage: sums.bc/n, augmentedCoverage: sums.ac/n, baselineMeanNees: sums.bn/steps, augmentedVolumeMeanNees: sums.an/steps,
    baselineIntervalWidth: sums.bw/n, augmentedIntervalWidth: sums.aw/n, lossRmse: Math.sqrt(sums.le/steps), lossCoverage: sums.lc/steps, lossIntervalWidth: sums.lw/steps, sampleCount: n,
  } };
}
export interface Aggregate extends TrialMetrics { replications: number; rmseRatio: number; pairedMeanRmseDifference: number; pairedDifferenceStandardError: number }
export function aggregate(trials: readonly TrialMetrics[]): Aggregate {
  requireCondition(trials.length > 1, 'At least two replications are required.');
  const n = trials.length;
  const mean = (key: keyof TrialMetrics) => trials.reduce((s, r) => s+r[key], 0)/n;
  const pooledRmse = (key: 'baselineRmse' | 'augmentedRmse' | 'holdLastRmse' | 'lossRmse') => Math.sqrt(trials.reduce((s, r) => s+r[key]**2, 0)/n);
  const baselineRmse = pooledRmse('baselineRmse'); const augmentedRmse = pooledRmse('augmentedRmse');
  const paired = trials.map(r => r.augmentedRmse-r.baselineRmse); const difference = paired.reduce((s, d) => s+d, 0)/n;
  const standardError = Math.sqrt(paired.reduce((s, d) => s+(d-difference)**2, 0)/(n-1)/n);
  return { replications: n, baselineRmse, augmentedRmse, holdLastRmse: pooledRmse('holdLastRmse'), lossRmse: pooledRmse('lossRmse'),
    rmseRatio: augmentedRmse/baselineRmse, pairedMeanRmseDifference: difference, pairedDifferenceStandardError: standardError,
    baselineCoverage: mean('baselineCoverage'), augmentedCoverage: mean('augmentedCoverage'),
    baselineMeanNees: mean('baselineMeanNees'), augmentedVolumeMeanNees: mean('augmentedVolumeMeanNees'),
    baselineIntervalWidth: mean('baselineIntervalWidth'), augmentedIntervalWidth: mean('augmentedIntervalWidth'),
    lossCoverage: mean('lossCoverage'), lossIntervalWidth: mean('lossIntervalWidth'), sampleCount: trials.reduce((s, r) => s+r.sampleCount, 0),
  };
}
export interface Selection {
  schema: 'synthetic-loss-selection.v1'; protocolHash: string; selectedParameters: LossParameters; selectionHash: string;
  developmentFixtureHashes: string[]; candidates: { processVariance: number; nominal: Aggregate; step: Aggregate; eligible: boolean }[];
}
/** All candidates see development seeds/regimes only. No holdout metrics enter. */
export function selectOnDevelopment(): Selection {
  const fixtures = DEVELOPMENT_REGIMES.map(regime => Array.from({ length: protocol.developmentSeeds.count }, (_, i) => lossFixture(regime, protocol.developmentSeeds.start+i)));
  const candidates = protocol.candidateProcessVariances.map(processVariance => {
    const p = { processVariance, initialVariance: protocol.initialLossVariance };
    const nominal = aggregate(fixtures[0].map(f => runTrial(f, p).metrics));
    const step = aggregate(fixtures[1].map(f => runTrial(f, p).metrics));
    return { processVariance, nominal, step, eligible: nominal.rmseRatio <= protocol.holdoutGate.nominalRmseRatioMaximum };
  });
  const eligible = candidates.filter(c => c.eligible).sort((a, b) => a.step.augmentedRmse-b.step.augmentedRmse || a.processVariance-b.processVariance);
  requireCondition(eligible.length > 0, 'No candidate meets the predeclared nominal constraint; do not tune on holdout.');
  const body: Omit<Selection, 'selectionHash'> = {
    schema: 'synthetic-loss-selection.v1', protocolHash: protocolHash(),
    selectedParameters: { processVariance: eligible[0].processVariance, initialVariance: protocol.initialLossVariance },
    developmentFixtureHashes: fixtures.flat().map(f => hash('synthetic-loss-fixture.v1', f)), candidates,
  };
  return { ...body, selectionHash: hash('synthetic-loss-selection.v1', body) };
}
export function checkSelection(selection: Selection): void {
  const { selectionHash, ...body } = selection;
  requireCondition(selection.schema === 'synthetic-loss-selection.v1' && selection.protocolHash === protocolHash() &&
    hash('synthetic-loss-selection.v1', body) === selectionHash, 'Selection artifact integrity mismatch.');
  const eligible = selection.candidates.filter(c => c.eligible).sort((a, b) => a.step.augmentedRmse-b.step.augmentedRmse || a.processVariance-b.processVariance);
  requireCondition(eligible.length > 0 && selection.selectedParameters.processVariance === eligible[0].processVariance &&
    selection.selectedParameters.initialVariance === protocol.initialLossVariance, 'Inconsistent selection.');
}
export function evaluateHeldOut(selection: Selection) {
  checkSelection(selection);
  const seeds = Array.from({ length: protocol.heldOutSeeds.count }, (_, i) => protocol.heldOutSeeds.start+i);
  const regimes = HELD_OUT_REGIMES.map(regime => {
    const trials = seeds.map(seed => { const r = runTrial(lossFixture(regime, seed), selection.selectedParameters); return { seed, fixtureHash: r.fixtureHash, metrics: r.metrics }; });
    return { regime, aggregate: aggregate(trials.map(t => t.metrics)), trials };
  });
  const nominal = regimes.find(r => r.regime === 'nominal')!;
  const losses = regimes.filter(r => !['nominal', 'sensor_bias'].includes(r.regime));
  const combinedLosses = aggregate(losses.flatMap(r => r.trials.map(t => t.metrics)));
  // The same seed is reused across regimes. Cluster the uncertainty summary by
  // seed instead of incorrectly treating 6x16 regime/seed trials as independent.
  const blocks = seeds.map(seed => losses.map(r => r.trials.find(t => t.seed === seed)!.metrics));
  const blockDifferences = blocks.map(rows => rows.reduce((sum, r) => sum+r.augmentedRmse-r.baselineRmse, 0)/rows.length);
  const blockMean = blockDifferences.reduce((sum, d) => sum+d, 0)/seeds.length;
  combinedLosses.replications = seeds.length;
  combinedLosses.pairedMeanRmseDifference = blockMean;
  combinedLosses.pairedDifferenceStandardError = Math.sqrt(blockDifferences.reduce((sum, d) => sum+(d-blockMean)**2, 0)/(seeds.length-1)/seeds.length);
  const gates = { nominal: nominal.aggregate.rmseRatio <= protocol.holdoutGate.nominalRmseRatioMaximum,
    aggregateLossError: combinedLosses.rmseRatio <= protocol.holdoutGate.lossRegimeAggregateRmseRatioMaximum,
    aggregateLossCoverage: combinedLosses.augmentedCoverage >= protocol.holdoutGate.lossRegimeCoverageMinimum };
  return { schema: 'synthetic-loss-heldout.v1', protocolHash: protocolHash(), selectionHash: selection.selectionHash,
    parameters: selection.selectedParameters, seeds, regimes, combinedLosses, regimeSeedTrials: losses.length*seeds.length, pairingUnit: 'seed_block_across_regimes', gates,
    candidateStatus: Object.values(gates).every(Boolean) ? 'benchmark_gates_passed_not_promoted' : 'benchmark_gate_failed_not_promoted',
    interpretation: 'synthetic_descriptive_regime_tests_not_causal_or_field_validation' };
}
