/** Bounded STAC metadata inspection. No pixels, geometry reprojection or admission. */
import { createHash } from 'node:crypto';
import { SOURCE_REGISTRY } from '../economy/sourceRegistry';
import { inspectIndustrialObservation } from '../economy/industrialObservationQualityRegistry';
import { QUALITY_SCHEMA } from '../economy/industrialObservationQuality';

export const LANDSAT_SOURCE = 'usgs-landsat-c2l2-stac';
export const LANDSAT_COLLECTION = 'landsat-c2l2-sr';
export const LANDSAT_ADAPTER = 'landsat-c2l2-stac-metadata.v1';
export const CATALOG_ORIGIN = 'https://landsatlook.usgs.gov/stac-server';
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
export type BBox = [number, number, number, number];
export type SceneQuery = {
  schemaVersion: 'rs.scene.query.v1';
  aoi: { crs: 'OGC:CRS84'; bbox: BBox };
  interval: { start: string; end: string };
  maxCloudCoverPercent: number | null;
  knownAtOrBefore: string | null;
  limit: number;
};
export type SnapshotReceipt = {
  schemaVersion: 'rs.stac.snapshot.v1';
  sourceId: string; sourceVersion: string; artifactSha256: string;
  evidenceId: string; retrievedAt: string;
  mode: 'operational' | 'synthetic';
  querySha256: string;
};
export type SceneCode = 'INVALID_QUERY' | 'INVALID_TIME' | 'UNSUPPORTED_CRS'
  | 'INVALID_BBOX' | 'DATELINE_UNSUPPORTED' | 'SOURCE_NOT_ELIGIBLE'
  | 'SNAPSHOT_TOO_LARGE' | 'SNAPSHOT_HASH_MISMATCH' | 'INVALID_RECEIPT'
  | 'QUERY_BINDING_MISMATCH' | 'INVALID_SNAPSHOT' | 'INVALID_ITEM'
  | 'UNSUPPORTED_STAC_VERSION' | 'WRONG_COLLECTION' | 'INVALID_GEOMETRY'
  | 'BBOX_GEOMETRY_MISMATCH' | 'INVALID_CLOUD_COVER' | 'INVALID_ASSETS'
  | 'CONFLICTING_ITEM_VERSIONS' | 'DUPLICATE_ITEM'
  | 'OUTSIDE_AOI_ENVELOPE' | 'OUTSIDE_ACQUISITION_INTERVAL'
  | 'AFTER_KNOWLEDGE_CUTOFF' | 'SCENE_CLOUD_ABOVE_THRESHOLD' | 'CLOUD_COVER_UNKNOWN';
export class SceneError extends Error {
  constructor(public readonly code: SceneCode) { super(code); this.name = 'SceneError'; }
}
const insist: (ok: unknown, code: SceneCode) => asserts ok = (ok, code) => { if (!ok) throw new SceneError(code); };
const obj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const token = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_:./-]{0,199}$/.test(x);
const keys = (x: Record<string, unknown>, ks: string[]) => Object.keys(x).length === ks.length && ks.every(k => Object.hasOwn(x, k));
export const digest = (x: string | Uint8Array): string => createHash('sha256').update(x).digest('hex');
const occurrenceId = (sourceId: string, artifact: string, query: string, time: string) =>
  `evidence:rs:${digest(JSON.stringify([sourceId, artifact, query, time]))}`;
