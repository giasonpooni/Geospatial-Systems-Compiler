/** Explicit domain projection; no scientific analysis or canonical-state mutation. */
import { compilePayload } from './adapters';
import { array, attempt, object, requireThat, timeValue, validateIR } from './compiler';
import { dataTree, finite, identifier, text } from './compat/gsv/validation';
import { recordKey } from './ir';
import type { Bindings, Diagnostic, IRRecord, Interval, RepresentationIR, Result, ValueKind } from './ir';

const collections = ['flows', 'capacities', 'dependencies', 'events'] as const;
const optional = (v: unknown, field: string) => v === undefined ? null : text(v, field);
function period(value: unknown): Interval | null {
  if (value === undefined) return null;
  const p = object(value, 'period'), from = timeValue(p.start), to = timeValue(p.end);
  requireThat(from.precision === 'date' && to.precision === 'date', 'INVALID_TIME', 'Payload measurement periods retain calendar-date precision');
  return { from, to, end: 'inclusive' };
}
/**
 * Accept an explicit six-collection projection of the existing EconomyState.
 * Metadata/accounting fields are not silently accepted and discarded. Endpoint
 * geometry is never converted into an invented route; links remain links.
 */
export function compilePayloadDomain(input: unknown, compilationId: string, bindings: Bindings): Result<RepresentationIR> {
  const notes: Diagnostic[] = [];
  const adapted = attempt<RepresentationIR>('gsc.adapter.payload-domain.v1', () => {
    dataTree(input); dataTree(bindings);
    const p = object(structuredClone(input), 'domain projection');
    requireThat(Object.keys(p).every((key) => ['entities', 'observations', 'coordinateFrame', ...collections].includes(key)),
      'UNSUPPORTED_RECORD', 'Expected an explicit six-collection domain projection');
    const base = compilePayload({ entities: p.entities, observations: p.observations,
      ...(p.coordinateFrame === undefined ? {} : { coordinateFrame: p.coordinateFrame }) }, compilationId, bindings);
    requireThat(base.ok, 'INVALID_SOURCE_RECORD', base.diagnostics.map((d) => d.message).join('; '));
    notes.push(...base.diagnostics);
    const entities = new Map(base.value.records.filter((r) => r.source.collection === 'entities').map((r) => [r.source.recordId, r.id]));
    const records: IRRecord[] = [...base.value.records];
    for (const collection of collections) for (const item of array(p[collection], collection)) {
      const row = object(item, collection), provenance = object(row.provenance, 'provenance');
      const source = { adapterId: 'payload.domain.v1', datasetId: bindings.datasetId, collection, recordId: identifier(row.id, 'id') };
      // These domain contracts do not declare a system-known clock. Retrieval is the conservative bound.
      const retrievedAt = timeValue(provenance.retrievedAt);
      const links: { predicate: string; targetId: string }[] = [];
      for (const key of ['fromEntityId', 'toEntityId', 'entityId']) if (row[key] !== undefined) {
        const target = entities.get(identifier(row[key], key));
        requireThat(target, 'UNBOUND_IDENTITY', `${collection}: unresolved ${key}`); links.push({ predicate: key, targetId: target });
      }
      let record: IRRecord = { id: recordKey(source), source, role: 'entity', kind: collection,
        label: source.recordId, valueKind: 'unspecified', geometry: null, quantity: null, links,
        knownAt: retrievedAt, knownAtBasis: 'retrieval-upper-bound', eventTime: null, period: null, validity: null,
        uncertaintyRefs: [], provenance: [{ sourceId: text(provenance.sourceId, 'sourceId'), knownAt: retrievedAt,
          retrievedAt, sourceRef: optional(provenance.sourceRef, 'sourceRef'), artifactId: optional(provenance.artifactId, 'artifactId'), evidenceIds: [] }], sourceRecord: row };
      if (collection === 'flows' || collection === 'capacities') {
        requireThat(['reported', 'estimated', 'derived', 'representative'].includes(row.valueKind as string), 'INVALID_SOURCE_RECORD', 'Unknown domain valueKind');
        requireThat(['low', 'medium', 'high'].includes(row.confidence as string), 'INVALID_SOURCE_RECORD', 'Unknown domain confidence class');
        record = { ...record, role: collection === 'flows' ? 'observation' : 'constraint', valueKind: row.valueKind as ValueKind,
          quantity: { value: finite(collection === 'flows' ? row.quantity : row.value, 'quantity'), unit: text(row.unit, 'unit'), basis: optional(row.basis, 'basis') },
          period: period(row.period), label: collection === 'flows' ? `${text(row.commodity, 'commodity')} / ${text(row.form, 'form')}` : text(row.stage, 'stage') };
        if (collection === 'flows') {
          requireThat(links.some((l) => l.predicate === 'fromEntityId') && links.some((l) => l.predicate === 'toEntityId'), 'UNBOUND_IDENTITY', 'Flow requires both endpoints');
          requireThat(record.period !== null, 'INVALID_TIME', 'Flow requires a measurement period');
          requireThat(['sea', 'rail', 'road', 'pipeline', 'internal', 'mixed', 'unknown'].includes(row.mode as string), 'INVALID_SOURCE_RECORD', 'Unknown Payload transport mode');
          record = { ...record, kind: `flow:${row.mode}:${row.form}` };
        } else {
          requireThat(links.some((l) => l.predicate === 'entityId'), 'UNBOUND_IDENTITY', 'Capacity requires an entity');
          record = { ...record, kind: `capacity:${row.stage}`, applicability: record.period };
        }
      } else if (collection === 'dependencies') {
        requireThat(links.length === 2 && row.fromEntityId !== undefined && row.toEntityId !== undefined, 'UNBOUND_IDENTITY', 'Dependency requires two endpoints');
        requireThat(['depends_on', 'feeds', 'located_in', 'produces', 'processes', 'consumes', 'operated_by'].includes(row.type as string), 'INVALID_SOURCE_RECORD', 'Unknown dependency type');
        if (row.strength !== undefined) finite(row.strength, 'strength', 0, 1);
        if (row.role !== undefined) requireThat(['operator', 'shareholder'].includes(row.role as string), 'INVALID_SOURCE_RECORD', 'Unknown dependency role');
        record = { ...record, role: 'assertion', kind: `${row.type}:${row.role ?? 'role-unspecified'}`, label: `${row.type} / ${row.role ?? 'role not supplied'}` };
      } else {
        requireThat(['outage', 'strike', 'closure', 'expansion', 'disruption', 'weather', 'policy', 'demand_surge', 'sanction', 'insolvency'].includes(row.type as string), 'INVALID_SOURCE_RECORD', 'Unknown event type');
        const from = timeValue(row.start), to = row.end === undefined ? null : timeValue(row.end);
        // Preserve each supplied time, but do not manufacture an event-end convention.
        if (to !== null) requireThat(from.precision === to.precision, 'INVALID_TIME', 'Event start/end precision differs');
        for (const key of ['firstReportedAt', 'announcedAt']) if (row[key] !== undefined) timeValue(row[key]);
        record = { ...record, role: 'event', kind: `event:${text(row.type, 'type')}`, label: text(row.title, 'title'),
          eventTime: from };
        notes.push({ code: 'UNAVAILABLE_TIME', severity: 'warning', recordId: record.id,
          message: 'Event interval endpoint convention is not declared; start is retained, full interval stays in source detail, active-state inference is unsupported' });
      }
      records.push(record);
    }
    return { schema: 'gsc.representation-ir.v1', compilationId, bindings, records };
  });
  if (!adapted.ok) return adapted;
  const checked = validateIR(adapted.value);
  return { ...checked, diagnostics: [...notes, ...checked.diagnostics], passes: [...adapted.passes, ...checked.passes] };
}
