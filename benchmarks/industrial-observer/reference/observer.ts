import { at, hash, pair, requireCondition as check, selectReadings, stepOf } from '../core';
import { advance, condition, initialize, makeModel, summarize } from '../switching/observer';
import { eye, mul, rank } from '../switching/numerics';
import type { Pair, TankReading } from '../../../src/types/observer_benchmark';
import type { SwitchingModel, SwitchingState } from '../../../src/types/switching_observer';
import type { ReferenceReading, ReferenceResult, ReferenceSpecification } from '../../../src/types/reference_observer';

export const OPERATION = 'reference.two-tank-imm-independent-measurement.v1' as const;
export function referenceRow(spec: ReferenceSpecification): number[] {
  check(spec && Object.keys(spec).length === 5 &&
    spec.calibrationId === (spec.loading === 'tank_b' ? 'synthetic:calibration:b:independent-v1' : 'synthetic:calibration:b:shared-bias-v1') &&
    ['tank_b', 'tank_b_plus_primary_bias'].includes(spec.loading) &&
    spec.noiseFamily === 'synthetic:reference:b:iid' &&
    spec.calibrationStatus === 'synthetic_known_offset_assumption' &&
    Number.isFinite(spec.varianceLitres2) && spec.varianceLitres2 > 0 && spec.varianceLitres2 <= 100, 'Invalid reference specification.');
  return spec.loading === 'tank_b' ? [0, 1, 0, 0] : [0, 1, 0, 1];
}
export function sealReference(draft: Omit<ReferenceReading, 'rowHash'>): ReferenceReading {
  return { ...draft, rowHash: hash('synthetic-reference-reading.v1', draft) };
}
export function selectReferences(rows: readonly ReferenceReading[], spec: ReferenceSpecification, cutoff: number): ReferenceReading[] {
  referenceRow(spec);
  check(Number.isInteger(cutoff) && cutoff >= 0 && cutoff <= 256, 'Invalid cutoff.');
  check(Array.isArray(rows) && rows.length <= 256, 'Invalid reference batch.');
  const times = new Set<string>(), ids = new Set<string>();
  const selected: ReferenceReading[] = [];
  for (const row of rows) {
    check(row && Object.keys(row).length === 8, 'Invalid reference shape.');
    const { rowHash, ...draft } = row;
    check(rowHash === hash('synthetic-reference-reading.v1', draft), 'Reference integrity mismatch.');
    const observed = stepOf(row.observedAt), known = stepOf(row.knownAt);
    check(observed >= 1 && observed <= 256 && known >= observed &&
      row.recordId === `synthetic:reference:b:${observed}` &&
      row.calibrationId === spec.calibrationId && row.noiseFamily === spec.noiseFamily &&
      row.varianceLitres2 === spec.varianceLitres2 &&
      Number.isFinite(row.valueLitres) && Math.abs(row.valueLitres) <= 1e6, 'Invalid reference identity, chronology or uncertainty.');
    check(!times.has(row.observedAt) && !ids.has(row.recordId), 'Duplicate reference sample.');
    times.add(row.observedAt); ids.add(row.recordId);
    if (known <= cutoff) selected.push(row);
  }
  return selected.sort((a,b) => a.observedAt.localeCompare(b.observedAt));
}
/** Same interaction/prediction/primary correction as PR20, then one extra scalar
 * likelihood. No new state, mode, process covariance, gain heuristic or training.
 * B and reference noise must be conditionally independent given the four states.
 */
