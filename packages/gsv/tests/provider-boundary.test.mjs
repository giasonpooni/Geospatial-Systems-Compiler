import assert from 'node:assert/strict';
import test from 'node:test';
import { WorldStore } from '../src/data/store.ts';
import { instant, validatedSnapshot } from '../src/data/validation.ts';
import { SyntheticProvider } from '../src/data/synthetic/provider.ts';
import { buildWorldSnapshot } from '../src/data/synthetic/world.ts';

const start = '2026-09-01T00:00:00Z', end = '2026-09-10T00:00:00Z';
const now = '2026-09-05T00:00:00Z';
const provenance = () => ({ source: 'test:source', knownAt: start });
const node = (id) => ({ id, kind: 'warehouse', name: id, geometry: { type: 'Point', coordinates: [0, 0] },
  status: 'active', importance: 0.5, provenance: provenance() });
function fixture() {
  return { nodes: [node('node:a'), node('node:b')], routes: [{ id: 'route:a-b', kind: 'route', name: 'route',
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, status: 'active', importance: 0.5,
    provenance: provenance(), mode: 'road', originId: 'node:a', destinationId: 'node:b', distanceKm: 5,
    estimatedDurationHours: 1, capacity: { value: 1, unit: 'loads/day' }, utilization: 0.5,
    constraints: [], historicalState: [] }],
  flows: [{ id: 'flow:a', name: 'flow', commodityId: 'commodity:a', originId: 'node:a', destinationId: 'node:b',
    intensity: 0.5, status: 'moving', provenance: provenance(), segments: [{ id: 'segment:a', routeId: 'route:a-b',
      mode: 'road', fromNodeId: 'node:a', toNodeId: 'node:b', sequence: 0 }] }],
  commodities: [{ id: 'commodity:a', name: 'load', category: 'machinery', unit: 'load', provenance: provenance() }],
  events: [{ id: 'event:a', name: 'test', description: 'test', affects: ['route:a-b'], severity: 0.5,
    start, end, category: 'congestion', provenance: provenance() }], constraints: [],
  assertions: [{ id: 'assertion:a', entityId: 'route:a-b', metric: 'duration', value: 1, unit: 'h',
    assertedAt: start, provenance: { ...provenance(), validFrom: start, validTo: end } }],
  observations: [{ id: 'observation:a', entityId: 'route:a-b', metric: 'duration', value: 2, unit: 'h',
    t: '2026-09-03T00:00:00Z', provenance: provenance() }],
  cityLights: [], timeRange: { start, end, now }, meta: { label: 'test', disclaimer: 'Synthetic test', generatedAt: now } };
}
function provider(snapshot, resolve = (entityId, t) => ({ entityId, t, utilization: 0.25,
  congestion: 0.25, status: 'active', activeEventIds: [] })) {
  return { id: 'test:provider', label: 'test', load: async () => snapshot, stateAt: resolve };
}
const selection = { knownAt: now, from: start, to: now };
async function comparison(snapshot) {
  const store = new WorldStore(); await store.init(provider(snapshot)); return store.deviationsFor('route:a-b', selection)[0];
}

test('real synthetic provider snapshot and sampled state remain valid', async () => {
  const store = new WorldStore(), source = new SyntheticProvider();
  const snapshot = await store.init(source);
  assert.equal(snapshot.nodes.length, 114); assert.equal(snapshot.routes.length, 55);
  for (const t of Object.values(snapshot.timeRange)) for (const r of snapshot.routes) {
    assert.equal(store.stateAt(r.id, t).entityId, r.id);
  }
  assert.deepEqual(snapshot, buildWorldSnapshot());
});

test('replacement clears every old index and repeated hydration never duplicates joins', async () => {
  const store = new WorldStore(), initial = fixture();
  await store.init(provider(initial)); await store.init(provider(initial));
  assert.equal(store.routesOfNode('node:a').length, 1);
  assert.equal(store.flowsThroughRoute('route:a-b').length, 1);
  assert.equal(store.deviationsFor('route:a-b', selection).length, 1);
  const empty = { ...fixture(), nodes: [], routes: [], flows: [], commodities: [], events: [], constraints: [], assertions: [], observations: [] };
  await store.init(provider(empty));
  for (const id of ['node:a', 'route:a-b', 'flow:a']) assert.equal(store.entity(id), undefined);
  assert.equal(store.commodity('commodity:a'), undefined);
  assert.deepEqual(store.routesOfNode('node:a'), []); assert.deepEqual(store.flowsThroughRoute('route:a-b'), []);
});

test('failed load/validation retains old snapshot, indexes and provider atomically', async () => {
  const store = new WorldStore(); const original = await store.init(provider(fixture()));
  const bad = fixture(); bad.nodes[0].geometry.coordinates[0] = NaN;
  await assert.rejects(store.init(provider(bad)), /Invalid provider/);
  await assert.rejects(store.init({ ...provider(fixture()), load: async () => { throw new Error('offline'); } }), /offline/);
  assert.strictEqual(store.snapshot, original); assert.equal(store.node('node:a').name, 'node:a');
  assert.equal(store.stateAt('node:a', now).utilization, 0.25);
});

