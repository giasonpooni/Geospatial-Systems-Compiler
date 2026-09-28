import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const { inspectLinearMapView } = await import(process.env.LINEAR_MAP_MODULE);
const hash = text => 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex');
// Wire/parser fixture only: these are not retained native-execution claims.
function fixture(provider = 'cpp') {
  const d = 'sha256:' + 'a'.repeat(64);
  return { schema: 'notation.linear-map-view.v1', case_digest: d,
    model: { owner: 'fixture', kind: 'parser-test', digest: d }, frame: 'local-test',
    provider, native_profile: 'affine-binary64.v1', bundle_digest: d, result_id: d,
    numerical_result_id: d, execution_id: 'execution-' + 'b'.repeat(32), verification_id: d, runtime_digest: d,
    outputs: [{ id: 'displacement', unit: 'm', baseline: 0, delta: 0.125, value: 0.125 }],
    claim_scope: 'first-order-mean-response-only', covariance: 'not_propagated', may_authorize: false,
    physical_validation: 'not_established', sp1_verification: 'not_performed', state_admission: 'not_performed' };
}
function envelope(value) {
  const payload = JSON.stringify(value);
  return { schema: 'notation.linear-map-view-envelope.v1', payload, sha256: hash(payload) };
}
for (const provider of ['cpp', 'julia']) test(`read-only ${provider} parser fixture`, async () => {
  const e = envelope(fixture(provider)); const r = await inspectLinearMapView(e, e.sha256);
  assert.equal(r.view.provider, provider); assert.equal(r.authority, 'none');
  assert.equal(r.view.outputs[0].value, 0.125);
  assert.throws(() => { r.view.outputs[0].value = 99; }, TypeError);
  assert.ok(Object.isFrozen(r.view.model)); assert.ok(Object.isFrozen(r.view.outputs));
});
test('requires external selection and exact payload bytes', async () => {
  const e = envelope(fixture());
  await assert.rejects(inspectLinearMapView(e, 'sha256:' + '0'.repeat(64)));
  await assert.rejects(inspectLinearMapView({ ...e, payload: e.payload + ' ' }, e.sha256));
});
test('hashes original Python-style numbers rather than JS serialization', async () => {
  const e = envelope(fixture()); e.payload = e.payload.replace('"baseline":0', '"baseline":0.0'); e.sha256 = hash(e.payload);
  assert.equal((await inspectLinearMapView(e, e.sha256)).view.outputs[0].baseline, 0);
});
const mutations = {
  authorization: v => { v.may_authorize = true; },
  booleanAsZero: v => { v.may_authorize = 0; },
  physicalClaim: v => { v.physical_validation = 'validated'; },
  proofClaim: v => { v.sp1_verification = 'verified'; },
  covarianceClaim: v => { v.covariance = 'propagated'; },
  admission: v => { v.state_admission = 'admitted'; },
  profile: v => { v.native_profile = 'arbitrary-code'; },
  provider: v => { v.provider = 'shell'; },
  extra: v => { v.command = 'execute'; },
  shortDigest: v => { v.model.digest = 'sha256:abcd'; },
  coerced: v => { v.outputs[0].value = '1'; },
  missingUnit: v => { delete v.outputs[0].unit; },
  duplicate: v => { v.outputs.push({ ...v.outputs[0] }); },
  count: v => { v.outputs = []; },
  infinite: v => { v.outputs[0].value = Infinity; },
  frame: v => { v.frame = ''; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`refuses ${name} even with a matching digest`, async () => {
  const value = fixture(); mutate(value); const e = envelope(value);
  await assert.rejects(inspectLinearMapView(e, e.sha256));
});
test('byte budget', async () => {
  const e = envelope(fixture()); e.payload = ' '.repeat(65537); e.sha256 = hash(e.payload);
  await assert.rejects(inspectLinearMapView(e, e.sha256));
});
// Optional producer fixture for local cross-language qualification. No native
// runtime is implied by fixture parsing; genuine runs are produced by CIW only.
if (process.env.LINEAR_MAP_FIXTURE) test('Python-exported UTF-8 fixture', async () => {
  const e = JSON.parse(readFileSync(process.env.LINEAR_MAP_FIXTURE, 'utf8'));
  const expected = process.env.LINEAR_MAP_EXPECTED_DIGEST;
  assert.ok(expected, 'Supply the separately selected digest');
  const r = await inspectLinearMapView(e, expected);
  assert.equal(r.view.claim_scope, 'first-order-mean-response-only');
});

test('caller mutation during asynchronous hashing cannot change inspected bytes', async () => {
  const e = envelope(fixture());
  const result = inspectLinearMapView(e, e.sha256);
  const changed = fixture(); changed.outputs[0].value = 999;
  e.payload = JSON.stringify(changed);
  assert.equal((await result).view.outputs[0].value, 0.125);
});


const { inspectUncertaintyView } = await import(process.env.LINEAR_UNCERTAINTY_MODULE);
function uncertaintyFixture() {
  const d = 'sha256:' + 'c'.repeat(64);
  return { schema: 'notation.linear-uncertainty-view.v1', mean: envelope(fixture()),
    quantity_ids: ['displacement'], units: ['m'], frame: 'local-test', matrix: [[0.25]],
    covariance_id: d, input_covariance_id: d, calculation_id: d, verification_id: d,
    native_stage_count: 3, scope: 'fixed-jacobian-input-covariance-only', may_authorize: false };
}
function uncertaintyEnvelope(value) {
  const payload = JSON.stringify(value);
  return { schema: 'notation.linear-uncertainty-view-envelope.v1', payload, sha256: hash(payload) };
}
test('uncertainty view retains frozen matrix and distinct identities', async () => {
  const e = uncertaintyEnvelope(uncertaintyFixture());
  const r = await inspectUncertaintyView(e, e.sha256);
  assert.equal(r.covariance.matrix[0][0],0.25); assert.equal(r.mean.view.outputs[0].value,0.125);
  assert.throws(() => { r.covariance.matrix[0][0]=0; },TypeError);
});
const covarianceMutations = {
  axis: v => { v.quantity_ids[0] = 'other'; },
  unit: v => { v.units[0] = 'mm'; },
  frame: v => { v.frame = 'other'; },
  shape: v => { v.matrix[0].push(1); },
  negativeVariance: v => { v.matrix[0][0] = -1; },
  nonfinite: v => { v.matrix[0][0] = Infinity; },
  coerced: v => { v.matrix[0][0] = '1'; },
  stageCount: v => { v.native_stage_count = 2; },
  widenedClaim: v => { v.scope = 'physically-validated'; },
  authorizing: v => { v.may_authorize = true; },
  nestedTamper: v => { v.mean.payload += ' '; },
};
for (const [name, mutate] of Object.entries(covarianceMutations)) test(`uncertainty refuses ${name}`, async () => {
  const v=uncertaintyFixture(); mutate(v); const e=uncertaintyEnvelope(v);
  await assert.rejects(inspectUncertaintyView(e,e.sha256));
});
test('uncertainty requires separately selected digest', async () => {
  const e=uncertaintyEnvelope(uncertaintyFixture());
  await assert.rejects(inspectUncertaintyView(e,'sha256:'+'0'.repeat(64)));
});
test('uncertainty checks the original payload during asynchronous mutation', async () => {
  const e=uncertaintyEnvelope(uncertaintyFixture()); const result=inspectUncertaintyView(e,e.sha256);
  e.payload='changed'; assert.equal((await result).covariance.matrix[0][0],0.25);
});