export function advanceReference(m: SwitchingModel, current: SwitchingState, u: Pair,
  primary: readonly TankReading[], reference: ReferenceReading | undefined, spec: ReferenceSpecification): SwitchingState {
  const h = referenceRow(spec);
  const next = advance(m, current, u, primary);
  if (!reference) return next;
  // Numeric projection into the existing scalar kernel. This is not admission
  // as a primary row: source identity and reference hashes are kept separately.
  const measurement: TankReading = { ...reference, sensor: 1,
    noiseVarianceLitres2: reference.varianceLitres2, referenceVarianceLitres2: 0 };
  const updates = next.components.map(c => condition(c, h, measurement));
  const logMass = updates.map((c,i) => Math.log(next.modeWeights[i]) + c.logLikelihood);
  const maximum = Math.max(...logMass), mass = logMass.map(v => Math.exp(v-maximum));
  const total = mass.reduce((a,b) => a+b, 0);
  check(Number.isFinite(total) && total > 0, 'Invalid reference posterior mass.');
  return { components: updates.map(c => c.state), modeWeights: mass.map(v => v/total) };
}
/** Initial-state structural information; not current precision or causal proof. */
export function structuralRows(model: SwitchingModel, primary: readonly TankReading[], references: readonly ReferenceReading[], spec: ReferenceSpecification, cutoff: number) {
  let power = eye(); const rows: number[][] = [], h = referenceRow(spec);
  for (let t=1; t<=cutoff; ++t) {
    power = mul(power, model.transition);
    for (const r of primary.filter(r => stepOf(r.observedAt) === t)) rows.push(mul([model.measurementRows[r.sensor]], power)[0]);
    if (references.some(r => stepOf(r.observedAt) === t)) rows.push(mul([h], power)[0]);
  }
  return rows;
}
export function replayReference(model: SwitchingModel, controls: readonly Pair[], readings: readonly TankReading[], references: readonly ReferenceReading[], spec: ReferenceSpecification, cutoff: number): ReferenceResult {
  const m = makeModel(model.base, model.parameters);
  check(hash('model-check', m) === hash('model-check', model), 'Mutated derived model.');
  check(Array.isArray(controls) && controls.length <= 256 && controls.length >= cutoff, 'Missing controls.');
  const primary = selectReadings(readings, cutoff), selected = selectReferences(references, spec, cutoff);
  const inputs = controls.slice(0,cutoff); inputs.forEach(pair);
  let current = initialize(m), p = 0, q = 0;
  const lastObservedAt: [string|null, string|null] = [null,null];
  for (let t=1; t<=cutoff; ++t) {
    const batch: TankReading[] = [];
    while (p < primary.length && stepOf(primary[p].observedAt) === t) {
      const r = primary[p++]; batch.push(r); lastObservedAt[r.sensor] = r.observedAt;
    }
    const r = q < selected.length && stepOf(selected[q].observedAt) === t ? selected[q++] : undefined;
    current = advanceReference(m, current, inputs[t-1], batch, r, spec);
  }
  check(p === primary.length && q === selected.length, 'Incomplete sample accounting.');
  const rows = structuralRows(m, primary, selected, spec, cutoff), informationRank = rank(rows);
  const support = (axis: number) => !rows.length ? 'model_only' as const : rank([...rows,eye()[axis]]) === informationRank ? 'structurally_identifiable' as const : 'not_identifiable' as const;
  const primaryEvidenceHash = hash('synthetic-tank-input.v1', { rowHashes: primary.map(r=>r.rowHash), controls: inputs });
  const body: Omit<ReferenceResult,'resultHash'> = {
    schema:'synthetic-tank-reference-result.v1', operationId:OPERATION, valueKind:'synthetic', asOf:at(cutoff),
    modelHash:hash('synthetic-switching-model.v1',m), measurementModelHash:hash('synthetic-reference-spec.v1',spec),
    primaryEvidenceHash, evidenceHash:hash('synthetic-reference-input.v1',{primaryEvidenceHash, referenceRowHashes:selected.map(r=>r.rowHash)}),
    referenceSpecification:structuredClone(spec), ...summarize(current), components:current.components, modeWeights:current.modeWeights,
    stateUnits:['litres_deviation','litres_deviation','litres_per_second','litres'],
    modeWeightMeaning:'model_conditional_not_fault_probability', intervalBasis:'equal_tail_of_approximate_imm_mixture',
    initialStateInformationRank:informationRank, lossSupport:support(2), biasSupport:support(3), lastObservedAt,
    lastReferenceObservedAt:selected.length ? selected[selected.length-1].observedAt : null,
    assimilation:{usedRows:p+q,primaryRows:p,referenceRows:q,delayedRows:[...primary,...selected].filter(r=>r.knownAt!==r.observedAt).length},
    causalAttribution:'not_established',
  };
  return {...body,resultHash:hash('synthetic-reference-result.v1',body)};
}
