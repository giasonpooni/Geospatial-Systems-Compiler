/** Renderer-independent inspection IR. It conveys no execution or admission authority. */
export type TimeValue = Readonly<{ precision: 'date' | 'instant'; value: string }>;
export interface Interval {
  readonly from: TimeValue | null;
  readonly to: TimeValue | null;
  readonly end: 'inclusive' | 'exclusive';
}
export interface Bindings {
  readonly datasetId: string;
  readonly snapshotId: string | null;
  readonly releaseId: string | null;
  readonly runId: string | null;
  readonly modelId: string | null;
}
export interface SourceIdentity {
  readonly adapterId: string;
  readonly datasetId: string;
  readonly collection: string;
  readonly recordId: string;
}
export interface ProvenanceRef {
  readonly sourceId: string;
  readonly knownAt: TimeValue | null;
  readonly retrievedAt: TimeValue | null;
  readonly sourceRef: string | null;
  readonly artifactId: string | null;
  readonly evidenceIds: readonly string[];
}
export type ValueKind = 'observed' | 'reported' | 'computed' | 'estimated' |
  'derived' | 'representative' | 'synthetic' | 'unspecified';
export type Position = readonly [number, number];
export type Geometry = Readonly<{
  frame: { reference: string; axes: readonly [string, string]; unit: string };
  basis: string | null;
  shape: { type: 'Point'; coordinates: Position } |
    { type: 'LineString'; coordinates: readonly Position[] };
}>;
export interface IRRecord {
  readonly id: string; // representation identity, not evidence or execution identity
  readonly source: SourceIdentity;
  readonly role: 'entity' | 'observation' | 'assertion' | 'event' | 'constraint';
  readonly kind: string;
  readonly label: string;
  readonly valueKind: ValueKind;
  readonly geometry: Geometry | null;
  readonly quantity: { value: number; unit: string | null; basis: string | null } | null;
  readonly knownAt: TimeValue | null;
  readonly knownAtBasis: 'declared' | 'retrieval-upper-bound' | 'unavailable';
  readonly eventTime: TimeValue | null;
  readonly period: Interval | null; // measurement period, not applicability
  readonly validity: Interval | null;
  /** Optional source-specific applicability, distinct from provenance validity. */
  readonly applicability?: Interval | null;
  readonly provenance: readonly ProvenanceRef[];
  readonly uncertaintyRefs: readonly string[]; // [] means none supplied, NOT zero uncertainty
  readonly links: readonly { predicate: string; targetId: string }[];
  /** Transient, detached compatibility detail for inspection, never a canonical store. */
  readonly sourceRecord: Readonly<Record<string, unknown>>;
}
export interface RepresentationIR {
  readonly schema: 'gsc.representation-ir.v1';
  readonly compilationId: string; // caller-assigned; not a cryptographic certificate
  readonly bindings: Bindings;
  readonly records: readonly IRRecord[];
}
export type DiagnosticCode = 'INVALID_SOURCE_RECORD' | 'UNBOUND_IDENTITY' | 'INVALID_TIME' |
  'MISSING_PROVENANCE' | 'MISSING_KNOWLEDGE_TIME' | 'MISSING_GEOMETRY' | 'MISSING_UNIT' |
  'UNSUPPORTED_CRS' | 'FRAME_MISMATCH' | 'UNSUPPORTED_REPRESENTATION' |
  'UNAVAILABLE_TIME' | 'UNSUPPORTED_RECORD' | 'INVALID_PROJECTION' | 'BINDING_MISMATCH';
export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: 'warning' | 'error';
  readonly message: string;
  readonly recordId?: string;
  readonly passId?: string;
}
export type Result<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly Diagnostic[]; readonly passes: readonly string[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[]; readonly passes: readonly string[] };
export const recordKey = (s: SourceIdentity): string =>
  JSON.stringify([s.adapterId, s.datasetId, s.collection, s.recordId]);
