import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const build = process.env.GSC_BUILD_DIR;
assert.ok(build, 'Run node scripts/test-gsc.mjs');
const { compileGsv, compilePayload, CRS84 } = require(path.join(build, 'adapters.js'));
const { validateIR, inspectRecord, timeOrder, timeValue } = require(path.join(build, 'compiler.js'));
const { project, VIEW_KINDS } = require(path.join(build, 'projections.js'));
const { beginInvestigation, transitionInvestigation } = require(path.join(build, 'investigation.js'));
const { validatedState } = require(path.join(build, 'compat/gsv/validation.js'));
const bindings = () => ({ datasetId: 'fixture:compiler', snapshotId: 'snapshot:fixture', releaseId: null, runId: null, modelId: null });
const prov = () => ({ source: 'synthetic:demo', knownAt: '2026-09-01T00:00:00Z',
  validFrom: '2026-09-01T00:00:00Z', validTo: '2026-10-01T00:00:00Z', evidence: ['fixture:evidence'] });
const node = (id, lon) => ({ id, kind: 'warehouse', name: id, geometry: { type: 'Point', coordinates: [lon, 0] },
  status: 'active', provenance: prov(), importance: 0.5 });
// Bounded compiler test fixture, not the original GSV world or real facilities.
function gsv() {
  return {
    nodes: [node('node:a', 0), node('node:b', 90)],
    routes: [{ id: 'route:a-b', kind: 'route', name: 'Synthetic test route', mode: 'road',
      geometry: { type: 'LineString', coordinates: [[0, 0], [90, 0]] },
      status: 'active', provenance: prov(), importance: 0.5, originId: 'node:a', destinationId: 'node:b',
      distanceKm: 10000, estimatedDurationHours: 10, capacity: { value: 30, unit: 'loads/day' },
      utilization: 0.4, constraints: [], historicalState: [], geometryBasis: 'synthetic_corridor' }],
    commodities: [{ id: 'commodity:copper', name: 'Copper fixture', category: 'metals', unit: 't', provenance: prov() }],
    flows: [{ id: 'flow:a-b', name: 'Synthetic flow', commodityId: 'commodity:copper', originId: 'node:a', destinationId: 'node:b',
      segments: [{ id: 'segment:1', routeId: 'route:a-b', mode: 'road', fromNodeId: 'node:a', toNodeId: 'node:b', sequence: 0 }],
      intensity: 0.5, status: 'moving', provenance: prov() }],
    events: [{ id: 'event:1', name: 'Fixture event', description: 'Not a real closure', affects: ['route:a-b'],
      severity: 0.2, start: '2026-09-05T00:00:00Z', end: '2026-09-07T00:00:00Z', category: 'closure', provenance: prov() }],
    constraints: [{ id: 'constraint:1', entityId: 'route:a-b', type: 'capacity', description: 'Fixture only', severity: 0.2, provenance: prov() }],
    assertions: [{ id: 'assertion:1', entityId: 'route:a-b', metric: 'transit_hours', value: 10, unit: 'h',
      assertedAt: '2026-09-02T00:00:00Z', provenance: prov() }],
    observations: [{ id: 'observation:1', entityId: 'route:a-b', metric: 'transit_hours', value: 14, unit: 'h',
      t: '2026-09-06T00:00:00Z', provenance: { ...prov(), knownAt: '2026-09-10T00:00:00Z' } }],
    cityLights: [], timeRange: { start: '2026-09-01T00:00:00Z', end: '2026-09-30T00:00:00Z', now: '2026-09-15T00:00:00Z' },
    meta: { label: 'Compiler fixture', disclaimer: 'SYNTHETIC TEST DATA — not real shipments', generatedAt: '2026-09-15T00:00:00Z' },
  };
}
function payload() {
  return { coordinateFrame: CRS84, entities: [{ id: 'ent:mine:fixture', name: 'Compiler fixture', kind: 'mine', lat: 0, lng: 0, geoPrecision: 'country' }],
    observations: [{ id: 'obs:fixture', entityId: 'ent:mine:fixture', metric: 'production', value: 100, unit: 'kt/y',
      period: { start: '2025-01-01', end: '2025-12-31' }, knownAt: '2026-01-31', basis: 'metal_content',
      valueKind: 'representative', confidence: 'low', provenance: { sourceId: 'synthetic:compiler-fixture', sourceName: 'Test fixture',
        retrievedAt: '2026-02-03T12:00:00Z', sourceRef: 'fixture:row-1', artifactId: 'fixture:artifact' } }] };
}
function value(result) { assert.equal(result.ok, true, JSON.stringify(result.diagnostics)); return result.value; }
function refused(result, code) {
  assert.equal(result.ok, false); assert.equal('value' in result, false);
  if (code) assert.ok(result.diagnostics.some((d) => d.code === code), JSON.stringify(result.diagnostics));
}
const compiledGsv = () => value(compileGsv(gsv(), 'compile:fixture', bindings()));

