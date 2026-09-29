import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, appendFile, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SOURCE_REGISTRY, sensorCardsForAdapter, registerSource, missLoggable, type RegisteredSource } from './sourceRegistry';
import { listAdapters, registerAdapter } from './adapters';
import { getEconomyState, type AssembledState } from './store';
import { cachedSourceWithReceipt, clearSourceCache } from '../sourceCache';
import { seatProjection, readAdapterSensor } from './seatProjection';
import { GET, POST } from '@/app/api/economy/seat/route';
import { ROUTE_DISPOSITION } from '../routeGate';
import { sessionDigest } from './sessionTelemetry';
import { appendSeatArtifact, readSeatArtifacts } from './seatArtifacts';
import { measurementClassOf } from './types';

const SESSION = '4aa8e31f-d1f4-4c5d-87a6-805be59b8f09';
const TOKEN = 'synthetic-test-authority';
const context = { sessionId: SESSION, commodity: 'copper', asOf: null, knowledge: 'best_known', entityIds: ['ent:mine:escondida'] };
const miss = () => ({ ...context, kind: 'miss', question: 'stocks', gapIds: ['lme-licensed'] });
const request = (body: unknown, headers: Record<string, string> = {}) => new Request('http://localhost/api/economy/seat', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (query = '', authenticated = false) => GET(new Request(`http://localhost/api/economy/seat${query}`, { headers: authenticated ? { authorization: `Bearer ${TOKEN}` } : {} }));
let assembled: AssembledState;
beforeAll(async () => { assembled = await getEconomyState('copper', { fresh: true }); });

describe('adapter sensor cards extend the one registered-source system', () => {
  it('every source has a serialisable, source-bound card', () => {
    for (const source of SOURCE_REGISTRY) {
      const card = source.sensor!;
      expect(card.sourceId).toBe(source.sourceId);
      expect(JSON.parse(JSON.stringify(card))).toEqual(card);
      expect(card.forbiddenYield).toEqual(['natural_person']);
      expect(card.degradationLadder).toEqual(['live', 'ttl_cache', 'last_good', 'snapshot']);
      expect(card.postingWindow).toBeNull();
      expect(card.ledgers.length).toBeGreaterThan(0);
    }
  });
  it('covers every current adapter, including aluminium and held flow vintages', () => {
    for (const adapter of listAdapters()) expect(sensorCardsForAdapter(adapter.providerId).length, adapter.providerId).toBeGreaterThan(0);
    expect(sensorCardsForAdapter('usgs-mcs-aluminium-live')[0].sourceId).toBe('usgs-mcs');
    expect(sensorCardsForAdapter('comtrade-flow-vintages')[0].availableRungs).toEqual(['snapshot']);
    expect(sensorCardsForAdapter('curated-aluminium-v1')[0].availableRungs).toEqual(['snapshot']);
  });
  it('keeps price and positioning out of physical ledgers, Westmetall out of resale', () => {
    expect(sensorCardsForAdapter('yahoo-copper-price')[0].ledgers).toEqual(['market_price']);
    expect(sensorCardsForAdapter('cftc-positioning')[0].ledgers).toEqual(['financial_positioning']);
    expect(sensorCardsForAdapter('westmetall-lme-stocks')[0].licensePosture).toBe('research_only_not_for_resale');
  });
  for (const yieldKind of ['natural_person', 'resident', 'phone', 'device', 'maid']) it(`refuses ${yieldKind} at runtime registration before mutation`, () => {
    const count = SOURCE_REGISTRY.length;
    const input = { ...SOURCE_REGISTRY[0], sourceId: `fixture-${yieldKind}`, yields: [yieldKind] } as unknown as RegisteredSource;
    expect(() => registerSource(input)).toThrow(/source_yield_refused/);
    expect(SOURCE_REGISTRY.length).toBe(count);
  });
  it('refuses removal of the natural-person exclusion', () => {
    const source = structuredClone(SOURCE_REGISTRY[0]);
    source.sensor!.forbiddenYield = [] as unknown as ['natural_person'];
    expect(() => registerSource(source)).toThrow(/sensor_card_refused/);
  });
  it('requires a sensor for a newly registered adapter', () => {
    expect(() => registerAdapter({ providerId: 'missing-sensor', providerName: 'Fixture', commodities: [], load: async () => { throw new Error('unreachable'); } })).toThrow(/adapter_sensor_missing/);
  });
  it('source entries cannot be mutated after registration', () => {
    expect(Object.isFrozen(SOURCE_REGISTRY[0])).toBe(true);
    expect(Object.isFrozen(SOURCE_REGISTRY[0].sensor!.forbiddenYield)).toBe(true);
  });
  it('direct array mutation cannot bypass registration policy', () => {
    expect(() => SOURCE_REGISTRY.push(SOURCE_REGISTRY[0])).toThrow('source_registry_read_only');
  });
  it('new registered vocabulary participates in the existing miss gate', () => {
    const source = structuredClone(SOURCE_REGISTRY[0]);
    source.sourceId = 'fixture-vocabulary'; source.adapter = null; source.additionalAdapters = [];
    source.keywords = ['fixturevocabcensus']; source.sensor!.sourceId = source.sourceId;
    source.sensor!.availableRungs = [];
    registerSource(source);
    expect(missLoggable('fixturevocabcensus')).toBe(true);
  });
  it('current snapshot reads carry explicit acquisition metadata without enabling HTTP', () => {
    const records = assembled.state.observations.filter(o => o.provenance.acquisition);
    expect(records.length).toBeGreaterThan(0);
    expect(records.every(o => o.provenance.acquisition!.rung === 'snapshot')).toBe(true);
    expect(records.every(o => o.provenance.acquisition!.lastLiveAt === null)).toBe(true);
  });
  it('cards cover the ledgers actually produced by all economy adapters', async () => {
    for (const adapter of listAdapters()) {
      const payload = await adapter.load(adapter.commodities[0]);
      const allowed = sensorCardsForAdapter(adapter.providerId).flatMap(c => c.ledgers);
      for (const observation of payload.observations) expect(allowed, `${adapter.providerId}:${observation.metric}`).toContain(measurementClassOf(observation.metric));
    }
  });
});

describe('cache receipts distinguish freshness from a successful fallback', () => {
  afterEach(() => { clearSourceCache(); vi.useRealTimers(); });
  it('live → TTL → last-good stays degraded during retry TTL and recovers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T00:00:00Z'));
    let fail = false;
    const loader = cachedSourceWithReceipt('fixture:ladder', async () => { if (fail) throw new Error('synthetic outage'); return [7]; }, 100);
    const first = await loader(); expect(first.rung).toBe('live');
    expect((await loader()).rung).toBe('ttl_cache');
    fail = true; vi.advanceTimersByTime(101);
    const fallback = await loader(); expect(fallback.rung).toBe('last_good');
    expect(fallback.acquiredAt).toBe(first.acquiredAt);
    expect((await loader()).rung).toBe('last_good');
    fail = false; vi.advanceTimersByTime(60_001);
    expect((await loader()).rung).toBe('live');
  });
  it('empty refresh does not turn old data into a live reading', async () => {
    vi.useFakeTimers(); let empty = false;
    const read = cachedSourceWithReceipt('fixture:empty', async () => empty ? [] : [1], 5);
    await read(); empty = true; vi.advanceTimersByTime(6);
    expect((await read()).rung).toBe('last_good');
  });
  it('no cache plus failure remains no records, not fresh data', async () => {
    const read = cachedSourceWithReceipt('fixture:dark', async () => { throw new Error('synthetic outage'); });
    expect(await read()).toEqual({ data: [], rung: 'last_good', acquiredAt: null });
  });
});

