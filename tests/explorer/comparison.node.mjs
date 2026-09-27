import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRecords, projectionDiagnostics } from '../../src/lib/explorer/recordComparison.ts';
import { fixture } from '../helpers/public-projection.mjs';
async function sample() { const p = await fixture(); p.records.forEach(r => { r.unit = 'm'; }); p.records[0].value = 10; p.records[1].value = 12; return p; }
const compare = p => compareRecords(p, 'fixture:one', 'fixture:two');
test('signed difference retains evidence identities and common time without inventing covariance', async () => {
  const p = await sample(), before = structuredClone(p), r = compare(p);
  assert.equal(r.status, 'READY'); assert.equal(r.difference, 2); assert.equal(r.relativeDifference, .2);
  assert.equal(r.projectionDigest, p.digest); assert.equal(r.knownAt, p.spec.selection.knownAt);
  assert.equal(r.uncertaintyOfDifference, null); assert.deepEqual(p, before);
});
const cases = [
  ['SUBJECT_MISMATCH', p => { p.records[1].subject.canonicalId = 'notation://other'; }],
  ['PREDICATE_MISMATCH', p => { p.records[1].predicate = 'other'; }],
  ['UNIT_MISMATCH', p => { p.records[1].unit = 'cm'; }],
  ['UNIT_NOT_STATED', p => { p.records[1].unit = null; }],
  ['BASIS_NOT_STATED', p => { p.records[1].basis = null; }],
  ['BASIS_MISMATCH', p => { p.records[1].basis = 'other method'; }],
  ['NON_NUMERIC_VALUE', p => { p.records[1].value = '12'; }],
  ['NONCURRENT_RECORD', p => { p.records[1].statusAtKnownAt = 'RETRACTED'; }],
  ['NUMERIC_OVERFLOW', p => { p.records[0].value = -Number.MAX_VALUE; p.records[1].value = Number.MAX_VALUE; }],
];
for (const [reason, mutate] of cases) test(`refuses ${reason}`, async () => { const p = await sample(); mutate(p); assert.equal(compare(p).reason, reason); });
test('zero baseline has an absolute difference but no relative result', async () => { const p = await sample(); p.records[0].value = 0; const r = compare(p); assert.equal(r.difference, 12); assert.equal(r.relativeDifference, null); assert.equal(r.relativeUnavailable, 'ZERO_BASELINE'); });
test('reversing comparison reverses signed difference, not evidence', async () => { const p = await sample(); const r = compareRecords(p, 'fixture:two', 'fixture:one'); assert.equal(r.difference, -2); assert.equal(r.relativeDifference, -2/12); });
test('negative baseline uses its magnitude as the denominator', async () => { const p = await sample(); p.records[0].value = -10; p.records[1].value = -8; assert.equal(compare(p).relativeDifference, .2); });
test('relative overflow stays null rather than Infinity', async () => { const p = await sample(); p.records[0].value = Number.MIN_VALUE; const r = compare(p); assert.equal(r.relativeDifference, null); assert.equal(r.relativeUnavailable, 'NUMERIC_OVERFLOW'); });
test('unknown or identical records refuse', async () => { const p = await sample(); assert.equal(compareRecords(p,'missing','fixture:two').reason,'RECORD_NOT_AVAILABLE'); assert.equal(compareRecords(p,'fixture:one','fixture:one').reason,'SAME_RECORD'); });
test('uncertainty is carried verbatim and detached, never interpreted as independent', async () => { const p = await sample(); p.records[0].uncertainty = { low: 9, high: 11, semantics: 'declared bounds' }; const r = compare(p); assert.deepEqual(r.baselineUncertainty,p.records[0].uncertainty); r.baselineUncertainty.low=0; assert.equal(p.records[0].uncertainty.low,9); });
test('diagnostics count absent units, uncertainty and geometry rather than quality-scoring them', async () => { const p = await fixture(); const d = projectionDiagnostics(p); assert.equal(d.selectedRecords,2); assert.equal(d.unitsNotStated,2); assert.equal(d.uncertaintiesNotStated,2); assert.equal(d.unplacedRecords,1); assert.equal(d.positionsWithoutStatedUncertainty,1); });
