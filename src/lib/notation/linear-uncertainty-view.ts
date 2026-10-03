/** Retained covariance inspection, not an estimator or covariance verifier. */
import { inspectLinearMapView, type LinearMapInspection } from './linear-map-view';
export type UncertaintyInspection = Readonly<{
  integrity: 'matched-external-digest'; authority: 'none'; mean: LinearMapInspection;
  covariance: Readonly<{ id: string; inputId: string; quantityIds: readonly string[];
    units: readonly string[]; frame: string; matrix: readonly (readonly number[])[] }>;
  calculationId: string; verificationId: string; nativeStageCount: number;
  scope: 'fixed-jacobian-input-covariance-only';
}>;
const d = /^sha256:[0-9a-f]{64}$/;
function object(v: unknown, keys: string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)
      || Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k))) {
    throw new Error('Unexpected uncertainty fields');
  }
  return v as Record<string, unknown>;
}
function digest(v: unknown): asserts v is string {
  if (typeof v !== 'string' || !d.test(v)) throw new Error('Require complete digest');
}
export async function inspectUncertaintyView(envelope: unknown, expected: string): Promise<UncertaintyInspection> {
  digest(expected);
  const { schema, payload, sha256 } = object(envelope, ['schema', 'payload', 'sha256']);
  if (schema !== 'notation.linear-uncertainty-view-envelope.v1' || typeof payload !== 'string' || sha256 !== expected) {
    throw new Error('Uncertainty envelope or external selection differs');
  }
  if (payload.length > 65536) throw new Error('Uncertainty byte budget exceeded');
  const bytes = new TextEncoder().encode(payload);
  if (bytes.byteLength > 65536) throw new Error('Uncertainty byte budget exceeded');
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  if ('sha256:'+Array.from(h, x => x.toString(16).padStart(2, '0')).join('') !== expected) {
    throw new Error('Uncertainty bytes differ');
  }
  const v = object(JSON.parse(payload), ['schema', 'mean', 'quantity_ids', 'units', 'frame', 'matrix',
    'covariance_id', 'input_covariance_id', 'calculation_id', 'verification_id', 'native_stage_count', 'scope', 'may_authorize']);
  if (v.schema !== 'notation.linear-uncertainty-view.v1' || v.scope !== 'fixed-jacobian-input-covariance-only'
      || v.may_authorize !== false) throw new Error('Unsupported covariance claim');
  for (const k of ['covariance_id','input_covariance_id','calculation_id','verification_id']) digest(v[k]);
  const meanEnvelope = object(v.mean, ['schema', 'payload', 'sha256']);
  digest(meanEnvelope.sha256);
  // The independent outer selection already binds this nested digest. This is
  // not accepting a free-standing envelope's self-digest as an external pin.
  const mean = await inspectLinearMapView(meanEnvelope, meanEnvelope.sha256);
  const outputs = mean.view.outputs;
  const count = outputs.length;
  if (!Array.isArray(v.quantity_ids) || !Array.isArray(v.units) || v.quantity_ids.length !== count || v.units.length !== count
      || outputs.some((q, i) => q.id !== (v.quantity_ids as unknown[])[i] || q.unit !== (v.units as unknown[])[i])
      || v.frame !== mean.view.frame) throw new Error('Covariance axes, units or frame differ from mean');
  if (!Number.isInteger(v.native_stage_count) || (v.native_stage_count as number) < count+2
      || (v.native_stage_count as number) > count+9) throw new Error('Invalid native stage count');
  if (!Array.isArray(v.matrix) || v.matrix.length !== count) throw new Error('Invalid covariance dimensions');
  const matrix = v.matrix.map((r: unknown, i: number) => {
    if (!Array.isArray(r) || r.length !== count || r.some(x => typeof x !== 'number' || !Number.isFinite(x)) || r[i] < 0) {
      throw new Error('Invalid finite covariance row');
    }
    return Object.freeze([...r] as number[]);
  });
  return Object.freeze({ integrity: 'matched-external-digest', authority: 'none', mean,
    covariance: Object.freeze({ id: v.covariance_id as string, inputId: v.input_covariance_id as string,
      quantityIds: Object.freeze([...v.quantity_ids] as string[]), units: Object.freeze([...v.units] as string[]),
      frame: v.frame as string, matrix: Object.freeze(matrix) }),
    calculationId: v.calculation_id as string, verificationId: v.verification_id as string,
    nativeStageCount: v.native_stage_count as number, scope: 'fixed-jacobian-input-covariance-only' });
}
