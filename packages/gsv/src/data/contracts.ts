/**
 * GEOSPATIAL STATE VISUALIZATION — DATA CONTRACTS
 * ------------------------------------------------------------------
 * Provider-independent schemas for the geographic state client.
 *
 * These contracts are the boundary between provider-supplied state
 * and the visualization client. The client treats the supplied shapes
 * as read-only; it exposes no canonical-state write or admission API.
 * The current provider is synthetic; a live service is not connected.
 *
 * Every object carries a stable id plus provenance/temporal metadata
 * (source, knownAt, validFrom, validTo) so synthetic demo data can be
 * swapped for real corpus data without touching the render layer.
 */

// ------------------------------------------------------------------
// Identity, provenance, temporality
// ------------------------------------------------------------------

export type EntityId = string;

/** ISO-8601 timestamp string, UTC. */
export type Timestamp = string;

export type DataSource =
  | 'synthetic:demo' // clearly-labeled generated demo data
  | 'payload:canonical' // retained source namespace; no live provider
  | 'payload:spatial' // retained source namespace; no live provider
  | 'external:osm'
  | 'external:ais'
  | 'external:gov-gis'
  | (string & {});

/** Provenance block attached to anything that claims to describe the world. */
export interface Provenance {
  source: DataSource;
  /** When this fact became known to the system. */
  knownAt: Timestamp;
  /** Temporal validity window of the fact itself. */
  validFrom?: Timestamp;
  validTo?: Timestamp;
  /** Free-form evidence descriptors (document ids, sensor ids, ...). */
  evidence?: string[];
  confidence?: number; // 0..1
}

export type LifecycleStatus =
  | 'active'
  | 'inactive'
  | 'planned'
  | 'degraded'
  | 'disrupted'
  | 'unknown';

// ------------------------------------------------------------------
// Geometry (GeoJSON-compatible subset, WGS84 lon/lat)
// ------------------------------------------------------------------

export type LonLat = [lon: number, lat: number];

export interface PointGeometry {
  type: 'Point';
  coordinates: LonLat;
}

export interface LineStringGeometry {
  type: 'LineString';
  coordinates: LonLat[];
}

export type Geometry = PointGeometry | LineStringGeometry;

// ------------------------------------------------------------------
// Transport ontology
// ------------------------------------------------------------------

export type TransportMode = 'road' | 'rail' | 'maritime' | 'air';

export type NodeKind =
  // logistics
  | 'port'
  | 'airport'
  | 'rail_terminal'
  | 'trucking_hub'
  | 'warehouse'
  | 'distribution_center'
  | 'border_crossing'
  // extraction
  | 'mine'
  | 'oil_field'
  | 'gas_field'
  | 'agricultural_region'
  // processing
  | 'refinery'
  | 'smelter'
  | 'chemical_plant'
  | 'steel_mill'
  | 'processing_facility'
  // industry
  | 'factory'
  | 'industrial_park'
  | 'manufacturing_cluster'
  | 'consumption_center'
  // world
  | 'city'
  | 'chokepoint';

export type EntityKind = NodeKind | 'route' | 'flow' | 'country' | 'corridor';

// ------------------------------------------------------------------
// Base entity
// ------------------------------------------------------------------

export interface Entity {
  id: EntityId;
  kind: EntityKind;
  name: string;
  geometry: Geometry;
  status: LifecycleStatus;
  provenance: Provenance;
  /** 0..1 relative importance — drives visual prominence and LOD. */
  importance: number;
  /** ISO 3166-1 alpha-2 where meaningful. */
  country?: string;
  tags?: string[];
}

// ------------------------------------------------------------------
// Facilities & infrastructure nodes
// ------------------------------------------------------------------

