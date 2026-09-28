import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { GsvInvestigation } from './session';
import { SyntheticProvider } from '../../../packages/gsv/src/data/synthetic/provider';

const pin = '58713d02d4e79c52290ee9d0da51ea6b4d0677ed';
describe('GSV provider, compiler and browser investigation are one data path', () => {
  it('loads the full original world, not an illustrative replacement', async () => {
    const session = await GsvInvestigation.load();
    expect(session.snapshot.nodes).toHaveLength(114);
    expect(session.snapshot.routes).toHaveLength(55);
    expect(session.ir.records).toHaveLength(277);
    expect(session.frame().map.features).toHaveLength(169);
    expect(session.ir.bindings.snapshotId).toBeNull();
    expect(session.ir.bindings.runId).toBeNull();
    expect(session.ir.bindings.modelId).toContain(pin);
  });
  it('one exact selection survives every view and both clocks remain independent', async () => {
    const session = await GsvInvestigation.load();
    const id = session.frame().map.features[0].id;
    expect(session.dispatch({ type: 'select', value: id }).ok).toBe(true);
    const initial = session.frame();
    for (const view of ['geojson', 'unit-sphere', 'table', 'timeline', 'relations']) {
      expect(session.dispatch({ type: 'view', value: view }).ok).toBe(true);
      expect(session.frame().state.selectedRecordId).toBe(id);
      expect(session.frame().state.bindings).toEqual(initial.state.bindings);
    }
    expect(session.dispatch({ type: 'eventCursor', value: '2026-09-01T00:00:00Z' }).ok).toBe(true);
    expect(session.frame().state.knowledgeCutoff).toEqual(initial.state.knowledgeCutoff);
    expect(session.frame().dynamic).not.toEqual(initial.dynamic);
    expect(session.dispatch({ type: 'knowledgeCutoff', value: session.snapshot.timeRange.start }).ok).toBe(true);
    expect(session.frame().selectedUnavailable).toBe(true);
    expect(session.frame().state.selectedRecordId).toBe(id);
    expect(session.frame().dynamic.status).toBe('unavailable');
    expect(session.frame().map.features).toHaveLength(0);
  });
  it('invalid transition leaves prior visible state intact', async () => {
    const session = await GsvInvestigation.load(), before = session.frame();
    for (const cmd of [{ type: 'eventCursor', value: null }, { type: 'knowledgeCutoff', value: '1900-01-01T00:00:00Z' },
      { type: 'select', value: 'invented' }, { type: 'eventCursor', value: '2026-08-31' }]) {
      expect(session.dispatch(cmd).ok).toBe(false);
      expect(session.frame()).toBe(before);
    }
  });
  it('same instant produces identical model values without creating evidence or run identities', async () => {
    const a = await GsvInvestigation.load(), b = await GsvInvestigation.load();
    const id = a.frame().map.features[0].id;
    for (const s of [a, b]) s.dispatch({ type: 'select', value: id });
    expect(a.frame().dynamic).toEqual(b.frame().dynamic);
    expect(a.frame().dynamic.status).toBe('available');
    expect(a.ir.bindings.runId).toBeNull();
  });
  it('a provider without an explicit knowledge policy cannot claim as-known model state', async () => {
    const original = new SyntheticProvider();
    const session = await GsvInvestigation.load({ id: 'test:external', label: 'External fixture',
      load: () => original.load(), stateAt: (id, t) => original.stateAt(id, t) });
    session.dispatch({ type: 'select', value: session.frame().map.features[0].id });
    expect(session.frame().dynamic.status).toBe('unavailable');
  });
  it('contributing event known in the future makes numerical output unavailable, not just its label', async () => {
    class LateEventProvider extends SyntheticProvider {
      override async load() {
        const snapshot = structuredClone(await super.load());
        const e = snapshot.events.find((e) => e.end && Date.parse(e.end) - Date.parse(e.start) > 12 * 3_600_000)!;
        e.provenance.knownAt = snapshot.timeRange.end;
        return snapshot;
      }
    }
    const session = await GsvInvestigation.load(new LateEventProvider());
    const event = session.snapshot.events.find((e) => e.provenance.knownAt === session.snapshot.timeRange.end)!;
    const time = new Date(Date.parse(event.start) + 6 * 3_600_000).toISOString();
    const entity = session.ir.records.find((r) => r.source.recordId === event.affects[0])!;
    session.dispatch({ type: 'eventCursor', value: time });
    session.dispatch({ type: 'select', value: entity.id });
    expect(session.frame().dynamic.status).toBe('unavailable');
    if (session.frame().dynamic.status === 'unavailable') expect(session.frame().dynamic).toMatchObject({ reason: expect.stringContaining('not known') });
  });
});
it('every imported file matches its pinned source or declared adaptation exactly', () => {
  const manifest = JSON.parse(readFileSync('packages/gsv/ORIGIN.json', 'utf8'));
  expect(manifest.commit).toBe(pin);
  expect(manifest.files.length).toBeGreaterThan(30);
  for (const item of manifest.files) {
    const bytes = readFileSync(item.destination);
    const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    expect(actual, item.destination).toBe(item.adaptedBlob ?? item.upstreamBlob);
    if (item.adaptedBlob) expect(item.adaptation).toBeTruthy();
  }
});
it('runs all original GSV provider, seam and view-command regressions from the merged repository', () => {
  execFileSync(process.execPath, ['--import', 'tsx', '--test',
    'packages/gsv/tests/provider-boundary.test.mjs', 'packages/gsv/tests/seam.test.mjs', 'packages/gsv/tests/view-tools.test.mjs'],
    { timeout: 60_000, stdio: 'pipe' });
}, 65_000);
