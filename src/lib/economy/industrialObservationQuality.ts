/**
 * Industrial observation quality v1: a pure, bounded representation validator.
 * Not evidence admission, a source adapter, a solver, or a publication API.
 * Call through industrialObservationQualityRegistry.ts in the application.
 */
export const QUALITY_SCHEMA = 'industrial-observation-quality.v1' as const;
export type QualityKind = 'FEED_GAP' | 'QUALITY_ASSESSMENT' | 'REPORTED_CONSTRAINT'
  | 'MODEL_RESIDUAL' | 'HYPOTHESIS' | 'INSUFFICIENT_EVIDENCE';
export type EvidenceClass = 'feed_query' | 'instrument_diagnostic' | 'acquisition_metadata'
  | 'organizational_notice' | 'environmental_measurement' | 'trade_reporting'
  | 'model_result' | 'verification_result' | 'hypothesis' | 'person_level' | 'mixed' | 'unknown';
export type Window = { start: string; end: string };
export type QualityTimes = {
  eventWindow: Window | null; measurementWindow: Window | null;
  publishedAt: string | null; retrievedAt: string;
};
/** A transient view of SOURCE_REGISTRY, not another registration mechanism. */
export type RegistryView = {
  sourceId: string; accessClass: string; adapter: string | null; yields: readonly string[];
};
/** Trusted, already classified metadata supplied by an upstream evidence owner.
 * Never build this context from the same untrusted request being validated.
 * Full dependency lineage must include the pre-transformation source records.
 */
export type QualityEvidence = {
  evidenceId: string; artifactId: string; sourceId: string; sourceVersion: string;
  mode: 'operational' | 'synthetic'; subjectClass: 'industrial' | 'natural_person' | 'mixed' | 'unknown';
  evidenceClass: EvidenceClass; dependencies: readonly string[];
  subjectRef: string; times: QualityTimes; payload: unknown;
};
export type QualityContext = {
  mode: 'operational' | 'synthetic';
  sources: readonly RegistryView[];
  evidence: ReadonlyMap<string, QualityEvidence>;
};
export type QualityReason = 'INVALID_REQUEST' | 'EVIDENCE_NOT_FOUND' | 'INVALID_EVIDENCE'
  | 'PERSON_LEVEL_SOURCE_NOT_ADMISSIBLE' | 'SOURCE_ELIGIBILITY_UNESTABLISHED'
  | 'SOURCE_NOT_REGISTERED' | 'SOURCE_NOT_OPERATIONAL' | 'MODE_MISMATCH'
  | 'LINEAGE_INCOMPLETE_OR_CYCLIC' | 'INVALID_TIME' | 'SEMANTIC_MISMATCH'
  | 'NUMERIC_CONFIDENCE_UNSUPPORTED' | 'UNSUPPORTED_FIELDS';
export type QualityResult = {
  schemaVersion: typeof QUALITY_SCHEMA;
  disposition: 'REPRESENTED';
  record: {
    kind: QualityKind; mode: QualityContext['mode']; subjectRef: string;
    times: QualityTimes; evidenceIds: string[];
    provenance: { evidenceId: string; artifactId: string; sourceId: string; sourceVersion: string }[];
    payload: Record<string, unknown>;
    confidence: null;
    physicalCause: 'NOT_ESTABLISHED';
    admission: 'NOT_PERFORMED';
  };
} | {
  schemaVersion: typeof QUALITY_SCHEMA; disposition: 'REJECTED';
  reasonCodes: QualityReason[]; record: null;
};

const KINDS: readonly QualityKind[] = ['FEED_GAP', 'QUALITY_ASSESSMENT', 'REPORTED_CONSTRAINT',
  'MODEL_RESIDUAL', 'HYPOTHESIS', 'INSUFFICIENT_EVIDENCE'];
const CLASSES: readonly EvidenceClass[] = ['feed_query', 'instrument_diagnostic', 'acquisition_metadata',
  'organizational_notice', 'environmental_measurement', 'trade_reporting', 'model_result', 'verification_result', 'hypothesis'];