export interface Facility extends Entity {
  kind: NodeKind;
  geometry: PointGeometry;
  /** Commodities consumed / produced (commodity ids). */
  inputs?: EntityId[];
  outputs?: EntityId[];
  /** Nominal throughput capacity, unit-qualified. */
  capacity?: QuantityRating;
  operator?: string;
  connectedRouteIds?: EntityId[];
  connectedSupplierIds?: EntityId[];
  connectedCustomerIds?: EntityId[];
}

export interface QuantityRating {
  value: number;
  unit: string; // 'TEU/yr' | 'Mt/yr' | 'loads/day' | ...
}

export interface Port extends Facility {
  kind: 'port';
  portType?: 'container' | 'bulk' | 'energy' | 'mixed';
  berths?: number;
  drafts?: number; // meters
}

export interface Airport extends Facility {
  kind: 'airport';
  iata?: string;
  cargoTonnesPerYear?: number;
}

export interface RailTerminal extends Facility {
  kind: 'rail_terminal';
  intermodal?: boolean;
}

export interface Warehouse extends Facility {
  kind: 'warehouse' | 'distribution_center';
  areaSqm?: number;
}

// ------------------------------------------------------------------
// Routes — first-class semantic objects, never decorative lines
// ------------------------------------------------------------------

export interface RouteConstraint {
  id: EntityId;
  type:
    | 'chokepoint'
    | 'border'
    | 'capacity'
    | 'draft_limit'
    | 'weather'
    | 'regulatory'
    | 'congestion';
  description: string;
  severity: number; // 0..1
  atFraction?: number; // 0..1 position along route geometry
}

export interface RouteStateSample {
  t: Timestamp;
  utilization: number; // 0..1
  congestion: number; // 0..1
  status: LifecycleStatus;
}

export interface Route extends Entity {
  kind: 'route';
  mode: TransportMode;
  geometry: LineStringGeometry;
  originId: EntityId;
  destinationId: EntityId;
  distanceKm: number;
  estimatedDurationHours: number;
  capacity: QuantityRating;
  /** Instantaneous utilization 0..1 at `provenance.knownAt`. */
  utilization: number;
  constraints: RouteConstraint[];
  /** Sparse historical/forecast state samples (temporal spine). */
  historicalState: RouteStateSample[];
  /** Corridor grouping, e.g. 'corridor:na-great-lakes'. */
  corridorId?: EntityId;
  bidirectional?: boolean;
  /**
   * What the geometry IS — a routed path, or an estimate. A straight
   * arc over a lake is not where the truck goes; the difference must
   * stay queryable, never cosmetic. Synthetic corridors default to
   * 'synthetic_corridor'.
   */
  geometryBasis?: 'routed' | 'great_circle_estimate' | 'synthetic_corridor';
}

/**
 * A leg of a multimodal journey: one route traversal, possibly partial.
 */
export interface TransportSegment {
  id: EntityId;
  routeId: EntityId;
  mode: TransportMode;
  fromNodeId: EntityId;
  toNodeId: EntityId;
  /** Fraction interval of the route geometry this segment covers. */
  span?: [number, number];
  sequence: number;
}

// ------------------------------------------------------------------
// Commodities & flows
// ------------------------------------------------------------------

export interface Commodity {
  id: EntityId;
  name: string;
  category:
    | 'metals'
    | 'energy'
    | 'agriculture'
    | 'chemicals'
    | 'consumer'
    | 'machinery'
    | 'automotive'
    | 'electronics';
  unit: string;
  provenance: Provenance;
}

/**
 * A physical flow across the network: a chain of transport segments
 * moving a commodity from an origin facility to a destination facility.
 */
export interface Flow {
  id: EntityId;
  name: string;
  commodityId: EntityId;
  originId: EntityId;
  destinationId: EntityId;
  segments: TransportSegment[];
  /** Relative volume 0..1 — drives particle density. */
  intensity: number;
  status: 'moving' | 'holding' | 'delayed' | 'delivered';
  provenance: Provenance;
  tags?: string[];
}

