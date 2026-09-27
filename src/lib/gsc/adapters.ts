import { dataTree, identifier, text, finite, validatedSnapshot } from './compat/gsv/validation';
import { array, attempt, object, requireThat, timeValue, validateIR } from './compiler';
import { recordKey } from './ir';
import type { Bindings, Diagnostic, Geometry, IRRecord, ProvenanceRef, RepresentationIR, Result, ValueKind } from './ir';

type Row = Record<string, unknown>;
export const CRS84: Geometry['frame'] = Object.freeze({
  reference: 'OGC:CRS84', axes: Object.freeze(['longitude', 'latitude'] as const), unit: 'degree',
});
const optionalText = (value: unknown, field: string): string | null =>
  value === undefined ? null : text(value, field);
function blank(adapterId: string, bindings: Bindings, collection: string, row: Row): IRRecord {
  const source = { adapterId, datasetId: bindings.datasetId, collection, recordId: identifier(row.id, 'record id') };
  return {
    id: recordKey(source), source, role: 'entity', kind: collection,
    label: typeof row.name === 'string' ? row.name : source.recordId,
    valueKind: 'unspecified', geometry: null, quantity: null,
    knownAt: null, knownAtBasis: 'unavailable', eventTime: null, period: null, validity: null,
    provenance: [], uncertaintyRefs: [], links: [], sourceRecord: row,
  };
}
function finish(adapted: Result<RepresentationIR>, notes: readonly Diagnostic[]): Result<RepresentationIR> {
  if (!adapted.ok) return adapted;
  const checked = validateIR(adapted.value);
  return { ...checked, diagnostics: [...notes, ...checked.diagnostics], passes: [...adapted.passes, ...checked.passes] };
}

/** Compile static snapshot records; this does NOT replace the GSV stateAt dynamics provider. */
export function compileGsv(input: unknown, compilationId: string, bindings: Bindings): Result<RepresentationIR> {
  const result = attempt<RepresentationIR>('gsc.adapter.gsv-snapshot.v1', () => {
    dataTree(bindings);
    const snapshot = validatedSnapshot(input);
    const collections = ['nodes', 'routes', 'flows', 'commodities', 'events', 'constraints', 'assertions', 'observations'] as const;
    const originals = collections.flatMap((collection) => snapshot[collection].map((r) => ({
      collection, row: r as unknown as Row,
    })));
    const ids = new Map(originals.map(({ collection, row }) => [row.id as string,
      blank('gsv.snapshot.v1', bindings, collection, row).id]));
    const records = originals.map(({ collection, row }): IRRecord => {
      const base = blank('gsv.snapshot.v1', bindings, collection, row);
      const p = object(row.provenance, 'provenance');
      const knownAt = timeValue(p.knownAt);
      const provenance: ProvenanceRef = {
        sourceId: text(p.source, 'source'), knownAt, retrievedAt: null,
        sourceRef: null, artifactId: null,
        evidenceIds: p.evidence === undefined ? [] : array(p.evidence, 'evidence').map((s) => text(s, 'evidence')),
      };
      const role = collection === 'observations' ? 'observation' : collection === 'assertions' ? 'assertion' :
        collection === 'events' ? 'event' : collection === 'constraints' ? 'constraint' : 'entity';
      const links: { predicate: string; targetId: string }[] = [];
      const link = (predicate: string, target: unknown) => {
        const targetId = ids.get(identifier(target, predicate));
        requireThat(targetId, 'UNBOUND_IDENTITY', 'Unresolved GSV reference', base.id);
        links.push({ predicate, targetId });
      };
      for (const key of ['entityId', 'originId', 'destinationId', 'commodityId'] as const)
        if (row[key] !== undefined) link(key, row[key]);
      for (const key of ['inputs', 'outputs', 'connectedRouteIds', 'connectedSupplierIds', 'connectedCustomerIds', 'affects'] as const)
        if (row[key] !== undefined) array(row[key], key).forEach((id) => link(key, id));
      if (collection === 'flows') array(row.segments, 'segments').forEach((s, index) => link(`segment:${index}:route`, object(s, 'segment').routeId));
      let geometry: Geometry | null = null;
      if (collection === 'nodes' || collection === 'routes') geometry = {
        frame: CRS84, shape: row.geometry as Geometry['shape'], basis: optionalText(row.geometryBasis, 'geometryBasis'),
      };
      return {
        ...base, role, kind: typeof row.kind === 'string' ? row.kind : typeof row.metric === 'string' ? row.metric : collection,
        valueKind: p.source === 'synthetic:demo' ? 'synthetic' : role === 'observation' ? 'observed' : 'unspecified',
        geometry, knownAt, knownAtBasis: 'declared', provenance: [provenance], links,
        quantity: role === 'observation' || role === 'assertion' ? {
          value: finite(row.value, 'value'), unit: optionalText(row.unit, 'unit'), basis: null,
        } : null,
        eventTime: role === 'observation' ? timeValue(row.t) : role === 'assertion' ? timeValue(row.assertedAt) : null,
        period: role === 'event' ? { from: timeValue(row.start), to: row.end === undefined ? null : timeValue(row.end), end: 'exclusive' } : null,
        validity: p.validFrom !== undefined || p.validTo !== undefined ? {
          from: p.validFrom === undefined ? null : timeValue(p.validFrom),
          to: p.validTo === undefined ? null : timeValue(p.validTo), end: 'exclusive',
        } : null,
      };
    });
    return { schema: 'gsc.representation-ir.v1', compilationId, bindings, records };
  });
  return finish(result, []);
}

