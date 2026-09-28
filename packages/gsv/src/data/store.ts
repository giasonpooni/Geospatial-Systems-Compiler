/**
 * WorldStore — read-only projection of provider state for the twin.
 *
 * The store never mutates canonical data; it indexes a WorldSnapshot
 * for query and resolves temporal state through the provider. It is
 * deliberately renderer-blind (enforced by scripts/check-seam.mjs).
 */

import type {
  Assertion,
  Commodity,
  Deviation,
  EntityId,
  EntityState,
  Facility,
  Flow,
  Observation,
  Route,
  Timestamp,
  TransportMode,
  WorldEvent,
  WorldSnapshot,
} from './contracts';
import type { SpatialDataProvider } from './provider';
import { deepFreeze, identifier, instant, text, validatedSnapshot, validatedState } from './validation.ts';

export interface SearchResult {
  id: EntityId;
  name: string;
  kind: string;
  score: number;
  detail?: string;
}

export interface DeviationView {
  assertion: Assertion;
  observations: Observation[];
  meanObserved: number | null;
  deviation: Deviation | null;
  status: 'ready' | 'unavailable';
  reason: string | null;
  excluded: Array<{ observationId: EntityId; reason: string }>;
  comparison: DeviationSelection & {
    interval: '[from,to)'; unit: string | null;
    method: 'descriptive_arithmetic_mean'; independence: 'not_established';
    observationIds: EntityId[]; sources: string[];
  };
}

/** Knowledge cutoff and event-time window are independent, explicit clocks. */
export interface DeviationSelection { knownAt: Timestamp; from: Timestamp; to: Timestamp }

export class WorldStore {
  private provider!: SpatialDataProvider;
  private snap!: WorldSnapshot;

  private nodeIx = new Map<EntityId, Facility>();
  private routeIx = new Map<EntityId, Route>();
  private flowIx = new Map<EntityId, Flow>();
  private commodityIx = new Map<EntityId, Commodity>();
  private routesByNode = new Map<EntityId, Route[]>();
  private flowsByRoute = new Map<EntityId, Flow[]>();
  private assertionsByEntity = new Map<EntityId, Assertion[]>();
  private observationsByEntity = new Map<EntityId, Observation[]>();
  private generation = 0;

  async init(provider: SpatialDataProvider): Promise<WorldSnapshot> {
    identifier(provider.id, 'provider.id'); text(provider.label, 'provider.label');
    if (typeof provider.load !== 'function' || typeof provider.stateAt !== 'function') throw new Error('Invalid provider interface');
    const generation = ++this.generation;
    const snapshot = validatedSnapshot(await provider.load());
    // A slow earlier request must never replace a later selection.
    if (generation !== this.generation) throw new Error('Snapshot load superseded');
    const indexes = this.buildIndexes(snapshot);
    // All work above may fail. Commit provider, snapshot and fresh indexes together.
    Object.assign(this, indexes);
    this.provider = provider;
    this.snap = snapshot;
    return snapshot;
  }

  get snapshot(): WorldSnapshot {
    if (!this.snap) throw new Error('Snapshot is not loaded');
    return this.snap;
  }

