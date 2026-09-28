/**
 * SyntheticProvider — deterministic dynamics over the synthetic world.
 *
 * Implements SpatialDataProvider for the canonical demo corpus. All
 * dynamic state is a pure function of (entityId, t): a hash-seeded sum
 * of slow sinusoids plus smooth event ramps. No randomness, no wall
 * clock — scrubbing the sim time is perfectly stable and continuous.
 *
 * world.ts imports the SAME resolver to precompute Route.historicalState,
 * so the sparse temporal spine and live stateAt() agree by construction.
 */

import type {
  EntityId,
  EntityState,
  LifecycleStatus,
  Timestamp,
  WorldEvent,
  WorldSnapshot,
} from '../contracts';
import type { SpatialDataProvider } from '../provider';
import { buildWorldSnapshot } from './world.ts';
import { identifier, instant, validatedSnapshot } from '../validation.ts';

// ------------------------------------------------------------------
// Deterministic hashing / noise
// ------------------------------------------------------------------

/** FNV-1a 32-bit hash of a string (deterministic seed source). */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Map a 32-bit hash to [0, 1). */
export function hashUnit(h: number): number {
  return (h >>> 0) / 4294967296;
}

function mix(h: number, salt: number): number {
  return Math.imul((h ^ salt) >>> 0, 0x9e3779b1) >>> 0;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

const TAU = Math.PI * 2;
const HOUR_MS = 3_600_000;

/**
 * Deterministic, continuous pseudo-noise in [0, 1] for an entity at a
 * time. Three sinusoids (~26 h, ~76 h, ~7.2 d) whose amplitude, phase
 * and exact period derive from an FNV-1a hash of the entity id, summed
 * around a 0.5 mean. Same function feeds both live stateAt() and the
 * precomputed Route.historicalState samples in world.ts.
 */
export function syntheticNoise(entityId: EntityId, tMs: number): number {
  const h1 = fnv1a(entityId);
  const h2 = fnv1a(entityId + '#b');
  const h3 = fnv1a(entityId + '#c');
  const th = tMs / HOUR_MS;

  const p1 = 26 * (0.85 + 0.3 * hashUnit(h1)); // ~ daily-ish rhythm
  const p2 = 76 * (0.85 + 0.3 * hashUnit(h2)); // ~ 3-day swell
  const p3 = 172.8 * (0.85 + 0.3 * hashUnit(h3)); // ~ 7.2-day cycle

  const a1 = 0.18 + 0.1 * hashUnit(mix(h1, 0x51ed));
  const a2 = 0.12 + 0.08 * hashUnit(mix(h2, 0x2c9f));
  const a3 = 0.08 + 0.06 * hashUnit(mix(h3, 0x7a3b));

  const ph1 = TAU * hashUnit(mix(h1, 0x1234));
  const ph2 = TAU * hashUnit(mix(h2, 0x5678));
  const ph3 = TAU * hashUnit(mix(h3, 0x9abc));

  return clamp01(
    0.5 +
      a1 * Math.sin((TAU * th) / p1 + ph1) +
      a2 * Math.sin((TAU * th) / p2 + ph2) +
      a3 * Math.sin((TAU * th) / p3 + ph3)
  );
}

// ------------------------------------------------------------------
// Event ramps
// ------------------------------------------------------------------

const RAMP_MS = 3 * HOUR_MS;
const windowCache = new WeakMap<WorldEvent, { s: number; e: number }>();

function eventWindow(ev: WorldEvent): { s: number; e: number } {
  let w = windowCache.get(ev);
  if (!w) {
    w = { s: Date.parse(ev.start), e: ev.end ? Date.parse(ev.end) : Infinity };
    windowCache.set(ev, w);
  }
  return w;
}

/** Smooth cosine ramp 0→1 over 3 h at each edge of the event window. */
function rampAt(ev: WorldEvent, tMs: number): number {
  const { s, e } = eventWindow(ev);
  if (tMs < s || tMs > e) return 0;
  const edge = Math.min(tMs - s, e - tMs);
  if (edge >= RAMP_MS) return 1;
  return 0.5 - 0.5 * Math.cos((Math.PI * edge) / RAMP_MS);
}

/**
 * Total severity-scaled event boost for an entity at a time, plus the
 * ids of the events currently perturbing it.
 */
export function eventBoostAt(
  entityId: EntityId,
  tMs: number,
  events: readonly WorldEvent[]
): { boost: number; activeEventIds: EntityId[] } {
  let boost = 0;
  const activeEventIds: EntityId[] = [];
  for (const ev of events) {
    if (!ev.affects.includes(entityId)) continue;
    const r = rampAt(ev, tMs);
    if (r <= 0) continue;
    boost += ev.severity * r;
    activeEventIds.push(ev.id);
  }
  return { boost: Math.min(1, boost), activeEventIds };
}

// ------------------------------------------------------------------
// State resolver — the single formula for all synthetic dynamics
// ------------------------------------------------------------------

/**
 * Resolve dynamic state for one entity at one sim time. Pure and
 * deterministic; world.ts uses this exact function to precompute the
 * temporal spine (historicalState) so samples and live queries agree.
 */
export function resolveEntityState(
  entityId: EntityId,
  base: number,
  staticStatus: LifecycleStatus,
  t: Timestamp,
  events: readonly WorldEvent[]
): EntityState {
  const tMs = instant(t);
  const noise = syntheticNoise(entityId, tMs);
  const { boost, activeEventIds } = eventBoostAt(entityId, tMs, events);

  const congestion = clamp01(0.25 * base + 0.6 * noise + boost);
  const utilization = clamp01(base + 0.35 * noise + 0.5 * boost);

  let status: LifecycleStatus = staticStatus;
  if (boost > 0.5) status = 'disrupted';
  else if (boost > 0.22) status = 'degraded';

  return { entityId, t, utilization, congestion, status, activeEventIds };
}

// ------------------------------------------------------------------
// Provider
// ------------------------------------------------------------------

interface Baseline {
  base: number;
  status: LifecycleStatus;
}

export class SyntheticProvider implements SpatialDataProvider {
  readonly id = 'synthetic:demo';
  readonly label = 'Synthetic demo world';

  private snap: WorldSnapshot | null = null;
  private baselines = new Map<EntityId, Baseline>();

  private ensure(): WorldSnapshot {
    if (this.snap) return this.snap;
    const snap = validatedSnapshot(buildWorldSnapshot());
    for (const n of snap.nodes) {
      this.baselines.set(n.id, {
        base: clamp01(0.3 + 0.45 * n.importance),
        status: n.status,
      });
    }
    for (const r of snap.routes) {
      this.baselines.set(r.id, { base: r.utilization, status: r.status });
    }
    for (const f of snap.flows) {
      this.baselines.set(f.id, { base: clamp01(f.intensity), status: 'active' });
    }
    this.snap = snap;
    return snap;
  }

  async load(): Promise<WorldSnapshot> {
    return this.ensure();
  }

  stateAt(entityId: EntityId, t: Timestamp): EntityState {
    const snap = this.ensure();
    const bl = this.baselines.get(identifier(entityId, 'entityId'));
    if (!bl) throw new Error('Unknown synthetic entity');
    const time = instant(t);
    if (time < instant(snap.timeRange.start) || time > instant(snap.timeRange.end)) throw new Error('Time outside synthetic range');
    return resolveEntityState(entityId, bl.base, bl.status, t, snap.events);
  }
}