test('older pending load cannot overwrite later provider selection', async () => {
  const store = new WorldStore(); let resolveFirst;
  const first = store.init({ ...provider(fixture()), load: () => new Promise((resolve) => { resolveFirst = resolve; }) });
  const second = fixture(); second.nodes[0].name = 'second';
  await store.init(provider(second)); resolveFirst(fixture());
  await assert.rejects(first, /superseded/); assert.equal(store.node('node:a').name, 'second');
});

test('snapshot and returned index arrays are detached and deeply immutable', async () => {
  const source = fixture(), store = new WorldStore(); const snapshot = await store.init(provider(source));
  source.nodes[0].name = 'tampered'; source.routes.length = 0;
  assert.equal(store.node('node:a').name, 'node:a'); assert.equal(snapshot.routes.length, 1);
  assert.throws(() => { snapshot.nodes[0].geometry.coordinates[0] = 9; }, TypeError);
  assert.throws(() => { store.routesOfNode('node:a').pop(); }, TypeError);
  assert.throws(() => { store.snapshot.nodes.push(node('node:c')); }, TypeError);
});

for (const [name, mutate] of [
  ['nonfinite coordinate', (s) => { s.nodes[0].geometry.coordinates[0] = Infinity; }],
  ['out-of-range longitude', (s) => { s.nodes[0].geometry.coordinates[0] = 181; }],
  ['wrong geometry', (s) => { s.nodes[0].geometry.type = 'Mesh'; }],
  ['string measurement', (s) => { s.observations[0].value = '2'; }],
  ['duplicate global identity', (s) => { s.observations[0].id = s.nodes[0].id; }],
  ['duplicate nested identity', (s) => { s.flows[0].segments[0].id = s.nodes[0].id; }],
  ['missing node reference', (s) => { s.routes[0].originId = 'node:absent'; }],
  ['wrong reference kind', (s) => { s.observations[0].entityId = 'commodity:a'; }],
  ['missing commodity reference', (s) => { s.flows[0].commodityId = 'commodity:absent'; }],
  ['wrong whole-route endpoint', (s) => { s.flows[0].segments[0].toNodeId = 'node:a'; }],
  ['segment sequence', (s) => { s.flows[0].segments[0].sequence = 1; }],
  ['unknown mode', (s) => { s.routes[0].mode = 'teleport'; }],
  ['invalid boolean', (s) => { s.routes[0].bidirectional = 'false'; }],
  ['whitespace unit', (s) => { s.routes[0].capacity.unit = ' '; }],
  ['confidence range', (s) => { s.nodes[0].provenance.confidence = 2; }],
  ['date rollover', (s) => { s.observations[0].t = '2026-02-30T00:00:00Z'; }],
  ['ambiguous local time', (s) => { s.observations[0].t = '2026-09-03T00:00:00'; }],
  ['reversed validity', (s) => { s.assertions[0].provenance.validTo = start; }],
  ['range reversal', (s) => { s.timeRange.end = start; }],
  ['sparse array', (s) => { delete s.nodes[0]; }],
  ['sparse array hidden by extra key', (s) => { delete s.nodes[0]; s.nodes.other = node('node:other'); }],
  ['cyclic input', (s) => { s.extra = s; }],
  ['getter input', (s) => { Object.defineProperty(s.nodes[0], 'name', { get() { throw new Error('must not execute'); } }); }],
  ['oversized array', (s) => { s.cityLights = Array.from({ length: 10001 }, () => [0, 0, 0]); }],
]) test(`provider validation rejects ${name}`, () => {
  const s = fixture(); mutate(s); assert.throws(() => validatedSnapshot(s), /Invalid provider data/);
});

test('state requests and responses bind entity, UTC instant and event applicability', async () => {
  let calls = 0;
  const store = new WorldStore();
  await store.init(provider(fixture(), (entityId, t) => { calls++; return { entityId, t, utilization: 0.5, congestion: 0, status: 'active', activeEventIds: [] }; }));
  assert.throws(() => store.stateAt('missing', now), /Unknown entity/);
  assert.throws(() => store.stateAt('node:a', 'bad'), /Invalid provider/);
  assert.throws(() => store.stateAt('node:a', '2027-01-01T00:00:00Z'), /outside/);
  assert.equal(calls, 0);
  for (const mutation of [
    (s) => { s.entityId = 'node:b'; }, (s) => { s.t = start; },
    (s) => { s.utilization = NaN; }, (s) => { s.activeEventIds = ['missing']; },
    (s) => { s.activeEventIds = ['event:a']; },
  ]) {
    await store.init(provider(fixture(), (entityId, t) => { const s = { entityId, t, utilization: 0.5, congestion: 0, status: 'active', activeEventIds: [] }; mutation(s); return s; }));
    assert.throws(() => store.stateAt('node:a', now), /Invalid provider/);
  }
  await store.init(provider(fixture(), (entityId, t) => ({ entityId, t, utilization: 0.5, congestion: 0,
    status: 'active', activeEventIds: ['event:a'] })));
  assert.equal(store.stateAt('route:a-b', now).activeEventIds[0], 'event:a');
  assert.throws(() => store.stateAt('route:a-b', end), /event entity\/time/);
});

