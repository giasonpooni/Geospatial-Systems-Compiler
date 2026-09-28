/** Browser composition seam. The original GSV store/provider remain renderer-blind. */
import { WorldStore } from '../../../packages/gsv/src/data/store';
import { SyntheticProvider } from '../../../packages/gsv/src/data/synthetic/provider';
import type { SpatialDataProvider } from '../../../packages/gsv/src/data/provider';
import type { EntityState, WorldSnapshot } from '../../../packages/gsv/src/data/contracts';
import { compileGsv } from '../gsc/adapters';
import { beginInvestigation, transitionInvestigation } from '../gsc/investigation';
import type { InvestigationState } from '../gsc/investigation';
import type { IRRecord, RepresentationIR, Result } from '../gsc/ir';
import { timeOrder, timeValue } from '../gsc/compiler';
import { deepFreeze } from '../gsc/compat/gsv/validation';
import { project } from '../gsc/projections';
import type { Projection } from '../gsc/projections';
import { selectTemporal } from '../gsc/temporal';
import type { TemporalSlice } from '../gsc/temporal';

const SOURCE_PIN = '58713d02d4e79c52290ee9d0da51ea6b4d0677ed';
export type DynamicState =
  | { status: 'available'; kind: 'synthetic'; value: EntityState; modelId: string; sourceRecordId: string; inputEventIds: readonly string[] }
  | { status: 'unavailable'; reason: string };
export interface InvestigationFrame {
  readonly state: InvestigationState;
  readonly temporal: TemporalSlice;
  readonly map: Extract<Projection, { kind: 'geojson' }>;
  readonly globe: Extract<Projection, { kind: 'unit-sphere' }>;
  readonly selected: IRRecord | null;
  readonly selectedUnavailable: boolean;
  readonly dynamic: DynamicState;
}

export class GsvInvestigation {
  readonly ir: RepresentationIR;
  readonly snapshot: WorldSnapshot;
  private state: InvestigationState;
  private readonly store: WorldStore;
  private readonly synthetic: boolean;
  private frameCache: InvestigationFrame | null = null;
  private spatialCache: { key: string; temporal: TemporalSlice; map: InvestigationFrame['map']; globe: InvestigationFrame['globe'] } | null = null;

  private constructor(store: WorldStore, ir: RepresentationIR, synthetic: boolean) {
    this.store = store; this.snapshot = store.snapshot; this.ir = ir; this.synthetic = synthetic;
    const initial = beginInvestigation(ir);
    if (!initial.ok) throw new Error('Failed to initialize investigation');
    this.state = deepFreeze({ ...initial.value, view: 'geojson',
      eventCursor: timeValue(this.snapshot.timeRange.now), knowledgeCutoff: timeValue(this.snapshot.timeRange.now) });
  }

  static async load(provider: SpatialDataProvider = new SyntheticProvider()): Promise<GsvInvestigation> {
    const store = new WorldStore();
    const snapshot = await store.init(provider);
    // Snapshot identity is absent upstream. Never relabel a code commit as a snapshot/release ID.
    const synthetic = provider instanceof SyntheticProvider;
    const compiled = compileGsv(snapshot, `gsc:view:${provider.id}:${snapshot.meta.generatedAt}`, {
      datasetId: provider.id, snapshotId: null, releaseId: null, runId: null,
      modelId: synthetic ? `gsv.synthetic-model:${SOURCE_PIN}` : null,
    });
    if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => d.message).join('; '));
    return new GsvInvestigation(store, compiled.value, synthetic);
  }

  dispatch(command: unknown): Result<InvestigationState> {
    const result = transitionInvestigation(this.ir, this.state, command);
    if (!result.ok) return result;
    const next = result.value;
    const start = timeValue(this.snapshot.timeRange.start), end = timeValue(this.snapshot.timeRange.end);
    for (const t of [next.eventCursor, next.knowledgeCutoff]) {
      if (t === null || t.precision !== 'instant' || timeOrder(t, start) < 0 || timeOrder(t, end) > 0)
        return { ok: false, passes: result.passes, diagnostics: [{ code: 'UNAVAILABLE_TIME', severity: 'error',
          message: 'Both clocks must remain explicit UTC instants inside the supplied snapshot range' }] };
    }
    // Evaluate first; malformed temporal data cannot partially advance the active view.
    const previous = this.state;
    this.state = next; this.frameCache = null;
    try { this.frame(); }
    catch (error) {
      this.state = previous; this.frameCache = null;
      return { ok: false, passes: result.passes, diagnostics: [{ code: 'UNAVAILABLE_TIME', severity: 'error',
        message: error instanceof Error ? error.message : 'Temporal selection failed' }] };
    }
    return result;
  }

  frame(): InvestigationFrame {
    if (this.frameCache) return this.frameCache;
    const at = this.state.eventCursor!, knownAt = this.state.knowledgeCutoff!;
    const key = JSON.stringify([at, knownAt]);
    if (this.spatialCache?.key !== key) {
      const selected = selectTemporal(this.ir, { at, knownAt, from: timeValue(this.snapshot.timeRange.start) });
      if (!selected.ok) throw new Error(selected.diagnostics.map((d) => d.message).join('; '));
      const map = project(selected.value.ir, 'geojson'), globe = project(selected.value.ir, 'unit-sphere');
      if (!map.ok || map.value.kind !== 'geojson' || !globe.ok || globe.value.kind !== 'unit-sphere')
        throw new Error('A required representation was refused');
      this.spatialCache = { key, temporal: selected.value, map: map.value, globe: globe.value };
    }
    const { temporal, map, globe } = this.spatialCache;
    const selected = temporal.ir.records.find((r) => r.id === this.state.selectedRecordId) ?? null;
    this.frameCache = deepFreeze({ state: this.state, temporal, map, globe, selected,
      selectedUnavailable: this.state.selectedRecordId !== null && selected === null,
      dynamic: this.resolveState(selected, at.value, knownAt.value) });
    return this.frameCache;
  }

  private resolveState(selected: IRRecord | null, at: string, knownAt: string): DynamicState {
    if (!selected || !['nodes', 'routes', 'flows'].includes(selected.source.collection))
      return { status: 'unavailable', reason: 'Select a geographic entity with a supported provider state' };
    if (!this.synthetic) return { status: 'unavailable', reason: 'This provider has no declared model-input knowledge policy' };
    try {
      const value = this.store.stateAt(selected.source.recordId, at);
      const cutoff = timeValue(knownAt);
      // Do not merely hide unknown events while displaying their modelled effect.
      for (const id of value.activeEventIds) {
        const event = this.snapshot.events.find((e) => e.id === id);
        if (!event || timeOrder(timeValue(event.provenance.knownAt), cutoff) > 0)
          return { status: 'unavailable', reason: 'A contributing model event was not known by this cutoff' };
      }
      return { status: 'available', kind: 'synthetic', value, modelId: this.ir.bindings.modelId!,
        sourceRecordId: selected.source.recordId, inputEventIds: [...value.activeEventIds] };
    } catch (error) { return { status: 'unavailable', reason: error instanceof Error ? error.message : 'Provider state refused' }; }
  }
}