/** UTC subset of RFC3339, retaining up to nanoseconds; never silently truncate. */
export function utcNanos(value: unknown): bigint {
  insist(typeof value === 'string', 'INVALID_TIME');
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  insist(m, 'INVALID_TIME');
  const base = Date.parse(m[1] + 'Z');
  insist(Number.isFinite(base) && new Date(base).toISOString() === m[1] + '.000Z', 'INVALID_TIME');
  return BigInt(base) * BigInt(1_000_000) + BigInt((m[2] ?? '').padEnd(9, '0'));
}
function bbox(value: unknown): BBox {
  insist(Array.isArray(value) && value.length === 4 && value.every(finite), 'INVALID_BBOX');
  const [w, s, e, n] = value as number[];
  insist(w >= -180 && e <= 180 && e >= -180 && w <= 180 && s >= -90 && n <= 90, 'INVALID_BBOX');
  insist(w <= e && e - w <= 180, 'DATELINE_UNSUPPORTED');
  insist(w < e && s < n, 'INVALID_BBOX');
  return [w, s, e, n];
}
export function parseSceneQuery(value: unknown): SceneQuery {
  insist(obj(value) && keys(value, ['schemaVersion', 'aoi', 'interval', 'maxCloudCoverPercent', 'knownAtOrBefore', 'limit']), 'INVALID_QUERY');
  insist(value.schemaVersion === 'rs.scene.query.v1' && obj(value.aoi) && keys(value.aoi, ['crs', 'bbox']), 'INVALID_QUERY');
  insist(value.aoi.crs === 'OGC:CRS84', 'UNSUPPORTED_CRS');
  const aoi = { crs: 'OGC:CRS84' as const, bbox: bbox(value.aoi.bbox) };
  insist(obj(value.interval) && keys(value.interval, ['start', 'end']), 'INVALID_QUERY');
  insist(utcNanos(value.interval.start) < utcNanos(value.interval.end), 'INVALID_TIME');
  if (value.knownAtOrBefore !== null) utcNanos(value.knownAtOrBefore);
  insist(value.maxCloudCoverPercent === null || (finite(value.maxCloudCoverPercent) && value.maxCloudCoverPercent >= 0 && value.maxCloudCoverPercent <= 100), 'INVALID_QUERY');
  insist(Number.isInteger(value.limit) && Number(value.limit) >= 1 && Number(value.limit) <= 50, 'INVALID_QUERY');
  return { schemaVersion: 'rs.scene.query.v1', aoi,
    interval: { start: value.interval.start as string, end: value.interval.end as string },
    maxCloudCoverPercent: value.maxCloudCoverPercent as number | null,
    knownAtOrBefore: value.knownAtOrBefore as string | null, limit: value.limit as number };
}
export function assertLandsatSource(): void {
  const entries = SOURCE_REGISTRY.filter(s => s.sourceId === LANDSAT_SOURCE);
  insist(entries.length === 1 && entries[0].adapter === LANDSAT_ADAPTER &&
    entries[0].accessClass === 'open' && entries[0].yields.includes('observation'), 'SOURCE_NOT_ELIGIBLE');
}
export function makeSnapshotReceipt(bytes: Uint8Array, query: unknown, retrievedAt: string,
  mode: SnapshotReceipt['mode']): SnapshotReceipt {
  insist(mode === 'operational' || mode === 'synthetic', 'INVALID_RECEIPT');
  const q = parseSceneQuery(query); utcNanos(retrievedAt);
  if (mode === 'operational') assertLandsatSource();
  insist(bytes.byteLength <= MAX_SNAPSHOT_BYTES, 'SNAPSHOT_TOO_LARGE');
  const hash = digest(bytes), queryHash = digest(JSON.stringify(q));
  const sourceId = mode === 'synthetic' ? 'fixture:landsat-stac' : LANDSAT_SOURCE;
  return { schemaVersion: 'rs.stac.snapshot.v1', sourceId,
    sourceVersion: 'collection-2', artifactSha256: hash, evidenceId: occurrenceId(sourceId, hash, queryHash, retrievedAt),
    retrievedAt, mode, querySha256: queryHash };
}
/** Receipts prove byte/query consistency, NOT publisher authenticity or ESM admission. */
function checkReceipt(value: unknown, bytes: Uint8Array, q: SceneQuery): SnapshotReceipt {
  insist(obj(value) && keys(value, ['schemaVersion', 'sourceId', 'sourceVersion', 'artifactSha256', 'evidenceId', 'retrievedAt', 'mode', 'querySha256']), 'INVALID_RECEIPT');
  insist(value.schemaVersion === 'rs.stac.snapshot.v1' && value.sourceVersion === 'collection-2' &&
    (value.mode === 'operational' || value.mode === 'synthetic'), 'INVALID_RECEIPT');
  insist(value.sourceId === (value.mode === 'synthetic' ? 'fixture:landsat-stac' : LANDSAT_SOURCE), 'SOURCE_NOT_ELIGIBLE');
  if (value.mode === 'operational') assertLandsatSource();
  utcNanos(value.retrievedAt);
  const hash = digest(bytes);
  insist(value.artifactSha256 === hash && value.evidenceId === occurrenceId(value.sourceId as string, hash, value.querySha256 as string, value.retrievedAt as string), 'SNAPSHOT_HASH_MISMATCH');
  insist(value.querySha256 === digest(JSON.stringify(q)), 'QUERY_BINDING_MISMATCH');
  return structuredClone(value) as SnapshotReceipt;
}
/** Validate coordinate bounds and envelope consistency; not a topology proof. */
function checkGeometry(geometry: unknown, bounds: BBox): void {
  insist(obj(geometry) && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') && Array.isArray(geometry.coordinates), 'INVALID_GEOMETRY');
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  insist(polygons.length > 0 && polygons.length <= 16, 'INVALID_GEOMETRY');
  let vertices = 0;
  for (const polygon of polygons) {
    insist(Array.isArray(polygon) && polygon.length > 0 && polygon.length <= 16, 'INVALID_GEOMETRY');
    for (const ring of polygon) {
      insist(Array.isArray(ring) && ring.length >= 4, 'INVALID_GEOMETRY');
      vertices += ring.length; insist(vertices <= 2048, 'INVALID_GEOMETRY');
      let previous: number[] | null = null;
      for (const p of ring) {
        insist(Array.isArray(p) && p.length === 2 && p.every(finite), 'INVALID_GEOMETRY');
        insist(p[0] >= -180 && p[0] <= 180 && p[1] >= -90 && p[1] <= 90, 'INVALID_GEOMETRY');
        if (previous) insist(Math.abs(p[0] - previous[0]) <= 180, 'DATELINE_UNSUPPORTED');
        insist(p[0] >= bounds[0] && p[0] <= bounds[2] && p[1] >= bounds[1] && p[1] <= bounds[3], 'BBOX_GEOMETRY_MISMATCH');
        previous = p;
      }
      insist(ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1], 'INVALID_GEOMETRY');
    }
  }
}
export type SceneCard = {
  sceneId: string; stacVersion: string; bbox: BBox;
  nominalDatetime: string | null; acquisitionInterval: { start: string; end: string };
  metadataCreatedAt: string | null; metadataUpdatedAt: string | null;
  platform: string | null; groundSampleDistanceMeters: number | null;
  sceneCloudCoverPercent: number | null;
  assets: { key: string; declaredMediaType: string | null; declaredCog: boolean;
    commonBands: string[]; projectedCrs: string | null }[];
};
function optionalInstant(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  utcNanos(value); return value as string;
}
function normalizeItem(value: unknown): SceneCard {
  insist(obj(value) && value.type === 'Feature' && token(value.id) && obj(value.properties), 'INVALID_ITEM');
  insist(value.stac_version === '1.0.0' || value.stac_version === '1.1.0', 'UNSUPPORTED_STAC_VERSION');
  insist(value.collection === LANDSAT_COLLECTION, 'WRONG_COLLECTION');
  insist(Array.isArray(value.links) && Array.isArray(value.stac_extensions), 'INVALID_ITEM');
  const p = value.properties;
  insist(Object.hasOwn(p, 'datetime'), 'INVALID_TIME');
  const nominal = optionalInstant(p.datetime);
  const hasStart = Object.hasOwn(p, 'start_datetime'), hasEnd = Object.hasOwn(p, 'end_datetime');
  insist(hasStart === hasEnd && (nominal !== null || hasStart), 'INVALID_TIME');
  const start = hasStart ? p.start_datetime : nominal, end = hasEnd ? p.end_datetime : nominal;
  insist(utcNanos(start) <= utcNanos(end), 'INVALID_TIME');
  if (nominal !== null && hasStart) insist(utcNanos(nominal) >= utcNanos(start) && utcNanos(nominal) <= utcNanos(end), 'INVALID_TIME');
  const bounds = bbox(value.bbox); checkGeometry(value.geometry, bounds);
  const cloud = p['eo:cloud_cover'] ?? null;
  insist(cloud === null || (finite(cloud) && cloud >= 0 && cloud <= 100), 'INVALID_CLOUD_COVER');
  const gsd = p.gsd ?? null;
  insist(gsd === null || (finite(gsd) && gsd > 0), 'INVALID_ITEM');
  const assets = value.assets;
  insist(obj(assets) && Object.keys(assets).length <= 64, 'INVALID_ASSETS');
  const projectedCrs = (a: Record<string, unknown>): string | null => {
    const epsg = a['proj:epsg'] ?? p['proj:epsg'];
    const code = a['proj:code'] ?? p['proj:code'];
    insist(epsg == null || (Number.isSafeInteger(epsg) && Number(epsg) > 0), 'INVALID_ASSETS');
    insist(code == null || (typeof code === 'string' && /^EPSG:[1-9][0-9]{0,7}$/.test(code)), 'INVALID_ASSETS');
    insist(epsg == null || code == null || code === `EPSG:${epsg}`, 'INVALID_ASSETS');
    return code as string ?? (epsg == null ? null : `EPSG:${epsg}`);
  };
  const assetCards = Object.entries(assets).map(([key, a]) => {
    insist(token(key) && obj(a) && typeof a.href === 'string' && a.href.length <= 2048, 'INVALID_ASSETS');
    // href, title, description, unknown extensions and provider links are NOT projected or followed.
    const type = a.type ?? null;
    insist(type === null || (typeof type === 'string' && type.length <= 128 && /^[A-Za-z0-9/;=+_. -]+$/.test(type)), 'INVALID_ASSETS');
    const bands = a.bands ?? a['eo:bands'] ?? [];
    insist(Array.isArray(bands) && bands.length <= 32 && bands.every(obj), 'INVALID_ASSETS');
    const commonBands = [...new Set(bands.map(b => b['eo:common_name'] ?? b.common_name)
      .filter((b): b is string => typeof b === 'string' && ['red', 'green', 'blue', 'nir', 'nir08', 'nir09', 'swir16', 'swir22', 'lwir11', 'lwir12', 'pan', 'coastal', 'cirrus'].includes(b)))].sort();
    return { key, declaredMediaType: type as string | null,
      declaredCog: typeof type === 'string' && /^image\/tiff;\s*application=geotiff;\s*profile=cloud-optimized$/i.test(type),
      commonBands, projectedCrs: projectedCrs(a) };
  }).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  insist(p.platform === undefined || token(p.platform), 'INVALID_ITEM');
  return { sceneId: `${LANDSAT_COLLECTION}/${value.id}`, stacVersion: value.stac_version,
    bbox: bounds, nominalDatetime: nominal, acquisitionInterval: { start: start as string, end: end as string },
    metadataCreatedAt: optionalInstant(p.created), metadataUpdatedAt: optionalInstant(p.updated),
    platform: p.platform as string ?? null, groundSampleDistanceMeters: gsd as number | null,
    sceneCloudCoverPercent: cloud as number | null, assets: assetCards };
}
const intersects = (a: BBox, b: BBox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
/** Deterministic projection of a single bounded page; counts every supplied row. */
export function inspectSceneSnapshot(bytes: Uint8Array, suppliedReceipt: unknown, query: unknown, executionRef: string) {
  insist(token(executionRef) && executionRef !== 'gsc.rs-scene-inspect.v1', 'INVALID_QUERY');
  const q = parseSceneQuery(query);
  insist(bytes.byteLength <= MAX_SNAPSHOT_BYTES, 'SNAPSHOT_TOO_LARGE');
  const receipt = checkReceipt(suppliedReceipt, bytes, q);
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new SceneError('INVALID_SNAPSHOT'); }
  insist(obj(raw) && raw.type === 'FeatureCollection' && Array.isArray(raw.features) && raw.features.length <= q.limit && Array.isArray(raw.links), 'INVALID_SNAPSHOT');
  const rowDecisions: { index: number; disposition: 'selected' | 'filtered' | 'rejected' | 'undetermined'; reason: SceneCode | null }[] = [];
  const normalized: { index: number; scene: SceneCard; identityHash: string }[] = [];
  for (let index = 0; index < raw.features.length; index++) {
    try {
      const scene = normalizeItem(raw.features[index]);
      normalized.push({ index, scene, identityHash: digest(JSON.stringify(raw.features[index])) });
    } catch (error) {
      rowDecisions.push({ index, disposition: 'rejected', reason: error instanceof SceneError ? error.code : 'INVALID_ITEM' });
    }
  }
  const selected: SceneCard[] = [], seen = new Set<string>();
  const hashes = new Map<string, Set<string>>();
  for (const row of normalized) {
    const group = hashes.get(row.scene.sceneId) ?? new Set<string>(); group.add(row.identityHash); hashes.set(row.scene.sceneId, group);
  }
  for (const { index, scene } of normalized) {
    let reason: SceneCode | null = null;
    let disposition: 'selected' | 'filtered' | 'rejected' | 'undetermined' = 'filtered';
    if (hashes.get(scene.sceneId)!.size > 1) { reason = 'CONFLICTING_ITEM_VERSIONS'; disposition = 'rejected'; }
    else if (seen.has(scene.sceneId)) reason = 'DUPLICATE_ITEM';
    else if (q.knownAtOrBefore !== null && utcNanos(receipt.retrievedAt) > utcNanos(q.knownAtOrBefore)) reason = 'AFTER_KNOWLEDGE_CUTOFF';
    else if (!intersects(q.aoi.bbox, scene.bbox)) reason = 'OUTSIDE_AOI_ENVELOPE';
    else if (utcNanos(scene.acquisitionInterval.end) < utcNanos(q.interval.start) || utcNanos(scene.acquisitionInterval.start) > utcNanos(q.interval.end)) reason = 'OUTSIDE_ACQUISITION_INTERVAL';
    else if (q.maxCloudCoverPercent !== null && scene.sceneCloudCoverPercent === null) { reason = 'CLOUD_COVER_UNKNOWN'; disposition = 'undetermined'; }
    else if (q.maxCloudCoverPercent !== null && scene.sceneCloudCoverPercent! > q.maxCloudCoverPercent) reason = 'SCENE_CLOUD_ABOVE_THRESHOLD';
    else { disposition = 'selected'; selected.push(scene); }
    seen.add(scene.sceneId); rowDecisions.push({ index, disposition, reason });
  }
  selected.sort((a, b) => {
    const x = utcNanos(a.acquisitionInterval.start), y = utcNanos(b.acquisitionInterval.start);
    return x > y ? -1 : x < y ? 1 : a.sceneId < b.sceneId ? -1 : a.sceneId > b.sceneId ? 1 : 0;
  });
  rowDecisions.sort((a, b) => a.index - b.index);
  const accounting = { fetched: raw.features.length, selected: 0, filtered: 0, rejected: 0, undetermined: 0 };
  for (const row of rowDecisions) accounting[row.disposition]++;
  const report = {
    schemaVersion: 'rs.scene.inspection.v1', mode: receipt.mode,
    operationRef: 'gsc.rs-scene-inspect.v1', executionRef, verificationRef: null,
    provenance: { sourceId: receipt.sourceId, sourceVersion: receipt.sourceVersion,
      artifactId: `sha256:${receipt.artifactSha256}`, evidenceId: receipt.evidenceId,
      retrievedAt: receipt.retrievedAt, knownAt: receipt.retrievedAt, publishedAt: null },
    query: q, accounting, rowDecisions, scenes: selected,
    page: { nextPageAdvertised: raw.links.some(l => obj(l) && l.rel === 'next'),
      reportedMatched: Number.isSafeInteger(raw.numberMatched) && Number(raw.numberMatched) >= 0 ? raw.numberMatched as number : null,
      catalogCompleteness: 'NOT_ESTABLISHED' },
    limits: { spatialPredicate: 'BBOX_CANDIDATE_ONLY', aoiPixelCoverage: null, aoiCloudCover: null,
      pixelsRead: 0, positionalAccuracyMeters: null, physicalCause: 'NOT_ESTABLISHED', confidence: null,
      originVerification: 'NOT_PERFORMED', admission: 'NOT_PERFORMED', release: 'NOT_PERFORMED' },
    emptyKind: raw.features.length === 0 ? 'EMPTY_RETURNED_PAGE' : selected.length === 0 ? 'NO_SELECTED_METADATA_CANDIDATES' : null,
  };
  const representationId = `rs-scenes:${digest(JSON.stringify({ ...report, executionRef: null }))}`;
  // The layer geometry is the reported scene ENVELOPE, not reconstructed pixels or footprint topology.
  const geojson = { type: 'FeatureCollection', features: selected.map(scene => {
    const [w, s, e, n] = scene.bbox;
    return { type: 'Feature', id: scene.sceneId, bbox: scene.bbox,
      geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      properties: { sceneId: scene.sceneId, geometryBasis: 'STAC_BBOX_ENVELOPE', mode: receipt.mode,
        representationId, evidenceId: receipt.evidenceId, sourceId: receipt.sourceId,
        nominalDatetime: scene.nominalDatetime, sceneCloudCoverPercent: scene.sceneCloudCoverPercent,
        knownAt: receipt.retrievedAt, admission: 'NOT_PERFORMED', release: 'NOT_PERFORMED', pixelsRead: 0 } };
  }) };
  let feedGap = null;
  if (raw.features.length === 0) {
    const evidence = { evidenceId: receipt.evidenceId, artifactId: `sha256:${receipt.artifactSha256}`,
      sourceId: receipt.sourceId, sourceVersion: receipt.sourceVersion, mode: receipt.mode,
      subjectClass: 'industrial' as const, evidenceClass: 'feed_query' as const, dependencies: [],
      subjectRef: `catalog:${LANDSAT_COLLECTION}`,
      times: { eventWindow: null, measurementWindow: { ...q.interval }, publishedAt: null, retrievedAt: receipt.retrievedAt },
      payload: { kind: 'FEED_GAP', feedRef: LANDSAT_SOURCE, queryRef: `query:${receipt.querySha256}`, returnedRecords: 0 } };
    feedGap = inspectIndustrialObservation({ schemaVersion: QUALITY_SCHEMA, evidenceId: receipt.evidenceId },
      { mode: receipt.mode, evidence: new Map([[receipt.evidenceId, evidence]]) });
  }
  return { ...report, representationId, geojson, feedGap };
}
