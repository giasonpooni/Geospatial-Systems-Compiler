/** Runtime eligibility checks, not source authentication or evidence admission. */
import type { EntityState, WorldEvent, WorldSnapshot } from './contracts';

type Row = Record<string, unknown>;
const MAX_ITEMS = 10_000;
const MAX_VALUES = 250_000;
const MAX_TEXT = 4096;
const LIFECYCLE = ['active', 'inactive', 'planned', 'degraded', 'disrupted', 'unknown'];
const MODES = ['road', 'rail', 'maritime', 'air'];
const NODE_KINDS = ['port', 'airport', 'rail_terminal', 'trucking_hub', 'warehouse',
  'distribution_center', 'border_crossing', 'mine', 'oil_field', 'gas_field',
  'agricultural_region', 'refinery', 'smelter', 'chemical_plant', 'steel_mill',
  'processing_facility', 'factory', 'industrial_park', 'manufacturing_cluster',
  'consumption_center', 'city', 'chokepoint'];
const CONSTRAINTS = ['chokepoint', 'border', 'capacity', 'draft_limit', 'weather', 'regulatory', 'congestion'];

function fail(field: string): never { throw new Error(`Invalid provider data: ${field}`); }
export function text(value: unknown, field: string, maximum = MAX_TEXT): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) fail(field);
  return value;
}
export function identifier(value: unknown, field: string): string {
  const result = text(value, field, 256);
  if (/\s/.test(result)) fail(field);
  return result;
}
export function finite(value: unknown, field: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(field);
  return value;
}
function row(value: unknown, field: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(field);
  return value as Row;
}
function list(value: unknown, field: string, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > MAX_ITEMS) fail(field);
  return value;
}
function choice(value: unknown, allowed: readonly string[], field: string): void {
  if (typeof value !== 'string' || !allowed.includes(value)) fail(field);
}
function optional(record: Row, field: string, check: (value: unknown, field: string) => unknown): void {
  if (record[field] !== undefined) check(record[field], field);
}
function bool(value: unknown, field: string): void { if (typeof value !== 'boolean') fail(field); }
function nonnegative(value: unknown, field: string): void { finite(value, field, 0); }
function fraction(value: unknown, field: string): void { finite(value, field, 0, 1); }
function unit(value: unknown, field: string): void {
  const result = text(value, field, 128);
  if (result.trim() !== result) fail(field);
}
function ids(value: unknown, field: string): string[] {
  const values = list(value, field).map((entry) => identifier(entry, field));
  if (new Set(values).size !== values.length) fail(`${field}: duplicate references`);
  return values;
}

/** UTC only, real calendar dates and at most millisecond precision; no Date rollover. */
export function instant(value: unknown, field = 'time'): number {
  const s = text(value, field, 24);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(s);
  if (!match) fail(field);
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) fail(field);
  return Date.parse(s);
}
function interval(record: Row, from: string, to: string): void {
  optional(record, from, instant); optional(record, to, instant);
  if (record[from] !== undefined && record[to] !== undefined && instant(record[to]) <= instant(record[from])) fail(`${from}/${to}: empty or reversed interval`);
}
function provenance(value: unknown): void {
  const p = row(value, 'provenance');
  text(p.source, 'provenance.source'); instant(p.knownAt, 'provenance.knownAt');
  interval(p, 'validFrom', 'validTo');
  optional(p, 'evidence', (v, f) => list(v, f).forEach((entry) => text(entry, f)));
  optional(p, 'confidence', fraction);
}
function lonLat(value: unknown): void {
  const p = list(value, 'WGS84 position');
  if (p.length !== 2) fail('WGS84 lon/lat pair');
  finite(p[0], 'longitude', -180, 180); finite(p[1], 'latitude', -90, 90);
}
function quantity(value: unknown, field: string): void {
  const q = row(value, field); finite(q.value, `${field}.value`, 0); unit(q.unit, `${field}.unit`);
}
function base(value: unknown): Row {
  const r = row(value, 'record'); identifier(r.id, 'id'); provenance(r.provenance); return r;
}
function entity(r: Row): void {
  text(r.name, 'name'); choice(r.status, LIFECYCLE, 'status'); fraction(r.importance, 'importance');
  optional(r, 'country', (v) => { if (typeof v !== 'string' || !/^[A-Z]{2}$/.test(v)) fail('country'); });
  optional(r, 'tags', (v, f) => list(v, f).forEach((entry) => text(entry, f)));
}
function routeConstraint(value: unknown): Row {
  const r = row(value, 'route constraint'); identifier(r.id, 'constraint.id');
  choice(r.type, CONSTRAINTS, 'constraint.type'); text(r.description, 'description');
  fraction(r.severity, 'severity'); optional(r, 'atFraction', fraction); return r;
}

