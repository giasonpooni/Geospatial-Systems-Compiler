import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url), build = process.env.GSC_BUILD_DIR;
const { compileGsv } = require(path.join(build, 'adapters.js'));
const { selectTemporal } = require(path.join(build, 'temporal.js'));
const { timeValue } = require(path.join(build, 'compiler.js'));
const start = '2026-09-01T00:00:00Z', at = '2026-09-05T00:00:00Z', later = '2026-09-08T00:00:00Z';
const p = () => ({ source: 'synthetic:demo', knownAt: start });
function input() {
  return { nodes: [{ id: 'node:a', name: 'A', kind: 'warehouse', geometry: { type: 'Point', coordinates: [0, 0] },
    status: 'active', importance: .5, provenance: p() }], routes: [], flows: [], commodities: [],
    events: [{ id: 'event:a', name: 'Event', description: 'Synthetic test', affects: ['node:a'], severity: .5,
      start: at, end: later, category: 'closure', provenance: p() }],
    constraints: [{ id: 'constraint:a', entityId: 'node:a', type: 'capacity', description: 'Test', severity: .5,
      validFrom: at, validTo: later, provenance: p() }],
    assertions: [{ id: 'assertion:a', entityId: 'node:a', metric: 'test', value: 10, unit: 'h', assertedAt: later, provenance: p() }],
    observations: [{ id: 'observation:a', entityId: 'node:a', metric: 'test', value: 12, unit: 'h', t: at,
      provenance: { ...p(), knownAt: later } }], cityLights: [],
    timeRange: { start, now: at, end: later }, meta: { label: 'Test', disclaimer: 'SYNTHETIC fixture', generatedAt: at } };
}
function value(r) { assert.equal(r.ok, true, JSON.stringify(r.diagnostics)); return r.value; }
function ir(source = input()) { return value(compileGsv(source, 'compile:test', { datasetId: 'fixture:time', snapshotId: null, releaseId: null, runId: null, modelId: null })); }
function query(event = at, cutoff = at) { return { from: timeValue(start), at: timeValue(event), knownAt: timeValue(cutoff) }; }
function ids(slice) { return slice.ir.records.map((r) => r.source.recordId); }
test('late-arriving observation is withheld even though its event has happened', () => {
  const s = value(selectTemporal(ir(), query('2026-09-06T00:00:00Z')));
  assert.ok(!ids(s).includes('observation:a')); assert.equal(s.excluded.find((r) => r.recordId.includes('observation:a')).reason, 'not-known');
});
test('knowledge clock reveals history without changing event cursor', () => {
  const s = value(selectTemporal(ir(), query('2026-09-06T00:00:00Z', later)));
  assert.ok(ids(s).includes('observation:a')); assert.ok(!ids(s).includes('assertion:a'));
});
test('point observation at history end is excluded, at history start is included', () => {
  assert.ok(!ids(value(selectTemporal(ir(), query(at, later)))).includes('observation:a'));
  const q = query('2026-09-06T00:00:00Z', later); q.from = timeValue(at);
  assert.ok(ids(value(selectTemporal(ir(), q))).includes('observation:a'));
});
test('event and source-specific constraint use half-open applicability', () => {
  for (const point of [start, at, later]) {
    const s = ids(value(selectTemporal(ir(), query(point, later))));
    for (const id of ['event:a', 'constraint:a']) assert.equal(s.includes(id), point === at);
  }
});
test('unknown entity never leaks through relation links or raw histories', () => {
  const source = input(); source.nodes[0].provenance.knownAt = later;
  source.nodes[0].hiddenFuture = 'must-not-appear';
  const s = value(selectTemporal(ir(source), query()));
  assert.ok(!JSON.stringify(s.ir).includes('must-not-appear'));
  assert.ok(s.omittedLinks > 0);
  const records = new Set(s.ir.records.map((r) => r.id));
  for (const r of s.ir.records) for (const l of r.links) assert.ok(records.has(l.targetId));
});
test('even eligible entity raw source detail is redacted rather than claiming nested temporal safety', () => {
  const source = input(); source.nodes[0].future = { secretForecast: 2000 };
  const full = ir(source), s = value(selectTemporal(full, query()));
  assert.ok(!JSON.stringify(s.ir).includes('secretForecast'));
  assert.equal(full.records[0].sourceRecord.future.secretForecast, 2000);
  assert.ok(Object.isFrozen(s.ir.records));
});
test('unbounded structure is explicitly context, not an assertion of currently active state', () => {
  const s = value(selectTemporal(ir(), query()));
  assert.deepEqual(s.contextOnly, [s.ir.records.find((r) => r.source.recordId === 'node:a').id]);
});
for (const q of [null, {}, { ...query(), extra: true }, { ...query(), at: timeValue('2026-09-05') },
  { ...query(), from: timeValue(later) }, { ...query(), knownAt: { precision: 'instant', value: '2026-02-30T00:00:00Z' } }]) {
  test(`malformed or ambiguous time query refused: ${JSON.stringify(q)}`, () => {
    const result = selectTemporal(ir(), q); assert.equal(result.ok, false); assert.equal('value' in result, false);
  });
}
test('conflicting provenance knownAt cannot bypass a record knownAt', () => {
  const compiled = structuredClone(ir()); compiled.records[0].provenance[0].knownAt = timeValue(later);
  assert.ok(!ids(value(selectTemporal(compiled, query()))).includes('node:a'));
});
