/**
 * Provider-independent spatial data interface.
 *
 * The geographic state client obtains data through this interface.
 * The synthetic demo provider implements load() and stateAt() today.
 * No live data-service provider is implemented; query() and subscribe()
 * are optional extension points.
 */

import type {
  EntityId,
  EntityState,
  Timestamp,
  WorldSnapshot,
} from './contracts';

export interface ViewportQuery {
  /** [west, south, east, north] in degrees. */
  bbox?: [number, number, number, number];
  /** Camera altitude in earth-radii above surface — providers use it for LOD. */
  altitude?: number;
  /** Minimum importance to include (progressive disclosure). */
  minImportance?: number;
}

export interface SpatialDataProvider {
  readonly id: string;
  readonly label: string;

  /** Load the world snapshot (initial hydration). */
  load(): Promise<WorldSnapshot>;

  /**
   * Resolve dynamic state for an entity at a sim time.
   * Deterministic for a given (entityId, t) so scrubbing is stable.
   */
  stateAt(entityId: EntityId, t: Timestamp): EntityState;

  /**
   * Optional viewport-scoped incremental fetch. Not implemented by
   * the synthetic provider.
   */
  query?(viewport: ViewportQuery): Promise<Partial<WorldSnapshot>>;

  /** Optional push-based provider updates; not implemented in this build. */
  subscribe?(onDelta: (delta: Partial<WorldSnapshot>) => void): () => void;
}
