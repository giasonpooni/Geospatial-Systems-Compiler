import { at, hash, pair, matrix, positiveDefinite, requireCondition as check, selectReadings, stepOf } from '../core';
import type { Pair, TankModel, TankReading } from '../../../src/types/observer_benchmark';
import type { Gaussian4, SwitchingModel, SwitchingParameters, SwitchingResult, SwitchingState } from '../../../src/types/switching_observer';
import { add, apply, checked, chol, dot, eye, intervals, mix, mul, rank, transpose, vector, weights } from './numerics';

export const OPERATION = 'reference.two-tank-loss-bias-imm.v1' as const;
export function makeModel(base: TankModel, parameters: SwitchingParameters): SwitchingModel {
  matrix(base.transition); positiveDefinite(base.processCovariance); pair(base.initial.mean); positiveDefinite(base.initial.covariance);
  const keys = ['jumpProbability', 'quietLossVariance', 'quietBiasVariance', 'jumpLossVariance', 'jumpBiasVariance', 'initialLossVariance', 'initialBiasVariance'];
  check(parameters && keys.every(k => Object.hasOwn(parameters, k)) && Object.keys(parameters).every(k => [...keys, 'modePersistence', 'lossJumpCoupling'].includes(k)), 'Invalid parameter shape.');
  check(keys.every(k => { const v = parameters[k as keyof SwitchingParameters]; return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 10; }) && parameters.jumpProbability < 0.25, 'Invalid switch parameters.');
  check(parameters.modePersistence === undefined || (Number.isFinite(parameters.modePersistence) && parameters.modePersistence >= 0 && parameters.modePersistence < 1), 'Invalid mode persistence.');
  check(parameters.lossJumpCoupling === undefined || [0, 1].includes(parameters.lossJumpCoupling), 'Invalid loss-jump timing.');
  check(parameters.jumpLossVariance >= parameters.quietLossVariance && parameters.jumpBiasVariance >= parameters.quietBiasVariance, 'Jump variance below quiet variance.');
  const b = structuredClone(base); const p = { ...parameters }; const f = b.transition; const v = b.initial.covariance;
  const h = p.jumpProbability; const persistence = p.modePersistence ?? 0; const coupling = p.lossJumpCoupling ?? 0;
  const transitionWeights = [(1-h)*(1-h), h*(1-h), h*(1-h), h*h];
  return {
    base: b, parameters: p, transition: [[f[0][0], f[0][1], 0, 0], [f[1][0], f[1][1], -1, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
    measurementRows: [[1, 0, 0, 0], [0, 1, 0, 1]],
    modeNames: ['quiet', 'loss_change', 'bias_change', 'combined_change'],
    // Optional persistent modes; p=0 reproduces independent per-step hazards.
    modeTransition: Array.from({ length: 4 }, (_, i) => transitionWeights.map((v, j) => (1-persistence)*v+persistence*Number(i === j))),
    processCovariances: [0, 1, 2, 3].map(i => [
      [b.processCovariance[0][0], b.processCovariance[0][1], 0, 0],
      [b.processCovariance[1][0], b.processCovariance[1][1]+coupling*(i & 1 ? p.jumpLossVariance : p.quietLossVariance), -coupling*(i & 1 ? p.jumpLossVariance : p.quietLossVariance), 0],
      [0, -coupling*(i & 1 ? p.jumpLossVariance : p.quietLossVariance), i & 1 ? p.jumpLossVariance : p.quietLossVariance, 0],
      [0, 0, 0, i & 2 ? p.jumpBiasVariance : p.quietBiasVariance],
    ]),
    initial: checked([...b.initial.mean, 0, 0], [[v[0][0], v[0][1], 0, 0], [v[1][0], v[1][1], 0, 0], [0, 0, p.initialLossVariance, 0], [0, 0, 0, p.initialBiasVariance]]),
    initialModeWeights: [1, 0, 0, 0],
  };
}
export const initialize = (m: SwitchingModel): SwitchingState => ({ components: m.modeNames.map(() => structuredClone(m.initial)), modeWeights: [...m.initialModeWeights] });
export function condition(s: Gaussian4, h: number[], reading: TankReading): { state: Gaussian4; logLikelihood: number } {
  vector(s.mean); chol(s.covariance); vector(h);
  check([0, 1].includes(reading.sensor) && Number.isFinite(reading.valueLitres) && Math.abs(reading.valueLitres) <= 1e6 &&
    Number.isFinite(reading.noiseVarianceLitres2) && reading.noiseVarianceLitres2 > 0 &&
    Number.isFinite(reading.referenceVarianceLitres2) && reading.referenceVarianceLitres2 >= 0, 'Invalid reading.');
  const r = reading.noiseVarianceLitres2+reading.referenceVarianceLitres2;
  const cross = apply(s.covariance, h); const variance = dot(h, cross)+r;
  const residual = reading.valueLitres-dot(h, s.mean); const k = cross.map(v => v/variance);
  check(Number.isFinite(variance) && variance > 0, 'Invalid innovation variance.');
  const j = eye().map((row, i) => row.map((v, d) => v-k[i]*h[d]));
  const p = add(mul(mul(j, s.covariance), transpose(j)), k.map(v => k.map(w => v*r*w)));
  return { state: checked(s.mean.map((v, i) => v+k[i]*residual), p), logLikelihood: -0.5*(Math.log(2*Math.PI*variance)+residual*residual/variance) };
}
/** One interaction-prediction-correction step. No scenario or truth arguments. */
export function advance(m: SwitchingModel, current: SwitchingState, control: Pair, observations: readonly TankReading[]): SwitchingState {
  pair(control); check(current.components.length === 4, 'Invalid IMM state.'); weights(current.modeWeights, 4);
  check(observations.length <= 2 && new Set(observations.map(r => r.sensor)).size === observations.length, 'Duplicate sensor at update.');
  m.modeTransition.forEach(r => weights(r, 4));
  const prior = [0, 1, 2, 3].map(j => current.modeWeights.reduce((s, v, i) => s+v*m.modeTransition[i][j], 0));
  const logWeights: number[] = [];
  const components = prior.map((probability, mode) => {
    check(probability > 0, 'Unreachable mode.');
    const mixing = current.modeWeights.map((v, i) => v*m.modeTransition[i][mode]/probability);
    const input = mix(current.components, mixing); const mean = apply(m.transition, input.mean);
    let state = checked(mean.map((v, d) => v+(d < 2 ? control[d] : 0)), add(mul(mul(m.transition, input.covariance), transpose(m.transition)), m.processCovariances[mode]));
    let likelihood = 0;
    for (const reading of observations) {
      check(reading.sensor === 0 || reading.sensor === 1, 'Unknown sensor.');
      const out = condition(state, m.measurementRows[reading.sensor], reading); state = out.state; likelihood += out.logLikelihood;
    }
    logWeights.push(Math.log(probability)+likelihood); return state;
  });
  const max = Math.max(...logWeights); const unnormalized = logWeights.map(w => Math.exp(w-max)); const total = unnormalized.reduce((s, v) => s+v, 0);
  check(Number.isFinite(total) && total > 0, 'Invalid posterior mode mass.');
  return { components, modeWeights: unnormalized.map(v => v/total) };
}
export function summarize(s: SwitchingState) {
  return { state: mix(s.components, s.modeWeights), interval95: intervals(s.components, s.modeWeights) };
}
export function replaySwitching(model: SwitchingModel, controls: readonly Pair[], readings: readonly TankReading[], cutoff: number): SwitchingResult {
  const m = makeModel(model.base, model.parameters);
  check(hash('model-check', m) === hash('model-check', model), 'Mutated derived model.');
  check(Array.isArray(controls) && controls.length <= 256 && controls.length >= cutoff, 'Missing controls.');
  const selected = selectReadings(readings, cutoff); const inputs = controls.slice(0, cutoff); inputs.forEach(pair);
  let state = initialize(m); let cursor = 0; let power = eye(); const observationRows: number[][] = [];
  const lastObservedAt: [string | null, string | null] = [null, null];
  for (let t = 1; t <= cutoff; ++t) {
    const batch: TankReading[] = []; power = mul(power, m.transition);
    while (cursor < selected.length && stepOf(selected[cursor].observedAt) === t) {
      const r = selected[cursor++]; batch.push(r); lastObservedAt[r.sensor] = r.observedAt;
      observationRows.push(mul([m.measurementRows[r.sensor]], power)[0]);
    }
    state = advance(m, state, inputs[t-1], batch);
  }
  check(cursor === selected.length, 'Incomplete observation accounting.');
  const initialStateInformationRank = rank(observationRows);
  const support = (d: number) => !selected.length ? 'model_only' as const : rank([...observationRows, eye()[d]]) === initialStateInformationRank ? 'structurally_identifiable' as const : 'not_identifiable' as const;
  const body: Omit<SwitchingResult, 'resultHash'> = {
    schema: 'synthetic-tank-switching-result.v1', operationId: OPERATION, valueKind: 'synthetic', asOf: at(cutoff),
    modelHash: hash('synthetic-switching-model.v1', m), evidenceHash: hash('synthetic-tank-input.v1', { rowHashes: selected.map(r => r.rowHash), controls: inputs }),
    stateUnits: ['litres_deviation', 'litres_deviation', 'litres_per_second', 'litres'],
    ...summarize(state), components: state.components, modeWeights: state.modeWeights,
    modeWeightMeaning: 'model_conditional_not_fault_probability', intervalBasis: 'equal_tail_of_approximate_imm_mixture',
    initialStateInformationRank, lossSupport: support(2), biasSupport: support(3), lastObservedAt,
    assimilation: { usedRows: selected.length, delayedRows: selected.filter(r => r.knownAt !== r.observedAt).length }, causalAttribution: 'not_established',
  };
  return { ...body, resultHash: hash('synthetic-switching-result.v1', body) };
}
