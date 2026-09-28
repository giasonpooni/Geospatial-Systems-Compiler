import { dataTree, deepFreeze, finite, identifier, instant, text } from './compat/gsv/validation';
import type { Diagnostic, DiagnosticCode, Interval, IRRecord, RepresentationIR, Result, TimeValue } from './ir';
import { recordKey } from './ir';

export class CompilerFault extends Error {
  constructor(readonly code: DiagnosticCode, message: string, readonly recordId?: string) { super(message); }
}
export function requireThat(condition: unknown, code: DiagnosticCode, message: string, recordId?: string): asserts condition {
  if (!condition) throw new CompilerFault(code, message, recordId);
}
export function attempt<T>(passId: string, operation: () => T): Result<T> {
  try { return { ok: true, value: operation(), diagnostics: [], passes: [passId] }; }
  catch (error) {
    return { ok: false, passes: [passId], diagnostics: [{
      code: error instanceof CompilerFault ? error.code : 'INVALID_SOURCE_RECORD',
      severity: 'error', message: error instanceof Error ? error.message : 'Invalid plain input data',
      ...(error instanceof CompilerFault && error.recordId ? { recordId: error.recordId } : {}), passId,
    }] };
  }
}
export function object(value: unknown, field: string): Record<string, unknown> {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_SOURCE_RECORD', `${field}: expected object`);
  return value as Record<string, unknown>;
}
export function array(value: unknown, field: string): unknown[] {
  requireThat(Array.isArray(value), 'INVALID_SOURCE_RECORD', `${field}: expected array`);
  return value;
}
export function timeValue(value: unknown): TimeValue {
  const s = text(value, 'time');
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      instant(`${s}T00:00:00Z`); // calendar check ONLY; output retains date precision
      return { precision: 'date', value: s };
    }
    instant(s);
    return { precision: 'instant', value: s };
  } catch { throw new CompilerFault('INVALID_TIME', 'Expected a real calendar date or UTC instant'); }
}
function checkTime(t: TimeValue | null): void {
  if (t === null) return;
  const parsed = timeValue(t.value);
  requireThat(t.precision === parsed.precision, 'INVALID_TIME', 'Declared temporal precision differs from value');
}
export function timeOrder(a: TimeValue, b: TimeValue): number {
  checkTime(a); checkTime(b);
  requireThat(a.precision === b.precision, 'UNAVAILABLE_TIME', 'Mixed date/instant comparison requires an explicit precision policy');
  if (a.precision === 'date') return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  return Math.sign(instant(a.value) - instant(b.value));
}
function checkInterval(v: Interval | null): void {
  if (v === null) return;
  checkTime(v.from); checkTime(v.to);
  requireThat(v.end === 'inclusive' || v.end === 'exclusive', 'INVALID_TIME', 'Interval endpoint convention is missing');
  if (v.from !== null && v.to !== null) {
    const order = timeOrder(v.from, v.to);
    requireThat(order < 0 || (order === 0 && v.end === 'inclusive'), 'INVALID_TIME', 'Empty or reversed interval');
  }
}
function warning(code: DiagnosticCode, message: string, recordId: string): Diagnostic {
  return { code, severity: 'warning', message, recordId };
}
export interface ValidationPass {
  readonly id: string;
  check(ir: RepresentationIR): readonly Diagnostic[];
}
export const validationPasses: readonly ValidationPass[] = [
  { id: 'gsc.identity.v1', check(ir) {
    requireThat(ir.schema === 'gsc.representation-ir.v1', 'INVALID_SOURCE_RECORD', 'Unsupported IR schema');
    identifier(ir.compilationId, 'compilationId');
    identifier(ir.bindings.datasetId, 'datasetId');
    for (const key of ['snapshotId', 'releaseId', 'runId', 'modelId'] as const)
      if (ir.bindings[key] !== null) identifier(ir.bindings[key], key);
    array(ir.records, 'records');
    const ids = new Set<string>();
    for (const r of ir.records) {
      for (const key of ['adapterId', 'datasetId', 'collection', 'recordId'] as const) identifier(r.source[key], key);
      requireThat(r.source.datasetId === ir.bindings.datasetId, 'BINDING_MISMATCH', 'Record belongs to a different dataset', r.id);
      requireThat(r.id === recordKey(r.source) && !ids.has(r.id), 'UNBOUND_IDENTITY', 'Invalid or duplicate representation identity', r.id);
      ids.add(r.id);
      requireThat(['entity', 'observation', 'assertion', 'event', 'constraint'].includes(r.role), 'INVALID_SOURCE_RECORD', 'Unsupported record role', r.id);
      text(r.kind, 'kind'); text(r.label, 'label');
      object(r.sourceRecord, 'sourceRecord');
      requireThat(r.sourceRecord.id === r.source.recordId, 'BINDING_MISMATCH', 'Source-record identity changed', r.id);
    }
    for (const r of ir.records) for (const link of array(r.links, 'links')) {
      const edge = object(link, 'link'); text(edge.predicate, 'predicate');
      requireThat(typeof edge.targetId === 'string' && ids.has(edge.targetId), 'UNBOUND_IDENTITY', 'Unresolved internal relation', r.id);
    }
    return [];
  } },
  { id: 'gsc.temporal.v1', check(ir) {
    const notes: Diagnostic[] = [];
    for (const r of ir.records) {
      checkTime(r.knownAt); checkTime(r.eventTime); checkInterval(r.period); checkInterval(r.validity); checkInterval(r.applicability ?? null);
      requireThat(['declared', 'retrieval-upper-bound', 'unavailable'].includes(r.knownAtBasis), 'INVALID_TIME', 'Unknown knowledge-time basis', r.id);
      requireThat((r.knownAt === null) === (r.knownAtBasis === 'unavailable'), 'INVALID_TIME', 'Knowledge-time presence and basis disagree', r.id);
      if (r.knownAt === null) notes.push(warning('MISSING_KNOWLEDGE_TIME', 'No source-known time supplied; not eligible for as-known filtering', r.id));
    }
    return notes;
  } },
  { id: 'gsc.quantity.v1', check(ir) {
    const notes: Diagnostic[] = [];
    for (const r of ir.records) {
      requireThat(['observed', 'reported', 'computed', 'estimated', 'derived', 'representative', 'synthetic', 'unspecified'].includes(r.valueKind), 'INVALID_SOURCE_RECORD', 'Unknown value classification', r.id);
      if (r.quantity !== null) {
        finite(r.quantity.value, 'quantity.value');
        if (r.quantity.unit === null) notes.push(warning('MISSING_UNIT', 'No unit supplied; no conversion or dimensionless default applied', r.id));
        else requireThat(text(r.quantity.unit, 'unit', 128).trim() === r.quantity.unit, 'INVALID_SOURCE_RECORD', 'Unit must be nonblank and trimmed', r.id);
        if (r.quantity.basis !== null) text(r.quantity.basis, 'quantity.basis');
      }
      array(r.uncertaintyRefs, 'uncertaintyRefs').forEach((ref) => text(ref, 'uncertainty reference'));
    }
    return notes;
  } },
  { id: 'gsc.geometry.v1', check(ir) {
    for (const r of ir.records) {
      if (r.geometry === null) continue;
      const g = r.geometry;
      text(g.frame.reference, 'frame.reference'); text(g.frame.unit, 'frame.unit');
      requireThat(array(g.frame.axes, 'frame.axes').length === 2, 'FRAME_MISMATCH', 'Expected two explicitly declared coordinate axes', r.id);
      g.frame.axes.forEach((axis) => text(axis, 'axis'));
      if (g.basis !== null) text(g.basis, 'geometry basis');
      requireThat(g.shape.type === 'Point' || g.shape.type === 'LineString', 'UNSUPPORTED_REPRESENTATION', 'Only Point and LineString are supported', r.id);
      const positions = g.shape.type === 'Point' ? [g.shape.coordinates] : array(g.shape.coordinates, 'coordinates');
      requireThat(g.shape.type === 'Point' || positions.length >= 2, 'INVALID_PROJECTION', 'LineString requires at least two positions', r.id);
      for (const position of positions) {
        const p = array(position, 'position');
        requireThat(p.length === 2, 'FRAME_MISMATCH', 'Geometry requires two coordinates', r.id);
        finite(p[0], 'coordinate'); finite(p[1], 'coordinate');
        if (g.frame.reference === 'OGC:CRS84') {
          requireThat(g.frame.axes[0] === 'longitude' && g.frame.axes[1] === 'latitude' && g.frame.unit === 'degree', 'FRAME_MISMATCH', 'CRS84 requires longitude/latitude degrees', r.id);
          finite(p[0], 'longitude', -180, 180); finite(p[1], 'latitude', -90, 90);
        }
      }
    }
    return [];
  } },
  { id: 'gsc.provenance.v1', check(ir) {
    const notes: Diagnostic[] = [];
    for (const r of ir.records) {
      array(r.provenance, 'provenance');
      if (!r.provenance.length) {
        requireThat(r.role === 'entity', 'MISSING_PROVENANCE', 'Non-entity record has no source provenance', r.id);
        notes.push(warning('MISSING_PROVENANCE', 'Source entity has no provenance; none invented from related observations', r.id));
      }
      for (const p of r.provenance) {
        text(p.sourceId, 'sourceId'); checkTime(p.knownAt); checkTime(p.retrievedAt);
        if (p.sourceRef !== null) text(p.sourceRef, 'sourceRef');
        if (p.artifactId !== null) text(p.artifactId, 'artifactId');
        array(p.evidenceIds, 'evidenceIds').forEach((id) => text(id, 'evidence descriptor'));
      }
    }
    return notes;
  } },
];
/** Runtime validation precedes all passes. Failure returns no partially admitted IR. */
export function validateIR(input: unknown): Result<RepresentationIR> {
  const parsed = attempt('gsc.plain-data.v1', () => { dataTree(input); return structuredClone(input) as RepresentationIR; });
  if (!parsed.ok) return parsed;
  const passes = [...parsed.passes];
  const diagnostics: Diagnostic[] = [];
  for (const pass of validationPasses) {
    const result = attempt(pass.id, () => pass.check(parsed.value));
    passes.push(pass.id);
    if (!result.ok) return { ok: false, diagnostics: [...diagnostics, ...result.diagnostics], passes };
    diagnostics.push(...result.value.map((d) => ({ ...d, passId: pass.id })));
  }
  return { ok: true, value: deepFreeze(parsed.value), diagnostics: deepFreeze(diagnostics), passes: Object.freeze(passes) };
}
/** Resolve an exact compiled record, not a fuzzy source-ID match. */
export function inspectRecord(ir: RepresentationIR, id: string): Result<IRRecord> {
  const checked = validateIR(ir);
  if (!checked.ok) return checked;
  const result = attempt('gsc.inspect.v1', () => {
    const record = checked.value.records.find((r) => r.id === id);
    requireThat(record, 'UNBOUND_IDENTITY', 'Selected record is not in this compilation');
    return record;
  });
  return { ...result, diagnostics: [...checked.diagnostics, ...result.diagnostics], passes: [...checked.passes, ...result.passes] };
}