  private buildIndexes(snapshot: WorldSnapshot) {
    const nodeIx = new Map<EntityId, Facility>();
    const routeIx = new Map<EntityId, Route>();
    const flowIx = new Map<EntityId, Flow>();
    const commodityIx = new Map<EntityId, Commodity>();
    const routesByNode = new Map<EntityId, Route[]>();
    const flowsByRoute = new Map<EntityId, Flow[]>();
    const assertionsByEntity = new Map<EntityId, Assertion[]>();
    const observationsByEntity = new Map<EntityId, Observation[]>();
    const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
      const arr = m.get(k);
      if (arr) arr.push(v);
      else m.set(k, [v]);
    };
    for (const n of snapshot.nodes) nodeIx.set(n.id, n);
    for (const r of snapshot.routes) {
      routeIx.set(r.id, r);
      push(routesByNode, r.originId, r);
      if (r.destinationId !== r.originId) push(routesByNode, r.destinationId, r);
    }
    for (const f of snapshot.flows) {
      flowIx.set(f.id, f);
      for (const id of new Set(f.segments.map((seg) => seg.routeId))) push(flowsByRoute, id, f);
    }
    for (const c of snapshot.commodities) commodityIx.set(c.id, c);
    for (const a of snapshot.assertions) push(assertionsByEntity, a.entityId, a);
    for (const o of snapshot.observations) push(observationsByEntity, o.entityId, o);
    for (const index of [routesByNode, flowsByRoute, assertionsByEntity, observationsByEntity])
      for (const entries of index.values()) Object.freeze(entries);
    return { nodeIx, routeIx, flowIx, commodityIx, routesByNode, flowsByRoute, assertionsByEntity, observationsByEntity };
  }

  // ---------------------------------------------------------------- lookups

  node(id: EntityId): Facility | undefined {
    return this.nodeIx.get(id);
  }
  route(id: EntityId): Route | undefined {
    return this.routeIx.get(id);
  }
  flow(id: EntityId): Flow | undefined {
    return this.flowIx.get(id);
  }
  commodity(id: EntityId): Commodity | undefined {
    return this.commodityIx.get(id);
  }
  entity(id: EntityId): Facility | Route | Flow | undefined {
    return this.nodeIx.get(id) ?? this.routeIx.get(id) ?? this.flowIx.get(id);
  }

  routesOfNode(nodeId: EntityId): Route[] {
    return this.routesByNode.get(nodeId) ?? [];
  }
  flowsThroughRoute(routeId: EntityId): Flow[] {
    return this.flowsByRoute.get(routeId) ?? [];
  }
  flowsTouchingNode(nodeId: EntityId): Flow[] {
    return this.snap.flows.filter(
      (f) =>
        f.originId === nodeId ||
        f.destinationId === nodeId ||
        f.segments.some((s) => s.fromNodeId === nodeId || s.toNodeId === nodeId)
    );
  }
  routesByMode(mode: TransportMode): Route[] {
    return this.snap.routes.filter((r) => r.mode === mode);
  }
  nodesInCountry(cc: string): Facility[] {
    return this.snap.nodes.filter((n) => n.country === cc);
  }
  routesTouchingCountry(cc: string): Route[] {
    return this.snap.routes.filter((r) => {
      const o = this.nodeIx.get(r.originId);
      const d = this.nodeIx.get(r.destinationId);
      return o?.country === cc || d?.country === cc;
    });
  }

  // ---------------------------------------------------------------- temporal

  stateAt(entityId: EntityId, t: Timestamp): EntityState {
    const snapshot = this.snapshot;
    if (!this.entity(identifier(entityId, 'entityId'))) throw new Error('Unknown entity');
    const ms = instant(t);
    if (ms < instant(snapshot.timeRange.start) || ms > instant(snapshot.timeRange.end)) throw new Error('Time outside snapshot range');
    return validatedState(this.provider.stateAt(entityId, t), entityId, t, new Map(snapshot.events.map((event) => [event.id, event])));
  }

  activeEvents(t: Timestamp): WorldEvent[] {
    const ms = instant(t);
    return this.snap.events.filter((e) => {
      const s = Date.parse(e.start);
      const en = e.end ? Date.parse(e.end) : Infinity;
      return ms >= s && ms < en;
    });
  }

  // ----------------------------------------------------- promises vs evidence

  /**
   * Join assertions (promises) against observations (evidence) for an
   * entity — the deviation history that shows where estimates run
   * optimistic. Derived on demand; nothing is overwritten.
   */
  deviationsFor(entityId: EntityId, selection: DeviationSelection): DeviationView[] {
    if (!this.entity(identifier(entityId, 'entityId'))) throw new Error('Unknown entity');
    const known = instant(selection.knownAt, 'knownAt');
    const from = instant(selection.from, 'from'), to = instant(selection.to, 'to');
    if (from >= to || from < instant(this.snapshot.timeRange.start) || to > instant(this.snapshot.timeRange.end)) throw new Error('Invalid comparison interval');
    const out: DeviationView[] = [];
    for (const a of this.assertionsByEntity.get(entityId) ?? []) {
      const candidates = (this.observationsByEntity.get(entityId) ?? []).filter((o) => o.metric === a.metric);
      const obs: Observation[] = [];
      const excluded: DeviationView['excluded'] = [];
      const assertionReason = instant(a.provenance.knownAt) > known || instant(a.assertedAt) > known
        ? 'ASSERTION_NOT_KNOWN' : !a.unit ? 'ASSERTION_UNIT_UNDECLARED'
          : a.provenance.validFrom === undefined || a.provenance.validTo === undefined ? 'ASSERTION_VALIDITY_UNDECLARED' : null;
      for (const o of candidates) {
        const time = instant(o.t);
        const reason = assertionReason ?? (!o.unit ? 'OBSERVATION_UNIT_UNDECLARED' : o.unit !== a.unit ? 'UNIT_MISMATCH'
          : instant(o.provenance.knownAt) > known ? 'OBSERVATION_NOT_KNOWN'
            : time < from || time >= to ? 'OUTSIDE_ANALYSIS_WINDOW'
              : time < instant(a.assertedAt) ? 'BEFORE_ASSERTION'
                : time < instant(a.provenance.validFrom!) || time >= instant(a.provenance.validTo!) ? 'OUTSIDE_ASSERTION_VALIDITY'
                  : (o.provenance.validFrom !== undefined && time < instant(o.provenance.validFrom)) ||
                    (o.provenance.validTo !== undefined && time >= instant(o.provenance.validTo)) ? 'OUTSIDE_OBSERVATION_VALIDITY' : null);
        if (reason) excluded.push({ observationId: o.id, reason }); else obs.push(o);
      }
      obs.sort((a, b) => instant(a.t) - instant(b.t) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      // Scale before summing to avoid overflow of a finite descriptive mean.
      const scale = Math.max(0, ...obs.map((o) => Math.abs(o.value)));
      const mean = obs.length ? (scale === 0 ? 0 : obs.reduce((sum, o) => sum + (o.value / scale) / obs.length, 0) * scale) : null;
      const delta = mean === null ? null : mean - a.value;
      const ratio = mean === null || a.value === 0 ? null : mean / a.value;
      const finiteResult = mean !== null && Number.isFinite(mean) && Number.isFinite(delta) && (ratio === null || Number.isFinite(ratio));
      const observationIds = obs.map((o) => o.id);
      out.push({
        assertion: a,
        observations: obs,
        meanObserved: finiteResult ? mean : null,
        status: finiteResult ? 'ready' : 'unavailable',
        reason: assertionReason ?? (obs.length ? finiteResult ? null : 'NONFINITE_AGGREGATE' : 'NO_COMPATIBLE_OBSERVATIONS'),
        excluded,
        comparison: { ...selection, interval: '[from,to)', unit: a.unit ?? null,
          method: 'descriptive_arithmetic_mean', independence: 'not_established', observationIds,
          sources: [...new Set([a.provenance.source, ...obs.map((o) => o.provenance.source)])] },
        deviation: finiteResult ? {
          id: `dev:${a.id}`,
          entityId,
          assertionId: a.id,
          observationId: obs[obs.length - 1].id,
          observationIds,
          metric: a.metric,
          delta: delta!, ratio,
        } : null,
      });
    }
    return deepFreeze(out);
  }

  // ---------------------------------------------------------------- search

  search(query: string, limit = 8): SearchResult[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results: SearchResult[] = [];
    const scan = (
      items: { id: EntityId; name: string; kind?: string; tags?: string[] }[],
      kindOf: (x: any) => string,
      detailOf?: (x: any) => string
    ) => {
      for (const it of items) {
        const name = it.name.toLowerCase();
        let score = 0;
        if (name === q) score = 100;
        else if (name.startsWith(q)) score = 80;
        else if (name.includes(q)) score = 60;
        else if (it.tags?.some((tg) => tg.toLowerCase().includes(q))) score = 40;
        else {
          // token-prefix match ("la port" → Port of Los Angeles)
          const tokens = q.split(/\s+/);
          if (tokens.every((tk) => name.includes(tk))) score = 30;
        }
        if (score > 0)
          results.push({
            id: it.id,
            name: it.name,
            kind: kindOf(it),
            score,
            detail: detailOf?.(it),
          });
      }
    };
    scan(this.snap.nodes, (n) => n.kind, (n) => n.country ?? '');
    scan(this.snap.routes, (r) => `route:${r.mode}`, (r) => `${Math.round(r.distanceKm)} km`);
    scan(this.snap.flows, () => 'flow', (f) => this.commodityIx.get(f.commodityId)?.name ?? '');
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
