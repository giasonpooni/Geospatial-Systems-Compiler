import { it, expect } from 'vitest';
import { compilePayloadDomain } from '../gsc/payloadDomain';
import { CRS84 } from '../gsc/adapters';
import { COPPER_ENTITIES, COPPER_OBSERVATIONS, COPPER_FLOWS, COPPER_CAPACITIES, COPPER_DEPENDENCIES, COPPER_EVENTS } from '@/data/economy/copper';
const input = () => ({ coordinateFrame: CRS84, entities: COPPER_ENTITIES, observations: COPPER_OBSERVATIONS,
  flows: COPPER_FLOWS, capacities: COPPER_CAPACITIES, dependencies: COPPER_DEPENDENCIES, events: COPPER_EVENTS });
const bindings = { datasetId: 'payload:curated-copper', releaseId: null, snapshotId: null, runId: null, modelId: null };
it('compiles the actual curated Payload copper domain without replacing it with a GSV-shaped mock', () => {
  const source = input(), result = compilePayloadDomain(source, 'compile:curated-copper', bindings);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) return;
  const r = result.value.records;
  expect(r.length).toBe(Object.entries(source).filter(([key]) => key !== 'coordinateFrame').reduce((n, [, a]) => n + (a as unknown[]).length, 0));
  expect(r.filter((x) => x.source.collection === 'flows').every((x) => x.geometry === null && x.quantity !== null)).toBe(true);
  expect(r.filter((x) => x.source.collection === 'dependencies').some((x) => x.kind === 'operated_by:shareholder')).toBe(true);
  expect(r.filter((x) => x.source.collection === 'dependencies').some((x) => x.kind === 'operated_by:operator')).toBe(true);
  expect(r.filter((x) => x.source.collection === 'flows').every((x) => x.valueKind === x.sourceRecord.valueKind)).toBe(true);
  expect(r.filter((x) => x.source.adapterId === 'payload.domain.v1').every((x) => x.knownAtBasis === 'retrieval-upper-bound')).toBe(true);
  expect(Object.isFrozen(r)).toBe(true);
});
it('domain adapter refuses broken endpoints and undeclared top-level corpus content', () => {
  const source = structuredClone(input()); source.flows[0].toEntityId = 'missing';
  expect(compilePayloadDomain(source, 'compile:test', bindings).ok).toBe(false);
  expect(compilePayloadDomain({ ...input(), secrets: [] }, 'compile:test', bindings).ok).toBe(false);
});
