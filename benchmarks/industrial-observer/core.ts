import { createHash } from 'node:crypto';
import type { GaussianState, Matrix2, Pair, TankModel, TankReading, ObserverResult, Innovation } from '../../src/types/observer_benchmark';

export const EPOCH = '2026-01-01T00:00:00.000Z';
export const OPERATION = 'reference.two-tank-kalman.v1' as const;
const LIMIT = 256;
const I: Matrix2 = [[1, 0], [0, 1]];
const Z95 = 1.959963984540054;

export function requireCondition(ok: unknown, message: string): asserts ok {
  if (!ok) throw new TypeError(message);
}
/** Canonical plain-JSON content identity, not source authentication. */
export function hash(domain: string, value: unknown): string {
  const walk = (v: unknown): string => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (Array.isArray(v)) return `[${Array.from(v, walk).join(',')}]`;
    requireCondition(v && typeof v === 'object', 'Expected finite JSON.');
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${walk((v as Record<string, unknown>)[k])}`).join(',')}}`;
  };
  return createHash('sha256').update(`${domain}\0${walk(value)}`).digest('hex');
}
export function at(step: number): string {
  requireCondition(Number.isInteger(step) && step >= 0 && step <= LIMIT + 8, 'Invalid synthetic step.');
  return new Date(Date.parse(EPOCH) + 1000 * step).toISOString();
}
export function stepOf(timestamp: string): number {
  const step = (Date.parse(timestamp) - Date.parse(EPOCH)) / 1000;
  requireCondition(Number.isInteger(step) && step >= 0 && step <= LIMIT + 8 && at(step) === timestamp, 'Invalid synthetic timestamp.');
  return step;
}
export function pair(value: unknown): asserts value is Pair {
  requireCondition(Array.isArray(value) && value.length === 2 && [0, 1].every(i => Object.hasOwn(value, i) && typeof value[i] === 'number' && Number.isFinite(value[i]) && Math.abs(value[i]) <= 1e9), 'Invalid finite pair.');
}
export function matrix(value: unknown): asserts value is Matrix2 {
  requireCondition(Array.isArray(value) && value.length === 2, 'Expected 2x2 matrix.');
  pair(value[0]); pair(value[1]);
}
export function positiveDefinite(value: Matrix2): void {
  matrix(value);
  const scale = Math.max(Math.abs(value[0][0]), Math.abs(value[1][1]), 1e-30);
  requireCondition(Math.abs(value[0][1] - value[1][0]) <= 1e-12 * scale, 'Covariance must be symmetric.');
  requireCondition(value[0][0] > 0 && value[1][1] > 0 && value[0][0] * value[1][1] - value[0][1] * value[1][0] > 1e-14 * scale * scale, 'Covariance must be well-conditioned positive definite.');
}
export function mul(a: Matrix2, b: Matrix2): Matrix2 {
  return [[a[0][0]*b[0][0]+a[0][1]*b[1][0], a[0][0]*b[0][1]+a[0][1]*b[1][1]],
    [a[1][0]*b[0][0]+a[1][1]*b[1][0], a[1][0]*b[0][1]+a[1][1]*b[1][1]]];
}
export function apply(a: Matrix2, x: Pair): Pair {
  return [a[0][0]*x[0]+a[0][1]*x[1], a[1][0]*x[0]+a[1][1]*x[1]];
}
const transpose = (a: Matrix2): Matrix2 => [[a[0][0], a[1][0]], [a[0][1], a[1][1]]];
const add = (a: Matrix2, b: Matrix2): Matrix2 => [[a[0][0]+b[0][0], a[0][1]+b[0][1]], [a[1][0]+b[1][0], a[1][1]+b[1][1]]];
function checked(mean: Pair, p: Matrix2): GaussianState {
  pair(mean); matrix(p);
  const off = (p[0][1] + p[1][0]) / 2;
  const covariance: Matrix2 = [[p[0][0], off], [off, p[1][1]]];
  positiveDefinite(covariance);
  return { mean, covariance };
}
export function predict(state: GaussianState, model: TankModel, control: Pair): GaussianState {
  pair(state.mean); positiveDefinite(state.covariance); matrix(model.transition); positiveDefinite(model.processCovariance); pair(control);
  const x = apply(model.transition, state.mean);
  return checked([x[0]+control[0], x[1]+control[1]], add(mul(mul(model.transition, state.covariance), transpose(model.transition)), model.processCovariance));
}
export function correct(state: GaussianState, reading: TankReading): { state: GaussianState; innovation: Innovation } {
  pair(state.mean); positiveDefinite(state.covariance);
  requireCondition(reading.sensor === 0 || reading.sensor === 1, 'Unknown sensor.');
  requireCondition(Number.isFinite(reading.valueLitres) && Math.abs(reading.valueLitres) <= 1e6 && Number.isFinite(reading.noiseVarianceLitres2) && reading.noiseVarianceLitres2 > 0 && Number.isFinite(reading.referenceVarianceLitres2) && reading.referenceVarianceLitres2 >= 0, 'Invalid reading or uncertainty.');
  const s = reading.sensor;
  const r = reading.noiseVarianceLitres2 + reading.referenceVarianceLitres2;
  const variance = state.covariance[s][s] + r;
  requireCondition(Number.isFinite(variance) && variance > 0, 'Invalid innovation variance.');
  const residual = reading.valueLitres - state.mean[s];
  const gain: Pair = [state.covariance[0][s]/variance, state.covariance[1][s]/variance];
  const j: Matrix2 = [[1, 0], [0, 1]];
  j[0][s] -= gain[0]; j[1][s] -= gain[1];
  const krk: Matrix2 = [[gain[0]*r*gain[0], gain[0]*r*gain[1]], [gain[1]*r*gain[0], gain[1]*r*gain[1]]];
  // Joseph update includes independent measurement AND reference uncertainty.
  const posterior = checked([state.mean[0]+gain[0]*residual, state.mean[1]+gain[1]*residual], add(mul(mul(j, state.covariance), transpose(j)), krk));
  return { state: posterior, innovation: { recordId: reading.recordId, observedAt: reading.observedAt, residualLitres: residual, varianceLitres2: variance, normalizedSquared: residual*residual/variance } };
}
export function nees(state: GaussianState, truth: Pair): number {
  pair(truth); pair(state.mean); positiveDefinite(state.covariance);
  // Cholesky whitening avoids explicitly forming P^-1.
  const a = Math.sqrt(state.covariance[0][0]);
  const b = state.covariance[1][0]/a;
  const c = Math.sqrt(state.covariance[1][1] - b*b);
  const v0 = (truth[0]-state.mean[0])/a;
  const v1 = (truth[1]-state.mean[1]-b*v0)/c;
  return v0*v0 + v1*v1;
}
export function sealReading(draft: Omit<TankReading, 'rowHash'>): TankReading {
  return { ...draft, rowHash: hash('synthetic-tank-reading.v1', draft) };
}
export function selectReadings(readings: readonly TankReading[], cutoff: number): TankReading[] {
  requireCondition(Number.isInteger(cutoff) && cutoff >= 0 && cutoff <= LIMIT, 'Invalid cutoff.');
  requireCondition(Array.isArray(readings) && readings.length <= 2*LIMIT, 'Oversized reading batch.');
  const ids = new Set<string>(); const events = new Set<string>();
  const selected: TankReading[] = [];
  for (const r of readings) {
    requireCondition(r && typeof r === 'object', 'Invalid reading.');
    const { rowHash, ...draft } = r;
    requireCondition(typeof r.recordId === 'string' && /^synthetic:tank:[ab]:[0-9]+$/.test(r.recordId), 'Invalid synthetic record identity.');
    requireCondition(Object.keys(r).length === 8 && hash('synthetic-tank-reading.v1', draft) === rowHash, 'Reading integrity mismatch.');
    const observed = stepOf(r.observedAt); const known = stepOf(r.knownAt);
    requireCondition(observed >= 1 && observed <= LIMIT && known >= observed && (r.sensor === 0 || r.sensor === 1), 'Invalid measurement chronology.');
    const event = `${observed}:${r.sensor}`;
    requireCondition(!ids.has(r.recordId) && !events.has(event), 'Duplicate observation; refusing double count.');
    ids.add(r.recordId); events.add(event);
    if (known <= cutoff) selected.push(r);
  }
  return selected.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.sensor-b.sensor);
}
/** Bounded full replay, not arrival-time updates and not an online production service. */
export function replay(model: TankModel, controls: readonly Pair[], readings: readonly TankReading[], cutoff: number): ObserverResult {
  matrix(model.transition); positiveDefinite(model.processCovariance); pair(model.initial.mean); positiveDefinite(model.initial.covariance);
  requireCondition(Array.isArray(controls) && controls.length <= LIMIT && controls.length >= cutoff, 'Missing controls.');
  const inputs = controls.slice(0, cutoff); inputs.forEach(pair);
  const selected = selectReadings(readings, cutoff);
  let state: GaussianState = structuredClone(model.initial);
  const innovations: Innovation[] = [];
  const lastObservedAt: [string | null, string | null] = [null, null];
  let transitionPower: Matrix2 = I; let cursor = 0;
  const rows: Pair[] = [];
  for (let t = 1; t <= cutoff; t += 1) {
    state = predict(state, model, inputs[t-1]);
    transitionPower = mul(transitionPower, model.transition);
    while (cursor < selected.length && stepOf(selected[cursor].observedAt) === t) {
      const r = selected[cursor++];
      const update = correct(state, r); state = update.state; innovations.push(update.innovation);
      lastObservedAt[r.sensor] = r.observedAt;
      rows.push(transitionPower[r.sensor]);
    }
  }
  let informationRank: 0 | 1 | 2 = 0;
  const nonzero = rows.filter(r => Math.hypot(...r) > 1e-12);
  if (nonzero.length) {
    informationRank = 1;
    const a = nonzero[0];
    if (nonzero.some(b => Math.abs(a[0]*b[1]-a[1]*b[0]) > 1e-10 * Math.hypot(...a) * Math.hypot(...b))) informationRank = 2;
  }
  const interval95Litres: [Pair, Pair] = [0, 1].map(d => {
    const width = Z95*Math.sqrt(state.covariance[d][d]);
    return [state.mean[d]-width, state.mean[d]+width];
  }) as [Pair, Pair];
  const body: Omit<ObserverResult, 'resultHash'> = {
    schema: 'synthetic-tank-observer-result.v1', valueKind: 'synthetic', operationId: OPERATION,
    modelHash: hash('synthetic-tank-model.v1', model),
    evidenceHash: hash('synthetic-tank-input.v1', { rowHashes: selected.map(r => r.rowHash), controls: inputs }),
    asOf: at(cutoff), state, interval95Litres, lastObservedAt, informationRank,
    assimilation: { usedRows: selected.length, delayedRows: selected.filter(r => r.knownAt !== r.observedAt).length }, innovations,
  };
  return { ...body, resultHash: hash('synthetic-tank-result.v1', body) };
}
