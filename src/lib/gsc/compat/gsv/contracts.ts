/**
 * GSV compatibility types, adapted from Geospatial-State-Visualization
 * commit 58713d02d4e79c52290ee9d0da51ea6b4d0677ed, src/data/contracts.ts.
 * GPL-3.0; original field meanings and provider identity are retained.
 * These are source contracts, NOT the GSC intermediate representation.
 */
export type EntityId = string;
export type Timestamp = string;
export type LonLat = [number, number];
export interface Provenance {
  source: string; knownAt: Timestamp; validFrom?: Timestamp; validTo?: Timestamp;
  evidence?: string[]; confidence?: number;
}
export type LifecycleStatus = 'active' | 'inactive' | 'planned' | 'degraded' | 'disrupted' | 'unknown';
export type TransportMode = 'road' | 'rail' | 'maritime' | 'air';
export interface PointGeometry { type: 'Point'; coordinates: LonLat }
export interface LineStringGeometry { type: 'LineString'; coordinates: LonLat[] }
export type Geometry = PointGeometry | LineStringGeometry;
export interface Entity {
  id: EntityId; kind: string; name: string; geometry: Geometry; status: LifecycleStatus;
  provenance: Provenance; importance: number; country?: string; tags?: string[];
}
export interface QuantityRating { value: number; unit: string }
export interface Facility extends Entity {
  geometry: PointGeometry; inputs?: EntityId[]; outputs?: EntityId[];
  capacity?: QuantityRating; operator?: string; connectedRouteIds?: EntityId[];
  connectedSupplierIds?: EntityId[]; connectedCustomerIds?: EntityId[];
}
export interface RouteConstraint {
  id: EntityId; type: 'chokepoint' | 'border' | 'capacity' | 'draft_limit' | 'weather' | 'regulatory' | 'congestion';
  description: string; severity: number; atFraction?: number;
}
export interface RouteStateSample {
  t: Timestamp; utilization: number; congestion: number; status: LifecycleStatus;
}
export interface Route extends Entity {
  kind: 'route'; mode: TransportMode; geometry: LineStringGeometry;
  originId: EntityId; destinationId: EntityId; distanceKm: number;
  estimatedDurationHours: number; capacity: QuantityRating; utilization: number;
  constraints: RouteConstraint[]; historicalState: RouteStateSample[];
  corridorId?: EntityId; bidirectional?: boolean;
  geometryBasis?: 'routed' | 'great_circle_estimate' | 'synthetic_corridor';
}
export interface TransportSegment {
  id: EntityId; routeId: EntityId; mode: TransportMode; fromNodeId: EntityId;
  toNodeId: EntityId; span?: [number, number]; sequence: number;
}
export interface Commodity { id: EntityId; name: string; category: string; unit: string; provenance: Provenance }
export interface Flow {
  id: EntityId; name: string; commodityId: EntityId; originId: EntityId; destinationId: EntityId;
  segments: TransportSegment[]; intensity: number;
  status: 'moving' | 'holding' | 'delayed' | 'delivered'; provenance: Provenance; tags?: string[];
}
export interface Assertion {
  id: EntityId; entityId: EntityId; metric: string; value: number; unit?: string;
  assertedAt: Timestamp; provenance: Provenance;
}
export interface Observation {
  id: EntityId; entityId: EntityId; metric: string; value: number; unit?: string;
  t: Timestamp; provenance: Provenance;
}
export interface Constraint extends RouteConstraint {
  entityId: EntityId; provenance: Provenance; validFrom?: Timestamp; validTo?: Timestamp;
}
export interface WorldEvent {
  id: EntityId; name: string; description: string; affects: EntityId[]; severity: number;
  start: Timestamp; end?: Timestamp; category: string; provenance: Provenance;
}
export interface EntityState {
  entityId: EntityId; t: Timestamp; utilization: number; congestion: number;
  status: LifecycleStatus; activeEventIds: EntityId[];
}
export interface WorldSnapshot {
  nodes: Facility[]; routes: Route[]; flows: Flow[]; commodities: Commodity[];
  events: WorldEvent[]; constraints: Constraint[]; assertions: Assertion[]; observations: Observation[];
  cityLights: [number, number, number][];
  timeRange: { start: Timestamp; end: Timestamp; now: Timestamp };
  meta: { label: string; disclaimer: string; generatedAt: Timestamp };
}
