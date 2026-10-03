/** Shared hermetic regressions, registered with Vitest in the adjacent test. */
import assert from 'node:assert/strict';
import { QUALITY_SCHEMA, validateIndustrialObservation, type QualityContext, type QualityEvidence,
  type QualityReason, type QualityResult } from './industrialObservationQuality';

export type QualityCase = { name: string; run: () => void };
const window = { start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z' };
export const gapPayload = () => ({ kind: 'FEED_GAP', feedRef: 'feed:test', queryRef: 'query:test',
  returnedRecords: 0, coverage: 'unknown', coverageEvidenceId: null, collectionHealth: 'unknown', healthEvidenceId: null });
export const evidenceFixture = (patch: Partial<QualityEvidence> = {}): QualityEvidence => ({
  evidenceId: 'evidence:test', artifactId: 'artifact:test-v1', sourceId: 'fixture:industrial', sourceVersion: 'v1',
  mode: 'synthetic', subjectClass: 'industrial', evidenceClass: 'feed_query', dependencies: [],
  subjectRef: 'instrument:test', times: { eventWindow: null, measurementWindow: { ...window },
    publishedAt: null, retrievedAt: '2026-01-02T00:00:00Z' }, payload: gapPayload(), ...patch,
});
export const qualityContext = (e: QualityEvidence, more: QualityEvidence[] = []): QualityContext => ({
  mode: 'synthetic', sources: [], evidence: new Map([e, ...more].map(x => [x.evidenceId, x])),
});
const request = { schemaVersion: QUALITY_SCHEMA, evidenceId: 'evidence:test' };
const run = (e: QualityEvidence, more: QualityEvidence[] = []) => validateIndustrialObservation(request, qualityContext(e, more));
function represented(r: QualityResult) { assert.equal(r.disposition, 'REPRESENTED'); if (r.disposition !== 'REPRESENTED') throw new Error('Expected representation'); return r.record; }
function rejected(r: QualityResult, reason?: QualityReason) { assert.equal(r.disposition, 'REJECTED'); if (r.disposition !== 'REJECTED') throw new Error('Expected refusal'); assert.equal(r.record, null); if (reason) assert.deepEqual(r.reasonCodes, [reason]); }
const qualityPayload = () => ({ kind: 'QUALITY_ASSESSMENT', metric: 'packet_loss_fraction', value: 0.2, unit: '1', methodRef: 'operation:loss-v1', executionRef: 'run:test', verificationRef: null as string | null });
const qualityEvidence = () => evidenceFixture({ evidenceClass: 'instrument_diagnostic', payload: qualityPayload() });
const coverageEvidence = () => evidenceFixture({ evidenceId: 'evidence:coverage', evidenceClass: 'acquisition_metadata',
  payload: { coverage: 'complete', feedRef: 'feed:test', queryRef: 'query:test' } });
const residualEvidence = () => evidenceFixture({ evidenceClass: 'model_result', dependencies: ['evidence:measurement'], payload: {
  kind: 'MODEL_RESIDUAL', observed: 0.2, predicted: 0.1, residual: 0.1, unit: '1', uncertainty: null,
  measurementEvidenceId: 'evidence:measurement', methodRef: 'operation:model-v1', executionRef: 'run:model',
} });
const measurementEvidence = () => ({ ...qualityEvidence(), evidenceId: 'evidence:measurement' });
const hypothesisEvidence = () => evidenceFixture({ evidenceClass: 'hypothesis', dependencies: ['evidence:measurement'], payload: {
  kind: 'HYPOTHESIS', hypothesisRef: 'hypothesis:test', relationship: 'causal_hypothesis', target: 'sensor_quality',
  supportEvidenceIds: ['evidence:measurement'], alternativeRefs: ['hypothesis:alternative'], requiredTestRef: 'test:rf-diagnostic',
} });

/** Each registration owns its case list; no mutable module-level registry. */
export function industrialQualityCases(): readonly QualityCase[] {
  const cases: QualityCase[] = [];
  const test = (name: string, run: () => void) => cases.push({ name, run });
  test('an empty feed is represented without inventing an absent transmission or cause', () => {
    const r = represented(run(evidenceFixture()));
    assert.equal(r.kind, 'FEED_GAP'); assert.equal(r.confidence, null);
    assert.equal(r.physicalCause, 'NOT_ESTABLISHED'); assert.equal(r.admission, 'NOT_PERFORMED');
    assert.equal(r.payload.collectionHealth, 'unknown'); assert.equal(r.times.eventWindow, null);
  });
  test('source/version and artifact identities survive independently', () => {
    const r = represented(run(evidenceFixture()));
    assert.deepEqual(r.provenance, [{ evidenceId: 'evidence:test', artifactId: 'artifact:test-v1', sourceId: 'fixture:industrial', sourceVersion: 'v1' }]);
  });
  test('output copies do not alias supplied metadata or payload', () => {
    const e = evidenceFixture(), r = represented(run(e)); r.times.measurementWindow!.start = 'changed'; r.payload.queryRef = 'changed';
    assert.equal(e.times.measurementWindow!.start, window.start); assert.equal((e.payload as Record<string, unknown>).queryRef, 'query:test');
  });
  for (const classification of ['natural_person', 'mixed'] as const) test(`refuse ${classification} despite industrial labels`, () => {
    rejected(run(evidenceFixture({ subjectClass: classification })), 'PERSON_LEVEL_SOURCE_NOT_ADMISSIBLE');
  });
  for (const classification of ['person_level', 'mixed'] as const) test(`refuse ${classification} source content`, () => {
    rejected(run(evidenceFixture({ evidenceClass: classification })), 'PERSON_LEVEL_SOURCE_NOT_ADMISSIBLE');
  });
  test('a person dependency cannot be laundered through an industrial derived node', () => {
    const person = evidenceFixture({ evidenceId: 'Signal_Source_8492', subjectClass: 'natural_person', payload: { person: 'PRIVATE_PAYLOAD', location: 'PRIVATE_LOCATION' } });
    const r = run(evidenceFixture({ dependencies: [person.evidenceId] }), [person]); rejected(r, 'PERSON_LEVEL_SOURCE_NOT_ADMISSIBLE');
    for (const secret of ['PRIVATE_PAYLOAD', 'PRIVATE_LOCATION', 'Signal_Source_8492']) assert.equal(JSON.stringify(r).includes(secret), false);
  });
  test('eligibility failure precedes payload getters', () => {
    const e = evidenceFixture({ subjectClass: 'natural_person' });
    Object.defineProperty(e, 'payload', { get() { throw new Error('raw data was read'); } });
    rejected(run(e), 'PERSON_LEVEL_SOURCE_NOT_ADMISSIBLE');
  });
  for (const field of ['subjectClass', 'evidenceClass'] as const) test(`unknown ${field} is not eligibility`, () => {
    rejected(run(evidenceFixture({ [field]: 'unknown' })), 'SOURCE_ELIGIBILITY_UNESTABLISHED');
  });
  for (const raw of [{ posting: 'PRIVATE_POST', likes: 500 }, { ...request, occupancy_excluded: true }, { ...request, sourceId: 'industrial' }]) {
    test(`reject raw input or caller authority fields: ${Object.keys(raw).join(',')}`, () => rejected(validateIndustrialObservation(raw, qualityContext(evidenceFixture())), 'INVALID_REQUEST'));
  }
  test('unknown references produce only a fixed refusal code', () => {
    rejected(validateIndustrialObservation({ ...request, evidenceId: 'unknown' }, qualityContext(evidenceFixture())), 'EVIDENCE_NOT_FOUND');
  });
  test('missing dependency is not silently ignored', () => rejected(run(evidenceFixture({ dependencies: ['missing'] })), 'EVIDENCE_NOT_FOUND'));
  test('cycles fail closed', () => rejected(run(evidenceFixture({ dependencies: ['evidence:test'] })), 'LINEAGE_INCOMPLETE_OR_CYCLIC'));
  test('deep lineage is bounded', () => {
    const chain = Array.from({ length: 35 }, (_, i) => evidenceFixture({ evidenceId: `evidence:${i}`, dependencies: i < 34 ? [`evidence:${i + 1}`] : [] }));
    rejected(run(evidenceFixture({ dependencies: ['evidence:0'] }), chain), 'LINEAGE_INCOMPLETE_OR_CYCLIC');
  });
  test('synthetic data cannot enter operational mode', () => {
    const c = qualityContext(evidenceFixture()); c.mode = 'operational'; rejected(validateIndustrialObservation(request, c), 'MODE_MISMATCH');
  });
  test('open access without a built registered adapter is not operational eligibility', () => {
    const e = evidenceFixture({ mode: 'operational', sourceId: 'test:registered' }), c = qualityContext(e); c.mode = 'operational';
    rejected(validateIndustrialObservation(request, c), 'SOURCE_NOT_REGISTERED');
    c.sources = [{ sourceId: e.sourceId, accessClass: 'open', adapter: null, yields: ['observation'] }];
    rejected(validateIndustrialObservation(request, c), 'SOURCE_NOT_OPERATIONAL');
  });
  test('operational view can consume an eligible built source without changing registry', () => {
    const e = evidenceFixture({ mode: 'operational', sourceId: 'test:registered' }), c = qualityContext(e); c.mode = 'operational';
    c.sources = [{ sourceId: e.sourceId, accessClass: 'registered', adapter: 'test:adapter', yields: ['observation'] }];
    represented(validateIndustrialObservation(request, c)); assert.equal(c.sources.length, 1);
  });
  for (const change of [{ accessClass: 'blocked' }, { yields: ['person'] }, { yields: [] }]) test(`reject registry posture ${JSON.stringify(change)}`, () => {
    const e = evidenceFixture({ mode: 'operational', sourceId: 'test:registered' }), c = qualityContext(e); c.mode = 'operational';
    c.sources = [{ sourceId: e.sourceId, accessClass: 'open', adapter: 'test:adapter', yields: ['observation'], ...change }];
    rejected(validateIndustrialObservation(request, c), 'SOURCE_NOT_OPERATIONAL');
  });
  for (const t of ['2026-02-30T00:00:00Z', '2026-01-01', '2026-01-01T00:00:00', '2026-01-01T25:00:00Z']) test(`reject fabricated or ambiguous time ${t}`, () => {
    const e = evidenceFixture(); e.times.retrievedAt = t; rejected(run(e), 'INVALID_TIME');
  });
  test('zero-duration and reversed windows are rejected', () => {
    for (const end of [window.start, '2025-12-31T23:00:00Z']) {
      const e = evidenceFixture(); e.times.measurementWindow!.end = end; rejected(run(e), 'INVALID_TIME');
    }
  });
  test('a feed gap requires a supplied measurement interval', () => {
    const e = evidenceFixture(); e.times.measurementWindow = null; rejected(run(e), 'SEMANTIC_MISMATCH');
  });
  for (const extra of [{ confidence: 0.85 }, { probability: 0.35 }, { radius: 50 }, { reason: 'people imply RF interference' }, { occupancy_excluded: true }]) {
    test(`reject unsupported payload field ${Object.keys(extra)[0]}`, () => rejected(run(evidenceFixture({ payload: { ...gapPayload(), ...extra } })),
      'confidence' in extra || 'probability' in extra ? 'NUMERIC_CONFIDENCE_UNSUPPORTED' : 'UNSUPPORTED_FIELDS'));
  }
  test('coverage requires its own matching evidence', () => {
    const p = { ...gapPayload(), coverage: 'complete', coverageEvidenceId: 'evidence:coverage' };
    rejected(run(evidenceFixture({ payload: p })), 'LINEAGE_INCOMPLETE_OR_CYCLIC');
    const e = evidenceFixture({ payload: p, dependencies: ['evidence:coverage'] }); represented(run(e, [coverageEvidence()]));
    const c = coverageEvidence(); (c.payload as Record<string, unknown>).queryRef = 'query:other'; rejected(run(e, [c]), 'SEMANTIC_MISMATCH');
  });
  test('coverage evidence must match subject and measurement interval', () => {
    const e = evidenceFixture({ payload: { ...gapPayload(), coverage: 'complete', coverageEvidenceId: 'evidence:coverage' }, dependencies: ['evidence:coverage'] });
    const c = coverageEvidence(); c.times.measurementWindow = { ...window, end: '2026-01-01T02:00:00Z' }; rejected(run(e, [c]), 'SEMANTIC_MISMATCH');
    c.times.measurementWindow = { ...window }; c.subjectRef = 'instrument:other'; rejected(run(e, [c]), 'SEMANTIC_MISMATCH');
  });
  test('operating collection health requires matching diagnostics', () => {
    const e = evidenceFixture({ payload: { ...gapPayload(), collectionHealth: 'operating', healthEvidenceId: 'evidence:health' }, dependencies: ['evidence:health'] });
    const h = evidenceFixture({ evidenceId: 'evidence:health', evidenceClass: 'instrument_diagnostic', payload: { collectionHealth: 'operating', feedRef: 'feed:test', queryRef: 'query:test' } });
    represented(run(e, [h])); (h.payload as Record<string, unknown>).collectionHealth = 'degraded'; rejected(run(e, [h]), 'SEMANTIC_MISMATCH');
  });
  test('quality metrics preserve separate method and execution refs without confidence', () => {
    const r = represented(run(qualityEvidence())); assert.equal(r.payload.methodRef, 'operation:loss-v1'); assert.equal(r.payload.executionRef, 'run:test'); assert.equal(r.confidence, null);
  });
  for (const value of [NaN, Infinity, -0.1, 1.1]) test(`invalid diagnostic value ${String(value)}`, () => {
    rejected(run(evidenceFixture({ evidenceClass: 'instrument_diagnostic', payload: { ...qualityPayload(), value } })), 'SEMANTIC_MISMATCH');
  });
  test('method and run identity cannot collapse', () => rejected(run(evidenceFixture({ evidenceClass: 'instrument_diagnostic', payload: { ...qualityPayload(), methodRef: 'run:test' } })), 'SEMANTIC_MISMATCH'));
  test('verification references must bind the artifact and execution', () => {
    const e = qualityEvidence(); e.dependencies = ['evidence:verification']; e.payload = { ...qualityPayload(), verificationRef: 'evidence:verification' };
    const v = evidenceFixture({ evidenceId: 'evidence:verification', evidenceClass: 'verification_result', payload: { methodRef: 'operation:loss-v1', executionRef: 'run:test', targetArtifactId: e.artifactId, verdict: 'pass' } });
    represented(run(e, [v])); (v.payload as Record<string, unknown>).targetArtifactId = 'artifact:other'; rejected(run(e, [v]), 'SEMANTIC_MISMATCH');
  });
  test('reported schedule is a constraint, never a sensor diagnosis', () => {
    const e = evidenceFixture({ evidenceClass: 'organizational_notice', payload: { kind: 'REPORTED_CONSTRAINT', noticeRef: 'notice:test', status: 'scheduled', constraint: 'operating_schedule' } });
    e.times.eventWindow = { ...window }; e.times.measurementWindow = null;
    const r = represented(run(e)); assert.equal(r.payload.status, 'scheduled'); assert.equal(r.times.measurementWindow, null);
    e.payload = qualityPayload(); rejected(run(e), 'SEMANTIC_MISMATCH');
  });
  test('residual sign, quantity and measurement binding are checked', () => {
    const e = residualEvidence(); represented(run(e, [measurementEvidence()]));
    (e.payload as Record<string, unknown>).residual = -0.1; rejected(run(e, [measurementEvidence()]), 'SEMANTIC_MISMATCH');
    (e.payload as Record<string, unknown>).residual = 0.1;
    const m = measurementEvidence(); (m.payload as Record<string, unknown>).unit = 'ms'; rejected(run(e, [m]), 'SEMANTIC_MISMATCH');
  });
  test('uncertainty requires a result bound to the same execution', () => {
    const e = residualEvidence(); e.dependencies = ['evidence:measurement', 'evidence:uncertainty'];
    (e.payload as Record<string, unknown>).uncertainty = { standardDeviation: 0.01, unit: '1', evidenceId: 'evidence:uncertainty' };
    const u = evidenceFixture({ evidenceId: 'evidence:uncertainty', evidenceClass: 'model_result', payload: { standardDeviation: 0.01, unit: '1', forExecutionRef: 'run:model' } });
    represented(run(e, [measurementEvidence(), u])); (u.payload as Record<string, unknown>).forExecutionRef = 'run:other'; rejected(run(e, [measurementEvidence(), u]), 'SEMANTIC_MISMATCH');
  });
  test('hypothesis remains explicitly unverified and has alternatives plus required test', () => {
    const r = represented(run(hypothesisEvidence(), [measurementEvidence()]));
    assert.equal(r.kind, 'HYPOTHESIS'); assert.equal(r.physicalCause, 'NOT_ESTABLISHED'); assert.equal(r.admission, 'NOT_PERFORMED');
  });
  test('an event notice alone cannot support a sensor hypothesis', () => {
    rejected(run(hypothesisEvidence(), [evidenceFixture({ evidenceId: 'evidence:measurement', evidenceClass: 'organizational_notice' })]), 'SEMANTIC_MISMATCH');
  });
  test('hypotheses need explicit alternatives', () => {
    const e = hypothesisEvidence(); (e.payload as Record<string, unknown>).alternativeRefs = []; rejected(run(e, [measurementEvidence()]), 'SEMANTIC_MISMATCH');
  });
  test('insufficient evidence uses fixed missing categories instead of made-up values', () => {
    const r = represented(run(evidenceFixture({ payload: { kind: 'INSUFFICIENT_EVIDENCE', missing: ['measurement', 'calibration'] } })));
    assert.equal(r.kind, 'INSUFFICIENT_EVIDENCE'); assert.equal(r.confidence, null);
  });
  test('unexpected upstream failures cannot leak exception messages', () => {
    const c = qualityContext(evidenceFixture()); Object.defineProperty(c, 'evidence', { get() { throw new Error('PRIVATE_ERROR'); } });
    const r = validateIndustrialObservation(request, c); rejected(r, 'INVALID_EVIDENCE'); assert.equal(JSON.stringify(r).includes('PRIVATE_ERROR'), false);
  });
  test('source versions cannot be omitted', () => rejected(run(evidenceFixture({ sourceVersion: '' })), 'INVALID_EVIDENCE'));
  test('duplicate source IDs cannot silently choose a policy entry', () => {
    const e = evidenceFixture({ mode: 'operational', sourceId: 'test:registered' }), c = qualityContext(e); c.mode = 'operational';
    const source = { sourceId: e.sourceId, accessClass: 'open', adapter: 'test:adapter', yields: ['observation'] };
    c.sources = [source, { ...source }]; rejected(validateIndustrialObservation(request, c), 'SOURCE_NOT_REGISTERED');
  });
  test('large cancelling operands do not excuse a fabricated residual', () => {
    const e = residualEvidence(), m = measurementEvidence();
    Object.assign(e.payload as object, { observed: 1e300, predicted: 1e300, residual: 1 });
    (m.payload as Record<string, unknown>).value = 1e300;
    rejected(run(e, [m]), 'SEMANTIC_MISMATCH');
  });
  test('absent collection-health and coverage information remains explicitly unknown', () => {
    const payload: Record<string, unknown> = gapPayload();
    for (const key of ['collectionHealth', 'healthEvidenceId', 'coverage', 'coverageEvidenceId']) delete payload[key];
    const e = evidenceFixture({ payload }), r = represented(run(e));
    assert.equal(r.payload.collectionHealth, 'unknown'); assert.equal(r.payload.coverage, 'unknown');
    assert.equal(r.payload.healthEvidenceId, null); assert.equal(Object.hasOwn(payload, 'collectionHealth'), false);
  });
  test('a positive result count is not an empty feed', () => rejected(run(evidenceFixture({ payload: { ...gapPayload(), returnedRecords: 1 } })), 'SEMANTIC_MISMATCH'));
  return Object.freeze(cases);
}