// ------------------------------------------------------------------
// Assertions, observations, deviations
// ------------------------------------------------------------------
// Promises and evidence are DISTINCT record types, never one field
// overwritten by the other. `Route.estimatedDurationHours` and
// `capacity` are convenience projections of the current Assertion of
// record; the authoritative history lives here, so the twin can show
// where its own estimates run optimistic instead of forgetting them.

/** A promise: something the system claims about an entity. */
export interface Assertion {
  id: EntityId;
  entityId: EntityId;
  metric: string; // 'transit_hours' | 'capacity' | 'dwell_hours' | ...
  value: number;
  unit?: string;
  assertedAt: Timestamp;
  provenance: Provenance;
}

/** Evidence: a timestamped measurement about an entity. */
export interface Observation {
  id: EntityId;
  entityId: EntityId;
  t: Timestamp;
  metric: string; // 'transit_hours' | 'utilization' | 'queue_length' | ...
  value: number;
  unit?: string;
  provenance: Provenance;
}

/** The join between a promise and the evidence that tests it. */
export interface Deviation {
  id: EntityId;
  entityId: EntityId;
  assertionId: EntityId;
  observationId: EntityId;
  /** Complete ordered contributors; observationId remains the final member. */
  observationIds: EntityId[];
  metric: string;
  /** observed − asserted, in the metric's unit. */
  delta: number;
  /** observed / asserted; null when the asserted value is zero. */
  ratio: number | null;
}

// ------------------------------------------------------------------
// Constraints, events
// ------------------------------------------------------------------

/** A standing constraint attached to an entity (not route-inline). */
export interface Constraint {
  id: EntityId;
  entityId: EntityId;
  type: RouteConstraint['type'];
  description: string;
  severity: number;
  provenance: Provenance;
  validFrom?: Timestamp;
  validTo?: Timestamp;
}

/** A discrete event that propagates state changes through the twin. */
export interface WorldEvent {
  id: EntityId;
  name: string;
  description: string;
  /** Entities whose state this event perturbs. */
  affects: EntityId[];
  severity: number; // 0..1
  start: Timestamp;
  end?: Timestamp;
  category: 'congestion' | 'closure' | 'weather' | 'strike' | 'demand_surge' | 'incident';
  provenance: Provenance;
}

// ------------------------------------------------------------------
// Temporal state
// ------------------------------------------------------------------

export type TemporalRegime = 'historical' | 'current' | 'forecast' | 'scenario';

export interface TemporalState {
  /** Simulation time the twin is currently projecting. */
  t: Timestamp;
  regime: TemporalRegime;
  /** Wall-clock 'now' the regime is computed against. */
  referenceNow: Timestamp;
  scenarioId?: EntityId;
}

/** Resolved per-entity dynamic state at a specific sim time. */
export interface EntityState {
  entityId: EntityId;
  t: Timestamp;
  utilization: number; // 0..1
  congestion: number; // 0..1
  status: LifecycleStatus;
  activeEventIds: EntityId[];
}

// ------------------------------------------------------------------
// World snapshot — what a provider hands the renderer
// ------------------------------------------------------------------

export interface WorldSnapshot {
  nodes: Facility[];
  routes: Route[];
  flows: Flow[];
  commodities: Commodity[];
  events: WorldEvent[];
  constraints: Constraint[];
  /** Promises (estimates, rated capacities) — see Assertion. */
  assertions: Assertion[];
  /** Evidence (actual transits, measurements) — see Observation. */
  observations: Observation[];
  /** City light points for the night layer: [lon, lat, intensity 0..1]. */
  cityLights: [number, number, number][];
  /** Inclusive sim-time bounds the dataset can answer for. */
  timeRange: { start: Timestamp; end: Timestamp; now: Timestamp };
  meta: {
    label: string;
    disclaimer: string; // e.g. 'SYNTHETIC / DEMO DATA — not real shipments'
    generatedAt: Timestamp;
  };
}
