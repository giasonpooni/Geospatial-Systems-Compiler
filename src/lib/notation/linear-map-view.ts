/** Read-only CIW numerical projection. No runtime, evidence or authority API. */
export type Quantity = Readonly<{ id: string; unit: string; baseline: number; delta: number; value: number }>;
export type LinearMapView = Readonly<{
  schema: 'notation.linear-map-view.v1'; case_digest: string;
  model: Readonly<{ owner: string; kind: string; digest: string }>; frame: string;
  provider: 'cpp' | 'julia'; native_profile: 'affine-binary64.v1';
  bundle_digest: string; result_id: string; numerical_result_id: string;
  execution_id: string; verification_id: string; runtime_digest: string;
  outputs: readonly Quantity[]; claim_scope: 'first-order-mean-response-only';
  covariance: 'not_propagated'; may_authorize: false;
  physical_validation: 'not_established'; sp1_verification: 'not_performed'; state_admission: 'not_performed';
}>;
export type LinearMapInspection = Readonly<{
  integrity: 'matched-external-digest'; authority: 'none'; view: LinearMapView;
}>;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const fields = ['schema', 'case_digest', 'model', 'frame', 'provider', 'native_profile',
  'bundle_digest', 'result_id', 'numerical_result_id', 'execution_id', 'verification_id',
  'runtime_digest', 'outputs', 'claim_scope', 'covariance', 'may_authorize',
  'physical_validation', 'sp1_verification', 'state_admission'];

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(k => !keys.includes(k))) throw new Error('Unexpected or missing fields');
  return value as Record<string, unknown>;
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Invalid bounded identifier or unit');
  }
}
function digest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !digestPattern.test(value)) throw new Error('Invalid complete digest');
}
function finite(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Nonfinite or coerced quantity');
}

/**
 * expectedSha256 MUST come from a separately trusted retained-artifact selection,
 * not from envelope.sha256. Matching bytes do not authenticate a sensor, attest a
 * binary, establish calibration or admit a state. No units or frames are guessed.
 * Hash the Python producer's exact UTF-8 string, never a JS reserialization.
 */
export async function inspectLinearMapView(envelope: unknown, expectedSha256: string): Promise<LinearMapInspection> {
  digest(expectedSha256);
  const { schema, payload, sha256 } = object(envelope, ['schema', 'payload', 'sha256']);
  if (schema !== 'notation.linear-map-view-envelope.v1' || typeof payload !== 'string') throw new Error('Unsupported envelope');
  digest(sha256);
  if (sha256 !== expectedSha256) throw new Error('External artifact selection differs');
  if (payload.length > 65536) throw new Error('View exceeds byte budget');
  const bytes = new TextEncoder().encode(payload);
  if (bytes.byteLength > 65536) throw new Error('View exceeds byte budget');
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  const observed = 'sha256:' + Array.from(hash, b => b.toString(16).padStart(2, '0')).join('');
  if (observed !== expectedSha256) throw new Error('View bytes differ from retained digest');
  const v = object(JSON.parse(payload), fields);
  if (v.schema !== 'notation.linear-map-view.v1' || v.native_profile !== 'affine-binary64.v1'
      || !['cpp', 'julia'].includes(v.provider as string) || v.claim_scope !== 'first-order-mean-response-only'
      || v.covariance !== 'not_propagated' || v.may_authorize !== false
      || v.physical_validation !== 'not_established' || v.sp1_verification !== 'not_performed'
      || v.state_admission !== 'not_performed') throw new Error('Unsupported scientific or authority claim');
  for (const key of ['case_digest', 'bundle_digest', 'result_id', 'numerical_result_id', 'verification_id', 'runtime_digest']) digest(v[key]);
  if (typeof v.execution_id !== 'string' || !/^execution-[0-9a-f]{32}$/.test(v.execution_id)) throw new Error('Invalid execution identity');
  text(v.frame);
  const model = object(v.model, ['owner', 'kind', 'digest']);
  text(model.owner); text(model.kind); digest(model.digest);
  if (!Array.isArray(v.outputs) || v.outputs.length < 1 || v.outputs.length > 8) throw new Error('Unsupported output count');
  const seen = new Set<string>();
  const outputs = v.outputs.map(item => {
    const q = object(item, ['id', 'unit', 'baseline', 'delta', 'value']);
    text(q.id); text(q.unit); finite(q.baseline); finite(q.delta); finite(q.value);
    if (seen.has(q.id)) throw new Error('Duplicate output identity');
    seen.add(q.id);
    return Object.freeze({ id: q.id, unit: q.unit, baseline: q.baseline, delta: q.delta, value: q.value });
  });
  const view = Object.freeze({ ...v, model: Object.freeze({ ...model }), outputs: Object.freeze(outputs) }) as LinearMapView;
  return Object.freeze({ integrity: 'matched-external-digest', authority: 'none', view });
}
