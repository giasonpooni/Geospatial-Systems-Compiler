import { describe, it, expect } from 'vitest';
import { industrialQualityCases, evidenceFixture, qualityContext } from './industrialObservationQuality.cases';
import { inspectIndustrialObservation } from './industrialObservationQualityRegistry';
import { QUALITY_SCHEMA } from './industrialObservationQuality';
import { SOURCE_REGISTRY } from './sourceRegistry';

describe('industrial observation quality: source, measurement and lineage boundaries', () => {
  for (const scenario of industrialQualityCases()) it(scenario.name, scenario.run);

  it('application wrapper uses the existing source registry', () => {
    const source = SOURCE_REGISTRY.find(s => s.sourceId === 'un-comtrade');
    expect(source?.adapter).toBeTruthy();
    const e = evidenceFixture({ mode: 'operational', sourceId: 'un-comtrade', evidenceClass: 'trade_reporting' });
    const c = qualityContext(e); c.mode = 'operational';
    expect(inspectIndustrialObservation({ schemaVersion: QUALITY_SCHEMA, evidenceId: e.evidenceId }, c).disposition).toBe('REPRESENTED');
  });

  it('application wrapper overrides even an injected source allowlist', () => {
    const e = evidenceFixture({ mode: 'operational', sourceId: 'unregistered-source' });
    const c = qualityContext(e); c.mode = 'operational';
    c.sources = [{ sourceId: e.sourceId, accessClass: 'open', adapter: 'fake-adapter', yields: ['observation'] }];
    expect(inspectIndustrialObservation({ schemaVersion: QUALITY_SCHEMA, evidenceId: e.evidenceId }, c)).toMatchObject({
      disposition: 'REJECTED', reasonCodes: ['SOURCE_NOT_REGISTERED'], record: null,
    });
  });
});
