/**
 * Read-only consumer of ESM's existing payload.projection.v1 wire contract.
 * No source acquisition, publication decision, admission, state estimation or
 * coordinate conversion. A matching digest establishes consistency, not truth.
 */
export const MAX_PROJECTION_BYTES = 1_048_576;
export const BRIDGE_SCHEMA = 'notation.gsv-inspection.v1';
export type JsonRecord = Record<string, unknown>;
export interface PublicProjectionSpec {
  schema: 'payload.projection-spec.v1';
  source: { kind: 'CORPUS_RELEASE'; corpusId: string; releaseId: string;
    releaseDigest: string; manifestCommitment: string; snapshotDigest: string };
  selection: { recordIds: string[]; knownAt: string; validAt: string };
  view: { mode: 'GLOBE'; coordinateSemantics: 'GEODETIC'; representation: 'GLOBAL_3D' };
  viewer: 'PUBLIC_RULING';
}
export interface ProjectionRecord extends JsonRecord {
  recordId: string; canonicalId: string; title: string; predicate: string;
  subject: { subjectId: string; canonicalId: string; subjectType: string };
  value: string | number; unit: string | null; basis: string | null;
  validity: { validFrom: string; validTo: string | null }; knownAt: string;
  evidenceClass: string; provenance: JsonRecord & { sourceId: string };
  visibility: 'PUBLIC_RULING'; statusAtKnownAt: 'CURRENT' | 'SUPERSEDED' | 'RETRACTED';
}
export interface ProjectionPosition extends JsonRecord {
  recordId: string; positionRecordId: string; canonicalId: string;
  subject: ProjectionRecord['subject']; shape: JsonRecord & { kind: 'POINT' | 'POLYGON' | 'EXTENT'; datum: 'WGS84' };
  point: { datum: 'WGS84'; longitude: number; latitude: number; horizontalUncertaintyM: number | null };
  validity: ProjectionRecord['validity']; knownAt: string; evidenceClass: string;
  source: { sourceId: string; sourceName: string | null };
}
export interface PublicProjection extends JsonRecord {
  schema: 'payload.projection.v1'; fixture_only: true; spec: PublicProjectionSpec;
  authority: 'REPLACEABLE_PROJECTION'; engine: 'CesiumJS';
  status: 'READY' | 'UNAVAILABLE'; error: null | 'GEOMETRY_NOT_AVAILABLE';
  records: ProjectionRecord[]; graph: null;
  geometry: { datum: 'WGS84'; positions: ProjectionPosition[]; unplaced: string[] };
  provenance: { compilerId: string; compilerVersion: string; transformIdentity: string;
    specDigest: string; sourceSelectionDigest: string };
  nonclaims: Record<string, false>; digest: string;
}
export interface ProjectionPin { spec: PublicProjectionSpec; digest: string }
export class ProjectionRefusal extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'ProjectionRefusal'; this.code = code; }
}
function check(condition: unknown, code = 'INVALID_PROJECTION'): asserts condition {
  if (!condition) throw new ProjectionRefusal(code);
}
function object(value: unknown): asserts value is JsonRecord {
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
  check(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function fields(value: unknown, names: readonly string[]): asserts value is JsonRecord {
  object(value);
  check(Object.keys(value).length === names.length && names.every(k => Object.hasOwn(value, k)));
}
function text(value: unknown): asserts value is string {
  check(typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f]/.test(value));
}
function hash(value: unknown, prefix = true): asserts value is string {
  check(typeof value === 'string' && (prefix ? /^sha256:[a-f0-9]{64}$/ : /^[a-f0-9]{64}$/).test(value));
}
function instant(value: unknown): number {
  text(value);
  check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value));
  const clock = value.slice(11, 19).split(':').map(Number);
  check(clock[0] < 24 && clock[1] < 60 && clock[2] < 60);
  const t = Date.parse(value);
  check(Number.isFinite(t));
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(0); calendar.setUTCFullYear(y, m - 1, d);
  check(calendar.getUTCFullYear() === y && calendar.getUTCMonth() === m - 1 && calendar.getUTCDate() === d);
  return t;
}
function interval(value: unknown, at: number): void {
  fields(value, ['validFrom', 'validTo']);
  const from = instant(value.validFrom);
  const to = value.validTo === null ? Infinity : instant(value.validTo);
  check(from < to && from <= at && at < to, 'TIME_BINDING_MISMATCH');
}
function coordinate(value: unknown, max: number): asserts value is number {
  check(typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= max, 'INVALID_GEOMETRY');
}
function subject(value: unknown): void {
  fields(value, ['subjectId', 'canonicalId', 'subjectType']);
  Object.values(value).forEach(text);
}
/** Bounded JSON only, including before digest computation on a message event. */
function jsonCopy(input: unknown): unknown {
  let count = 0;
  const ancestors = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    check(++count <= 60_000 && depth <= 32, 'PROJECTION_TOO_LARGE');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'string') { check(v.length <= MAX_PROJECTION_BYTES, 'PROJECTION_TOO_LARGE'); return; }
    if (typeof v === 'number') { check(Number.isFinite(v)); return; }
    check(typeof v === 'object' && v !== null && !ancestors.has(v));
    ancestors.add(v);
    if (Array.isArray(v)) {
      check(v.length <= 8192, 'PROJECTION_TOO_LARGE');
      for (let i = 0; i < v.length; i++) { check(Object.hasOwn(v, i)); visit(v[i], depth + 1); }
    } else {
      object(v);
      for (const [k, child] of Object.entries(v)) {
        check(!['__proto__', 'prototype', 'constructor'].includes(k));
        visit(child, depth + 1);
      }
    }
    ancestors.delete(v);
  };
  visit(input, 0);
  const encoded = JSON.stringify(input);
  check(new TextEncoder().encode(encoded).length <= MAX_PROJECTION_BYTES, 'PROJECTION_TOO_LARGE');
  return JSON.parse(encoded);
}
/** ESM v1 canonical JSON: recursively sorted object keys, array order retained. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) :
    v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, child]) => [k, sort(child)])) : v;
  return JSON.stringify(sort(value));
}
export async function projectionDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export function parsePublicProjectionSpec(input: unknown): PublicProjectionSpec {
  const v = jsonCopy(input);
  fields(v, ['schema', 'source', 'selection', 'view', 'viewer']);
  check(v.schema === 'payload.projection-spec.v1' && v.viewer === 'PUBLIC_RULING', 'PUBLIC_FIXTURE_REQUIRED');
  fields(v.source, ['kind', 'corpusId', 'releaseId', 'releaseDigest', 'manifestCommitment', 'snapshotDigest']);
  check(v.source.kind === 'CORPUS_RELEASE'); text(v.source.corpusId); text(v.source.releaseId);
  hash(v.source.releaseDigest, false); hash(v.source.manifestCommitment, false); hash(v.source.snapshotDigest);
  fields(v.selection, ['recordIds', 'knownAt', 'validAt']);
  const ids = v.selection.recordIds;
  check(Array.isArray(ids) && ids.length > 0 && ids.length <= 128);
  ids.forEach(text); check(new Set(ids).size === ids.length);
  ids.sort();
  v.selection.knownAt = new Date(instant(v.selection.knownAt)).toISOString();
  v.selection.validAt = new Date(instant(v.selection.validAt)).toISOString();
  fields(v.view, ['mode', 'coordinateSemantics', 'representation']);
  check(v.view.mode === 'GLOBE' && v.view.coordinateSemantics === 'GEODETIC' && v.view.representation === 'GLOBAL_3D', 'UNSUPPORTED_VIEW');
  return v as unknown as PublicProjectionSpec;
}
function freeze<T>(v: T): T {
  if (v !== null && typeof v === 'object') { for (const child of Object.values(v)) freeze(child); Object.freeze(v); }
  return v;
}
/** Explicitly pinned public fixture only; a self-declared digest is insufficient. */
export async function validatePublicProjection(input: unknown, pin: ProjectionPin): Promise<PublicProjection> {
  const p = jsonCopy(input);
  fields(p, ['schema', 'fixture_only', 'spec', 'engine', 'authority', 'status', 'error', 'records', 'graph', 'geometry', 'provenance', 'nonclaims', 'digest']);
  check(p.schema === 'payload.projection.v1' && p.fixture_only === true, 'PUBLIC_FIXTURE_REQUIRED');
  check(p.authority === 'REPLACEABLE_PROJECTION', 'AUTHORITY_MISMATCH');
  const spec = parsePublicProjectionSpec(p.spec);
  check(canonicalJson(p.spec) === canonicalJson(spec) && canonicalJson(spec) === canonicalJson(parsePublicProjectionSpec(pin.spec)), 'SOURCE_BINDING_MISMATCH');
  hash(p.digest); hash(pin.digest);
  check(p.digest === pin.digest, 'SOURCE_BINDING_MISMATCH');
  check(p.engine === 'CesiumJS' && p.graph === null, 'UNSUPPORTED_VIEW');
  fields(p.nonclaims, ['sourceMutated', 'canonicalAdmission', 'relationInferred', 'positionInferred', 'sourceTruthClaimed', 'independentlyVerified', 'rendererExecuted']);
  check(Object.values(p.nonclaims).every(v => v === false), 'AUTHORITY_MISMATCH');
  const known = instant(spec.selection.knownAt), valid = instant(spec.selection.validAt);
  check(Array.isArray(p.records) && p.records.length === spec.selection.recordIds.length);
  const records = new Map<string, JsonRecord>(); const canonicalIds = new Set<string>();
  const subjects = new Map<string, string>();
  for (const r of p.records) {
    object(r); text(r.recordId); text(r.canonicalId); text(r.title); text(r.predicate); subject(r.subject);
    check(!records.has(r.recordId) && !canonicalIds.has(r.canonicalId), 'IDENTITY_MISMATCH');
    check(r.visibility === 'PUBLIC_RULING', 'PUBLIC_FIXTURE_REQUIRED');
    check(typeof r.value === 'string' || typeof r.value === 'number');
    check(r.unit === null || typeof r.unit === 'string'); check(r.basis === null || typeof r.basis === 'string');
    interval(r.validity, valid); check(instant(r.knownAt) <= known, 'TIME_BINDING_MISMATCH');
    text(r.evidenceClass); object(r.provenance); text(r.provenance.sourceId);
    check(['CURRENT', 'SUPERSEDED', 'RETRACTED'].includes(r.statusAtKnownAt as string));
    const s = r.subject as JsonRecord;
    const previous = subjects.get(s.subjectId as string);
    check(previous === undefined || previous === canonicalJson(s), 'IDENTITY_MISMATCH');
    subjects.set(s.subjectId as string, canonicalJson(s));
    records.set(r.recordId, r); canonicalIds.add(r.canonicalId);
  }
  check(canonicalJson([...records.keys()]) === canonicalJson(spec.selection.recordIds), 'SELECTION_MISMATCH');
  fields(p.geometry, ['datum', 'positions', 'unplaced']);
  check(p.geometry.datum === 'WGS84', 'UNSUPPORTED_COORDINATE_FRAME');
  check(Array.isArray(p.geometry.positions) && p.geometry.positions.length <= 512);
  check(Array.isArray(p.geometry.unplaced) && p.geometry.unplaced.length <= 128);
  const placed = new Set<string>(), placementKeys = new Set<string>();
  const positionDeclarations = new Map<string, string>();
  for (const pos of p.geometry.positions) {
    object(pos); text(pos.recordId); text(pos.positionRecordId); text(pos.canonicalId); subject(pos.subject);
    const record = records.get(pos.recordId);
    check(record && canonicalJson(record.subject) === canonicalJson(pos.subject), 'GEOMETRY_BINDING_MISMATCH');
    const key = canonicalJson([pos.recordId, pos.positionRecordId]);
    check(!placementKeys.has(key), 'GEOMETRY_BINDING_MISMATCH'); placementKeys.add(key); placed.add(pos.recordId);
    const { recordId: binding, ...declaration } = pos;
    const previousDeclaration = positionDeclarations.get(pos.positionRecordId);
    check(previousDeclaration === undefined || previousDeclaration === canonicalJson(declaration), 'GEOMETRY_BINDING_MISMATCH');
    positionDeclarations.set(pos.positionRecordId, canonicalJson(declaration));
    interval(pos.validity, valid); check(instant(pos.knownAt) <= known, 'TIME_BINDING_MISMATCH');
    text(pos.evidenceClass); object(pos.source); text(pos.source.sourceId);
    object(pos.shape); check(pos.shape.datum === 'WGS84', 'UNSUPPORTED_COORDINATE_FRAME');
    check(['POINT', 'POLYGON', 'EXTENT'].includes(pos.shape.kind as string), 'UNSUPPORTED_GEOMETRY');
    fields(pos.point, ['datum', 'longitude', 'latitude', 'horizontalUncertaintyM']);
    check(pos.point.datum === 'WGS84'); coordinate(pos.point.longitude, 180); coordinate(pos.point.latitude, 90);
    const u = pos.point.horizontalUncertaintyM;
    check(u === null || (typeof u === 'number' && Number.isFinite(u) && u >= 0), 'INVALID_GEOMETRY');
    const su = pos.shape.horizontalUncertaintyM;
    check(su === undefined || (typeof su === 'number' && Number.isFinite(su) && su >= 0), 'INVALID_GEOMETRY');
    check((su ?? null) === u, 'GEOMETRY_BINDING_MISMATCH');
    if (pos.shape.kind === 'POLYGON') {
      check(Array.isArray(pos.shape.ring) && pos.shape.ring.length >= 3 && pos.shape.ring.length <= 2048, 'INVALID_GEOMETRY');
      for (const vertex of pos.shape.ring) { fields(vertex, ['longitude', 'latitude']); coordinate(vertex.longitude, 180); coordinate(vertex.latitude, 90); }
    }
    if (pos.shape.kind === 'EXTENT') {
      coordinate(pos.shape.west, 180); coordinate(pos.shape.east, 180); coordinate(pos.shape.south, 90); coordinate(pos.shape.north, 90);
      check(pos.shape.south < pos.shape.north && pos.shape.west !== pos.shape.east, 'INVALID_GEOMETRY');
    }
    if (pos.shape.kind === 'POINT') {
      coordinate(pos.shape.longitude, 180); coordinate(pos.shape.latitude, 90);
      check(pos.shape.longitude === pos.point.longitude && pos.shape.latitude === pos.point.latitude, 'GEOMETRY_BINDING_MISMATCH');
    }
  }
  const unplaced = new Set<string>();
  for (const id of p.geometry.unplaced) {
    text(id); check(records.has(id) && !placed.has(id) && !unplaced.has(id), 'GEOMETRY_BINDING_MISMATCH'); unplaced.add(id);
  }
  check([...records.keys()].every(id => placed.has(id) || unplaced.has(id)), 'GEOMETRY_BINDING_MISMATCH');
  const ready = p.geometry.positions.length > 0;
  check(p.status === (ready ? 'READY' : 'UNAVAILABLE') && p.error === (ready ? null : 'GEOMETRY_NOT_AVAILABLE'));
  fields(p.provenance, ['compilerId', 'compilerVersion', 'transformIdentity', 'specDigest', 'sourceSelectionDigest']);
  check(p.provenance.compilerId === 'payload.fixture-projection' && p.provenance.transformIdentity === 'payload.projection/GLOBAL_3D/v1');
  text(p.provenance.compilerVersion);
  check(p.provenance.specDigest === await projectionDigest(p.spec), 'DIGEST_MISMATCH');
  check(p.provenance.sourceSelectionDigest === await projectionDigest(p.records), 'DIGEST_MISMATCH');
  const { digest, ...body } = p;
  check(digest === await projectionDigest(body), 'DIGEST_MISMATCH');
  return freeze(p as unknown as PublicProjection);
}
/** Only literal declared points are drawn. Boundaries are not converted into sites. */
export function drawablePositions(projection: PublicProjection): ProjectionPosition[] {
  return projection.geometry.positions.filter(p => p.shape.kind === 'POINT');
}
export function safeHttpUrl(value: string): URL {
  const url = new URL(value);
  check((url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
    !url.username && !url.password && !url.search && !url.hash, 'INVALID_ENDPOINT');
  return url;
}
export function bridgeMessage(value: unknown, channel: string, type: string): value is JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as JsonRecord;
  return v.schema === BRIDGE_SCHEMA && v.channel === channel && v.type === type;
}
