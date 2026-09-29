/** Pipe 1 read projection. Counts describe held records, not quantities or a new engine. */
import type { AdapterPayload } from './adapters';
import type { AssembledState } from './store';
import type { ValueKind } from './types';
import { knownAtOf } from './analytics';
import { selectTopology } from './graph';
import { corpusHealthAccounting } from './horizon';
import { sensorCardsForAdapter } from './sourceRegistry';
import type { SensorCard, SensorRung } from './sensorCards';

export interface SensorReading {
  adapterId: string;
  cards: SensorCard[];
  state: 'available' | 'degraded' | 'dark' | 'unknown';
  rungs: SensorRung[];
  records: number;
  reason: 'adapter_failed' | 'no_records' | 'last_good_or_snapshot' | 'snapshot_only' | 'acquisition_unreported' | 'sensor_card_missing' | 'live_or_cache';
}
export function readAdapterSensor(adapterId: string, payload: AdapterPayload | null): SensorReading {
  const cards = sensorCardsForAdapter(adapterId);
  const records = payload ? payload.entities.length + payload.observations.length + payload.flows.length + payload.capacities.length + payload.dependencies.length + payload.events.length : 0;
  const snapshotOnly = cards.length > 0 && cards.every(c => c.availableRungs.length === 1 && c.availableRungs[0] === 'snapshot');
  const rungs = [...new Set(payload?.observations.flatMap(o => o.provenance.acquisition ? [o.provenance.acquisition.rung] : []) ?? [])].sort() as SensorRung[];
  if (!payload || records === 0) return { adapterId, cards, records, rungs, state: 'dark', reason: payload ? 'no_records' : 'adapter_failed' };
  if (!cards.length) return { adapterId, cards, records, rungs, state: 'unknown', reason: 'sensor_card_missing' };
  if (snapshotOnly) return { adapterId, cards, records, rungs: ['snapshot'], state: 'available', reason: 'snapshot_only' };
  if (!rungs.length) return { adapterId, cards, records, rungs, state: 'unknown', reason: 'acquisition_unreported' };
  const degraded = rungs.includes('last_good') || rungs.includes('snapshot');
  return { adapterId, cards, records, rungs, state: degraded ? 'degraded' : 'available', reason: degraded ? 'last_good_or_snapshot' : 'live_or_cache' };
}
export interface SeatSelection {
  commodity: string;
  asOf: string | null;
  knowledge: 'best_known' | 'as_known_then';
  /** Exact existing flow ID; names, coordinates and guessed merges are not accepted. */
  corridorId?: string;
}
export class SeatRefusal extends Error {
  constructor(public code: 'unresolved_identifier' | 'coverage_gap' | 'policy', public remedy: string) { super(code); }
}
export function seatProjection(assembled: AssembledState, selection: SeatSelection, at = new Date().toISOString()) {
  const { state } = assembled;
  if (state.commodity !== selection.commodity) throw new SeatRefusal('unresolved_identifier', 'Select an assembled commodity.');
  if (selection.knowledge === 'as_known_then' && !selection.asOf) throw new SeatRefusal('coverage_gap', 'Supply the knowledge cutoff date.');
  const date = selection.asOf ?? at.slice(0, 10);
  const visible = {
    ...state,
    observations: state.observations.filter(o => o.period.start <= date && (selection.knowledge === 'best_known' || knownAtOf(o) <= date)),
    flows: state.flows.filter(f => selection.knowledge === 'best_known' || f.valueKind === 'representative' || f.provenance.retrievedAt.slice(0, 10) <= date),
  };
  const flows = selectTopology(visible, date).flows;
  const corridor = selection.corridorId ? state.flows.find(f => f.id === selection.corridorId) : null;
  if (selection.corridorId && !corridor) throw new SeatRefusal('unresolved_identifier', 'Use an exact registered flow ID; names never merge.');
  if (corridor && !flows.some(f => f.id === corridor.id)) throw new SeatRefusal('coverage_gap', 'This corridor is not available in the selected date and knowledge frame.');
  const members = corridor ? new Set([corridor.fromEntityId, corridor.toEntityId]) : null;
  const observations = visible.observations.filter(o => !members || members.has(o.entityId));
  const selectedFlows = corridor ? flows.filter(f => f.fromEntityId === corridor.fromEntityId && f.toEntityId === corridor.toEntityId) : flows;
  const capacities = state.capacities.filter(c => (!members || members.has(c.entityId)) && (!c.period || c.period.start <= date) &&
    (selection.knowledge === 'best_known' || c.valueKind === 'representative' || c.provenance.retrievedAt.slice(0, 10) <= date));
  const mix: Record<ValueKind, number> = { reported: 0, estimated: 0, representative: 0, derived: 0 };
  for (const row of [...observations, ...selectedFlows, ...capacities]) mix[row.valueKind]++;
  return {
    schema: 'seat-projection.v1', sku: { product: 'seat', kind: corridor ? 'corridor' : 'commodity', commodity: state.commodity, corridorId: corridor?.id ?? null },
    asOf: selection.asOf, knowledge: selection.knowledge,
    evidenceClassMix: mix,
    evidenceClassOrder: ['reported', 'estimated', 'representative', 'derived'],
    recordPopulation: { observations: observations.length, flows: selectedFlows.length, capacities: capacities.length,
      note: 'Counts of retained quantitative records, including coexisting source claims, not sums or confidence scores; flows use selected topology.' },
    unresolvedIdentifierCount: state.unresolved?.length ?? 0,
    unresolvedFrame: 'current_commodity_assembly_residue_not_historical_or_corridor_specific',
    lastSuccessfulAssembleTime: assembled.assembledAt,
    sensorStatusFrame: 'current_assembly_not_historical',
    sensors: assembled.sensorReadings,
    sensorsDark: assembled.sensorReadings.filter(s => s.state === 'dark').map(s => s.adapterId),
    sensorsDegraded: assembled.sensorReadings.filter(s => s.state === 'degraded').map(s => s.adapterId),
    sensorsUnknown: assembled.sensorReadings.filter(s => s.state === 'unknown').map(s => s.adapterId),
    // Existing freshness judgement, evaluated now, separately from acquisition success.
    corpusHealth: corpusHealthAccounting(state, at.slice(0, 10)),
    accounting: assembled.accounting,
  };
}
