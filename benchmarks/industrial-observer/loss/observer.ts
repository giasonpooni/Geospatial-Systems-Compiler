import { at, hash, matrix, pair, positiveDefinite, requireCondition, selectReadings, stepOf } from '../core';
import type { Innovation, Pair, TankModel, TankReading } from '../../../src/types/observer_benchmark';
import type { GaussianLossState, LossModel, LossObserverResult, LossParameters, Matrix3, Triple } from '../../../src/types/loss_observer';
import { add3, apply3, checked3, cholesky3, identity3, multiply3, rank3, transpose3, triple } from './numerics';

export const LOSS_OPERATION = 'reference.two-tank-loss-kalman.v1' as const;
const Z95 = 1.959963984540054;

/** Explicit process disturbance, not a sensor bias and not a learned model. */
export function augmentLossModel(base: TankModel, parameters: LossParameters): LossModel {
  matrix(base.transition); positiveDefinite(base.processCovariance);
  pair(base.initial.mean); positiveDefinite(base.initial.covariance);
  requireCondition(parameters && Object.keys(parameters).length === 2 &&
    [parameters.processVariance, parameters.initialVariance].every(v => Number.isFinite(v) && v > 0 && v <= 10), 'Invalid disturbance covariance.');
  const b = structuredClone(base); const p = { ...parameters };
  const f = b.transition; const q = b.processCovariance; const v = b.initial.covariance;
  return {
    base: b, stepSeconds: 1, parameters: p,
    transition: [[f[0][0], f[0][1], 0], [f[1][0], f[1][1], -1], [0, 0, 1]],
    processCovariance: [[q[0][0], q[0][1], 0], [q[1][0], q[1][1], 0], [0, 0, p.processVariance]],
    initial: { mean: [...b.initial.mean, 0], covariance: [[v[0][0], v[0][1], 0], [v[1][0], v[1][1], 0], [0, 0, p.initialVariance]] },
  };
}
export function predictLoss(state: GaussianLossState, model: LossModel, control: Pair): GaussianLossState {
  triple(state.mean); cholesky3(state.covariance); pair(control);
  const x = apply3(model.transition, state.mean);
  return checked3([x[0]+control[0], x[1]+control[1], x[2]],
    add3(multiply3(multiply3(model.transition, state.covariance), transpose3(model.transition)), model.processCovariance));
}
export function correctLoss(state: GaussianLossState, r: TankReading): { state: GaussianLossState; innovation: Innovation } {
  triple(state.mean); cholesky3(state.covariance);
  requireCondition(r.sensor === 0 || r.sensor === 1, 'Unknown sensor.');
  requireCondition(Number.isFinite(r.valueLitres) && Math.abs(r.valueLitres) <= 1e6 &&
    Number.isFinite(r.noiseVarianceLitres2) && r.noiseVarianceLitres2 > 0 &&
    Number.isFinite(r.referenceVarianceLitres2) && r.referenceVarianceLitres2 >= 0, 'Invalid measurement variance or value.');
  const noise = r.noiseVarianceLitres2+r.referenceVarianceLitres2;
  const variance = state.covariance[r.sensor][r.sensor]+noise;
  requireCondition(Number.isFinite(variance) && variance > 0, 'Invalid innovation variance.');
  const residual = r.valueLitres-state.mean[r.sensor];
  const k = state.covariance.map(row => row[r.sensor]/variance) as Triple;
  const j = identity3(); for (let i = 0; i < 3; ++i) j[i][r.sensor] -= k[i];
  const krk = k.map(v => k.map(w => v*noise*w)) as Matrix3;
  const posterior = checked3(state.mean.map((v, i) => v+k[i]*residual) as Triple,
    add3(multiply3(multiply3(j, state.covariance), transpose3(j)), krk));
  return { state: posterior, innovation: { recordId: r.recordId, observedAt: r.observedAt,
    residualLitres: residual, varianceLitres2: variance, normalizedSquared: residual*residual/variance } };
}

/** Canonical model is reconstructed to reject mutated derived F/Q/prior fields. */
export function replayLoss(model: LossModel, controls: readonly Pair[], readings: readonly TankReading[], cutoff: number): LossObserverResult {
  const canonical = augmentLossModel(model.base, model.parameters);
  requireCondition(hash('loss-model-check', canonical) === hash('loss-model-check', model), 'Inconsistent derived loss model.');
  const modelHash = hash('synthetic-loss-model.v1', canonical);
  requireCondition(Array.isArray(controls) && controls.length <= 256 && controls.length >= cutoff, 'Missing controls.');
  const selected = selectReadings(readings, cutoff);
  const inputs = controls.slice(0, cutoff); inputs.forEach(pair);
  let state = structuredClone(canonical.initial); let cursor = 0; let power = identity3();
  const rows: Triple[] = []; const innovations: Innovation[] = [];
  const lastObservedAt: [string | null, string | null] = [null, null];
  for (let t = 1; t <= cutoff; ++t) {
    state = predictLoss(state, canonical, inputs[t-1]); power = multiply3(power, canonical.transition);
    while (cursor < selected.length && stepOf(selected[cursor].observedAt) === t) {
      const r = selected[cursor++]; const update = correctLoss(state, r);
      state = update.state; innovations.push(update.innovation); lastObservedAt[r.sensor] = r.observedAt;
      rows.push(power[r.sensor]);
    }
  }
  const informationRank = rank3(rows);
  const lossIdentifiable = rows.length > 0 && rank3([...rows, [0, 0, 1]]) === informationRank;
  const interval95 = state.mean.map((v, i) => {
    const radius = Z95*Math.sqrt(state.covariance[i][i]); return [v-radius, v+radius];
  }) as [Pair, Pair, Pair];
  const body: Omit<LossObserverResult, 'resultHash'> = {
    schema: 'synthetic-tank-loss-result.v1', valueKind: 'synthetic', operationId: LOSS_OPERATION,
    modelHash, evidenceHash: hash('synthetic-tank-input.v1', { rowHashes: selected.map(r => r.rowHash), controls: inputs }),
    asOf: at(cutoff), state,
    stateUnits: ['litres_deviation', 'litres_deviation', 'litres_per_second'],
    volumeState: { mean: [state.mean[0], state.mean[1]], covariance: [[state.covariance[0][0], state.covariance[0][1]], [state.covariance[1][0], state.covariance[1][1]]] },
    interval95, lastObservedAt, initialStateInformationRank: informationRank,
    lossSupport: !rows.length ? 'model_only' : lossIdentifiable ? 'indirect_estimate' : 'unobserved',
    interpretation: 'net_outflow_equivalent_not_causal_attribution',
    assimilation: { usedRows: selected.length, delayedRows: selected.filter(r => r.knownAt !== r.observedAt).length }, innovations,
  };
  return { ...body, resultHash: hash('synthetic-loss-result.v1', body) };
}