describe('seat read model binds selection and assembly status', () => {
  it('counts all four value kinds without collapsing evidence classes', () => {
    const seat = seatProjection(assembled, { commodity: 'copper', asOf: '2026-09-28', knowledge: 'best_known' });
    expect(seat.sku.kind).toBe('commodity');
    expect(Object.keys(seat.evidenceClassMix)).toEqual(['reported', 'estimated', 'representative', 'derived']);
    expect(Object.values(seat.evidenceClassMix).reduce((a, b) => a + b, 0)).toBe(seat.recordPopulation.observations + seat.recordPopulation.flows + seat.recordPopulation.capacities);
    expect(seat.lastSuccessfulAssembleTime).toBe(assembled.assembledAt);
    expect(seat.sensorsDegraded).toContain('westmetall-lme-stocks');
    expect(seat.unresolvedIdentifierCount).toBe(assembled.state.unresolved!.length);
  });
  it('reading a memoized assembly does not fabricate a new success time', async () => {
    const again = await getEconomyState('copper');
    expect(again.assembledAt).toBe(assembled.assembledAt);
  });
  it('keeps historical record mix distinct from current acquisition health', () => {
    const best = seatProjection(assembled, { commodity: 'copper', asOf: '2019-06-01', knowledge: 'best_known' });
    const then = seatProjection(assembled, { commodity: 'copper', asOf: '2019-06-01', knowledge: 'as_known_then' });
    expect(then.recordPopulation.observations).toBeLessThan(best.recordPopulation.observations);
    expect(then.sensorStatusFrame).toBe('current_assembly_not_historical');
    expect(then.lastSuccessfulAssembleTime).toBe(best.lastSuccessfulAssembleTime);
  });
  it('refuses absent corridors rather than matching names', () => {
    expect(() => seatProjection(assembled, { commodity: 'copper', asOf: null, knowledge: 'best_known', corridorId: 'flow:similar-name' })).toThrow('unresolved_identifier');
  });
  it('projects a real, in-frame corridor using its exact flow ID', () => {
    const flow = assembled.state.flows.find(f => f.valueKind === 'representative')!;
    const seat = seatProjection(assembled, { commodity: 'copper', asOf: flow.period.start, knowledge: 'best_known', corridorId: flow.id });
    expect(seat.sku).toMatchObject({ kind: 'corridor', corridorId: flow.id });
  });
  it('dark adapters remain visible even without a payload', () => {
    expect(readAdapterSensor('usgs-mcs-live', null)).toMatchObject({ state: 'dark', reason: 'adapter_failed', records: 0 });
  });
});