const YIELDS = new Set(['entity', 'observation', 'flow', 'event', 'dependency', 'capacity']);
const object = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const ref = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}$/.test(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const oneOf = (x: unknown, choices: readonly string[]): boolean => typeof x === 'string' && choices.includes(x);
const exact = (x: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const refs = (x: unknown): x is string[] => Array.isArray(x) && x.length > 0 && x.length <= 32 &&
  x.every(ref) && new Set(x).size === x.length;
function fail(reason: QualityReason): never { throw reason; }
function requireCondition(ok: unknown, reason: QualityReason): asserts ok { if (!ok) fail(reason); }
/** V1 takes explicit UTC instants only. No date-only values or timezone guesses. */
function instant(x: unknown): x is string {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x)) return false;
  const t = Date.parse(x);
  return Number.isFinite(t) && new Date(t).toISOString() === (x.includes('.') ? x : x.replace('Z', '.000Z'));
}
function windowValid(x: unknown): x is Window {
  return object(x) && exact(x, ['start', 'end']) && instant(x.start) && instant(x.end) &&
    Date.parse(x.start) < Date.parse(x.end);
}
function validateTimes(t: unknown): asserts t is QualityTimes {
  requireCondition(object(t) && exact(t, ['eventWindow', 'measurementWindow', 'publishedAt', 'retrievedAt']), 'INVALID_TIME');
  requireCondition((t.eventWindow === null || windowValid(t.eventWindow)) &&
    (t.measurementWindow === null || windowValid(t.measurementWindow)) &&
    (t.publishedAt === null || instant(t.publishedAt)) && instant(t.retrievedAt), 'INVALID_TIME');
}
function sameMeasurement(a: QualityEvidence, b: QualityEvidence): boolean {
  const aw = a.times.measurementWindow, bw = b.times.measurementWindow;
  return a.subjectRef === b.subjectRef && aw !== null && bw !== null &&
    Date.parse(aw.start) === Date.parse(bw.start) && Date.parse(aw.end) === Date.parse(bw.end);
}

/** Input is references only: {schemaVersion, evidenceId}. No raw posts, geometry,
 * caller-provided eligibility flags, source relabelling, or free-text diagnostics.
 * Dependency/source metadata is authoritative ONLY to the extent its upstream
 * supplier is trusted; this function does not authenticate evidence contents.
 */
