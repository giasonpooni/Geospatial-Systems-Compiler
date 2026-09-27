import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicProjection, drawablePositions, parsePublicProjectionSpec, safeHttpUrl, bridgeMessage, BRIDGE_SCHEMA } from '../../src/lib/explorer/esmProjection.ts';
import { fixture, seal, pin } from '../helpers/public-projection.mjs';

test('exact projection preserves zero, null uncertainty, time and original evidence; input is detached and frozen', async () => {
  const p = await fixture(), v = await validatePublicProjection(p, pin(p));
  assert.deepEqual(v, p); assert.equal(v.records[0].value, 0); assert.equal(v.records[0].uncertainty, null);
  assert.equal(v.geometry.positions[0].point.horizontalUncertaintyM, null);
  assert.ok(Object.isFrozen(v.records[0].provenance)); p.records[0].value = 9; assert.equal(v.records[0].value, 0);
  assert.equal(drawablePositions(v).length, 1); assert.deepEqual(v.geometry.unplaced, ['fixture:two']);
});
test('self-consistent replacement does not satisfy an independent original pin', async () => {
  const p = await fixture(), expected = pin(p); p.records[0].value = 9; await seal(p);
  await assert.rejects(validatePublicProjection(p, expected), /SOURCE_BINDING_MISMATCH/);
});
test('unsealed value changes fail the records digest', async () => {
  const p = await fixture(); p.records[0].value = 9;
  await assert.rejects(validatePublicProjection(p, pin(p)), /DIGEST_MISMATCH/);
});
test('time and release selection cannot be changed by presentation', async () => {
  const p = await fixture(), expected = pin(p); p.spec.selection.validAt = '2026-05-02T00:00:00.000Z'; await seal(p);
  await assert.rejects(validatePublicProjection(p, expected), /SOURCE_BINDING_MISMATCH/);
});
const invalid = [
  ['internal viewer', p => { p.spec.viewer = 'COUNTERPARTY_SHARED'; }],
  ['internal row', p => { p.records[0].visibility = 'INTERNAL'; }],
  ['non-fixture claim', p => { p.fixture_only = false; }],
  ['admission escalation', p => { p.nonclaims.canonicalAdmission = true; }],
  ['source-truth escalation', p => { p.nonclaims.sourceTruthClaimed = true; }],
  ['wrong authority', p => { p.authority = 'CANONICAL'; }],
  ['unknown authority field', p => { p.may_authorize = true; }],
  ['duplicate record identity', p => { p.records[1].recordId = p.records[0].recordId; }],
  ['duplicate canonical identity', p => { p.records[1].canonicalId = p.records[0].canonicalId; }],
  ['wrong record selection', p => { p.records[1].recordId = 'fixture:other'; }],
  ['wrong subject', p => { p.geometry.positions[0].subject.subjectId = 'other'; }],
  ['position belongs to no selected record', p => { p.geometry.positions[0].recordId = 'other'; }],
  ['longitude outside bounds', p => { p.geometry.positions[0].point.longitude = 181; }],
  ['position convenience disagrees with source', p => { p.geometry.positions[0].point.longitude = 13; }],
  ['unknown frame', p => { p.geometry.datum = 'LOCAL'; }],
  ['unknown source frame', p => { p.geometry.positions[0].shape.datum = 'LOCAL'; }],
  ['future known time', p => { p.records[0].knownAt = '2026-07-01T00:00:00Z'; }],
  ['upper validity bound is excluded', p => { p.records[0].validity.validTo = p.spec.selection.validAt; }],
  ['invalid calendar date', p => { p.records[0].knownAt = '2026-02-30T00:00:00Z'; }],
  ['noncanonical projection spec', p => { p.spec.selection.validAt = '2026-05-01T00:00:00Z'; }],
  ['unaccounted record', p => { p.geometry.unplaced = []; }],
  ['both placed and unplaced', p => { p.geometry.unplaced.push('fixture:one'); }],
  ['duplicate missing record', p => { p.geometry.unplaced.push('fixture:two'); }],
  ['duplicate position', p => { p.geometry.positions.push(structuredClone(p.geometry.positions[0])); }],
  ['invented uncertainty', p => { p.geometry.positions[0].point.horizontalUncertaintyM = 0; }],
  ['wrong status', p => { p.status = 'UNAVAILABLE'; }],
];
for (const [name, mutate] of invalid) test(`refuses ${name} even with recomputed digests`, async () => {
  const p = await fixture(); mutate(p); await seal(p); await assert.rejects(validatePublicProjection(p, pin(p)));
});
test('unavailable geometry stays unavailable; no zero coordinate is invented', async () => {
  const p = await fixture(); p.geometry.positions = []; p.geometry.unplaced = p.spec.selection.recordIds.slice();
  p.status = 'UNAVAILABLE'; p.error = 'GEOMETRY_NOT_AVAILABLE'; await seal(p);
  const v = await validatePublicProjection(p, pin(p)); assert.deepEqual(drawablePositions(v), []); assert.equal(v.records.length, 2);
});
test('unsupported polygon is retained but not rendered as a point or facility', async () => {
  const p = await fixture(); p.geometry.positions[0].shape = { kind: 'POLYGON', datum: 'WGS84', ring: [
    { longitude: 11, latitude: 33 }, { longitude: 13, latitude: 33 }, { longitude: 12, latitude: 36 }] };
  await seal(p); const v = await validatePublicProjection(p, pin(p));
  assert.deepEqual(drawablePositions(v), []); assert.equal(v.geometry.positions[0].shape.kind, 'POLYGON');
  assert.equal(Object.hasOwn(v.records[0], 'utilization'), false);
});
test('non-JSON, excessive nesting, prototype keys and NaN are refused', async () => {
  const p = await fixture(), expected = pin(p);
  p.records[0].value = NaN; await assert.rejects(validatePublicProjection(p, expected));
  p.records[0].value = 0; p.records[0].extra = p; await assert.rejects(validatePublicProjection(p, expected));
  delete p.records[0].extra;
  p.records[0].extra = JSON.parse('{"__proto__":{"allowed":true}}'); await assert.rejects(validatePublicProjection(p, expected));
  let deep = {}; for (let i = 0; i < 40; i++) deep = { nested: deep }; p.records[0].extra = deep;
  await assert.rejects(validatePublicProjection(p, expected), /PROJECTION_TOO_LARGE/);
});
test('request spec normalizes dates and selection without modifying input', async () => {
  const p = await fixture(); p.spec.selection.recordIds.reverse(); p.spec.selection.validAt = '2026-05-01T00:00:00Z';
  const v = parsePublicProjectionSpec(p.spec); assert.deepEqual(v.selection.recordIds, ['fixture:one', 'fixture:two']);
  assert.equal(v.selection.validAt, '2026-05-01T00:00:00.000Z'); assert.equal(p.spec.selection.recordIds[0], 'fixture:two');
});
test('endpoint configuration refuses credentials, queries, unsafe schemes and non-loopback HTTP', () => {
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/?secret=x', 'https://example.com/#x']) assert.throws(() => safeHttpUrl(url));
  assert.equal(safeHttpUrl('http://127.0.0.1:5173/embed.html').origin, 'http://127.0.0.1:5173');
});
test('wire schema, channel and operation must agree', () => {
  const p = { schema: BRIDGE_SCHEMA, channel: 'a', type: 'load' };
  assert.equal(bridgeMessage(p, 'a', 'load'), true); assert.equal(bridgeMessage(p, 'b', 'load'), false);
  assert.equal(bridgeMessage(p, 'a', 'execute'), false); assert.equal(bridgeMessage(null, 'a', 'load'), false);
});

test('retained polygon vertices and extent bounds must be well-formed', async () => {
  for (const shape of [
    { kind: 'POLYGON', datum: 'WGS84', ring: [{longitude: 0, latitude: 0}] },
    { kind: 'POLYGON', datum: 'WGS84', ring: [{longitude: 0, latitude: 0},{longitude: 1, latitude: 0},{longitude: 2, latitude: 91}] },
    { kind: 'EXTENT', datum: 'WGS84', west: 0, east: 5, south: 10, north: 1 },
    { kind: 'EXTENT', datum: 'WGS84', west: 0, east: 0, south: 0, north: 1 },
  ]) { const p = await fixture(); p.geometry.positions[0].shape = shape; await seal(p); await assert.rejects(validatePublicProjection(p,pin(p)), /INVALID_GEOMETRY/); }
});
test('two bindings cannot rewrite one declared position identity', async () => {
  const p = await fixture(); const pos = structuredClone(p.geometry.positions[0]);
  pos.recordId = 'fixture:two'; pos.source.sourceId = 'other-source';
  p.geometry.positions.push(pos); p.geometry.unplaced = []; await seal(p);
  await assert.rejects(validatePublicProjection(p,pin(p)), /GEOMETRY_BINDING_MISMATCH/);
});
