import protocol from './protocol.json';
import { apply as apply2, at, correct, hash, predict, replay, requireCondition as check, sealReading, selectReadings, stepOf } from '../core';
import { generateFixture } from '../experiment';
import { augmentLossModel, correctLoss, predictLoss, replayLoss } from '../loss/observer';
import type { Pair, TankModel, TankReading } from '../../../src/types/observer_benchmark';
import type { SwitchingParameters, SwitchingResult } from '../../../src/types/switching_observer';
import { advance, initialize, makeModel, replaySwitching, summarize } from './observer';
export { protocol };
export const protocolHash = () => hash('synthetic-switching-protocol.v1', protocol);
export type Regime = 'nominal' | 'dev_loss' | 'dev_bias' | 'dev_joint' | 'loss_pulse_reversal' | 'loss_ramp_break' |
  'bias_negative_pulse' | 'bias_drift' | 'joint_changes' | 'delayed_joint' | 'blackout_change';
export interface Fixture { regime: string; seed: number; model: TankModel; controls: Pair[]; readings: TankReading[]; truth: number[][] }
function disturbance(regime: Regime, t: number): Pair {
  switch (regime) {
    case 'dev_loss': return [t >= 32 ? 0.55 : 0, 0];
    case 'dev_bias': return [0, t >= 40 ? 1.2 : 0];
    case 'dev_joint': return [t >= 40 ? 0.4 : 0, t >= 60 ? -0.9 : 0];
    case 'loss_pulse_reversal': return [t >= 18 && t < 42 ? 0.9 : t >= 63 && t < 80 ? -0.45 : 0, 0];
    case 'loss_ramp_break': return [t < 10 ? 0 : t < 72 ? Math.min(0.6, (t-10)*0.012) : -0.5, 0];
    case 'bias_negative_pulse': return [0, t >= 25 && t < 70 ? -1.8 : 0];
    case 'bias_drift': return [0, t < 16 ? 0 : Math.min(1.8, (t-16)*0.025)];
    case 'joint_changes': return [t >= 28 && t < 62 ? 0.75 : t >= 62 ? -0.25 : 0, t >= 35 && t < 75 ? 1.7 : t >= 75 ? -0.6 : 0];
    case 'delayed_joint': return [t >= 22 ? 0.65 : 0, t >= 51 ? -1.6 : 0];
    case 'blackout_change': return [t >= 43 ? 0.7 : 0, t >= 54 ? 1.4 : 0];
    default: return [0, 0];
  }
}
/** Synthetic fixture only. The observer never receives regime, seed, or truth. */
export function fixture(regime: Regime, seed: number): Fixture {
  check([...protocol.developmentRegimes, ...protocol.heldOutRegimes].includes(regime), 'Unknown regime.');
  const f = generateFixture('full', seed, protocol.steps);
  const controls: Pair[] = []; const truth: number[][] = [[...f.truth[0], 0, 0]];
  const held = !protocol.developmentRegimes.includes(regime);
  for (let t = 1; t <= protocol.steps; ++t) {
    const old = apply2(f.model.transition, f.truth[t-1]);
    const noise = f.truth[t].map((v, d) => v-old[d]-f.controls[t-1][d]);
    const u: Pair = held ? [0.45*Math.cos(t/6)+(t > 44 && t < 69 ? 0.65 : 0), 0.3*Math.sin(t/13)-0.15] : [...f.controls[t-1]];
    const mu = apply2(f.model.transition, [truth[t-1][0], truth[t-1][1]]);
    controls.push(u); truth.push([mu[0]+u[0]+noise[0], mu[1]+u[1]+noise[1]-truth[t-1][2], ...disturbance(regime, t)]);
  }
  const readings = f.readings.flatMap(r => {
    const t = stepOf(r.observedAt);
    if (regime === 'blackout_change' && t >= 40 && t <= 65) return [];
    if (regime === 'delayed_joint' && t % (r.sensor === 0 ? 2 : 4) !== 0) return [];
    const delay = regime === 'delayed_joint' ? (r.sensor === 0 ? 2 : 4) : 0;
    const { rowHash: _hash, ...draft } = r;
    return [sealReading({ ...draft, knownAt: at(t+delay), valueLitres: truth[t][r.sensor]+(r.sensor === 1 ? truth[t][3] : 0)+(r.valueLitres-f.truth[t][r.sensor]) })];
  });
  return { regime, seed, model: f.model, controls, readings, truth };
}
export interface Metrics {
  baselineRmse: number; lossOnlyRmse: number; switchingRmse: number;
  baselineCoverage: number; lossOnlyCoverage: number; switchingCoverage: number;
  baselineWidth: number; lossOnlyWidth: number; switchingWidth: number;
  lossRmse: number; biasRmse: number; lossCoverage: number; biasCoverage: number;
}
export interface SeriesRow { step: number; baselineMean: Pair; lossMean: number[]; candidate: SwitchingResult; evaluationTruth: number[] }
export function trial(f: Fixture, p: SwitchingParameters, retain = false) {
  const m = makeModel(f.model, p); const l = augmentLossModel(f.model, { processVariance: 0.001, initialVariance: 0.04 });
  const sums = { b: 0, l: 0, s: 0, bc: 0, lc: 0, sc: 0, bw: 0, lw: 0, sw: 0, le: 0, be: 0, lcov: 0, bcov: 0 };
  const immediate = !retain && f.readings.every(r => r.knownAt === r.observedAt);
  const selected = immediate ? selectReadings(f.readings, f.controls.length) : [];
  let cursor = 0; let bState = structuredClone(f.model.initial); let lState = structuredClone(l.initial); let sState = initialize(m);
  const series: SeriesRow[] = [];
  const gaussianIntervals = (x: number[], cov: number[][]) => x.map((v, d) => [v-1.959963984540054*Math.sqrt(cov[d][d]), v+1.959963984540054*Math.sqrt(cov[d][d])]);
  for (let t = 1; t <= f.controls.length; ++t) {
    if (immediate) {
      const batch: TankReading[] = [];
      while (cursor < selected.length && stepOf(selected[cursor].observedAt) === t) batch.push(selected[cursor++]);
      bState = predict(bState, f.model, f.controls[t-1]); lState = predictLoss(lState, l, f.controls[t-1]);
      for (const r of batch) { bState = correct(bState, r).state; lState = correctLoss(lState, r).state; }
      sState = advance(m, sState, f.controls[t-1], batch);
    }
    const b = immediate ? { state: bState, interval95Litres: gaussianIntervals(bState.mean, bState.covariance) } : replay(f.model, f.controls, f.readings, t);
    const loss = immediate ? { state: lState, interval95: gaussianIntervals(lState.mean, lState.covariance) } : replayLoss(l, f.controls, f.readings, t);
    const candidate = immediate ? summarize(sState) : replaySwitching(m, f.controls, f.readings, t);
    const truth = f.truth[t];
    for (const d of [0, 1]) {
      sums.b += (b.state.mean[d]-truth[d])**2; sums.l += (loss.state.mean[d]-truth[d])**2; sums.s += (candidate.state.mean[d]-truth[d])**2;
      sums.bc += Number(truth[d] >= b.interval95Litres[d][0] && truth[d] <= b.interval95Litres[d][1]);
      sums.lc += Number(truth[d] >= loss.interval95[d][0] && truth[d] <= loss.interval95[d][1]);
      sums.sc += Number(truth[d] >= candidate.interval95[d][0] && truth[d] <= candidate.interval95[d][1]);
      sums.bw += b.interval95Litres[d][1]-b.interval95Litres[d][0]; sums.lw += loss.interval95[d][1]-loss.interval95[d][0]; sums.sw += candidate.interval95[d][1]-candidate.interval95[d][0];
    }
    sums.le += (candidate.state.mean[2]-truth[2])**2; sums.be += (candidate.state.mean[3]-truth[3])**2;
    sums.lcov += Number(truth[2] >= candidate.interval95[2][0] && truth[2] <= candidate.interval95[2][1]);
    sums.bcov += Number(truth[3] >= candidate.interval95[3][0] && truth[3] <= candidate.interval95[3][1]);
    if (retain) series.push({ step: t, baselineMean: b.state.mean, lossMean: loss.state.mean, candidate: candidate as SwitchingResult, evaluationTruth: [...truth] });
  }
  const n = f.controls.length;
  const metrics: Metrics = {
    baselineRmse: Math.sqrt(sums.b/(2*n)), lossOnlyRmse: Math.sqrt(sums.l/(2*n)), switchingRmse: Math.sqrt(sums.s/(2*n)),
    baselineCoverage: sums.bc/(2*n), lossOnlyCoverage: sums.lc/(2*n), switchingCoverage: sums.sc/(2*n),
    baselineWidth: sums.bw/(2*n), lossOnlyWidth: sums.lw/(2*n), switchingWidth: sums.sw/(2*n),
    lossRmse: Math.sqrt(sums.le/n), biasRmse: Math.sqrt(sums.be/n), lossCoverage: sums.lcov/n, biasCoverage: sums.bcov/n,
  };
  return { fixtureHash: hash('synthetic-switching-fixture.v1', f), metrics, series };
}
export function aggregate(rows: readonly Metrics[]): Metrics & { replications: number } {
  check(rows.length > 0, 'Empty metric set.'); const result: Record<string, number> = {};
  for (const key of Object.keys(rows[0]) as (keyof Metrics)[]) {
    const rms = key.endsWith('Rmse'); const value = rows.reduce((s, r) => s+(rms ? r[key]**2 : r[key]), 0)/rows.length;
    result[key] = rms ? Math.sqrt(value) : value;
  }
  return { ...result, replications: rows.length } as Metrics & { replications: number };
}
export function selectDevelopment() {
  const fixtures = protocol.developmentRegimes.map(regime => Array.from({ length: protocol.developmentSeeds.count }, (_, i) => fixture(regime as Regime, protocol.developmentSeeds.start+i)));
  const candidates = protocol.candidateJumpProbabilities.map(jumpProbability => {
    const parameters = { ...protocol.fixedParameters, jumpProbability };
    const regimes = fixtures.map(fs => ({ regime: fs[0].regime, metrics: aggregate(fs.map(f => trial(f, parameters).metrics)) }));
    const nominal = regimes[0].metrics; const score = regimes.slice(1).reduce((s, r) => s+r.metrics.switchingRmse**2, 0)/3;
    return { parameters, regimes, score, eligible: nominal.switchingRmse <= nominal.baselineRmse*1.15 };
  });
  const eligible = candidates.filter(c => c.eligible); const order = (eligible.length ? eligible : candidates).slice().sort((a, b) => a.score-b.score || a.parameters.jumpProbability-b.parameters.jumpProbability);
  const body = { schema: 'synthetic-switching-selection.v1', protocolHash: protocolHash(), parameters: order[0].parameters, selectionEligible: eligible.length > 0,
    candidates, fixtureHashes: fixtures.flat().map(f => hash('synthetic-switching-fixture.v1', f)) };
  return { ...body, selectionHash: hash('synthetic-switching-selection.v1', body) };
}
export type Selection = ReturnType<typeof selectDevelopment>;
export function checkSelection(selection: Selection): void {
  const { selectionHash, ...body } = selection;
  check(selection.schema === 'synthetic-switching-selection.v1' && selection.protocolHash === protocolHash() && hash('synthetic-switching-selection.v1', body) === selectionHash, 'Selection integrity mismatch.');
  const eligible = selection.candidates.filter(c => c.eligible);
  const best = (eligible.length ? eligible : selection.candidates).slice().sort((a,b) => a.score-b.score || a.parameters.jumpProbability-b.parameters.jumpProbability)[0];
  check(best && hash('p', best.parameters) === hash('p', selection.parameters) && selection.selectionEligible === (eligible.length > 0), 'Inconsistent selection.');
}
export function gateDecision(regimes: { regime: string; metrics: Metrics }[]) {
  const nominal = regimes.find(r => r.regime === 'nominal')!.metrics;
  const changed = regimes.filter(r => r.regime !== 'nominal');
  const combined = aggregate(changed.map(r => r.metrics));
  const bias = aggregate(regimes.filter(r => r.regime.startsWith('bias_')).map(r => r.metrics));
  const gates = {
    nominalNoDegradation: nominal.switchingRmse/nominal.baselineRmse <= protocol.gates.nominalRmseRatioMaximum,
    changedError: combined.switchingRmse/combined.lossOnlyRmse <= protocol.gates.changedRegimeRmseRatioToLossMaximum,
    eachChangedCoverage: changed.every(r => r.metrics.switchingCoverage >= protocol.gates.eachChangedRegimeCoverageMinimum),
    biasError: bias.switchingRmse/bias.baselineRmse <= protocol.gates.biasRegimeRmseRatioToBaselineMaximum,
    widthBudget: combined.switchingWidth/combined.lossOnlyWidth <= protocol.gates.intervalWidthRatioToLossMaximum,
  };
  return { gates, combined, bias, status: Object.values(gates).every(Boolean) ? 'benchmark_gates_passed_not_promoted' : 'benchmark_gate_failed_not_promoted' };
}
export function evaluate(selection: Selection) {
  checkSelection(selection);
  const regimes = protocol.heldOutRegimes.map(regime => {
    const trials = Array.from({ length: protocol.heldOutSeeds.count }, (_, i) => {
      const seed = protocol.heldOutSeeds.start+i; const r = trial(fixture(regime as Regime, seed), selection.parameters);
      return { seed, fixtureHash: r.fixtureHash, metrics: r.metrics };
    });
    return { regime, metrics: aggregate(trials.map(t => t.metrics)), trials };
  });
  const result = gateDecision(regimes);
  // Regimes reuse seeds: error differences are summarized by seed block, not timestep.
  const differences = Array.from({ length: protocol.heldOutSeeds.count }, (_, i) => {
    const rows = regimes.filter(r => r.regime !== 'nominal').map(r => r.trials[i].metrics);
    return rows.reduce((s, r) => s+r.switchingRmse-r.lossOnlyRmse, 0)/rows.length;
  });
  const mean = differences.reduce((s,v) => s+v, 0)/differences.length;
  const se = Math.sqrt(differences.reduce((s,v) => s+(v-mean)**2, 0)/(differences.length-1)/differences.length);
  return { schema: 'synthetic-switching-heldout.v1', protocolHash: protocolHash(), selectionHash: selection.selectionHash,
    parameters: selection.parameters, selectionEligible: selection.selectionEligible, regimes, ...result,
    pairedRmseDifference: { unit: 'litres', mean, standardError: se, blocks: differences.length, unitOfReplication: 'seed_block_across_regimes' },
    overallStatus: selection.selectionEligible && Object.values(result.gates).every(Boolean) ? 'benchmark_gates_passed_not_promoted' : 'benchmark_gate_failed_not_promoted' };
}
