/** Same hermetic cases run under Vitest and node:test. Case lists are function-local. */
import assert from 'node:assert/strict';
import { SceneError, LANDSAT_COLLECTION, LANDSAT_SOURCE, MAX_SNAPSHOT_BYTES,
  parseSceneQuery, utcNanos, makeSnapshotReceipt, inspectSceneSnapshot, type SceneQuery } from './stacScenes';
import { collectLandsatSnapshot, landsatSearchUrl, CatalogError } from './landsatCatalog';
import { SOURCE_REGISTRY } from '../economy/sourceRegistry';

export const queryFixture = (): SceneQuery => ({ schemaVersion: 'rs.scene.query.v1',
  aoi: { crs: 'OGC:CRS84', bbox: [-80.25, 42.95, -78.5, 44.5] },
  interval: { start: '2025-07-01T00:00:00Z', end: '2025-07-31T23:59:59Z' },
  maxCloudCoverPercent: 30, knownAtOrBefore: null, limit: 10 });
export function sceneFixture(id = 'synthetic-clear'): Record<string, any> {
  return { type: 'Feature', id, collection: LANDSAT_COLLECTION, stac_version: '1.0.0', stac_extensions: [], links: [],
    bbox: [-80, 43, -79, 44], geometry: { type: 'Polygon', coordinates: [[[-80, 43], [-79, 43], [-79, 44], [-80, 44], [-80, 43]]] },
    properties: { datetime: '2025-07-14T15:42:49.236576Z', platform: 'LANDSAT_9', 'eo:cloud_cover': 5, gsd: 30, 'proj:epsg': 32617 },
    assets: { red: { href: 'https://example.invalid/DO-NOT-FETCH.tif',
      type: 'image/tiff; application=geotiff; profile=cloud-optimized', 'eo:bands': [{ common_name: 'red' }] } } };
}
const pageFixture = (features: unknown[] = [sceneFixture()]) => ({ type: 'FeatureCollection', features, links: [] as unknown[] });
const bytesOf = (x: unknown) => new TextEncoder().encode(JSON.stringify(x));
const receiptFor = (bytes: Uint8Array, q = queryFixture()) => makeSnapshotReceipt(bytes, q, '2026-01-02T00:00:00Z', 'synthetic');
const inspect = (features = [sceneFixture()], q = queryFixture()) => {
  const bytes = bytesOf(pageFixture(features)); return inspectSceneSnapshot(bytes, receiptFor(bytes, q), q, 'run:test');
};
const code = (fn: () => unknown, expected: string) => assert.throws(fn, (e: unknown) => e instanceof SceneError && e.code === expected);
const rowCode = (scene: Record<string, any>, expected: string) => {
  const r = inspect([scene]); assert.equal(r.accounting.rejected, 1); assert.equal(r.rowDecisions[0].reason, expected);
};
export function sceneCases(): readonly { name: string; run: () => void | Promise<void> }[] {
  const cases: { name: string; run: () => void | Promise<void> }[] = [];
  const test = (name: string, run: () => void | Promise<void>) => cases.push({ name, run });
  test('scene metadata projects only an envelope with no pixel/authority claims', () => {
    const r = inspect(); assert.equal(r.accounting.selected, 1); assert.equal(r.geojson.features[0].properties.geometryBasis, 'STAC_BBOX_ENVELOPE');
    assert.equal(r.limits.pixelsRead, 0); assert.equal(r.limits.aoiPixelCoverage, null); assert.equal(r.limits.admission, 'NOT_PERFORMED');
    assert.equal(r.limits.confidence, null); assert.equal(r.limits.originVerification, 'NOT_PERFORMED');
    assert.equal(r.scenes[0].groundSampleDistanceMeters, 30); assert.equal(r.limits.positionalAccuracyMeters, null);
  });
  test('nanosecond comparisons preserve precision and leap-day validation', () => {
    assert.equal(utcNanos('2024-02-29T00:00:00.123456789Z') - utcNanos('2024-02-29T00:00:00.123456788Z'), BigInt(1));
    code(() => utcNanos('2025-02-29T00:00:00Z'), 'INVALID_TIME');
  });
  for (const t of ['2025-02-30T00:00:00Z', '2025-07-01', '2025-07-01T24:00:00Z', '2025-07-01T00:00:00+03:00', '2025-07-01T00:00:60Z', '2025-07-01T00:00:00.1234567890Z'])
    test(`refuse unsupported UTC value ${t}`, () => code(() => utcNanos(t), 'INVALID_TIME'));
  test('strict query excludes person fields and request-controlled sources', () => {
    for (const extra of [{ person: 'private' }, { url: 'https://example.invalid' }, { sourceId: 'anything' }, { mode: 'operational' }])
      code(() => parseSceneQuery({ ...queryFixture(), ...extra }), 'INVALID_QUERY');
  });
  test('axis order must be explicit CRS84, not guessed from an EPSG code', () => {
    const q = queryFixture(); (q.aoi as any).crs = 'EPSG:4326'; code(() => parseSceneQuery(q), 'UNSUPPORTED_CRS');
  });
  for (const box of [[0, 0, 0, 1], [0, 2, 1, 1], [-181, 0, -180, 1], [0, 0, 1, 91], [0, 0, NaN, 1], [0, 0, 1, 1, 2, 2]])
    test(`invalid query bbox ${String(box)}`, () => code(() => parseSceneQuery({ ...queryFixture(), aoi: { crs: 'OGC:CRS84', bbox: box } }), 'INVALID_BBOX'));
  for (const box of [[170, 0, -170, 1], [-170, 0, 170, 1]])
    test(`dateline requires a separate operator ${String(box)}`, () => code(() => parseSceneQuery({ ...queryFixture(), aoi: { crs: 'OGC:CRS84', bbox: box } }), 'DATELINE_UNSUPPORTED'));
  for (const limit of [0, 51, 1.1, '10']) test(`bounded page limit ${limit}`, () => code(() => parseSceneQuery({ ...queryFixture(), limit }), 'INVALID_QUERY'));
  test('reversed query time refused', () => { const q = queryFixture(); q.interval.end = q.interval.start; code(() => parseSceneQuery(q), 'INVALID_TIME'); });
  test('snapshot bytes and receipt digest are bound before parsing', () => {
    const b = bytesOf(pageFixture()), receipt = receiptFor(b); const changed = new Uint8Array([...b, 32]);
    code(() => inspectSceneSnapshot(changed, receipt, queryFixture(), 'run:test'), 'SNAPSHOT_HASH_MISMATCH');
  });
  test('receipt cannot claim another source', () => {
    const b = bytesOf(pageFixture()); const receipt = receiptFor(b); receipt.sourceId = 'person-feed';
    code(() => inspectSceneSnapshot(b, receipt, queryFixture(), 'run:test'), 'SOURCE_NOT_ELIGIBLE');
  });
  test('changing AOI/filter/query after acquisition does not silently rebind scope', () => {
    const b = bytesOf(pageFixture()), receipt = receiptFor(b), q = queryFixture(); q.maxCloudCoverPercent = 10;
    code(() => inspectSceneSnapshot(b, receipt, q, 'run:test'), 'QUERY_BINDING_MISMATCH');
  });
  test('operational source must remain eligible in the original registry', () => {
    const s = SOURCE_REGISTRY.find(s => s.sourceId === LANDSAT_SOURCE)!; assert.ok(s); const access = s.accessClass;
    try { s.accessClass = 'blocked'; code(() => makeSnapshotReceipt(bytesOf(pageFixture()), queryFixture(), '2026-01-02T00:00:00Z', 'operational'), 'SOURCE_NOT_ELIGIBLE'); }
    finally { s.accessClass = access; }
  });
  test('invalid source metadata never echoes raw identifiers or fields', () => {
    const s = sceneFixture('PRIVATE_ID'); s.collection = 'person-feed'; s.properties.raw = 'PRIVATE_PAYLOAD';
    const r = inspect([s]); assert.equal(r.rowDecisions[0].reason, 'WRONG_COLLECTION');
    assert.ok(!JSON.stringify(r).includes('PRIVATE_ID')); assert.ok(!JSON.stringify(r).includes('PRIVATE_PAYLOAD'));
  });
  test('unprojected descriptions and hrefs are not copied into valid output', () => {
    const s = sceneFixture(); s.properties.description = 'PRIVATE_TEXT'; s.assets.red.href = 'https://example.invalid/?token=PRIVATE_TOKEN';
    const r = JSON.stringify(inspect([s])); assert.ok(!r.includes('PRIVATE_TEXT')); assert.ok(!r.includes('PRIVATE_TOKEN')); assert.ok(!r.includes('example.invalid'));
  });
  test('unknown STAC version is not silently assumed compatible', () => { const s = sceneFixture(); s.stac_version = '2.0.0'; rowCode(s, 'UNSUPPORTED_STAC_VERSION'); });
  test('STAC 1.1 bands/projection fields are read at asset scope', () => {
    const s = sceneFixture(); s.stac_version = '1.1.0'; delete s.assets.red['eo:bands']; s.assets.red.bands = [{ 'eo:common_name': 'red' }];
    s.assets.red['proj:code'] = 'EPSG:32617'; const r = inspect([s]); assert.deepEqual(r.scenes[0].assets[0].commonBands, ['red']);
  });
  test('conflicting projection metadata refuses; CRS84 envelope never becomes a raster CRS', () => {
    const s = sceneFixture(); s.assets.red['proj:code'] = 'EPSG:32618'; rowCode(s, 'INVALID_ASSETS');
    delete s.assets.red['proj:code']; delete s.properties['proj:epsg']; assert.equal(inspect([s]).scenes[0].assets[0].projectedCrs, null);
  });
  test('interval-only acquisition is accepted with inclusive endpoints', () => {
    const s = sceneFixture(); s.properties.datetime = null; s.properties.start_datetime = '2025-06-30T00:00:00Z'; s.properties.end_datetime = queryFixture().interval.start;
    assert.equal(inspect([s]).accounting.selected, 1);
  });
  test('nominal datetime alone preserves microseconds rather than inventing an interval duration', () => {
    const r = inspect(); assert.equal(r.scenes[0].nominalDatetime, '2025-07-14T15:42:49.236576Z');
    assert.equal(r.scenes[0].acquisitionInterval.start, r.scenes[0].acquisitionInterval.end);
  });
  test('dangling acquisition interval and missing datetime are rejected', () => {
    const s = sceneFixture(); s.properties.start_datetime = '2025-07-01T00:00:00Z'; rowCode(s, 'INVALID_TIME');
    delete s.properties.start_datetime; delete s.properties.datetime; rowCode(s, 'INVALID_TIME');
  });
  test('nominal timestamp cannot contradict an explicit interval', () => {
    const s = sceneFixture(); s.properties.start_datetime = '2025-07-01T00:00:00Z'; s.properties.end_datetime = '2025-07-02T00:00:00Z'; rowCode(s, 'INVALID_TIME');
  });
  test('metadata creation/update cannot backdate knowledge', () => {
    const s = sceneFixture(); s.properties.created = '2025-07-15T00:00:00Z'; s.properties.updated = '2025-07-16T00:00:00Z';
    const q = queryFixture(); q.knownAtOrBefore = '2025-08-01T00:00:00Z';
    const r = inspect([s], q); assert.equal(r.rowDecisions[0].reason, 'AFTER_KNOWLEDGE_CUTOFF'); assert.equal(r.provenance.publishedAt, null);
  });
  test('spatial/temporal filtering is named and counted', () => {
    const s = sceneFixture(); const q = queryFixture(); q.aoi.bbox = [10, 10, 11, 11];
    assert.equal(inspect([s], q).rowDecisions[0].reason, 'OUTSIDE_AOI_ENVELOPE');
    s.properties.datetime = '2024-07-14T00:00:00Z'; assert.equal(inspect([s]).rowDecisions[0].reason, 'OUTSIDE_ACQUISITION_INTERVAL');
  });
  test('scene-cloud zero is a value; missing is not clear', () => {
    const s = sceneFixture(); s.properties['eo:cloud_cover'] = 0; assert.equal(inspect([s]).scenes[0].sceneCloudCoverPercent, 0);
    delete s.properties['eo:cloud_cover']; const r = inspect([s]); assert.equal(r.accounting.undetermined, 1); assert.equal(r.rowDecisions[0].reason, 'CLOUD_COVER_UNKNOWN');
    const q = queryFixture(); q.maxCloudCoverPercent = null; assert.equal(inspect([s], q).scenes[0].sceneCloudCoverPercent, null);
  });
  for (const cloud of [-1, 101, '15']) test(`invalid scene cloud ${cloud}`, () => { const s = sceneFixture(); s.properties['eo:cloud_cover'] = cloud; rowCode(s, 'INVALID_CLOUD_COVER'); });
  test('above-threshold cloud does not become no available imagery', () => {
    const s = sceneFixture(); s.properties['eo:cloud_cover'] = 80; const r = inspect([s]);
    assert.equal(r.accounting.filtered, 1); assert.equal(r.feedGap, null); assert.equal(r.emptyKind, 'NO_SELECTED_METADATA_CANDIDATES');
  });
  test('empty fetched page bridges to existing quality validator with unknown health/coverage', () => {
    const r = inspect([]); assert.equal(r.emptyKind, 'EMPTY_RETURNED_PAGE'); assert.equal(r.feedGap?.disposition, 'REPRESENTED');
    if (r.feedGap?.disposition === 'REPRESENTED') { assert.equal(r.feedGap.record.payload.coverage, 'unknown'); assert.equal(r.feedGap.record.physicalCause, 'NOT_ESTABLISHED'); }
    assert.equal(r.page.catalogCompleteness, 'NOT_ESTABLISHED');
  });
  test('next-page and reported counts never imply catalog completeness', () => {
    const p = { ...pageFixture(), numberMatched: 300, links: [{ rel: 'next', href: 'https://example.invalid/PRIVATE_NEXT' }] };
    const b = bytesOf(p), r = inspectSceneSnapshot(b, receiptFor(b), queryFixture(), 'run:test');
    assert.equal(r.page.nextPageAdvertised, true); assert.equal(r.page.reportedMatched, 300); assert.ok(!JSON.stringify(r).includes('PRIVATE_NEXT'));
  });
  test('duplicates are counted without adding duplicate output features', () => {
    const s = sceneFixture(), r = inspect([s, structuredClone(s)]); assert.equal(r.accounting.selected, 1); assert.equal(r.accounting.filtered, 1);
    assert.equal(r.rowDecisions[1].reason, 'DUPLICATE_ITEM');
  });
  test('conflicting same-id versions refuse all copies, including unprojected href differences', () => {
    const s = sceneFixture(), other = structuredClone(s); other.assets.red.href = 'https://example.invalid/other';
    const r = inspect([s, other]); assert.equal(r.accounting.rejected, 2); assert.equal(r.scenes.length, 0);
  });
  test('every row accounted for exactly once, including bad and unresolved rows', () => {
    const a = sceneFixture('a'), b = sceneFixture('b'), c = sceneFixture('c'), d = sceneFixture('d');
    b.properties['eo:cloud_cover'] = 99; delete c.properties['eo:cloud_cover']; d.collection = 'wrong';
    const r = inspect([a, b, c, d]); assert.deepEqual(r.accounting, { fetched: 4, selected: 1, filtered: 1, rejected: 1, undetermined: 1 });
    assert.deepEqual(r.rowDecisions.map(x => x.index), [0, 1, 2, 3]);
  });
  test('geometry coordinates are bounded and must fit the reported envelope', () => {
    const s = sceneFixture(); s.geometry.coordinates[0][0][0] = -81; rowCode(s, 'BBOX_GEOMETRY_MISMATCH');
    s.geometry = null; rowCode(s, 'INVALID_GEOMETRY');
  });
  test('unclosed geometry ring refuses', () => { const s = sceneFixture(); s.geometry.coordinates[0].pop(); rowCode(s, 'INVALID_GEOMETRY'); });
  test('MultiPolygon metadata envelope is supported without claiming topology validation', () => {
    const s = sceneFixture(); s.geometry = { type: 'MultiPolygon', coordinates: [s.geometry.coordinates] }; assert.equal(inspect([s]).accounting.selected, 1);
  });
  test('asset media type is only a declaration; no COG bytes were validated', () => {
    const r = inspect(); assert.equal(r.scenes[0].assets[0].declaredCog, true); assert.equal(r.limits.pixelsRead, 0);
  });
  test('representation is replay-stable while execution identities remain distinct', () => {
    const b = bytesOf(pageFixture()), receipt = receiptFor(b), q = queryFixture();
    const a = inspectSceneSnapshot(b, receipt, q, 'run:a'), z = inspectSceneSnapshot(b, receipt, q, 'run:b');
    assert.equal(a.representationId, z.representationId); assert.notEqual(a.executionRef, z.executionRef); assert.equal(z.verificationRef, null);
  });
  test('output does not mutate caller query/receipt', () => {
    const b = bytesOf(pageFixture()), receipt = receiptFor(b), q = queryFixture(), r = inspectSceneSnapshot(b, receipt, q, 'run:test');
    r.query.aoi.bbox[0] = 0; assert.equal(q.aoi.bbox[0], -80.25); assert.equal(receipt.retrievedAt, '2026-01-02T00:00:00Z');
  });
  test('oversized and malformed snapshots refuse at the boundary', () => {
    code(() => inspectSceneSnapshot(new Uint8Array(MAX_SNAPSHOT_BYTES + 1), {}, queryFixture(), 'run:test'), 'SNAPSHOT_TOO_LARGE');
    const b = bytesOf({ type: 'FeatureCollection', features: 'not-an-array', links: [] }); code(() => inspectSceneSnapshot(b, receiptFor(b), queryFixture(), 'run:test'), 'INVALID_SNAPSHOT');
  });
  test('page response cannot exceed the explicitly requested bound', () => {
    const b = bytesOf(pageFixture(Array.from({ length: 11 }, () => sceneFixture()))); code(() => inspectSceneSnapshot(b, receiptFor(b), queryFixture(), 'run:test'), 'INVALID_SNAPSHOT');
  });
  test('fixed search URI contains only approved collection/bbox/time/limit', () => {
    const url = new URL(landsatSearchUrl(queryFixture())); assert.equal(url.origin, 'https://landsatlook.usgs.gov'); assert.equal(url.pathname, '/stac-server/search');
    assert.deepEqual([...url.searchParams.keys()].sort(), ['bbox', 'collections', 'datetime', 'limit']);
  });
  test('collector makes one bounded GET and no asset requests', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher: typeof fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(pageFixture()), { headers: { 'content-type': 'application/geo+json' } }); };
    const result = await collectLandsatSnapshot(queryFixture(), { fetch: fetcher, now: () => '2026-01-02T00:00:00Z' });
    assert.equal(calls.length, 1); assert.equal(calls[0].init?.redirect, 'error'); assert.equal(calls[0].init?.method, 'GET');
    assert.equal(result.receipt.mode, 'operational'); assert.equal(inspectSceneSnapshot(result.bytes, result.receipt, result.query, 'run:test').accounting.selected, 1);
  });
  for (const [name, response, expected] of [
    ['HTTP failure', () => new Response('PRIVATE_ERROR', { status: 500 }), 'CATALOG_HTTP_ERROR'],
    ['HTML response', () => new Response('PRIVATE_HTML', { headers: { 'content-type': 'text/html' } }), 'CATALOG_MEDIA_TYPE'],
    ['empty response', () => new Response('', { headers: { 'content-type': 'application/json' } }), 'CATALOG_EMPTY_BODY'],
    ['oversize header', () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(MAX_SNAPSHOT_BYTES + 1) } }), 'CATALOG_BODY_LIMIT'],
    ['oversize streaming body', () => new Response(new Uint8Array(MAX_SNAPSHOT_BYTES + 1), { headers: { 'content-type': 'application/json' } }), 'CATALOG_BODY_LIMIT'],
  ] as const) test(`collector refuses ${name}`, async () => {
    await assert.rejects(collectLandsatSnapshot(queryFixture(), { fetch: async () => response(), now: () => '2026-01-02T00:00:00Z' }),
      (e: unknown) => e instanceof CatalogError && e.code === expected && !e.message.includes('PRIVATE'));
  });
  test('transport exceptions are sanitized, not serialized', async () => {
    await assert.rejects(collectLandsatSnapshot(queryFixture(), { fetch: async () => { throw new Error('PRIVATE_SECRET'); }, now: () => '2026-01-02T00:00:00Z' }),
      (e: unknown) => e instanceof CatalogError && e.code === 'CATALOG_UNAVAILABLE' && !e.message.includes('PRIVATE'));
  });
  test('a redirected response cannot silently swap origins', async () => {
    const r = new Response('{}', { headers: { 'content-type': 'application/json' } }); Object.defineProperty(r, 'redirected', { value: true });
    await assert.rejects(collectLandsatSnapshot(queryFixture(), { fetch: async () => r, now: () => '2026-01-02T00:00:00Z' }),
      (e: unknown) => e instanceof CatalogError && e.code === 'CATALOG_REDIRECT');
  });
  test('artifact identity is not conflated with acquisition evidence identity', () => {
    const b = bytesOf(pageFixture()), q = queryFixture();
    const a = makeSnapshotReceipt(b, q, '2026-01-02T00:00:00Z', 'synthetic');
    const z = makeSnapshotReceipt(b, q, '2026-01-03T00:00:00Z', 'synthetic');
    const live = makeSnapshotReceipt(b, q, '2026-01-02T00:00:00Z', 'operational');
    assert.equal(a.artifactSha256, z.artifactSha256); assert.notEqual(a.evidenceId, z.evidenceId);
    assert.notEqual(a.evidenceId, live.evidenceId);
  });
  return Object.freeze(cases);
}
