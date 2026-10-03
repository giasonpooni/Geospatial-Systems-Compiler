import type { ObserverExecution, Pair } from '../types/observer_benchmark';

/** Read-only representation. No provider, solver, filesystem or network imports. */
export function toObserverInspection(execution: ObserverExecution) {
  const r = execution.result;
  if (r.schema !== 'synthetic-tank-observer-result.v1' || r.valueKind !== 'synthetic' ||
      r.operationId !== 'reference.two-tank-kalman.v1' ||
      execution.verification.status !== 'not_verified' || execution.verification.verificationId !== null ||
      !/^synthetic-execution:[a-zA-Z0-9-]+$/.test(execution.executionId) ||
      ![0, 1, 2].includes(r.informationRank) ||
      ![r.modelHash, r.evidenceHash, r.resultHash].every(h => /^[a-f0-9]{64}$/.test(h))) {
    throw new TypeError('Unsupported synthetic result envelope.');
  }
  const asOf = Date.parse(r.asOf);
  if (!Number.isFinite(asOf) || new Date(asOf).toISOString() !== r.asOf) throw new TypeError('Invalid result time.');
  if (![r.state.mean, r.state.covariance, r.interval95Litres, r.lastObservedAt].every(a => Array.isArray(a) && a.length === 2)) throw new TypeError('Invalid result dimensions.');
  const p = r.state.covariance;
  if (!p.every(row => Array.isArray(row) && row.length === 2 && row.every(Number.isFinite)) ||
      p[0][0] <= 0 || p[1][1] <= 0 || Math.abs(p[0][1]-p[1][0]) > 1e-10 ||
      p[0][0]*p[1][1]-p[0][1]*p[1][0] <= 0) throw new TypeError('Invalid covariance.');
  const rows = ([0, 1] as const).map(d => {
    const mean = r.state.mean[d]; const interval = r.interval95Litres[d];
    if (!Number.isFinite(mean) || !Array.isArray(interval) || interval.length !== 2 || !interval.every(Number.isFinite)) throw new TypeError('Invalid estimate.');
    const width = 1.959963984540054*Math.sqrt(p[d][d]);
    if (Math.abs(interval[0]-(mean-width)) > 1e-9 || Math.abs(interval[1]-(mean+width)) > 1e-9) throw new TypeError('Interval/covariance mismatch.');
    const last = r.lastObservedAt[d]; const measured = last === null ? null : Date.parse(last);
    if (measured !== null && (!Number.isFinite(measured) || measured > asOf || new Date(measured).toISOString() !== last)) throw new TypeError('Invalid measurement time.');
    const support = measured === null ? (r.informationRank === 2 ? 'indirect_estimate' : 'unobserved') : measured < asOf ? 'prediction_only' : 'measurement_conditioned';
    return { stateId: d === 0 ? 'synthetic:tank:a' : 'synthetic:tank:b', unit: 'litres_deviation', estimate: mean,
      interval95: [...interval] as Pair, lastObservedAt: last, ageSeconds: measured === null ? null : (asOf-measured)/1000, support };
  });
  return { title: 'Synthetic tank observer', asOf: r.asOf, valueKind: 'synthetic' as const,
    operationId: r.operationId, executionId: execution.executionId, modelHash: r.modelHash,
    evidenceHash: r.evidenceHash, resultHash: r.resultHash,
    verification: { ...execution.verification },
    integrityStatus: 'format_checked_not_cryptographically_verified' as const, rows };
}
