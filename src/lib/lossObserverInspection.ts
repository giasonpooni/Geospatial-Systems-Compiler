import type { LossExecution } from '../types/loss_observer';

/** Retained synthetic-result view; no solver, network or file imports. */
export function toLossObserverInspection(execution: LossExecution) {
  const r = execution.result;
  if (r.schema !== 'synthetic-tank-loss-result.v1' || r.valueKind !== 'synthetic' ||
      r.operationId !== 'reference.two-tank-loss-kalman.v1' ||
      r.interpretation !== 'net_outflow_equivalent_not_causal_attribution' ||
      execution.verification.status !== 'not_verified' || execution.verification.verificationId !== null ||
      !/^synthetic-execution:[a-zA-Z0-9-]+$/.test(execution.executionId) ||
      ![r.modelHash, r.evidenceHash, r.resultHash].every(v => /^[a-f0-9]{64}$/.test(v))) throw new TypeError('Unsupported loss-result envelope.');
  const t = Date.parse(r.asOf);
  if (!Number.isFinite(t) || new Date(t).toISOString() !== r.asOf ||
      ![0, 1, 2, 3].includes(r.initialStateInformationRank) ||
      !['model_only', 'unobserved', 'indirect_estimate'].includes(r.lossSupport) ||
      JSON.stringify(r.stateUnits) !== JSON.stringify(['litres_deviation', 'litres_deviation', 'litres_per_second'])) throw new TypeError('Invalid result metadata.');
  const p = r.state.covariance;
  if (!Array.isArray(p) || p.length !== 3 || !p.every(row => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite))) throw new TypeError('Invalid covariance dimensions.');
  // Independent correlation-matrix principal-minor check; no numerical engine import.
  const c = p.map((row, i) => row.map((v, j) => v/Math.sqrt(p[i][i])/Math.sqrt(p[j][j])));
  if (p.some((row, i) => row[i] <= 0) || c.some((row, i) => row.some((v, j) => !Number.isFinite(v) || Math.abs(v-c[j][i]) > 1e-12)) ||
      1-c[0][1]**2 <= 1e-13 ||
      1+2*c[0][1]*c[0][2]*c[1][2]-c[0][1]**2-c[0][2]**2-c[1][2]**2 <= 1e-13) throw new TypeError('Invalid covariance.');
  if (!Array.isArray(r.state.mean) || r.state.mean.length !== 3 || !r.state.mean.every(Number.isFinite) ||
      !Array.isArray(r.interval95) || r.interval95.length !== 3 ||
      !Array.isArray(r.lastObservedAt) || r.lastObservedAt.length !== 2) throw new TypeError('Invalid state shape.');
  const ages = r.lastObservedAt.map(v => {
    if (v === null) return null;
    const ms = Date.parse(v);
    if (!Number.isFinite(ms) || new Date(ms).toISOString() !== v || ms > t) throw new TypeError('Invalid observation time.');
    return (t-ms)/1000;
  });
  const rows = ([0, 1, 2] as const).map(d => {
    const v = r.state.mean[d]; const radius = 1.959963984540054*Math.sqrt(p[d][d]); const interval = r.interval95[d];
    if (!Array.isArray(interval) || interval.length !== 2 || !interval.every(Number.isFinite) ||
        Math.abs(interval[0]-(v-radius)) > 1e-9 || Math.abs(interval[1]-(v+radius)) > 1e-9) throw new TypeError('Interval/covariance mismatch.');
    return { stateId: ['synthetic:tank:a', 'synthetic:tank:b', 'synthetic:tank:b:net-outflow'][d],
      estimate: v, interval95: [...interval], unit: r.stateUnits[d],
      support: d === 2 ? r.lossSupport : ages[d] === null ? 'no_direct_measurement' : ages[d] === 0 ? 'measurement_conditioned' : 'prediction_only',
      ageSeconds: d === 2 ? null : ages[d] };
  });
  return { title: 'Synthetic tank loss observer', asOf: r.asOf, rows,
    executionId: execution.executionId, operationId: r.operationId, modelHash: r.modelHash,
    evidenceHash: r.evidenceHash, resultHash: r.resultHash, interpretation: r.interpretation,
    verification: { ...execution.verification }, integrityStatus: 'format_checked_not_cryptographically_verified' as const };
}