describe('classified seat API: durable round-trip without raw requester data', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'payload-seat-'));
    vi.stubEnv('PAYLOAD_MISS_LOG_DIR', dir);
    vi.stubEnv('PAYLOAD_FORCE_MISS_LOG', '1');
    vi.stubEnv('PAYLOAD_OPERATIONS_TOKEN', TOKEN);
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
  it('classifies the only new route and exposes sensor cards without starting an assembly', async () => {
    expect(ROUTE_DISPOSITION['economy/seat']).toBe('freight');
    const response = await get('?view=sensors');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).sources.length).toBe(SOURCE_REGISTRY.length);
  });
  for (const body of [miss(), { ...context, kind: 'query', question: 'inspect' }, ...['policy', 'unresolved_identifier', 'basis_refused', 'coverage_gap'].map(reason => ({ ...context, kind: 'refusal', question: 'coverage', reason }))]) {
    it(`writes and reads ${body.kind}${'reason' in body ? ':' + body.reason : ''} through the API`, async () => {
      const before = sessionDigest();
      const written = await POST(request(body)); expect(written.status).toBe(201);
      const result = await written.json();
      const response = await get(`?view=artifacts&sessionId=${SESSION}&kind=${body.kind}`, true);
      expect(response.status).toBe(200);
      const read = await response.json(); expect(read.records).toEqual([result.record]);
      expect(read.accounting).toMatchObject({ fetchedRows: 1, accepted: 1, rejected: 0 });
      expect(sessionDigest()).toEqual(before); // no invented S-7 demand
      expect(result.record.origin).toBe('operator_recorded');
    });
  }
  it('journal authority is fail-closed and protects reads as well as writes', async () => {
    expect((await POST(request(miss(), { authorization: '' }))).status).toBe(401);
    expect((await get(`?view=artifacts&kind=miss&sessionId=${SESSION}`)).status).toBe(401);
    vi.stubEnv('PAYLOAD_OPERATIONS_TOKEN', '');
    expect((await POST(request(miss()))).status).toBe(503);
  });
  for (const field of ['q', 'phone', 'email', 'username', 'person', 'maid', 'origin', 'ts', 'id']) it(`refuses extra ${field} before persistence`, async () => {
    const response = await POST(request({ ...miss(), [field]: 'synthetic-private-value' }));
    expect(response.status).toBe(400);
    await expect(stat(join(dir, 'search-misses.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('an arbitrary name is not an opaque session identity', async () => {
    expect((await POST(request({ ...miss(), sessionId: 'fixture@invalid.test' }))).status).toBe(400);
  });
  it('a well-shaped but unregistered entity remains unresolved', async () => {
    expect((await POST(request({ ...miss(), entityIds: ['ent:mine:unregistered'] }))).status).toBe(422);
  });
  it('does not accept an unregistered source as demand with an address', async () => {
    expect((await POST(request({ ...miss(), gapIds: ['unregistered-source'] }))).status).toBe(422);
  });
  it('rejects repeated entity IDs and rolled-over dates', async () => {
    expect((await POST(request({ ...miss(), entityIds: [...context.entityIds, ...context.entityIds] }))).status).toBe(422);
    expect((await get('?asOf=2026-02-30')).status).toBe(400);
    expect((await get('?knowledge=as_known_then')).status).toBe(400);
  });
  it('unknown or repeated query keys cannot smuggle free-text telemetry', async () => {
    expect((await get('?q=fixture')).status).toBe(400);
    expect((await get('?commodity=copper&commodity=aluminium')).status).toBe(400);
  });
  it('excludes declared machine traffic from human journals', async () => {
    expect((await POST(request(miss(), { 'x-payload-client': 'machine' }))).status).toBe(403);
  });
  it('authenticated projection records the context actually served', async () => {
    const response = await get(`?sessionId=${SESSION}&commodity=copper&asOf=2026-09-28`, true);
    expect(response.status).toBe(200);
    expect((await response.json()).recording.status).toBe('persisted');
    const page = await readSeatArtifacts('query', SESSION);
    expect(page.records[0]).toMatchObject({ origin: 'served_projection', asOf: '2026-09-28', commodity: 'copper' });
  });
  it('does not serve old raw text; all filtered and corrupt rows are counted', async () => {
    const path = join(dir, 'search-misses.jsonl');
    await writeFile(path, '{"q":"synthetic old free text"}\nnot-json\n');
    await POST(request(miss()));
    const response = await get(`?view=artifacts&sessionId=${SESSION}&kind=miss`, true);
    const data = await response.json();
    expect(data.accounting).toMatchObject({ fetchedRows: 3, accepted: 1, rejected: 1, filtered: { legacy: 1 } });
    expect(JSON.stringify(data)).not.toContain('synthetic old free text');
    expect(await readFile(path, 'utf8')).toContain('synthetic old free text'); // never rewrite history
  });
  it('paginates physical lines and excludes another session without hiding its count', async () => {
    await appendSeatArtifact({ ...miss(), sessionId: randomUUID() }, assembled.state);
    await POST(request(miss())); await POST(request(miss()));
    const first = await readSeatArtifacts('miss', SESSION, 0, 1);
    expect(first.accounting.filtered.other_session).toBe(1);
    expect(first.nextOffset).toBe(2);
    const second = await readSeatArtifacts('miss', SESSION, first.nextOffset!, 1);
    expect(second.records).toHaveLength(1);
    expect(second.records[0].id).not.toBe(first.records[0].id);
  });
  it('does not skip a trailing partial append on the next read', async () => {
    const made = await (await POST(request(miss()))).json();
    const path = join(dir, 'search-misses.jsonl');
    const next = { ...made.record, id: randomUUID() };
    const row = JSON.stringify(next);
    await appendFile(path, row.slice(0, 30));
    const first = await readSeatArtifacts('miss', SESSION);
    expect(first.accounting).toMatchObject({ fetchedRows: 2, accepted: 1, filtered: { partial_tail: 1 } });
    expect(first.nextOffset).toBe(1);
    await appendFile(path, row.slice(30) + '\n');
    const second = await readSeatArtifacts('miss', SESSION, first.nextOffset!);
    expect(second.records).toEqual([next]);
  });
  it('counts malformed versioned records rather than returning unknown fields', async () => {
    const made = await (await POST(request(miss()))).json();
    await appendFile(join(dir, 'search-misses.jsonl'), JSON.stringify({ ...made.record, q: 'synthetic raw text' }) + '\n');
    expect((await readSeatArtifacts('miss', SESSION)).accounting.rejected).toBe(1);
  });
  it('refuses unwritable storage rather than claiming a successful record', async () => {
    const path = join(dir, 'not-a-directory'); await writeFile(path, 'fixture');
    vi.stubEnv('PAYLOAD_MISS_LOG_DIR', path);
    expect((await POST(request(miss()))).status).toBe(503);
  });
  it('bounds the actual request stream, not an untrusted content-length header', async () => {
    expect((await POST(request({ ...miss(), q: 'x'.repeat(20_000) }))).status).toBe(400);
  });
  it('test writes require the pre-existing explicit scratch-log opt-in', async () => {
    vi.stubEnv('PAYLOAD_FORCE_MISS_LOG', '0');
    expect((await POST(request(miss()))).status).toBe(503);
  });
});
