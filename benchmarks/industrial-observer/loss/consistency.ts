import { at, hash, sealReading } from '../core';
import { generateFixture } from '../experiment';
import type { TankReading } from '../../../src/types/observer_benchmark';
import type { LossParameters, Triple } from '../../../src/types/loss_observer';
import { apply3, cholesky3, nees3 } from './numerics';
import { augmentLossModel, replayLoss } from './observer';
import { protocol } from './experiment';

/** Seeded pseudorandom replications, not a source of cryptographic randomness. */
function normalGenerator(seed: number): () => number {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state+0x6D2B79F5) >>> 0;
    let z = Math.imul(state ^ (state >>> 15), 1 | state);
    z ^= z+Math.imul(z ^ (z >>> 7), 61 | z);
    return (((z ^ (z >>> 14)) >>> 0)+0.5)/4294967296;
  };
  return () => Math.sqrt(-2*Math.log(uniform()))*Math.cos(2*Math.PI*uniform());
}
export function matchedFixture(seed: number, parameters: LossParameters) {
  const base = generateFixture('full', seed, protocol.consistency.terminalStep);
  const model = augmentLossModel(base.model, parameters);
  const normal = normalGenerator(seed);
  const sample = (l: ReturnType<typeof cholesky3>) => apply3(l, [normal(), normal(), normal()]);
  const truth: Triple[] = [sample(cholesky3(model.initial.covariance))];
  const readings: TankReading[] = [];
  const factor = cholesky3(model.processCovariance);
  for (let t = 1; t <= protocol.consistency.terminalStep; ++t) {
    const prediction = apply3(model.transition, truth[t-1]); const noise = sample(factor);
    truth.push([prediction[0]+base.controls[t-1][0]+noise[0], prediction[1]+base.controls[t-1][1]+noise[1], prediction[2]+noise[2]]);
    for (const sensor of [0, 1] as const) {
      const variance = sensor === 0 ? 0.25 : 0.64;
      readings.push(sealReading({ recordId: `synthetic:tank:${sensor === 0 ? 'a' : 'b'}:${t}`, observedAt: at(t), knownAt: at(t), sensor,
        valueLitres: truth[t][sensor]+Math.sqrt(variance)*normal()+0.2*normal(), noiseVarianceLitres2: variance, referenceVarianceLitres2: 0.04 }));
    }
  }
  return { model, controls: base.controls, readings, truth };
}
// Fixed two-sided 99% marginal bands, independently recomputed with SciPy.
export const LOSS_CONSISTENCY_BANDS = {
  nees3: [2.6203387094236517, 3.409001540596378],
  nis: [0.7870060854055189, 1.2423177882649463],
} as const;
export function runLossConsistency(parameters: LossParameters) {
  const rows = Array.from({ length: protocol.consistency.replications }, (_, i) => {
    const seed = protocol.consistency.startSeed+i; const fixture = matchedFixture(seed, parameters);
    const result = replayLoss(fixture.model, fixture.controls, fixture.readings, protocol.consistency.terminalStep);
    const innovation = result.innovations.find(r => r.recordId === `synthetic:tank:a:${protocol.consistency.terminalStep}`)!;
    return { seed, nees3: nees3(result.state, fixture.truth[protocol.consistency.terminalStep]), nis: innovation.normalizedSquared, resultHash: result.resultHash };
  });
  const meanNees3 = rows.reduce((s, r) => s+r.nees3, 0)/rows.length;
  const meanNis = rows.reduce((s, r) => s+r.nis, 0)/rows.length;
  const decision = (v: number, b: readonly [number, number]) => v < b[0] ? 'below_band' : v > b[1] ? 'above_band' : 'within_band';
  return { replications: rows.length, terminalStep: protocol.consistency.terminalStep, parameters,
    meanNees3, meanNis, bands: LOSS_CONSISTENCY_BANDS, neesDecision: decision(meanNees3, LOSS_CONSISTENCY_BANDS.nees3), nisDecision: decision(meanNis, LOSS_CONSISTENCY_BANDS.nis),
    rows, contentHash: hash('synthetic-loss-consistency.v1', rows), scope: 'matched_random_walk_model_not_step_regime_coverage' };
}