/** Reject non-data values/getters before cloning; bounds apply also to extension fields. */
function dataTree(value: unknown): void {
  let count = 0;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number, arrayEntry = false): void {
    if (++count > MAX_VALUES || depth > 32) fail('snapshot structural budget');
    if (item === undefined && !arrayEntry) return; // optional TypeScript properties
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') { finite(item, 'number'); return; }
    if (typeof item === 'string') { if (item.length > MAX_TEXT) fail('text budget'); return; }
    if (!item || typeof item !== 'object') fail('expected plain data');
    if (ancestors.has(item)) fail('cyclic data');
    ancestors.add(item);
    const array = Array.isArray(item);
    if (array) list(item, 'array'); else row(item, 'object');
    if (Object.getOwnPropertySymbols(item).length) fail('symbol property');
    const properties = Object.getOwnPropertyDescriptors(item);
    if (array && Object.keys(properties).length !== item.length + 1) fail('sparse or extended array');
    if (array) for (let index = 0; index < item.length; index++) if (!Object.hasOwn(properties, index)) fail('sparse array');
    for (const [key, descriptor] of Object.entries(properties)) {
      if (array && key === 'length') continue;
      if (!('value' in descriptor) || !descriptor.enumerable || key.length > MAX_TEXT) fail('non-data property');
      visit(descriptor.value, depth + 1, array);
    }
    ancestors.delete(item);
  }
  visit(value, 0);
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** A detached immutable snapshot; no provider-owned references escape. */
export function validatedSnapshot(input: unknown): WorldSnapshot {
  dataTree(input);
  const s = row(structuredClone(input), 'snapshot');
  const collections = ['nodes', 'routes', 'flows', 'commodities', 'events', 'constraints', 'assertions', 'observations'] as const;
  const allIds = new Set<string>();
  const records = Object.fromEntries(collections.map((name) => [name, list(s[name], name).map((item) => {
    const r = base(item); const id = r.id as string;
    if (allIds.has(id)) fail(`duplicate identity: ${id}`); allIds.add(id); return r;
  })])) as Record<typeof collections[number], Row[]>;
  const nodes = new Set(records.nodes.map((r) => r.id as string));
  const routes = new Map(records.routes.map((r) => [r.id as string, r]));
  const flows = new Set(records.flows.map((r) => r.id as string));
  const entities = new Set([...nodes, ...routes.keys(), ...flows]);
  const commodities = new Set(records.commodities.map((r) => r.id as string));
  const reference = (v: unknown, allowed: Set<string> | Map<string, unknown>, field: string) => {
    if (!allowed.has(identifier(v, field))) fail(`${field}: unresolved reference`);
  };
  for (const r of records.nodes) {
    entity(r); choice(r.kind, NODE_KINDS, 'node.kind');
    const geometry = row(r.geometry, 'node.geometry'); if (geometry.type !== 'Point') fail('node.geometry.type'); lonLat(geometry.coordinates);
    optional(r, 'capacity', quantity); optional(r, 'operator', text);
    for (const f of ['inputs', 'outputs']) optional(r, f, (v) => ids(v, f).forEach((id) => reference(id, commodities, f)));
    optional(r, 'connectedRouteIds', (v) => ids(v, 'connectedRouteIds').forEach((id) => {
      reference(id, routes, 'connectedRouteIds'); const route = routes.get(id)!;
      if (route.originId !== r.id && route.destinationId !== r.id) fail('connectedRouteIds: unrelated route');
    }));
    for (const f of ['connectedSupplierIds', 'connectedCustomerIds']) optional(r, f, (v) => ids(v, f).forEach((id) => reference(id, nodes, f)));
    for (const f of ['drafts', 'cargoTonnesPerYear', 'areaSqm']) optional(r, f, nonnegative);
    optional(r, 'berths', (v, f) => { nonnegative(v, f); if (!Number.isSafeInteger(v)) fail(f); });
    optional(r, 'portType', (v, f) => choice(v, ['container', 'bulk', 'energy', 'mixed'], f));
    optional(r, 'iata', (v, f) => { if (typeof v !== 'string' || !/^[A-Z]{3}$/.test(v)) fail(f); });
    optional(r, 'intermodal', bool);
  }
  const nestedIds = new Set(allIds);
  const uniqueNested = (id: unknown) => { const key = identifier(id, 'nested id'); if (nestedIds.has(key)) fail(`duplicate identity: ${key}`); nestedIds.add(key); };
  for (const r of records.routes) {
    entity(r); if (r.kind !== 'route') fail('route.kind'); choice(r.mode, MODES, 'route.mode');
    reference(r.originId, nodes, 'originId'); reference(r.destinationId, nodes, 'destinationId');
    const geometry = row(r.geometry, 'route.geometry'); if (geometry.type !== 'LineString') fail('route.geometry.type');
    list(geometry.coordinates, 'route coordinates', 2).forEach(lonLat);
    nonnegative(r.distanceKm, 'distanceKm'); nonnegative(r.estimatedDurationHours, 'estimatedDurationHours');
    quantity(r.capacity, 'capacity'); fraction(r.utilization, 'utilization');
    list(r.constraints, 'route.constraints').forEach((v) => uniqueNested(routeConstraint(v).id));
    let previous = -Infinity;
    list(r.historicalState, 'historicalState').forEach((v) => {
      const sample = row(v, 'sample'); const t = instant(sample.t); if (t <= previous) fail('historicalState: order'); previous = t;
      fraction(sample.utilization, 'utilization'); fraction(sample.congestion, 'congestion'); choice(sample.status, LIFECYCLE, 'status');
    });
    optional(r, 'corridorId', identifier); // external grouping label, not an invented entity
    optional(r, 'bidirectional', bool);
    optional(r, 'geometryBasis', (v, f) => choice(v, ['routed', 'great_circle_estimate', 'synthetic_corridor'], f));
  }
  for (const r of records.commodities) {
    text(r.name, 'commodity.name'); unit(r.unit, 'commodity.unit');
    choice(r.category, ['metals', 'energy', 'agriculture', 'chemicals', 'consumer', 'machinery', 'automotive', 'electronics'], 'commodity.category');
  }
  for (const r of records.flows) {
    text(r.name, 'flow.name'); reference(r.commodityId, commodities, 'commodityId');
    reference(r.originId, nodes, 'flow.originId'); reference(r.destinationId, nodes, 'flow.destinationId');
    fraction(r.intensity, 'intensity'); choice(r.status, ['moving', 'holding', 'delayed', 'delivered'], 'flow.status');
    optional(r, 'tags', (v, f) => list(v, f).forEach((tag) => text(tag, f)));
    let preceding = r.originId;
    list(r.segments, 'segments', 1).forEach((v, index) => {
      const segment = row(v, 'segment'); uniqueNested(segment.id);
      reference(segment.routeId, routes, 'segment.routeId'); reference(segment.fromNodeId, nodes, 'fromNodeId'); reference(segment.toNodeId, nodes, 'toNodeId');
      const route = routes.get(segment.routeId as string)!;
      choice(segment.mode, MODES, 'segment.mode'); if (segment.mode !== route.mode) fail('segment mode differs from route');
      if (segment.sequence !== index || segment.fromNodeId !== preceding) fail('segment sequence/continuity');
      preceding = segment.toNodeId;
      optional(segment, 'span', (v) => { const span = list(v, 'span'); if (span.length !== 2) fail('span'); span.forEach((x) => fraction(x, 'span')); if ((span[0] as number) >= (span[1] as number)) fail('span order'); });
      const span = segment.span as number[] | undefined;
      if (span === undefined || (span[0] === 0 && span[1] === 1)) {
        const forward = segment.fromNodeId === route.originId && segment.toNodeId === route.destinationId;
        const reverse = route.bidirectional === true && segment.fromNodeId === route.destinationId && segment.toNodeId === route.originId;
        if (!forward && !reverse) fail('whole segment endpoints differ from route');
      }
    });
    if (preceding !== r.destinationId) fail('flow destination differs from final segment');
  }
  for (const r of records.events) {
    text(r.name, 'event.name'); text(r.description, 'event.description'); ids(r.affects, 'affects').forEach((id) => reference(id, entities, 'affects'));
    fraction(r.severity, 'severity'); instant(r.start, 'start'); interval(r, 'start', 'end');
    choice(r.category, ['congestion', 'closure', 'weather', 'strike', 'demand_surge', 'incident'], 'event.category');
  }
  for (const r of records.constraints) { routeConstraint(r); reference(r.entityId, entities, 'constraint.entityId'); interval(r, 'validFrom', 'validTo'); }
  for (const name of ['assertions', 'observations'] as const) for (const r of records[name]) {
    reference(r.entityId, entities, `${name}.entityId`); identifier(r.metric, 'metric'); finite(r.value, 'value'); optional(r, 'unit', unit);
    instant(r[name === 'assertions' ? 'assertedAt' : 't'], name);
  }
  list(s.cityLights, 'cityLights').forEach((v) => { const p = list(v, 'cityLight'); if (p.length !== 3) fail('cityLight'); lonLat(p.slice(0, 2)); fraction(p[2], 'cityLight.intensity'); });
  const range = row(s.timeRange, 'timeRange'); const start = instant(range.start), end = instant(range.end), now = instant(range.now);
  if (!(start < end && start <= now && now <= end)) fail('timeRange order');
  const meta = row(s.meta, 'meta'); text(meta.label, 'meta.label'); text(meta.disclaimer, 'meta.disclaimer'); instant(meta.generatedAt, 'meta.generatedAt');
  return deepFreeze(s as unknown as WorldSnapshot);
}

export function validatedState(input: unknown, entityId: string, t: string, events: ReadonlyMap<string, WorldEvent>): EntityState {
  dataTree(input); const state = row(structuredClone(input), 'entity state');
  instant(state.t);
  if (state.entityId !== entityId || state.t !== t) fail('state identity/time mismatch');
  fraction(state.utilization, 'state.utilization'); fraction(state.congestion, 'state.congestion'); choice(state.status, LIFECYCLE, 'state.status');
  ids(state.activeEventIds, 'activeEventIds').forEach((id) => {
    const event = events.get(id), time = instant(t);
    if (!event || !event.affects.includes(entityId) || time < instant(event.start) ||
        (event.end !== undefined && time >= instant(event.end))) fail('active event entity/time mismatch');
  });
  return deepFreeze(state as unknown as EntityState);
}
