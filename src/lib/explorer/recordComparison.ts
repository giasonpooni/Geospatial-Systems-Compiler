/** Deterministic descriptive comparison over one pinned projection, not a solver.
 * No unit conversion, record fusion, covariance propagation or causal claim.
 */
import type { PublicProjection, ProjectionRecord } from './esmProjection.ts';
export type ComparisonRefusal = 'RECORD_NOT_AVAILABLE' | 'SAME_RECORD' | 'SUBJECT_MISMATCH' |
  'PREDICATE_MISMATCH' | 'UNIT_NOT_STATED' | 'UNIT_MISMATCH' | 'BASIS_NOT_STATED' |
  'BASIS_MISMATCH' | 'NON_NUMERIC_VALUE' | 'NONCURRENT_RECORD' | 'NUMERIC_OVERFLOW';
export type RecordComparison = {
  status: 'READY'; projectionDigest: string; baselineId: string; candidateId: string;
  subjectId: string; predicate: string; unit: string; basis: string;
  difference: number; relativeDifference: number | null;
  relativeUnavailable: 'ZERO_BASELINE' | 'NUMERIC_OVERFLOW' | null;
  baselineUncertainty: unknown; candidateUncertainty: unknown;
  uncertaintyOfDifference: null; uncertaintyReason: 'JOINT_UNCERTAINTY_NOT_SUPPLIED';
  knownAt: string; validAt: string; sources: string[];
} | { status: 'REFUSED'; reason: ComparisonRefusal; projectionDigest: string; baselineId: string; candidateId: string };
export function compareRecords(projection: PublicProjection, baselineId: string, candidateId: string): RecordComparison {
  const refuse = (reason: ComparisonRefusal): RecordComparison => ({ status: 'REFUSED', reason,
    projectionDigest: projection.digest, baselineId, candidateId });
  const a = projection.records.find(r => r.recordId === baselineId), b = projection.records.find(r => r.recordId === candidateId);
  if (!a || !b) return refuse('RECORD_NOT_AVAILABLE');
  if (a.recordId === b.recordId) return refuse('SAME_RECORD');
  if (a.subject.canonicalId !== b.subject.canonicalId || a.subject.subjectId !== b.subject.subjectId) return refuse('SUBJECT_MISMATCH');
  if (a.predicate !== b.predicate) return refuse('PREDICATE_MISMATCH');
  if (!a.unit?.trim() || !b.unit?.trim()) return refuse('UNIT_NOT_STATED');
  if (a.unit !== b.unit) return refuse('UNIT_MISMATCH');
  if (!a.basis?.trim() || !b.basis?.trim()) return refuse('BASIS_NOT_STATED');
  if (a.basis !== b.basis) return refuse('BASIS_MISMATCH');
  if (a.statusAtKnownAt !== 'CURRENT' || b.statusAtKnownAt !== 'CURRENT') return refuse('NONCURRENT_RECORD');
  if (typeof a.value !== 'number' || typeof b.value !== 'number' || !Number.isFinite(a.value) || !Number.isFinite(b.value)) return refuse('NON_NUMERIC_VALUE');
  const difference = b.value - a.value;
  if (!Number.isFinite(difference)) return refuse('NUMERIC_OVERFLOW');
  const relative = a.value === 0 ? null : difference / Math.abs(a.value);
  const relativeUnavailable = a.value === 0 ? 'ZERO_BASELINE' : !Number.isFinite(relative) ? 'NUMERIC_OVERFLOW' : null;
  return { status: 'READY', projectionDigest: projection.digest, baselineId, candidateId,
    subjectId: a.subject.subjectId, predicate: a.predicate, unit: a.unit, basis: a.basis,
    difference, relativeDifference: relativeUnavailable ? null : relative, relativeUnavailable,
    baselineUncertainty: structuredClone(a.uncertainty ?? null), candidateUncertainty: structuredClone(b.uncertainty ?? null),
    uncertaintyOfDifference: null, uncertaintyReason: 'JOINT_UNCERTAINTY_NOT_SUPPLIED',
    knownAt: projection.spec.selection.knownAt, validAt: projection.spec.selection.validAt,
    sources: [a.provenance.sourceId, b.provenance.sourceId] };
}
/** Descriptive counts: not a data-quality score or independent validation. */
export function projectionDiagnostics(projection: PublicProjection) {
  const absent = (value: unknown) => value === null || value === undefined;
  const count = (fn: (r: ProjectionRecord) => boolean) => projection.records.filter(fn).length;
  return { selectedRecords: projection.records.length,
    numericRecords: count(r => typeof r.value === 'number'),
    unitsNotStated: count(r => !r.unit?.trim()),
    uncertaintiesNotStated: count(r => absent(r.uncertainty)),
    noncurrentRecords: count(r => r.statusAtKnownAt !== 'CURRENT'),
    unplacedRecords: projection.geometry.unplaced.length,
    pointDeclarations: projection.geometry.positions.filter(p => p.shape.kind === 'POINT').length,
    retainedBoundaryDeclarations: projection.geometry.positions.filter(p => p.shape.kind !== 'POINT').length,
    positionsWithoutStatedUncertainty: projection.geometry.positions.filter(p => p.point.horizontalUncertaintyM === null).length };
}
