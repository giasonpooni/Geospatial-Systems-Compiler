import { deepFreeze } from './compat/gsv/validation';
import { validateIR } from './compiler';
import type { Bindings, Diagnostic, Geometry, IRRecord, Position, RepresentationIR, Result } from './ir';

export type ViewKind = 'table' | 'geojson' | 'timeline' | 'relations' | 'unit-sphere';
export const VIEW_KINDS: readonly ViewKind[] = Object.freeze(['table', 'geojson', 'timeline', 'relations', 'unit-sphere']);
interface Envelope { compilationId: string; bindings: Bindings }
export type Projection = Envelope & (
  | { kind: 'table'; rows: readonly IRRecord[] }
  | { kind: 'timeline'; rows: readonly Pick<IRRecord, 'id' | 'source' | 'knownAt' | 'eventTime' | 'period' | 'validity' | 'knownAtBasis'>[] }
  | { kind: 'relations'; edges: readonly { from: string; to: string; predicate: string }[] }
  | { kind: 'geojson'; type: 'FeatureCollection'; features: readonly {
      type: 'Feature'; id: string; geometry: Geometry['shape'];
      properties: { recordId: string; sourceRecordId: string; valueKind: string; geometryBasis: string | null };
    }[]; omitted: readonly string[] }
  | { kind: 'unit-sphere'; frame: 'gsv.unit-sphere-display.v1'; items: readonly {
      recordId: string; sourceGeometry: Geometry; vertices: readonly (readonly [number, number, number])[];
    }[]; omitted: readonly string[] }
);

/**
 * Adapted from GSV src/geo/projection.ts at 58713d02d4e79c52290ee9d0da51ea6b4d0677ed.
 * Same display axes (0 longitude -> +X, 90 E -> -Z, north -> +Y), without Three.js.
 * This is a unit-sphere DISPLAY mapping, not ECEF, a metric frame, or uncertainty propagation.
 */
function unitSphere([longitude, latitude]: Position): readonly [number, number, number] {
  const phi = latitude * Math.PI / 180, lambda = longitude * Math.PI / 180;
  return [Math.cos(phi) * Math.cos(lambda), Math.sin(phi), -Math.cos(phi) * Math.sin(lambda)];
}
export function project(input: RepresentationIR, kind: ViewKind): Result<Projection> {
  const checked = validateIR(input);
  if (!checked.ok) return checked;
  const ir = checked.value;
  const passId = typeof kind === 'string' && VIEW_KINDS.includes(kind) ? `gsc.project.${kind}.v1` : 'gsc.project.unsupported.v1';
  if (!VIEW_KINDS.includes(kind)) return { ok: false, passes: [...checked.passes, passId], diagnostics: [
    ...checked.diagnostics, { code: 'UNSUPPORTED_REPRESENTATION', severity: 'error', message: 'No backend for requested view', passId },
  ] };
  const envelope = { compilationId: ir.compilationId, bindings: ir.bindings };
  const notes: Diagnostic[] = [...checked.diagnostics];
  let projection: Projection;
  if (kind === 'table') projection = { ...envelope, kind, rows: ir.records };
  else if (kind === 'timeline') projection = { ...envelope, kind, rows: ir.records.map((r) => ({
    id: r.id, source: r.source, knownAt: r.knownAt, eventTime: r.eventTime,
    period: r.period, validity: r.validity, knownAtBasis: r.knownAtBasis,
  })) };
  else if (kind === 'relations') projection = { ...envelope, kind,
    edges: ir.records.flatMap((r) => r.links.map((link) => ({ from: r.id, to: link.targetId, predicate: link.predicate }))),
  };
  else {
    const eligible: (IRRecord & { geometry: Geometry })[] = [];
    const omitted: string[] = [];
    for (const r of ir.records.filter((r) => r.role === 'entity')) {
      if (r.geometry === null || r.geometry.frame.reference !== 'OGC:CRS84') {
        omitted.push(r.id);
        notes.push({ code: r.geometry === null ? 'MISSING_GEOMETRY' : 'UNSUPPORTED_CRS', severity: 'warning',
          message: r.geometry === null ? 'No geometry supplied; entity omitted from spatial output' : 'This backend only supports declared OGC:CRS84', recordId: r.id, passId });
      } else eligible.push(r as IRRecord & { geometry: Geometry });
    }
    projection = kind === 'geojson' ? { ...envelope, kind, type: 'FeatureCollection', omitted,
      features: eligible.map((r) => ({ type: 'Feature', id: r.id, geometry: r.geometry.shape,
        properties: { recordId: r.id, sourceRecordId: r.source.recordId, valueKind: r.valueKind, geometryBasis: r.geometry.basis } })),
    } : { ...envelope, kind, frame: 'gsv.unit-sphere-display.v1', omitted,
      items: eligible.map((r) => ({ recordId: r.id, sourceGeometry: r.geometry,
        vertices: (r.geometry.shape.type === 'Point' ? [r.geometry.shape.coordinates] : r.geometry.shape.coordinates).map(unitSphere),
      })),
    };
  }
  return deepFreeze({ ok: true, value: projection, diagnostics: notes, passes: [...checked.passes, passId] });
}