test('both source contracts compile through the same real validation passes', () => {
  for (const [fn, source] of [[compileGsv, gsv()], [compilePayload, payload()]]) {
    const result = fn(source, 'compile:fixture', bindings()); value(result);
    assert.deepEqual(result.passes.slice(-5), ['gsc.identity.v1', 'gsc.temporal.v1', 'gsc.quantity.v1', 'gsc.geometry.v1', 'gsc.provenance.v1']);
    for (const kind of VIEW_KINDS) assert.equal(value(project(result.value, kind)).kind, kind);
  }
});
test('synthetic observation and assertion stay distinct without overwriting their values', () => {
  const ir = compiledGsv();
  const observation = ir.records.find((r) => r.role === 'observation');
  const assertion = ir.records.find((r) => r.role === 'assertion');
  assert.equal(observation.valueKind, 'synthetic'); assert.equal(assertion.valueKind, 'synthetic');
  assert.equal(observation.quantity.value, 14); assert.equal(assertion.quantity.value, 10);
  assert.notEqual(observation.id, observation.source.recordId);
});
test('knowledge time, event time, validity and source evidence survive compilation', () => {
  const observation = compiledGsv().records.find((r) => r.role === 'observation');
  assert.equal(observation.eventTime.value, '2026-09-06T00:00:00Z');
  assert.equal(observation.knownAt.value, '2026-09-10T00:00:00Z');
  assert.equal(observation.validity.end, 'exclusive');
  assert.deepEqual(observation.provenance[0].evidenceIds, ['fixture:evidence']);
});
test('full source detail survives; IR is detached and deeply immutable', () => {
  const source = gsv(); const original = structuredClone(source);
  const ir = value(compileGsv(source, 'compile:fixture', bindings()));
  assert.deepEqual(source, original);
  assert.deepEqual(ir.records.find((r) => r.role === 'observation').sourceRecord, source.observations[0]);
  source.observations[0].value = 999; source.nodes[0].geometry.coordinates[0] = 34;
  assert.equal(ir.records.find((r) => r.role === 'observation').quantity.value, 14);
  assert.equal(ir.records[0].geometry.shape.coordinates[0], 0);
  assert.throws(() => { ir.records[0].geometry.shape.coordinates[0] = 50; }, TypeError);
  assert.throws(() => { ir.records[0].sourceRecord.name = 'overwrite'; }, TypeError);
});
test('deterministic compile has no wall clock or random identity', () => {
  assert.deepEqual(compileGsv(gsv(), 'compile:fixture', bindings()), compileGsv(gsv(), 'compile:fixture', bindings()));
});
test('Payload reported and representative values are not falsely relabelled observed/synthetic', () => {
  for (const kind of ['reported', 'representative', 'estimated', 'derived']) {
    const source = payload(); source.observations[0].valueKind = kind;
    assert.equal(value(compilePayload(source, 'compile:fixture', bindings())).records[1].valueKind, kind);
  }
});
test('Payload date precision and inclusive periods are retained without midnight fabrication', () => {
  const r = value(compilePayload(payload(), 'compile:fixture', bindings())).records[1];
  assert.deepEqual(r.knownAt, { precision: 'date', value: '2026-01-31' });
  assert.equal(r.period.end, 'inclusive'); assert.equal(r.period.from.precision, 'date');
  assert.equal(r.quantity.basis, 'metal_content'); assert.equal(r.quantity.unit, 'kt/y');
});
test('retrieval fallback has an explicit upper-bound basis, not an invented publication date', () => {
  const source = payload(); delete source.observations[0].knownAt;
  const r = value(compilePayload(source, 'compile:fixture', bindings())).records[1];
  assert.equal(r.knownAt.value, source.observations[0].provenance.retrievedAt);
  assert.equal(r.knownAtBasis, 'retrieval-upper-bound');
});
test('missing entity provenance/time is visible; never copied from its observation', () => {
  const result = compilePayload(payload(), 'compile:fixture', bindings());
  const entity = value(result).records[0];
  assert.deepEqual(entity.provenance, []); assert.equal(entity.knownAt, null);
  assert.ok(result.diagnostics.some((d) => d.code === 'MISSING_PROVENANCE'));
  assert.ok(result.diagnostics.some((d) => d.code === 'MISSING_KNOWLEDGE_TIME'));
});
test('missing unit and uncertainty do not become dimensionless values or zero variance', () => {
  const source = gsv(); delete source.observations[0].unit;
  const result = compileGsv(source, 'compile:fixture', bindings());
  const observation = value(result).records.find((r) => r.role === 'observation');
  assert.equal(observation.quantity.unit, null); assert.deepEqual(observation.uncertaintyRefs, []);
  assert.ok(result.diagnostics.some((d) => d.code === 'MISSING_UNIT'));
});
test('Payload coordinates require an explicit producer frame', () => {
  const source = payload(); delete source.coordinateFrame;
  const result = compilePayload(source, 'compile:fixture', bindings());
  assert.equal(value(result).records[0].geometry, null);
  assert.ok(result.diagnostics.some((d) => d.code === 'FRAME_MISMATCH'));
});
test('geographic precision and original geometry basis survive inspection and emission', () => {
  const ir = compiledGsv(); const map = value(project(ir, 'geojson'));
  assert.equal(map.features.find((f) => f.properties.sourceRecordId === 'route:a-b').properties.geometryBasis, 'synthetic_corridor');
  assert.equal(value(compilePayload(payload(), 'compile:fixture', bindings())).records[0].sourceRecord.geoPrecision, 'country');
});
test('missing geometry remains absent; flows are not fabricated as endpoint lines', () => {
  const map = value(project(compiledGsv(), 'geojson'));
  assert.equal(map.features.length, 3); assert.equal(map.omitted.length, 2);
});
test('unit-sphere axes match GSV and are not labelled geodetic/ECEF coordinates', () => {
  const sphere = value(project(compiledGsv(), 'unit-sphere'));
  assert.equal(sphere.frame, 'gsv.unit-sphere-display.v1');
  const a = sphere.items[0].vertices[0], b = sphere.items[1].vertices[0];
  assert.ok(Math.abs(a[0] - 1) < 1e-12); assert.ok(Math.abs(a[1]) < 1e-12);
  assert.ok(Math.abs(b[2] + 1) < 1e-12); assert.ok(Math.abs(b[0]) < 1e-12);
  for (const item of sphere.items) for (const v of item.vertices) assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-12);
});
test('unsupported CRS stays inspectable but cannot silently enter a geographic backend', () => {
  const ir = structuredClone(compiledGsv()); ir.records[0].geometry.frame.reference = 'EPSG:3857';
  const result = project(ir, 'geojson'); value(result);
  assert.ok(result.diagnostics.some((d) => d.code === 'UNSUPPORTED_CRS'));
  assert.ok(result.value.omitted.includes(ir.records[0].id));
});
test('relations and all outputs preserve exact bindings and source trace', () => {
  const ir = compiledGsv();
  for (const kind of VIEW_KINDS) {
    const p = value(project(ir, kind)); assert.deepEqual(p.bindings, ir.bindings); assert.equal(p.compilationId, ir.compilationId);
  }
  const relations = value(project(ir, 'relations'));
  assert.ok(relations.edges.some((e) => e.predicate === 'segment:0:route'));
  const id = value(project(ir, 'geojson')).features[0].properties.recordId;
  assert.equal(value(inspectRecord(ir, id)).source.recordId, 'node:a');
});
test('selection and two independent clocks survive view switching', () => {
  const ir = compiledGsv(); let state = value(beginInvestigation(ir));
  state = value(transitionInvestigation(ir, state, { type: 'select', value: ir.records[0].id }));
  state = value(transitionInvestigation(ir, state, { type: 'eventCursor', value: '2026-09-06T00:00:00Z' }));
  state = value(transitionInvestigation(ir, state, { type: 'knowledgeCutoff', value: '2026-09-10T00:00:00Z' }));
  const before = state;
  for (const kind of VIEW_KINDS) {
    state = value(transitionInvestigation(ir, state, { type: 'view', value: kind }));
    assert.equal(state.selectedRecordId, before.selectedRecordId); assert.deepEqual(state.bindings, before.bindings);
    assert.deepEqual(state.eventCursor, before.eventCursor); assert.deepEqual(state.knowledgeCutoff, before.knowledgeCutoff);
  }
});
for (const command of [{ type: 'select', value: 'missing' }, { type: 'view', value: 'solver' },
  { type: 'execute', value: true }, { type: 'view', value: 'table', authorize: true },
  { type: 'eventCursor', value: '2026-02-30T00:00:00Z' }]) {
  test(`invalid view command leaves the prior state unchanged: ${JSON.stringify(command)}`, () => {
    const ir = compiledGsv(); const state = value(beginInvestigation(ir)); const copy = structuredClone(state);
    refused(transitionInvestigation(ir, state, command)); assert.deepEqual(state, copy);
  });
}
test('cross-release, cross-dataset and cross-compilation selection is refused', () => {
  const ir = compiledGsv(); const state = value(beginInvestigation(ir));
  for (const key of ['datasetId', 'snapshotId', 'releaseId', 'runId', 'modelId']) {
    const changed = structuredClone(state); changed.bindings[key] = 'different';
    refused(transitionInvestigation(ir, changed, { type: 'view', value: 'table' }), 'BINDING_MISMATCH');
  }
  refused(transitionInvestigation(ir, { ...state, compilationId: 'different' }, { type: 'view', value: 'table' }), 'BINDING_MISMATCH');
});
for (const [name, mutate] of [
  ['duplicate record', (s) => s.nodes.push(structuredClone(s.nodes[0]))],
  ['unresolved route endpoint', (s) => { s.routes[0].originId = 'missing'; }],
  ['latitude outside bounds', (s) => { s.nodes[0].geometry.coordinates[1] = 91; }],
  ['nonfinite scalar', (s) => { s.observations[0].value = Infinity; }],
  ['invalid calendar day', (s) => { s.observations[0].t = '2026-02-30T00:00:00Z'; }],
  ['reversed validity', (s) => { s.nodes[0].provenance.validTo = '2026-08-01T00:00:00Z'; }],
  ['empty source', (s) => { s.nodes[0].provenance.source = ''; }],
  ['wrong segment mode', (s) => { s.flows[0].segments[0].mode = 'air'; }],
  ['wrong segment order', (s) => { s.flows[0].segments[0].sequence = 1; }],
  ['wrong segment endpoints', (s) => { s.flows[0].segments[0].toNodeId = 'node:a'; }],
  ['nested identity collision', (s) => { s.flows[0].segments[0].id = 'node:a'; }],
  ['sparse array', (s) => { s.cityLights = new Array(2); }],
  ['function', (s) => { s.extension = () => 1; }],
  ['cycle', (s) => { s.extension = s; }],
  ['symbol', (s) => { s[Symbol('hidden')] = 1; }],
]) test(`preserved GSV boundary refuses ${name}`, () => {
  const source = gsv(); mutate(source); refused(compileGsv(source, 'compile:fixture', bindings()));
});
test('source accessors are rejected without invoking them', () => {
  const source = gsv(); let invoked = false;
  Object.defineProperty(source, 'nodes', { enumerable: true, get() { invoked = true; throw Error('getter ran'); } });
  refused(compileGsv(source, 'compile:fixture', bindings())); assert.equal(invoked, false);
});
for (const [name, mutate] of [
  ['extra domain collection', (s) => { s.flows = []; }],
  ['duplicate entity', (s) => { s.entities.push(structuredClone(s.entities[0])); }],
  ['unknown subject', (s) => { s.observations[0].entityId = 'missing'; }],
  ['partial coordinates', (s) => { delete s.entities[0].lat; }],
  ['reversed period', (s) => { s.observations[0].period.start = '2026-01-01'; }],
  ['blank unit', (s) => { s.observations[0].unit = ' '; }],
  ['unknown classification', (s) => { s.observations[0].valueKind = 'observed'; }],
]) test(`Payload projection refuses ${name}`, () => {
  const source = payload(); mutate(source); refused(compilePayload(source, 'compile:fixture', bindings()));
});
for (const [name, mutate, code] of [
  ['unknown reference', (ir) => { ir.records[0].links = [{ predicate: 'x', targetId: 'missing' }]; }, 'UNBOUND_IDENTITY'],
  ['swapped axes', (ir) => { ir.records[0].geometry.frame.axes = ['latitude', 'longitude']; }, 'FRAME_MISMATCH'],
  ['wrong angular unit', (ir) => { ir.records[0].geometry.frame.unit = 'radian'; }, 'FRAME_MISMATCH'],
  ['changed source ID', (ir) => { ir.records[0].sourceRecord.id = 'another'; }, 'BINDING_MISMATCH'],
  ['wrong date precision', (ir) => { ir.records[0].knownAt.precision = 'date'; }, 'INVALID_TIME'],
  ['invented knowledge basis', (ir) => { ir.records[0].knownAtBasis = 'unavailable'; }, 'INVALID_TIME'],
  ['missing observation provenance', (ir) => { ir.records.find((r) => r.role === 'observation').provenance = []; }, 'MISSING_PROVENANCE'],
]) test(`IR pass refuses ${name}`, () => {
  const ir = structuredClone(compiledGsv()); mutate(ir); refused(validateIR(ir), code);
});
test('time comparator is precision-explicit and handles equivalent UTC spellings', () => {
  assert.equal(timeOrder(timeValue('2026-01-01T00:00:00Z'), timeValue('2026-01-01T00:00:00.000Z')), 0);
  assert.throws(() => timeOrder(timeValue('2026-01-01'), timeValue('2026-01-01T00:00:00Z')));
  assert.throws(() => timeValue('2025-02-29'));
  assert.deepEqual(timeValue('2024-02-29'), { precision: 'date', value: '2024-02-29' });
});
test('inherited dynamic-state validation retains exact identity and event eligibility', () => {
  const source = gsv(); const events = new Map(source.events.map((event) => [event.id, event]));
  const state = { entityId: 'route:a-b', t: '2026-09-06T00:00:00Z', utilization: 0.4, congestion: 0.1,
    status: 'active', activeEventIds: ['event:1'] };
  assert.equal(validatedState(state, state.entityId, state.t, events).entityId, state.entityId);
  assert.throws(() => validatedState(state, 'node:a', state.t, events));
  assert.throws(() => validatedState({ ...state, t: '2026-09-07T00:00:00Z' }, state.entityId, '2026-09-07T00:00:00Z', events));
});
test('Payload adapter refuses implicit CRS conversion, even for empty data', () => {
  for (const source of [payload(), { entities: [], observations: [] }]) {
    source.coordinateFrame = { reference: 'EPSG:3857', axes: ['x', 'y'], unit: 'm' };
    refused(compilePayload(source, 'compile:fixture', bindings()), 'UNSUPPORTED_CRS');
  }
});
test('unknown backend arguments return a diagnostic rather than stringifying arbitrary objects', () => {
  const ir = compiledGsv();
  for (const kind of [null, Symbol('not-a-view'), {}, 'solver']) refused(project(ir, kind), 'UNSUPPORTED_REPRESENTATION');
});
test('unit-sphere north pole is positive Y', () => {
  const source = gsv(); source.nodes[0].geometry.coordinates = [0, 90];
  const sphere = value(project(value(compileGsv(source, 'compile:fixture', bindings())), 'unit-sphere'));
  assert.ok(Math.abs(sphere.items[0].vertices[0][1] - 1) < 1e-12);
});