/**
 * Explicit projection of Payload's Entity/Observation contracts. Full economy
 * corpora must not be passed accidentally: unsupported top-level collections fail.
 * coordinateFrame is a producer declaration; absent frame means no spatial projection.
 */
export function compilePayload(input: unknown, compilationId: string, bindings: Bindings): Result<RepresentationIR> {
  const notes: Diagnostic[] = [];
  const result = attempt<RepresentationIR>('gsc.adapter.payload-projection.v1', () => {
    dataTree(input); dataTree(bindings);
    const projection = object(structuredClone(input), 'Payload projection');
    requireThat(Object.keys(projection).every((k) => ['entities', 'observations', 'coordinateFrame'].includes(k)),
      'UNSUPPORTED_RECORD', 'Supply an explicit entities/observations projection, not an entire domain corpus');
    const entities = array(projection.entities, 'entities').map((r) => object(r, 'entity'));
    const observations = array(projection.observations, 'observations').map((r) => object(r, 'observation'));
    const frame = projection.coordinateFrame === undefined || projection.coordinateFrame === null ? null :
      object(projection.coordinateFrame, 'coordinateFrame') as unknown as Geometry['frame'];
    if (frame !== null) {
      requireThat(frame.reference === 'OGC:CRS84', 'UNSUPPORTED_CRS', 'Payload longitude/latitude projection only supports an explicitly declared OGC:CRS84 frame');
      requireThat(Array.isArray(frame.axes) && frame.axes.length === 2 && frame.axes[0] === 'longitude' && frame.axes[1] === 'latitude' && frame.unit === 'degree',
        'FRAME_MISMATCH', 'Payload coordinates require longitude/latitude degrees; no implicit reprojection');
    }
    const entityIds = new Map(entities.map((r) => [identifier(r.id, 'entity.id'), blank('payload.projection.v1', bindings, 'entities', r).id]));
    const observationIds = new Map(observations.map((r) => [identifier(r.id, 'observation.id'), blank('payload.projection.v1', bindings, 'observations', r).id]));
    const records: IRRecord[] = entities.map((row) => {
      const base = blank('payload.projection.v1', bindings, 'entities', row);
      let geometry: Geometry | null = null;
      requireThat((row.lat === undefined) === (row.lng === undefined), 'MISSING_GEOMETRY', 'Partial latitude/longitude pair', base.id);
      if (row.lat !== undefined) {
        finite(row.lat, 'latitude', -90, 90); finite(row.lng, 'longitude', -180, 180);
        if (frame !== null) geometry = { frame, basis: null, shape: { type: 'Point', coordinates: [row.lng as number, row.lat as number] } };
        else notes.push({ code: 'FRAME_MISMATCH', severity: 'warning', recordId: base.id,
          message: 'Coordinates retained in source detail; producer has not declared a coordinate frame' });
      }
      return { ...base, kind: text(row.kind, 'kind'), label: text(row.name, 'name'), geometry };
    });
    for (const row of observations) {
      const base = blank('payload.projection.v1', bindings, 'observations', row);
      const entityId = entityIds.get(identifier(row.entityId, 'entityId'));
      requireThat(entityId, 'UNBOUND_IDENTITY', 'Observation entity is absent from this projection', base.id);
      const p = object(row.provenance, 'provenance');
      const retrievedAt = timeValue(p.retrievedAt);
      const knownAt = row.knownAt === undefined ? retrievedAt : timeValue(row.knownAt);
      const period = object(row.period, 'period');
      const from = timeValue(period.start), to = timeValue(period.end);
      requireThat(from.precision === 'date' && to.precision === 'date', 'INVALID_TIME', 'Payload periods require calendar dates', base.id);
      requireThat(['reported', 'estimated', 'derived', 'representative'].includes(row.valueKind as string),
        'INVALID_SOURCE_RECORD', 'Unknown Payload valueKind', base.id);
      const links = [{ predicate: 'entityId', targetId: entityId }];
      if (row.partnerEntityId !== undefined) {
        const partner = entityIds.get(identifier(row.partnerEntityId, 'partnerEntityId'));
        requireThat(partner, 'UNBOUND_IDENTITY', 'Partner entity is absent from projection', base.id);
        links.push({ predicate: 'partnerEntityId', targetId: partner });
      }
      if (row.supersedes !== undefined) {
        const previous = observationIds.get(identifier(row.supersedes, 'supersedes'));
        if (previous) links.push({ predicate: 'supersedes', targetId: previous });
        else notes.push({ code: 'UNSUPPORTED_RECORD', severity: 'warning', recordId: base.id,
          message: 'Predecessor is outside this projection; supersedes reference retained in source detail' });
      }
      records.push({ ...base, role: 'observation', kind: text(row.metric, 'metric'), label: text(row.metric, 'metric'),
        valueKind: row.valueKind as ValueKind, knownAt,
        knownAtBasis: row.knownAt === undefined ? 'retrieval-upper-bound' : 'declared',
        period: { from, to, end: 'inclusive' }, links,
        quantity: { value: finite(row.value, 'value'), unit: text(row.unit, 'unit', 128), basis: optionalText(row.basis, 'basis') },
        provenance: [{ sourceId: text(p.sourceId, 'sourceId'), knownAt, retrievedAt,
          sourceRef: optionalText(p.sourceRef, 'sourceRef'), artifactId: optionalText(p.artifactId, 'artifactId'), evidenceIds: [] }],
      });
    }
    return { schema: 'gsc.representation-ir.v1', compilationId, bindings, records };
  });
  return finish(result, notes);
}