export function validateIndustrialObservation(input: unknown, context: QualityContext): QualityResult {
  try {
    requireCondition(object(input) && exact(input, ['schemaVersion', 'evidenceId']) &&
      input.schemaVersion === QUALITY_SCHEMA && ref(input.evidenceId), 'INVALID_REQUEST');
    requireCondition(context.mode === 'operational' || context.mode === 'synthetic', 'MODE_MISMATCH');
    const visiting = new Set<string>(), checked = new Map<string, QualityEvidence>();
    const walk = (id: string, depth: number): QualityEvidence => {
      requireCondition(depth <= 32 && visiting.size < 64, 'LINEAGE_INCOMPLETE_OR_CYCLIC');
      requireCondition(!visiting.has(id), 'LINEAGE_INCOMPLETE_OR_CYCLIC');
      const cached = checked.get(id);
      if (cached) return cached;
      requireCondition(checked.size + visiting.size < 128, 'LINEAGE_INCOMPLETE_OR_CYCLIC');
      const e = context.evidence.get(id);
      requireCondition(e, 'EVIDENCE_NOT_FOUND');
      // Source eligibility is checked before payload interpretation; renaming an
      // input or adding an industrial derived node cannot erase a person leaf.
      if (e.subjectClass === 'natural_person' || e.subjectClass === 'mixed' ||
          e.evidenceClass === 'person_level' || e.evidenceClass === 'mixed') fail('PERSON_LEVEL_SOURCE_NOT_ADMISSIBLE');
      requireCondition(e.subjectClass === 'industrial' && CLASSES.includes(e.evidenceClass), 'SOURCE_ELIGIBILITY_UNESTABLISHED');
      requireCondition(e.mode === context.mode, 'MODE_MISMATCH');
      requireCondition(e.evidenceId === id && [e.evidenceId, e.artifactId, e.sourceId, e.sourceVersion, e.subjectRef].every(ref), 'INVALID_EVIDENCE');
      const syntheticFixture = context.mode === 'synthetic' && e.sourceId.startsWith('fixture:');
      if (!syntheticFixture) {
        const matches = context.sources.filter(s => s.sourceId === e.sourceId);
        requireCondition(matches.length === 1, 'SOURCE_NOT_REGISTERED');
        const s = matches[0];
        requireCondition(oneOf(s.accessClass, ['open', 'registered', 'licensed']) && ref(s.adapter) &&
          Array.isArray(s.yields) && s.yields.length > 0 && s.yields.every(y => YIELDS.has(y)), 'SOURCE_NOT_OPERATIONAL');
      }
      validateTimes(e.times);
      requireCondition(Array.isArray(e.dependencies) && e.dependencies.length <= 32 &&
        e.dependencies.every(ref) && new Set(e.dependencies).size === e.dependencies.length, 'LINEAGE_INCOMPLETE_OR_CYCLIC');
      visiting.add(id);
      for (const dependency of e.dependencies) walk(dependency, depth + 1);
      visiting.delete(id);
      checked.set(id, e);
      return e;
    };
    const e = walk(input.evidenceId, 0), raw = e.payload;
    requireCondition(object(raw) && oneOf(raw.kind, KINDS), 'SEMANTIC_MISMATCH');
    const p = { ...raw };
    // Missing diagnostics mean unknown, not healthy or complete. Only paired
    // absence is normalized; a dangling assertion/evidence field still fails.
    if (p.kind === 'FEED_GAP') {
      for (const [state, evidence] of [['coverage', 'coverageEvidenceId'], ['collectionHealth', 'healthEvidenceId']]) {
        if (!Object.hasOwn(p, state) && !Object.hasOwn(p, evidence)) {
          p[state] = 'unknown'; p[evidence] = null;
        }
      }
    }
    if (Object.hasOwn(p, 'confidence') || Object.hasOwn(p, 'probability')) fail('NUMERIC_CONFIDENCE_UNSUPPORTED');
    const keys = (ks: string[]) => requireCondition(exact(p, ['kind', ...ks]), 'UNSUPPORTED_FIELDS');
    const evidenceIs = (cs: EvidenceClass[]) => requireCondition(cs.includes(e.evidenceClass), 'SEMANTIC_MISMATCH');
    const measured = () => requireCondition(e.times.measurementWindow !== null, 'SEMANTIC_MISMATCH');
    const dependency = (id: unknown, cs: EvidenceClass[], matchWindow = false): QualityEvidence => {
      requireCondition(ref(id) && e.dependencies.includes(id), 'LINEAGE_INCOMPLETE_OR_CYCLIC');
      const d = checked.get(id);
      requireCondition(d && cs.includes(d.evidenceClass) && (!matchWindow || sameMeasurement(e, d)), 'SEMANTIC_MISMATCH');
      return d;
    };
    switch (p.kind as QualityKind) {
      case 'FEED_GAP':
        keys(['feedRef', 'queryRef', 'returnedRecords', 'coverage', 'coverageEvidenceId', 'collectionHealth', 'healthEvidenceId']);
        evidenceIs(['feed_query', 'trade_reporting']); measured();
        requireCondition(ref(p.feedRef) && ref(p.queryRef) && p.returnedRecords === 0 &&
          oneOf(p.coverage, ['complete', 'partial', 'unknown']) &&
          oneOf(p.collectionHealth, ['operating', 'degraded', 'unknown']), 'SEMANTIC_MISMATCH');
        if (p.coverage === 'unknown') requireCondition(p.coverageEvidenceId === null, 'SEMANTIC_MISMATCH');
        else {
          const c = dependency(p.coverageEvidenceId, ['acquisition_metadata', 'instrument_diagnostic'], true);
          requireCondition(object(c.payload) && c.payload.coverage === p.coverage &&
            c.payload.feedRef === p.feedRef && c.payload.queryRef === p.queryRef, 'SEMANTIC_MISMATCH');
        }
        if (p.collectionHealth === 'unknown') requireCondition(p.healthEvidenceId === null, 'SEMANTIC_MISMATCH');
        else {
          const h = dependency(p.healthEvidenceId, ['instrument_diagnostic'], true);
          requireCondition(object(h.payload) && h.payload.collectionHealth === p.collectionHealth &&
            h.payload.feedRef === p.feedRef && h.payload.queryRef === p.queryRef, 'SEMANTIC_MISMATCH');
        }
        break;
      case 'QUALITY_ASSESSMENT':
        keys(['metric', 'value', 'unit', 'methodRef', 'executionRef', 'verificationRef']);
        evidenceIs(['instrument_diagnostic', 'environmental_measurement', 'acquisition_metadata']); measured();
        requireCondition(ref(p.methodRef) && ref(p.executionRef) && p.methodRef !== p.executionRef &&
          (p.verificationRef === null || (ref(p.verificationRef) && p.verificationRef !== p.methodRef && p.verificationRef !== p.executionRef)), 'SEMANTIC_MISMATCH');
        if (p.verificationRef !== null) {
          const v = dependency(p.verificationRef, ['verification_result'], true);
          requireCondition(object(v.payload) && v.payload.methodRef === p.methodRef &&
            v.payload.executionRef === p.executionRef && v.payload.targetArtifactId === e.artifactId &&
            oneOf(v.payload.verdict, ['pass', 'fail', 'inconclusive']), 'SEMANTIC_MISMATCH');
        }
        requireCondition(finite(p.value), 'SEMANTIC_MISMATCH');
        requireCondition((oneOf(p.metric, ['packet_loss_fraction', 'detection_fraction']) && p.unit === '1' && p.value >= 0 && p.value <= 1) ||
          (p.metric === 'signal_to_noise_ratio' && p.unit === 'dB') ||
          (p.metric === 'latency' && p.unit === 'ms' && p.value >= 0), 'SEMANTIC_MISMATCH');
        break;
      case 'REPORTED_CONSTRAINT':
        keys(['noticeRef', 'status', 'constraint']);
        evidenceIs(['organizational_notice']);
        requireCondition(e.times.eventWindow !== null && ref(p.noticeRef) &&
          oneOf(p.status, ['scheduled', 'reported_active', 'cancelled', 'unknown']) &&
          oneOf(p.constraint, ['access_restriction', 'operating_schedule', 'reported_outage']), 'SEMANTIC_MISMATCH');
        break;
      case 'MODEL_RESIDUAL': {
        keys(['observed', 'predicted', 'residual', 'unit', 'uncertainty', 'measurementEvidenceId', 'methodRef', 'executionRef']);
        evidenceIs(['model_result']); measured();
        requireCondition(finite(p.observed) && finite(p.predicted) && finite(p.residual) && ref(p.unit) &&
          ref(p.methodRef) && ref(p.executionRef) && p.methodRef !== p.executionRef, 'SEMANTIC_MISMATCH');
        const m = dependency(p.measurementEvidenceId, ['instrument_diagnostic', 'environmental_measurement', 'trade_reporting'], true);
        requireCondition(object(m.payload) && m.payload.value === p.observed && m.payload.unit === p.unit, 'SEMANTIC_MISMATCH');
        const residual = p.observed - p.predicted;
        requireCondition(Number.isFinite(residual) && Math.abs(p.residual - residual) <= 8 * Number.EPSILON *
          Math.max(Math.abs(p.residual), Math.abs(residual), Number.MIN_VALUE), 'SEMANTIC_MISMATCH');
        requireCondition(p.uncertainty === null || (object(p.uncertainty) && exact(p.uncertainty, ['standardDeviation', 'unit', 'evidenceId']) &&
          finite(p.uncertainty.standardDeviation) && p.uncertainty.standardDeviation >= 0 && p.uncertainty.unit === p.unit), 'SEMANTIC_MISMATCH');
        if (object(p.uncertainty)) {
          const u = dependency(p.uncertainty.evidenceId, ['model_result'], true);
          requireCondition(object(u.payload) && u.payload.standardDeviation === p.uncertainty.standardDeviation &&
            u.payload.unit === p.unit && u.payload.forExecutionRef === p.executionRef, 'SEMANTIC_MISMATCH');
        }
        break;
      }
      case 'HYPOTHESIS':
        keys(['hypothesisRef', 'relationship', 'target', 'supportEvidenceIds', 'alternativeRefs', 'requiredTestRef']);
        evidenceIs(['hypothesis']);
        requireCondition(ref(p.hypothesisRef) && ref(p.requiredTestRef) && refs(p.alternativeRefs) && refs(p.supportEvidenceIds) &&
          oneOf(p.relationship, ['predictive_association', 'causal_hypothesis']) &&
          oneOf(p.target, ['feed_coverage', 'sensor_quality', 'model_fit']), 'SEMANTIC_MISMATCH');
        for (const id of p.supportEvidenceIds) {
          dependency(id, p.target === 'feed_coverage' ? ['feed_query', 'trade_reporting'] :
            p.target === 'sensor_quality' ? ['instrument_diagnostic', 'acquisition_metadata'] : ['model_result'], true);
        }
        break;
      case 'INSUFFICIENT_EVIDENCE':
        keys(['missing']);
        requireCondition(Array.isArray(p.missing) && p.missing.length > 0 && p.missing.length <= 8 &&
          new Set(p.missing).size === p.missing.length && p.missing.every(x => oneOf(x,
            ['coverage', 'collection_health', 'measurement', 'method', 'calibration', 'applicability', 'causal_evidence'])), 'SEMANTIC_MISMATCH');
        break;
    }
    // Copy only allowlisted, validated values. No raw evidence, source names,
    // rejected IDs, coordinates or exception text reaches diagnostics.
    return {
      schemaVersion: QUALITY_SCHEMA, disposition: 'REPRESENTED',
      record: {
        kind: p.kind as QualityKind, mode: context.mode, subjectRef: e.subjectRef,
        times: structuredClone(e.times), evidenceIds: [...checked.keys()],
        provenance: [...checked.values()].map(d => ({ evidenceId: d.evidenceId, artifactId: d.artifactId,
          sourceId: d.sourceId, sourceVersion: d.sourceVersion })),
        payload: structuredClone(p), confidence: null,
        physicalCause: 'NOT_ESTABLISHED', admission: 'NOT_PERFORMED',
      },
    };
  } catch (error) {
    // Only our fixed codes cross the boundary. Never stringify raw errors.
    const known: readonly string[] = ['INVALID_REQUEST', 'EVIDENCE_NOT_FOUND', 'INVALID_EVIDENCE',
      'PERSON_LEVEL_SOURCE_NOT_ADMISSIBLE', 'SOURCE_ELIGIBILITY_UNESTABLISHED', 'SOURCE_NOT_REGISTERED',
      'SOURCE_NOT_OPERATIONAL', 'MODE_MISMATCH', 'LINEAGE_INCOMPLETE_OR_CYCLIC', 'INVALID_TIME',
      'SEMANTIC_MISMATCH', 'NUMERIC_CONFIDENCE_UNSUPPORTED', 'UNSUPPORTED_FIELDS'];
    return { schemaVersion: QUALITY_SCHEMA, disposition: 'REJECTED',
      reasonCodes: [typeof error === 'string' && known.includes(error) ? error as QualityReason : 'INVALID_EVIDENCE'], record: null };
  }
}