test('unknown synthetic identities, malformed dates and out-of-range time refuse', () => {
  const p = new SyntheticProvider();
  assert.throws(() => p.stateAt('missing', '2026-08-31T14:00:00Z'), /Unknown/);
  assert.throws(() => p.stateAt('route:sea-shanghai-la', 'not-a-date'), /Invalid provider/);
  assert.throws(() => p.stateAt('route:sea-shanghai-la', '2027-01-01T00:00:00Z'), /outside/);
});

test('deviation keeps complete lineage and explicit no-independence claim', async () => {
  const source = fixture(); source.observations.push({ ...source.observations[0], id: 'observation:b', value: 4,
    t: '2026-09-04T00:00:00Z', provenance: { ...provenance(), source: 'test:second' } });
  const d = await comparison(source);
  assert.equal(d.status, 'ready'); assert.equal(d.meanObserved, 3); assert.equal(d.deviation.delta, 2);
  assert.deepEqual(d.deviation.observationIds, ['observation:a', 'observation:b']);
  assert.equal(d.deviation.observationId, 'observation:b');
  assert.deepEqual(d.comparison.sources, ['test:source', 'test:second']);
  assert.equal(d.comparison.independence, 'not_established'); assert.equal(d.comparison.interval, '[from,to)');
  assert.throws(() => { d.observations.pop(); }, TypeError);
});

for (const [reason, mutate] of [
  ['UNIT_MISMATCH', (s) => { s.observations[0].value = 3600; s.observations[0].unit = 's'; }],
  ['ASSERTION_UNIT_UNDECLARED', (s) => { delete s.assertions[0].unit; delete s.observations[0].unit; }],
  ['OBSERVATION_UNIT_UNDECLARED', (s) => { delete s.observations[0].unit; }],
  ['ASSERTION_VALIDITY_UNDECLARED', (s) => { delete s.assertions[0].provenance.validTo; }],
  ['ASSERTION_NOT_KNOWN', (s) => { s.assertions[0].provenance.knownAt = end; }],
  ['OBSERVATION_NOT_KNOWN', (s) => { s.observations[0].provenance.knownAt = end; }],
  ['OUTSIDE_ANALYSIS_WINDOW', (s) => { s.observations[0].t = now; }],
  ['OUTSIDE_ASSERTION_VALIDITY', (s) => { s.assertions[0].provenance.validTo = s.observations[0].t; }],
  ['OUTSIDE_OBSERVATION_VALIDITY', (s) => { s.observations[0].provenance.validTo = s.observations[0].t; }],
  ['BEFORE_ASSERTION', (s) => { s.assertions[0].assertedAt = '2026-09-04T00:00:00Z'; }],
]) test(`deviation excludes ${reason} without inventing an aggregate`, async () => {
  const s = fixture(); mutate(s); const d = await comparison(s);
  assert.equal(d.status, 'unavailable'); assert.equal(d.meanObserved, null); assert.equal(d.deviation, null);
  assert.deepEqual(d.excluded, [{ observationId: 'observation:a', reason }]);
});

test('analysis interval is half-open and both clocks must be real UTC instants', async () => {
  const source = fixture(); source.observations[0].t = start;
  const store = new WorldStore(); await store.init(provider(source));
  assert.equal(store.deviationsFor('route:a-b', selection)[0].observations.length, 1);
  for (const bad of [{ ...selection, to: start }, { ...selection, knownAt: '2026-02-30T00:00:00Z' },
    { ...selection, from: '2026-08-31T00:00:00Z' }]) assert.throws(() => store.deviationsFor('route:a-b', bad));
  assert.equal(instant('2024-02-29T00:00:00Z'), Date.parse('2024-02-29T00:00:00Z'));
});

test('zero assertion yields undefined ratio and overflow refuses computation', async () => {
  const s = fixture(); s.assertions[0].value = 0;
  const d = await comparison(s); assert.equal(d.deviation.ratio, null); assert.equal(d.deviation.delta, 2);
  s.assertions[0].value = -Number.MAX_VALUE; s.observations[0].value = Number.MAX_VALUE;
  const overflow = await comparison(s); assert.equal(overflow.status, 'unavailable'); assert.equal(overflow.reason, 'NONFINITE_AGGREGATE');
});

test('no observations is unavailable, not zero and not an empty claim of accuracy', async () => {
  const s = fixture(); s.observations = []; const d = await comparison(s);
  assert.equal(d.status, 'unavailable'); assert.equal(d.meanObserved, null);
  assert.equal(d.reason, 'NO_COMPATIBLE_OBSERVATIONS');
});
