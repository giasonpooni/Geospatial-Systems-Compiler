/**
 * AppApi — the single facade the UI instrument layer and demo
 * controllers talk to. UI components receive this and NOTHING else:
 * they never import renderer internals, and they never mutate data —
 * every call here is a view-level operation on the projection.
 */

import type { EntityId, Facility, Flow, LonLat, Route, TemporalState } from '../data/contracts';
import type { SearchResult, WorldStore } from '../data/store';
import type { EventBus } from '../core/events';
import type { SimClock } from '../core/time';

export type ViewPreset =
  | 'world'
  | 'freight'
  | 'trade'
  | 'commodities'
  | 'network'
  | 'exceptions';

export interface LayerDef {
  id: LayerId;
  label: string;
  group: 'WORLD' | 'TRANSPORT' | 'INFRASTRUCTURE' | 'ECONOMY' | 'INTELLIGENCE';
  visible: boolean;
}

export type LayerId =
  | 'world.countries'
  | 'world.cities'
  | 'world.terrain'
  | 'world.nightlights'
  | 'transport.road'
  | 'transport.rail'
  | 'transport.maritime'
  | 'transport.air'
  | 'infra.ports'
  | 'infra.airports'
  | 'infra.rail_terminals'
  | 'infra.warehouses'
  | 'infra.industrial'
  | 'economy.production'
  | 'economy.demand'
  | 'economy.inventory'
  | 'economy.flows'
  | 'intel.bottlenecks'
  | 'intel.constraints'
  | 'intel.anomalies'
  | 'intel.dependencies'
  | 'intel.risk';

export interface CountryInfo {
  code: string;
  name: string;
  nodes: Facility[];
  routes: Route[];
  flows: Flow[];
  byMode: Record<string, number>; // route counts per mode
}

export interface Suggestion {
  text: string; // what gets filled into the bar
  label: string; // display line
  hint?: string; // right-aligned kind hint
}

export interface CommandResult {
  ok: boolean;
  message: string;
}

export interface AppEvents extends Record<string, unknown> {
  select: { id: EntityId | null; source: 'pick' | 'search' | 'command' | 'demo' | 'ui' };
  hover: { id: EntityId | null };
  countrySelect: { code: string | null; name: string | null };
  layersChange: { layers: LayerDef[] };
  time: TemporalState;
  preset: { preset: ViewPreset };
  flowMode: { enabled: boolean };
  demo: { active: boolean; step?: number; totalSteps?: number; caption?: string; title?: string };
  toast: { title: string; body?: string; tone?: 'info' | 'warn' | 'alert' };
  status: {
    fps: number;
    altitudeKm: number;
    visibleNodes: number;
    visibleRoutes: number;
    particles: number;
  };
}

export interface CameraFacade {
  /** Smoothly fly to a lat/lon; distance in earth-radii from center (1 = surface). */
  flyToLatLon(
    lat: number,
    lon: number,
    opts?: { distance?: number; durationMs?: number }
  ): Promise<void>;
  /** Frame a whole route in view (midpoint + fitted distance). */
  frameRoute(routeId: EntityId, opts?: { durationMs?: number }): Promise<void>;
  /** Cinematic dolly along a lon/lat path (Follow-the-Load). */
  followPath(
    coords: LonLat[],
    opts: {
      durationMs: number;
      distance?: number;
      onProgress?: (u: number) => void;
    }
  ): Promise<void>;
  /** Cancel any in-flight camera animation. */
  cancel(): void;
  /** Camera altitude above the surface, in earth-radii. */
  altitudeRadii(): number;
  setAutoRotate(enabled: boolean): void;
}

export interface AppApi {
  readonly events: EventBus<AppEvents>;
  readonly store: WorldStore;
  readonly clock: SimClock;
  readonly camera: CameraFacade;

  // ---- layers / presets
  getLayers(): LayerDef[];
  setLayerVisible(id: LayerId, visible: boolean): void;
  setPreset(preset: ViewPreset): void;
  getPreset(): ViewPreset;
  setFlowMode(enabled: boolean): void;
  getFlowMode(): boolean;

  // ---- selection / focus
  select(id: EntityId | null, source?: AppEvents['select']['source']): void;
  getSelection(): EntityId | null;
  getSelectedCountry(): { code: string; name: string } | null;
  selectCountry(code: string | null): void;
  /** Select and cinematically frame an entity. */
  focus(id: EntityId): void;
  countryInfo(code: string): CountryInfo | null;

  // ---- command interface
  runCommand(input: string): CommandResult;
  suggest(input: string): Suggestion[];
  search(q: string): SearchResult[];

  // ---- demo scenario
  startFollowTheLoad(): void;
  stopFollowTheLoad(): void;
  isDemoActive(): boolean;
}
