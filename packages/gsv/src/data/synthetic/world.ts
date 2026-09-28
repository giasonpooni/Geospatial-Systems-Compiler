/**
 * SYNTHETIC WORLD DATASET — the canonical demo corpus.
 *
 * A geographically careful, fully deterministic snapshot of the
 * physical economy: ~114 nodes, ~55 routes, 14 multimodal flows,
 * 16 commodities, 9 events, plus standing constraints and the
 * assertion/observation (promise vs evidence) spine.
 *
 * EVERY record carries provenance.source = 'synthetic:demo' — realness
 * stays a query, not a memory. No Math.random / Date.now anywhere:
 * the dataset clock is fixed and all dynamics derive from hashes.
 */

import type {
  Airport,
  Assertion,
  Commodity,
  Constraint,
  Facility,
  Flow,
  LifecycleStatus,
  LonLat,
  NodeKind,
  Observation,
  Port,
  Provenance,
  QuantityRating,
  Route,
  RouteConstraint,
  RouteStateSample,
  TransportMode,
  TransportSegment,
  WorldEvent,
  WorldSnapshot,
} from '../contracts';
// note: explicit .ts extension so Node type-stripping (the provenance
// validator) can resolve this runtime import; Vite handles it too.
import { fnv1a, hashUnit, resolveEntityState } from './provider.ts';

// ------------------------------------------------------------------
// Dataset clock — fixed; nothing in this module reads the wall clock.
// ------------------------------------------------------------------

export const DATASET_NOW = '2026-08-31T14:00:00Z';
export const DATASET_START = '2026-08-17T00:00:00Z';
export const DATASET_END = '2026-09-14T00:00:00Z';

const START_MS = Date.parse(DATASET_START);
const END_MS = Date.parse(DATASET_END);

function prov(overrides?: Partial<Provenance>): Provenance {
  return { source: 'synthetic:demo', knownAt: DATASET_NOW, confidence: 0.92, ...overrides };
}

// ------------------------------------------------------------------
// Geometry helpers (internal — no geo-layer imports)
// ------------------------------------------------------------------

/** Author coordinates as (lat, lon); store as GeoJSON [lon, lat]. */
function ll(lat: number, lon: number): LonLat {
  return [lon, lat];
}

const EARTH_R_KM = 6371;

function haversineKm(a: LonLat, b: LonLat): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

function pathLengthKm(coords: LonLat[]): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversineKm(coords[i - 1], coords[i]);
  return km;
}

/** Fraction (0..1) along a path of the vertex nearest to a target point. */
function fractionNear(coords: LonLat[], target: LonLat): number {
  let bestIx = 0;
  let bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversineKm(coords[i], target);
    if (d < bestD) {
      bestD = d;
      bestIx = i;
    }
  }
  let acc = 0;
  let toBest = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += haversineKm(coords[i - 1], coords[i]);
    if (i <= bestIx) toBest = acc;
  }
  return acc === 0 ? 0 : Math.min(1, toBest / acc);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// ------------------------------------------------------------------
// Commodities
// ------------------------------------------------------------------

function commodity(id: string, name: string, category: Commodity['category'], unit: string): Commodity {
  return { id, name, category, unit, provenance: prov() };
}

function buildCommodities(): Commodity[] {
  return [
    commodity('commodity:iron-ore', 'Iron ore', 'metals', 'Mt'),
    commodity('commodity:copper', 'Copper cathode', 'metals', 'kt'),
    commodity('commodity:lithium', 'Lithium carbonate', 'metals', 'kt'),
    commodity('commodity:cobalt', 'Cobalt hydroxide', 'metals', 'kt'),
    commodity('commodity:steel', 'Finished steel', 'metals', 'Mt'),
    commodity('commodity:crude-oil', 'Crude oil', 'energy', 'Mbbl'),
    commodity('commodity:refined-products', 'Refined products', 'energy', 'Mbbl'),
    commodity('commodity:chemicals', 'Industrial chemicals', 'chemicals', 'kt'),
    commodity('commodity:grain', 'Corn & feed grain', 'agriculture', 'Mt'),
    commodity('commodity:soy', 'Soybeans', 'agriculture', 'Mt'),
    commodity('commodity:wheat', 'Wheat', 'agriculture', 'Mt'),
    commodity('commodity:auto-parts', 'Auto components', 'automotive', 'loads'),
    commodity('commodity:vehicles', 'Finished vehicles', 'automotive', 'units'),
    commodity('commodity:electronics', 'Consumer electronics', 'electronics', 'TEU'),
    commodity('commodity:machinery', 'Industrial machinery', 'machinery', 'TEU'),
    commodity('commodity:parcels', 'E-commerce parcels', 'consumer', 't'),
  ];
}

// ------------------------------------------------------------------
// Nodes
// ------------------------------------------------------------------

interface NodeSpec {
  id: string;
  kind: NodeKind;
  name: string;
  at: LonLat;
  country?: string;
  importance: number;
  status?: LifecycleStatus;
  capacity?: QuantityRating;
  operator?: string;
  inputs?: string[];
  outputs?: string[];
  tags?: string[];
}

function fac(s: NodeSpec): Facility {
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    geometry: { type: 'Point', coordinates: s.at },
    status: s.status ?? 'active',
    provenance: prov(),
    importance: s.importance,
    country: s.country,
    tags: s.tags,
    capacity: s.capacity,
    operator: s.operator,
    inputs: s.inputs,
    outputs: s.outputs,
    connectedRouteIds: [],
  };
}

type PortSpec = Omit<NodeSpec, 'kind'> & { portType?: Port['portType'] };
type AirportSpec = Omit<NodeSpec, 'kind'> & { iata: string; cargoTonnesPerYear: number };

function port(s: PortSpec): Port {
  return { ...fac({ ...s, kind: 'port' }), kind: 'port', portType: s.portType ?? 'container' };
}

function airport(s: AirportSpec): Airport {
  return {
    ...fac({ ...s, kind: 'airport' }),
    kind: 'airport',
    iata: s.iata,
    cargoTonnesPerYear: s.cargoTonnesPerYear,
  };
}

function teu(mTeuPerYear: number): QuantityRating {
  return { value: mTeuPerYear, unit: 'MTEU/yr' };
}
function mtpy(v: number): QuantityRating {
  return { value: v, unit: 'Mt/yr' };
}

function buildNodes(): Facility[] {
  const nodes: Facility[] = [];

  // ---- Ports (25)
  nodes.push(
    port({ id: 'node:port-shanghai', name: 'Port of Shanghai', at: ll(31.34, 121.65), country: 'CN', importance: 0.98, capacity: teu(47) }),
    port({ id: 'node:port-ningbo', name: 'Port of Ningbo-Zhoushan', at: ll(29.94, 121.85), country: 'CN', importance: 0.9, capacity: teu(33) }),
    port({ id: 'node:port-yantian', name: 'Yantian Port (Shenzhen)', at: ll(22.58, 114.27), country: 'CN', importance: 0.88, capacity: teu(14) }),
    port({ id: 'node:port-singapore', name: 'Port of Singapore', at: ll(1.26, 103.83), country: 'SG', importance: 0.97, capacity: teu(39) }),
    port({ id: 'node:port-busan', name: 'Port of Busan', at: ll(35.08, 129.06), country: 'KR', importance: 0.87, capacity: teu(23) }),
    port({ id: 'node:port-hongkong', name: 'Port of Hong Kong', at: ll(22.31, 114.13), country: 'HK', importance: 0.82, capacity: teu(14) }),
    port({ id: 'node:port-port-hedland', name: 'Port Hedland', at: ll(-20.31, 118.58), country: 'AU', importance: 0.85, portType: 'bulk', capacity: mtpy(560) }),
    port({ id: 'node:port-la', name: 'Port of Los Angeles', at: ll(33.73, -118.26), country: 'US', importance: 0.93, capacity: teu(10.7) }),
    port({ id: 'node:port-long-beach', name: 'Port of Long Beach', at: ll(33.75, -118.2), country: 'US', importance: 0.9, capacity: teu(9.6) }),
    port({ id: 'node:port-oakland', name: 'Port of Oakland', at: ll(37.8, -122.32), country: 'US', importance: 0.68, capacity: teu(2.4) }),
    port({ id: 'node:port-seattle-tacoma', name: 'NW Seaport Alliance (Seattle–Tacoma)', at: ll(47.27, -122.41), country: 'US', importance: 0.7, capacity: teu(3.3) }),
    port({ id: 'node:port-vancouver', name: 'Port of Vancouver', at: ll(49.29, -123.1), country: 'CA', importance: 0.78, portType: 'mixed', capacity: teu(3.7) }),
    port({ id: 'node:port-houston', name: 'Port of Houston', at: ll(29.73, -95.02), country: 'US', importance: 0.8, portType: 'mixed', capacity: teu(4) }),
    port({ id: 'node:port-ny-nj', name: 'Port of New York & New Jersey', at: ll(40.67, -74.15), country: 'US', importance: 0.88, capacity: teu(9.5) }),
    port({ id: 'node:port-savannah', name: 'Port of Savannah', at: ll(32.13, -81.14), country: 'US', importance: 0.76, capacity: teu(5.9) }),
    port({ id: 'node:port-montreal', name: 'Port of Montreal', at: ll(45.56, -73.53), country: 'CA', importance: 0.66, capacity: teu(1.7) }),
    port({ id: 'node:port-santos', name: 'Port of Santos', at: ll(-23.98, -46.3), country: 'BR', importance: 0.78, portType: 'mixed', capacity: teu(5) }),
    port({ id: 'node:port-valparaiso', name: 'Port of Valparaíso', at: ll(-33.03, -71.62), country: 'CL', importance: 0.62, portType: 'mixed', capacity: teu(1.2) }),
    port({ id: 'node:port-rotterdam', name: 'Port of Rotterdam', at: ll(51.95, 4.14), country: 'NL', importance: 0.95, portType: 'mixed', capacity: teu(15.3) }),
    port({ id: 'node:port-antwerp', name: 'Port of Antwerp-Bruges', at: ll(51.28, 4.34), country: 'BE', importance: 0.86, portType: 'mixed', capacity: teu(13.5) }),
    port({ id: 'node:port-hamburg', name: 'Port of Hamburg', at: ll(53.53, 9.93), country: 'DE', importance: 0.84, capacity: teu(8.3) }),
    port({ id: 'node:port-felixstowe', name: 'Port of Felixstowe', at: ll(51.95, 1.31), country: 'GB', importance: 0.72, capacity: teu(3.8) }),
    port({ id: 'node:port-piraeus', name: 'Port of Piraeus', at: ll(37.94, 23.62), country: 'GR', importance: 0.72, capacity: teu(5.4) }),
    port({ id: 'node:port-jebel-ali', name: 'Jebel Ali Port (Dubai)', at: ll(25.01, 55.06), country: 'AE', importance: 0.88, capacity: teu(14.5) }),
    port({ id: 'node:port-ras-tanura', name: 'Ras Tanura Terminal', at: ll(26.64, 50.16), country: 'SA', importance: 0.84, portType: 'energy', capacity: { value: 6.5, unit: 'Mbbl/day' } })
  );

  // ---- Airports (16)
  nodes.push(
    airport({ id: 'node:air-hkg', name: 'Hong Kong International (HKG)', at: ll(22.308, 113.918), country: 'HK', importance: 0.92, iata: 'HKG', cargoTonnesPerYear: 4_800_000 }),
    airport({ id: 'node:air-mem', name: 'Memphis International (MEM)', at: ll(35.042, -89.979), country: 'US', importance: 0.9, iata: 'MEM', cargoTonnesPerYear: 4_100_000, operator: 'FedEx superhub' }),
    airport({ id: 'node:air-anc', name: 'Ted Stevens Anchorage (ANC)', at: ll(61.174, -149.996), country: 'US', importance: 0.85, iata: 'ANC', cargoTonnesPerYear: 3_400_000 }),
    airport({ id: 'node:air-sdf', name: 'Louisville Muhammad Ali (SDF)', at: ll(38.174, -85.737), country: 'US', importance: 0.78, iata: 'SDF', cargoTonnesPerYear: 3_100_000, operator: 'UPS Worldport' }),
    airport({ id: 'node:air-icn', name: 'Incheon International (ICN)', at: ll(37.46, 126.44), country: 'KR', importance: 0.84, iata: 'ICN', cargoTonnesPerYear: 2_900_000 }),
    airport({ id: 'node:air-pvg', name: 'Shanghai Pudong (PVG)', at: ll(31.144, 121.808), country: 'CN', importance: 0.9, iata: 'PVG', cargoTonnesPerYear: 3_600_000 }),
    airport({ id: 'node:air-dwc', name: 'Dubai World Central (DWC)', at: ll(24.897, 55.161), country: 'AE', importance: 0.7, iata: 'DWC', cargoTonnesPerYear: 900_000 }),
    airport({ id: 'node:air-doh', name: 'Doha Hamad International (DOH)', at: ll(25.273, 51.608), country: 'QA', importance: 0.76, iata: 'DOH', cargoTonnesPerYear: 2_600_000 }),
    airport({ id: 'node:air-fra', name: 'Frankfurt am Main (FRA)', at: ll(50.037, 8.562), country: 'DE', importance: 0.84, iata: 'FRA', cargoTonnesPerYear: 2_000_000 }),
    airport({ id: 'node:air-lej', name: 'Leipzig/Halle (LEJ)', at: ll(51.42, 12.23), country: 'DE', importance: 0.72, iata: 'LEJ', cargoTonnesPerYear: 1_500_000, operator: 'DHL hub' }),
    airport({ id: 'node:air-ams', name: 'Amsterdam Schiphol (AMS)', at: ll(52.31, 4.76), country: 'NL', importance: 0.78, iata: 'AMS', cargoTonnesPerYear: 1_400_000 }),
    airport({ id: 'node:air-ord', name: "Chicago O'Hare (ORD)", at: ll(41.978, -87.904), country: 'US', importance: 0.82, iata: 'ORD', cargoTonnesPerYear: 2_200_000 }),
    airport({ id: 'node:air-yyz', name: 'Toronto Pearson (YYZ)', at: ll(43.677, -79.63), country: 'CA', importance: 0.68, iata: 'YYZ', cargoTonnesPerYear: 500_000 }),
    airport({ id: 'node:air-lax', name: 'Los Angeles International (LAX)', at: ll(33.941, -118.408), country: 'US', importance: 0.8, iata: 'LAX', cargoTonnesPerYear: 2_500_000 }),
    airport({ id: 'node:air-jfk', name: 'New York JFK (JFK)', at: ll(40.641, -73.778), country: 'US', importance: 0.76, iata: 'JFK', cargoTonnesPerYear: 1_400_000 }),
    airport({ id: 'node:air-can', name: 'Guangzhou Baiyun (CAN)', at: ll(23.392, 113.299), country: 'CN', importance: 0.78, iata: 'CAN', cargoTonnesPerYear: 2_000_000 })
  );

  // ---- Rail terminals (10)
  nodes.push(
    fac({ id: 'node:rail-chicago', kind: 'rail_terminal', name: 'Chicago Intermodal Hub', at: ll(41.81, -87.68), country: 'US', importance: 0.9, capacity: { value: 14_000, unit: 'lifts/day' } }),
    fac({ id: 'node:rail-detroit', kind: 'rail_terminal', name: 'Detroit Intermodal Terminal', at: ll(42.3, -83.1), country: 'US', importance: 0.68 }),
    fac({ id: 'node:rail-toronto', kind: 'rail_terminal', name: 'Toronto (Vaughan) Intermodal Terminal', at: ll(43.83, -79.53), country: 'CA', importance: 0.7 }),
    fac({ id: 'node:rail-kansas-city', kind: 'rail_terminal', name: 'Kansas City Rail Hub', at: ll(39.12, -94.55), country: 'US', importance: 0.66 }),
    fac({ id: 'node:rail-winnipeg', kind: 'rail_terminal', name: 'Winnipeg Rail Yard', at: ll(49.9, -97.2), country: 'CA', importance: 0.55 }),
    fac({ id: 'node:rail-duisburg', kind: 'rail_terminal', name: 'Duisburg Intermodal (duisport)', at: ll(51.44, 6.76), country: 'DE', importance: 0.85, tags: ['europe-largest-inland-port'] }),
    fac({ id: 'node:rail-malaszewicze', kind: 'rail_terminal', name: 'Małaszewicze Gauge-Break Terminal', at: ll(52.03, 23.13), country: 'PL', importance: 0.72, tags: ['gauge-break'] }),
    fac({ id: 'node:rail-xian', kind: 'rail_terminal', name: "Xi'an International Port", at: ll(34.38, 108.79), country: 'CN', importance: 0.7 }),
    fac({ id: 'node:rail-chongqing', kind: 'rail_terminal', name: 'Chongqing Tuanjiecun Terminal', at: ll(29.54, 106.46), country: 'CN', importance: 0.72 }),
    fac({ id: 'node:rail-port-hedland', kind: 'rail_terminal', name: 'Port Hedland Ore Loadout', at: ll(-20.38, 118.6), country: 'AU', importance: 0.7 })
  );

  // ---- Warehouses / DCs (8)
  nodes.push(
    fac({ id: 'node:dc-chicago', kind: 'distribution_center', name: 'Chicago Regional DC', at: ll(41.83, -87.74), country: 'US', importance: 0.72, tags: ['demo:follow-the-load'] }),
    fac({ id: 'node:dc-columbus', kind: 'distribution_center', name: 'Columbus Fulfillment Campus', at: ll(39.96, -82.99), country: 'US', importance: 0.6 }),
    fac({ id: 'node:dc-inland-empire', kind: 'warehouse', name: 'Inland Empire Logistics Cluster', at: ll(34.05, -117.6), country: 'US', importance: 0.78 }),
    fac({ id: 'node:dc-memphis', kind: 'distribution_center', name: 'Memphis Air-Hub DC', at: ll(35.06, -89.93), country: 'US', importance: 0.68 }),
    fac({ id: 'node:dc-venlo', kind: 'distribution_center', name: 'Venlo European DC', at: ll(51.4, 6.17), country: 'NL', importance: 0.62 }),
    fac({ id: 'node:dc-lille', kind: 'distribution_center', name: 'Lille Logistics Platform', at: ll(50.63, 3.07), country: 'FR', importance: 0.55 }),
    fac({ id: 'node:dc-toronto', kind: 'distribution_center', name: 'GTA West Distribution Centre', at: ll(43.73, -79.76), country: 'CA', importance: 0.66, tags: ['demo:follow-the-load'] }),
    fac({ id: 'node:dc-shenzhen', kind: 'warehouse', name: 'Shenzhen Fulfillment Center', at: ll(22.68, 114.05), country: 'CN', importance: 0.7 })
  );

  // ---- Border crossing
  nodes.push(
    fac({ id: 'node:border-windsor-detroit', kind: 'border_crossing', name: 'Windsor–Detroit Ambassador Bridge', at: ll(42.312, -83.074), country: 'CA', importance: 0.82, capacity: { value: 10_000, unit: 'trucks/day' }, tags: ['demo:follow-the-load'] })
  );

  // ---- Extraction (12)
  nodes.push(
    fac({ id: 'node:mine-pilbara', kind: 'mine', name: 'Pilbara Iron Ore Mines (Newman)', at: ll(-23.36, 119.73), country: 'AU', importance: 0.85, capacity: mtpy(450), outputs: ['commodity:iron-ore'] }),
    fac({ id: 'node:mine-escondida', kind: 'mine', name: 'Escondida Copper Mine', at: ll(-24.27, -69.07), country: 'CL', importance: 0.8, capacity: { value: 1200, unit: 'kt/yr' }, outputs: ['commodity:copper'] }),
    fac({ id: 'node:mine-sudbury', kind: 'mine', name: 'Sudbury Nickel Basin', at: ll(46.49, -81.01), country: 'CA', importance: 0.6, outputs: ['commodity:copper'] }),
    fac({ id: 'node:oil-athabasca', kind: 'oil_field', name: 'Athabasca Oil Sands', at: ll(57.02, -111.65), country: 'CA', importance: 0.72, capacity: { value: 3.3, unit: 'Mbbl/day' }, outputs: ['commodity:crude-oil'] }),
    fac({ id: 'node:oil-permian', kind: 'oil_field', name: 'Permian Basin', at: ll(31.8, -102.3), country: 'US', importance: 0.82, capacity: { value: 6.2, unit: 'Mbbl/day' }, outputs: ['commodity:crude-oil'] }),
    fac({ id: 'node:oil-ghawar', kind: 'oil_field', name: 'Ghawar Oil Field', at: ll(25.43, 49.62), country: 'SA', importance: 0.88, capacity: { value: 3.8, unit: 'Mbbl/day' }, outputs: ['commodity:crude-oil'] }),
    fac({ id: 'node:mine-katanga', kind: 'mine', name: 'Katanga Copper–Cobalt Belt (Kolwezi)', at: ll(-10.72, 25.47), country: 'CD', importance: 0.74, outputs: ['commodity:cobalt', 'commodity:copper'] }),
    fac({ id: 'node:mine-atacama-lithium', kind: 'mine', name: 'Salar de Atacama Lithium Operations', at: ll(-23.5, -68.25), country: 'CL', importance: 0.68, outputs: ['commodity:lithium'] }),
    fac({ id: 'node:agri-corn-belt', kind: 'agricultural_region', name: 'US Corn Belt (Iowa)', at: ll(41.9, -93.5), country: 'US', importance: 0.75, outputs: ['commodity:grain', 'commodity:soy'] }),
    fac({ id: 'node:agri-mato-grosso', kind: 'agricultural_region', name: 'Mato Grosso Soy Belt', at: ll(-13.0, -55.9), country: 'BR', importance: 0.74, outputs: ['commodity:soy'] }),
    fac({ id: 'node:agri-ukraine-wheat', kind: 'agricultural_region', name: 'Ukraine Wheat Belt', at: ll(48.5, 32.0), country: 'UA', importance: 0.66, outputs: ['commodity:wheat'] }),
    fac({ id: 'node:oil-bakken', kind: 'oil_field', name: 'Bakken Formation', at: ll(47.8, -103.2), country: 'US', importance: 0.6, outputs: ['commodity:crude-oil'] })
  );

  // ---- Processing (10)
  nodes.push(
    fac({ id: 'node:steel-gary', kind: 'steel_mill', name: 'Gary Works Steel Mill', at: ll(41.6, -87.34), country: 'US', importance: 0.68, inputs: ['commodity:iron-ore'], outputs: ['commodity:steel'] }),
    fac({ id: 'node:steel-baoshan', kind: 'steel_mill', name: 'Baoshan Steel Complex', at: ll(31.4, 121.48), country: 'CN', importance: 0.8, inputs: ['commodity:iron-ore'], outputs: ['commodity:steel'] }),
    fac({ id: 'node:steel-duisburg', kind: 'steel_mill', name: 'Duisburg Steelworks', at: ll(51.49, 6.74), country: 'DE', importance: 0.7, inputs: ['commodity:iron-ore'], outputs: ['commodity:steel'] }),
    fac({ id: 'node:refinery-houston', kind: 'refinery', name: 'Houston Refining Complex', at: ll(29.72, -95.12), country: 'US', importance: 0.8, inputs: ['commodity:crude-oil'], outputs: ['commodity:refined-products'] }),
    fac({ id: 'node:refinery-pernis', kind: 'refinery', name: 'Rotterdam Pernis Refinery', at: ll(51.88, 4.38), country: 'NL', importance: 0.72, inputs: ['commodity:crude-oil'], outputs: ['commodity:refined-products'] }),
    fac({ id: 'node:refinery-jamnagar', kind: 'refinery', name: 'Jamnagar Refinery', at: ll(22.35, 69.87), country: 'IN', importance: 0.8, inputs: ['commodity:crude-oil'], outputs: ['commodity:refined-products'] }),
    fac({ id: 'node:chem-ludwigshafen', kind: 'chemical_plant', name: 'Ludwigshafen Chemical Complex', at: ll(49.49, 8.43), country: 'DE', importance: 0.72, operator: 'BASF', outputs: ['commodity:chemicals'] }),
    fac({ id: 'node:smelter-norilsk', kind: 'smelter', name: 'Norilsk Smelter Complex', at: ll(69.35, 88.2), country: 'RU', importance: 0.62, outputs: ['commodity:copper'] }),
    fac({ id: 'node:chem-guangzhou', kind: 'chemical_plant', name: 'Guangzhou Petrochemical Works', at: ll(23.1, 113.5), country: 'CN', importance: 0.62, outputs: ['commodity:chemicals'] }),
    fac({ id: 'node:steel-hamilton', kind: 'steel_mill', name: 'Hamilton Steelworks', at: ll(43.27, -79.85), country: 'CA', importance: 0.56, outputs: ['commodity:steel'] })
  );

  // ---- Industry + consumption (12)
  nodes.push(
    fac({ id: 'node:industry-detroit', kind: 'manufacturing_cluster', name: 'Detroit Auto Cluster', at: ll(42.33, -83.05), country: 'US', importance: 0.78, inputs: ['commodity:auto-parts', 'commodity:steel'], outputs: ['commodity:vehicles'] }),
    fac({ id: 'node:industry-wolfsburg', kind: 'factory', name: 'Wolfsburg Auto Works', at: ll(52.43, 10.79), country: 'DE', importance: 0.74, outputs: ['commodity:vehicles'] }),
    fac({ id: 'node:industry-toyota-city', kind: 'manufacturing_cluster', name: 'Toyota City Auto Cluster', at: ll(35.08, 137.16), country: 'JP', importance: 0.76, outputs: ['commodity:vehicles'] }),
    fac({ id: 'node:industry-shenzhen', kind: 'manufacturing_cluster', name: 'Shenzhen Electronics Cluster', at: ll(22.55, 114.06), country: 'CN', importance: 0.86, outputs: ['commodity:electronics'] }),
    fac({ id: 'node:industry-suzhou', kind: 'industrial_park', name: 'Suzhou Industrial Park', at: ll(31.3, 120.62), country: 'CN', importance: 0.74, outputs: ['commodity:electronics'] }),
    fac({ id: 'node:industry-monterrey', kind: 'manufacturing_cluster', name: 'Monterrey Manufacturing Cluster', at: ll(25.69, -100.32), country: 'MX', importance: 0.68, outputs: ['commodity:auto-parts', 'commodity:machinery'] }),
    fac({ id: 'node:industry-toronto', kind: 'manufacturing_cluster', name: 'Toronto Manufacturing Belt', at: ll(43.7, -79.55), country: 'CA', importance: 0.64, outputs: ['commodity:auto-parts'] }),
    fac({ id: 'node:industry-chicago', kind: 'manufacturing_cluster', name: 'Chicago Manufacturing Corridor', at: ll(41.84, -87.7), country: 'US', importance: 0.66 }),
    fac({ id: 'node:consumption-nyc', kind: 'consumption_center', name: 'New York Metro Demand Center', at: ll(40.75, -73.99), country: 'US', importance: 0.9 }),
    fac({ id: 'node:consumption-la', kind: 'consumption_center', name: 'Greater Los Angeles Demand Center', at: ll(34.06, -118.3), country: 'US', importance: 0.86 }),
    fac({ id: 'node:consumption-london', kind: 'consumption_center', name: 'Greater London Demand Center', at: ll(51.51, -0.13), country: 'GB', importance: 0.84 }),
    fac({ id: 'node:consumption-tokyo', kind: 'consumption_center', name: 'Greater Tokyo Demand Center', at: ll(35.68, 139.77), country: 'JP', importance: 0.88 })
  );

  // ---- Chokepoints (8)
  nodes.push(
    fac({ id: 'node:choke-panama', kind: 'chokepoint', name: 'Panama Canal', at: ll(9.08, -79.68), country: 'PA', importance: 0.95, status: 'degraded', tags: ['canal'] }),
    fac({ id: 'node:choke-suez', kind: 'chokepoint', name: 'Suez Canal', at: ll(30.45, 32.35), country: 'EG', importance: 0.97, tags: ['canal'] }),
    fac({ id: 'node:choke-malacca', kind: 'chokepoint', name: 'Strait of Malacca', at: ll(1.6, 102.5), country: 'MY', importance: 0.97, tags: ['strait'] }),
    fac({ id: 'node:choke-hormuz', kind: 'chokepoint', name: 'Strait of Hormuz', at: ll(26.57, 56.25), country: 'OM', importance: 0.96, tags: ['strait'] }),
    fac({ id: 'node:choke-gibraltar', kind: 'chokepoint', name: 'Strait of Gibraltar', at: ll(35.95, -5.6), country: 'ES', importance: 0.9, tags: ['strait'] }),
    fac({ id: 'node:choke-bab-el-mandeb', kind: 'chokepoint', name: 'Bab el-Mandeb', at: ll(12.58, 43.33), country: 'DJ', importance: 0.92, tags: ['strait'] }),
    fac({ id: 'node:choke-bosporus', kind: 'chokepoint', name: 'Bosporus Strait', at: ll(41.12, 29.06), country: 'TR', importance: 0.9, tags: ['strait'] }),
    fac({ id: 'node:choke-dover', kind: 'chokepoint', name: 'Strait of Dover', at: ll(51.0, 1.45), country: 'GB', importance: 0.9, tags: ['strait'] })
  );

  // ---- Cities (12)
  nodes.push(
    fac({ id: 'node:city-toronto', kind: 'city', name: 'Toronto', at: ll(43.65, -79.38), country: 'CA', importance: 0.8 }),
    fac({ id: 'node:city-detroit', kind: 'city', name: 'Detroit', at: ll(42.34, -83.06), country: 'US', importance: 0.7 }),
    fac({ id: 'node:city-chicago', kind: 'city', name: 'Chicago', at: ll(41.88, -87.63), country: 'US', importance: 0.85 }),
    fac({ id: 'node:city-shanghai', kind: 'city', name: 'Shanghai', at: ll(31.23, 121.47), country: 'CN', importance: 0.92 }),
    fac({ id: 'node:city-singapore', kind: 'city', name: 'Singapore', at: ll(1.29, 103.85), country: 'SG', importance: 0.88 }),
    fac({ id: 'node:city-rotterdam', kind: 'city', name: 'Rotterdam', at: ll(51.92, 4.48), country: 'NL', importance: 0.72 }),
    fac({ id: 'node:city-dubai', kind: 'city', name: 'Dubai', at: ll(25.2, 55.27), country: 'AE', importance: 0.8 }),
    fac({ id: 'node:city-new-york', kind: 'city', name: 'New York', at: ll(40.71, -74.01), country: 'US', importance: 0.95 }),
    fac({ id: 'node:city-los-angeles', kind: 'city', name: 'Los Angeles', at: ll(34.05, -118.24), country: 'US', importance: 0.9 }),
    fac({ id: 'node:city-duisburg', kind: 'city', name: 'Duisburg', at: ll(51.43, 6.77), country: 'DE', importance: 0.6 }),
    fac({ id: 'node:city-dallas', kind: 'city', name: 'Dallas', at: ll(32.78, -96.8), country: 'US', importance: 0.72 }),
    fac({ id: 'node:city-warsaw', kind: 'city', name: 'Warsaw', at: ll(52.23, 21.01), country: 'PL', importance: 0.66 })
  );

  return nodes;
}

// ------------------------------------------------------------------
// Routes
// ------------------------------------------------------------------

const MODE_SPEED_KMH: Record<TransportMode, number> = { road: 75, rail: 45, maritime: 33, air: 830 };
const MODE_DWELL_H: Record<TransportMode, number> = { road: 1, rail: 8, maritime: 24, air: 4 };
const MODE_CAPACITY: Record<TransportMode, QuantityRating> = {
  road: { value: 320, unit: 'loads/day' },
  rail: { value: 36, unit: 'trains/day' },
  maritime: { value: 14, unit: 'vessels/day' },
  air: { value: 260, unit: 't/day' },
};

interface RouteConstraintSpec {
  type: RouteConstraint['type'];
  description: string;
  severity: number;
  at?: LonLat;
}

interface RouteSpec {
  id: string;
  name: string;
  mode: TransportMode;
  origin: string;
  dest: string;
  pts: LonLat[];
  utilization: number;
  importance?: number;
  dwellHours?: number;
  corridorId?: string;
  bidirectional?: boolean;
  capacity?: QuantityRating;
  tags?: string[];
  cons?: RouteConstraintSpec[];
}

function makeRoute(s: RouteSpec): Route {
  const distanceKm = pathLengthKm(s.pts);
  const estimatedDurationHours = round1(
    distanceKm / MODE_SPEED_KMH[s.mode] + (s.dwellHours ?? MODE_DWELL_H[s.mode])
  );
  const constraints: RouteConstraint[] = (s.cons ?? []).map((c, i) => ({
    id: `${s.id}:c${i}`,
    type: c.type,
    description: c.description,
    severity: c.severity,
    atFraction: c.at ? Math.round(fractionNear(s.pts, c.at) * 1000) / 1000 : undefined,
  }));
  return {
    id: s.id,
    kind: 'route',
    name: s.name,
    geometry: { type: 'LineString', coordinates: s.pts },
    status: 'active',
    provenance: prov(),
    importance: s.importance ?? 0.6,
    tags: s.tags,
    mode: s.mode,
    originId: s.origin,
    destinationId: s.dest,
    distanceKm: Math.round(distanceKm),
    estimatedDurationHours,
    capacity: s.capacity ?? MODE_CAPACITY[s.mode],
    utilization: s.utilization,
    constraints,
    historicalState: [], // filled in buildWorldSnapshot with the shared resolver
    corridorId: s.corridorId,
    bidirectional: s.bidirectional ?? true,
  };
}

// Chokepoint coordinates reused by route constraints.
const AT_PANAMA = ll(9.35, -79.92);
const AT_SUEZ = ll(30.45, 32.35);
const AT_MALACCA = ll(2.6, 101.0);
const AT_HORMUZ = ll(26.4, 56.6);
const AT_GIBRALTAR = ll(35.95, -5.6);
const AT_BAB_EL_MANDEB = ll(12.6, 43.4);
const AT_DOVER = ll(50.95, 1.35);

function buildRoutes(): Route[] {
  const specs: RouteSpec[] = [
    // ============================================================ ROAD
    {
      id: 'route:road-toronto-detroit',
      name: 'Hwy 401 — Toronto → Detroit',
      mode: 'road',
      origin: 'node:dc-toronto',
      dest: 'node:rail-detroit',
      utilization: 0.74,
      importance: 0.82,
      dwellHours: 2.5,
      corridorId: 'corridor:na-great-lakes',
      tags: ['demo:follow-the-load'],
      pts: [
        ll(43.73, -79.76), // GTA West DC (Brampton)
        ll(43.59, -79.64), // Mississauga
        ll(43.36, -80.31), // Cambridge
        ll(43.13, -80.75), // Woodstock
        ll(42.98, -81.25), // London ON
        ll(42.58, -81.85),
        ll(42.4, -82.19), // Chatham
        ll(42.32, -82.55), // Tilbury
        ll(42.3, -83.03), // Windsor
        ll(42.312, -83.074), // Ambassador Bridge
        ll(42.331, -83.046), // Detroit
        ll(42.3, -83.1), // Detroit intermodal
      ],
      cons: [
        { type: 'border', description: 'US–Canada customs at the Ambassador Bridge', severity: 0.5, at: ll(42.312, -83.074) },
      ],
    },
    {
      id: 'route:road-detroit-chicago',
      name: 'I-94 — Detroit → Chicago',
      mode: 'road',
      origin: 'node:industry-detroit',
      dest: 'node:rail-chicago',
      utilization: 0.68,
      importance: 0.7,
      corridorId: 'corridor:na-great-lakes',
      pts: [
        ll(42.33, -83.05),
        ll(42.28, -83.75), // Ann Arbor
        ll(42.25, -84.4), // Jackson
        ll(42.32, -85.18), // Battle Creek
        ll(42.29, -85.59), // Kalamazoo
        ll(42.1, -86.43), // Benton Harbor
        ll(41.72, -86.9), // Michigan City
        ll(41.6, -87.34), // Gary
        ll(41.85, -87.65), // Chicago
        ll(41.81, -87.68),
      ],
    },
    {
      id: 'route:road-chicago-drayage',
      name: 'Chicago terminal drayage',
      mode: 'road',
      origin: 'node:rail-chicago',
      dest: 'node:dc-chicago',
      utilization: 0.6,
      importance: 0.5,
      dwellHours: 0.5,
      corridorId: 'corridor:na-great-lakes',
      tags: ['demo:follow-the-load'],
      pts: [ll(41.81, -87.68), ll(41.82, -87.71), ll(41.83, -87.74)],
    },
    {
      id: 'route:road-la-inland-empire',
      name: 'San Pedro Bay → Inland Empire drayage',
      mode: 'road',
      origin: 'node:port-la',
      dest: 'node:dc-inland-empire',
      utilization: 0.85,
      importance: 0.78,
      corridorId: 'corridor:na-transcon',
      pts: [ll(33.73, -118.26), ll(33.79, -118.21), ll(33.92, -118.05), ll(34.0, -117.9), ll(34.03, -117.72), ll(34.05, -117.6)],
      cons: [{ type: 'congestion', description: 'Chronic harbor-gate truck queueing', severity: 0.6, at: ll(33.79, -118.21) }],
    },
    {
      id: 'route:road-ny-chicago',
      name: 'I-80 — New York → Chicago',
      mode: 'road',
      origin: 'node:consumption-nyc',
      dest: 'node:dc-chicago',
      utilization: 0.62,
      importance: 0.66,
      pts: [
        ll(40.75, -73.99),
        ll(40.9, -74.7),
        ll(41.0, -75.6), // Stroudsburg
        ll(41.05, -76.9), // Bloomsburg
        ll(41.2, -78.7),
        ll(41.15, -80.1),
        ll(41.5, -81.69), // Cleveland
        ll(41.65, -83.54), // Toledo
        ll(41.68, -86.25), // South Bend
        ll(41.6, -87.34), // Gary
        ll(41.83, -87.74),
      ],
    },
    {
      id: 'route:road-houston-dallas',
      name: 'I-45 — Houston → Dallas',
      mode: 'road',
      origin: 'node:port-houston',
      dest: 'node:city-dallas',
      utilization: 0.58,
      importance: 0.55,
      pts: [ll(29.73, -95.02), ll(29.76, -95.37), ll(30.72, -95.55), ll(31.46, -96.06), ll(32.1, -96.47), ll(32.78, -96.8)],
    },
    {
      id: 'route:road-rotterdam-duisburg',
      name: 'A15/A73 — Rotterdam → Venlo → Duisburg',
      mode: 'road',
      origin: 'node:port-rotterdam',
      dest: 'node:rail-duisburg',
      utilization: 0.72,
      importance: 0.7,
      corridorId: 'corridor:rhine',
      pts: [ll(51.95, 4.14), ll(51.9, 4.49), ll(51.88, 4.66), ll(51.85, 5.3), ll(51.66, 5.6), ll(51.4, 6.17), ll(51.45, 6.45), ll(51.44, 6.76)],
    },
    {
      id: 'route:road-hamburg-warsaw',
      name: 'A24/A2 — Hamburg → Berlin → Warsaw',
      mode: 'road',
      origin: 'node:port-hamburg',
      dest: 'node:city-warsaw',
      utilization: 0.6,
      importance: 0.6,
      pts: [
        ll(53.53, 9.93),
        ll(53.42, 10.22),
        ll(53.1, 11.6),
        ll(52.9, 12.5),
        ll(52.52, 13.4), // Berlin
        ll(52.34, 14.55), // Frankfurt (Oder)
        ll(52.25, 15.53),
        ll(52.41, 16.93), // Poznań
        ll(52.22, 18.25), // Konin
        ll(52.23, 21.01), // Warsaw
      ],
      cons: [{ type: 'border', description: 'DE–PL crossing at Frankfurt (Oder)', severity: 0.2, at: ll(52.34, 14.55) }],
    },
    {
      id: 'route:road-shenzhen-guangzhou',
      name: 'G4 — Shenzhen → Guangzhou',
      mode: 'road',
      origin: 'node:industry-shenzhen',
      dest: 'node:chem-guangzhou',
      utilization: 0.78,
      importance: 0.62,
      pts: [ll(22.55, 114.06), ll(22.8, 113.9), ll(23.02, 113.75), ll(23.1, 113.6), ll(23.1, 113.5)],
    },
    {
      id: 'route:road-toronto-drayage',
      name: 'GTA DC → Toronto intermodal drayage',
      mode: 'road',
      origin: 'node:dc-toronto',
      dest: 'node:rail-toronto',
      utilization: 0.55,
      importance: 0.45,
      dwellHours: 0.5,
      pts: [ll(43.73, -79.76), ll(43.76, -79.65), ll(43.83, -79.53)],
    },
    {
      id: 'route:road-shenzhen-hkg',
      name: 'Shenzhen → Hong Kong airport shuttle',
      mode: 'road',
      origin: 'node:dc-shenzhen',
      dest: 'node:air-hkg',
      utilization: 0.7,
      importance: 0.6,
      dwellHours: 2,
      pts: [ll(22.68, 114.05), ll(22.55, 114.1), ll(22.5, 114.11), ll(22.35, 114.1), ll(22.31, 113.92)],
      cons: [{ type: 'border', description: 'Shenzhen–Hong Kong boundary crossing', severity: 0.35, at: ll(22.5, 114.11) }],
    },
    {
      id: 'route:road-cornbelt-chicago',
      name: 'I-80 — Iowa Corn Belt → Chicago',
      mode: 'road',
      origin: 'node:agri-corn-belt',
      dest: 'node:rail-chicago',
      utilization: 0.5,
      importance: 0.55,
      pts: [ll(41.9, -93.5), ll(41.66, -91.53), ll(41.52, -90.58), ll(41.84, -89.48), ll(41.85, -88.3), ll(41.81, -87.68)],
    },
    {
      id: 'route:road-matogrosso-santos',
      name: 'BR-163 — Mato Grosso → Santos',
      mode: 'road',
      origin: 'node:agri-mato-grosso',
      dest: 'node:port-santos',
      utilization: 0.66,
      importance: 0.62,
      pts: [
        ll(-13.0, -55.9),
        ll(-15.0, -55.2),
        ll(-16.47, -54.64), // Rondonópolis
        ll(-18.5, -52.5),
        ll(-20.4, -50.5),
        ll(-22.0, -48.5),
        ll(-23.55, -46.63), // São Paulo
        ll(-23.98, -46.3), // Santos
      ],
    },
    {
      id: 'route:road-escondida-valparaiso',
      name: 'Ruta 5 — Escondida → Valparaíso',
      mode: 'road',
      origin: 'node:mine-escondida',
      dest: 'node:port-valparaiso',
      utilization: 0.62,
      importance: 0.6,
      pts: [
        ll(-24.27, -69.07),
        ll(-24.1, -69.9),
        ll(-23.65, -70.4), // Antofagasta
        ll(-25.4, -70.45),
        ll(-26.35, -70.65),
        ll(-27.3, -70.9),
        ll(-29.0, -71.25),
        ll(-29.9, -71.25), // La Serena
        ll(-31.5, -71.4),
        ll(-32.75, -71.5),
        ll(-33.03, -71.62),
      ],
    },
    {
      id: 'route:road-wolfsburg-hamburg',
      name: 'A39/A7 — Wolfsburg → Hamburg',
      mode: 'road',
      origin: 'node:industry-wolfsburg',
      dest: 'node:port-hamburg',
      utilization: 0.6,
      importance: 0.58,
      pts: [ll(52.43, 10.79), ll(52.85, 10.55), ll(53.2, 10.05), ll(53.53, 9.93)],
    },
    {
      id: 'route:road-memphis-drayage',
      name: 'Memphis air-hub drayage',
      mode: 'road',
      origin: 'node:air-mem',
      dest: 'node:dc-memphis',
      utilization: 0.65,
      importance: 0.45,
      dwellHours: 0.5,
      pts: [ll(35.042, -89.979), ll(35.05, -89.95), ll(35.06, -89.93)],
    },
    {
      id: 'route:road-monterrey-houston',
      name: 'I-35/I-10 — Monterrey → Houston',
      mode: 'road',
      origin: 'node:industry-monterrey',
      dest: 'node:port-houston',
      utilization: 0.7,
      importance: 0.66,
      dwellHours: 3,
      pts: [
        ll(25.69, -100.32),
        ll(26.6, -99.85),
        ll(27.48, -99.51), // Laredo crossing
        ll(28.6, -98.9),
        ll(29.42, -98.49), // San Antonio
        ll(29.55, -97.3),
        ll(29.76, -95.37),
        ll(29.73, -95.02),
      ],
      cons: [{ type: 'border', description: 'US–Mexico customs at Laredo', severity: 0.45, at: ll(27.48, -99.51) }],
    },
    {
      id: 'route:road-shanghai-baoshan',
      name: 'Shanghai port → Baoshan works drayage',
      mode: 'road',
      origin: 'node:port-shanghai',
      dest: 'node:steel-baoshan',
      utilization: 0.6,
      importance: 0.45,
      dwellHours: 0.5,
      pts: [ll(31.34, 121.65), ll(31.38, 121.56), ll(31.4, 121.48)],
    },
    {
      id: 'route:road-shenzhen-yantian',
      name: 'Shenzhen cluster → Yantian drayage',
      mode: 'road',
      origin: 'node:industry-shenzhen',
      dest: 'node:port-yantian',
      utilization: 0.75,
      importance: 0.55,
      dwellHours: 0.5,
      pts: [ll(22.55, 114.06), ll(22.57, 114.15), ll(22.58, 114.27)],
    },

    // ============================================================ RAIL
    {
      id: 'route:rail-detroit-chicago',
      name: 'Detroit → Chicago rail',
      mode: 'rail',
      origin: 'node:rail-detroit',
      dest: 'node:rail-chicago',
      utilization: 0.66,
      importance: 0.72,
      corridorId: 'corridor:na-great-lakes',
      tags: ['demo:follow-the-load'],
      pts: [
        ll(42.3, -83.1),
        ll(42.24, -83.61), // Ypsilanti
        ll(42.25, -84.4), // Jackson
        ll(42.24, -84.75), // Albion
        ll(42.32, -85.18), // Battle Creek
        ll(42.29, -85.63),
        ll(41.83, -86.25), // Niles
        ll(41.72, -86.9), // Michigan City
        ll(41.6, -87.34), // Gary
        ll(41.81, -87.68),
      ],
    },
    {
      id: 'route:rail-chicago-la',
      name: 'BNSF Transcon — Chicago → Los Angeles',
      mode: 'rail',
      origin: 'node:rail-chicago',
      dest: 'node:port-la',
      utilization: 0.82,
      importance: 0.85,
      corridorId: 'corridor:na-transcon',
      capacity: { value: 90, unit: 'trains/day' },
      pts: [
        ll(41.81, -87.68),
        ll(40.95, -90.37), // Galesburg
        ll(40.63, -91.32), // Fort Madison
        ll(39.12, -94.55), // Kansas City
        ll(38.4, -96.18), // Emporia
        ll(37.27, -97.4), // Wellington
        ll(36.75, -100.5),
        ll(35.19, -101.85), // Amarillo
        ll(34.4, -103.2), // Clovis
        ll(34.66, -106.78), // Belen
        ll(35.52, -108.74), // Gallup
        ll(35.2, -111.65), // Flagstaff
        ll(34.85, -114.61), // Needles
        ll(34.9, -117.02), // Barstow
        ll(34.1, -117.29), // San Bernardino
        ll(34.02, -118.2),
        ll(33.73, -118.26), // Alameda Corridor to the port
      ],
      cons: [{ type: 'congestion', description: 'Cajon Pass grade and staging congestion', severity: 0.4, at: ll(34.1, -117.29) }],
    },
    {
      id: 'route:rail-toronto-montreal',
      name: 'Toronto → Montreal rail',
      mode: 'rail',
      origin: 'node:rail-toronto',
      dest: 'node:port-montreal',
      utilization: 0.58,
      importance: 0.6,
      pts: [
        ll(43.83, -79.53),
        ll(43.9, -78.85), // Oshawa
        ll(44.1, -77.6), // Belleville
        ll(44.23, -76.48), // Kingston
        ll(44.59, -75.68), // Brockville
        ll(45.02, -74.73), // Cornwall
        ll(45.56, -73.53),
      ],
    },
    {
      id: 'route:rail-vancouver-toronto',
      name: 'CN Transcontinental — Vancouver → Toronto',
      mode: 'rail',
      origin: 'node:port-vancouver',
      dest: 'node:rail-toronto',
      utilization: 0.7,
      importance: 0.74,
      pts: [
        ll(49.29, -123.1),
        ll(50.67, -120.33), // Kamloops
        ll(52.87, -118.08), // Jasper
        ll(53.55, -113.49), // Edmonton
        ll(52.13, -106.67), // Saskatoon
        ll(49.9, -97.2), // Winnipeg
        ll(50.1, -91.92), // Sioux Lookout
        ll(49.21, -84.78), // Hornepayne
        ll(46.71, -80.92), // Capreol
        ll(43.83, -79.53),
      ],
    },
    {
      id: 'route:rail-chicago-memphis',
      name: 'CN — Chicago → Memphis',
      mode: 'rail',
      origin: 'node:rail-chicago',
      dest: 'node:dc-memphis',
      utilization: 0.55,
      importance: 0.58,
      pts: [
        ll(41.81, -87.68),
        ll(40.12, -88.24), // Champaign
        ll(38.53, -89.13), // Centralia
        ll(37.73, -89.22), // Carbondale
        ll(36.03, -89.39), // Dyersburg
        ll(35.06, -89.93),
      ],
    },
    {
      id: 'route:rail-duisburg-hamburg',
      name: 'Duisburg → Hamburg rail',
      mode: 'rail',
      origin: 'node:rail-duisburg',
      dest: 'node:port-hamburg',
      utilization: 0.6,
      importance: 0.6,
      corridorId: 'corridor:rhine',
      pts: [ll(51.44, 6.76), ll(51.96, 7.63), ll(52.28, 8.05), ll(53.08, 8.81), ll(53.53, 9.93)],
    },
    {
      id: 'route:rail-rotterdam-duisburg',
      name: 'Betuweroute — Rotterdam → Duisburg',
      mode: 'rail',
      origin: 'node:port-rotterdam',
      dest: 'node:rail-duisburg',
      utilization: 0.76,
      importance: 0.78,
      corridorId: 'corridor:rhine',
      capacity: { value: 110, unit: 'trains/day' },
      pts: [
        ll(51.95, 4.14),
        ll(51.9, 4.5),
        ll(51.89, 5.43), // Tiel
        ll(51.93, 6.08), // Zevenaar
        ll(51.83, 6.25), // Emmerich
        ll(51.66, 6.62), // Wesel
        ll(51.44, 6.76),
      ],
      cons: [{ type: 'capacity', description: 'Dedicated freight line at slot capacity', severity: 0.3, at: ll(51.93, 6.08) }],
    },
    {
      id: 'route:rail-chongqing-duisburg',
      name: 'China–Europe Landbridge — Chongqing → Duisburg',
      mode: 'rail',
      origin: 'node:rail-chongqing',
      dest: 'node:rail-duisburg',
      utilization: 0.78,
      importance: 0.9,
      dwellHours: 80,
      corridorId: 'corridor:asia-europe-rail',
      capacity: { value: 18, unit: 'trains/day' },
      pts: [
        ll(29.54, 106.46),
        ll(34.38, 108.79), // Xi'an
        ll(36.06, 103.83), // Lanzhou
        ll(42.83, 93.51), // Hami
        ll(43.83, 87.62), // Ürümqi
        ll(44.21, 80.42), // Khorgos
        ll(43.26, 76.93), // Almaty
        ll(49.8, 73.1), // Karaganda
        ll(51.17, 71.43), // Astana
        ll(51.77, 55.1), // Orenburg
        ll(53.2, 50.15), // Samara
        ll(55.76, 37.62), // Moscow
        ll(54.78, 32.05), // Smolensk
        ll(53.9, 27.57), // Minsk
        ll(52.1, 23.7), // Brest
        ll(52.03, 23.13), // Małaszewicze gauge break
        ll(52.23, 21.01), // Warsaw
        ll(52.41, 16.93), // Poznań
        ll(52.52, 13.4), // Berlin
        ll(52.38, 9.73), // Hannover
        ll(51.44, 6.76),
      ],
      cons: [
        { type: 'border', description: 'CN–KZ transshipment at Khorgos', severity: 0.5, at: ll(44.21, 80.42) },
        { type: 'border', description: 'Gauge break and customs at Małaszewicze', severity: 0.65, at: ll(52.03, 23.13) },
      ],
    },
    {
      id: 'route:rail-pilbara-port-hedland',
      name: 'Pilbara ore railway — Newman → Port Hedland',
      mode: 'rail',
      origin: 'node:mine-pilbara',
      dest: 'node:port-port-hedland',
      utilization: 0.88,
      importance: 0.76,
      capacity: { value: 8, unit: 'trains/day' },
      pts: [ll(-23.36, 119.73), ll(-22.6, 119.6), ll(-21.5, 119.1), ll(-20.6, 118.75), ll(-20.38, 118.6), ll(-20.31, 118.58)],
    },
    {
      id: 'route:rail-shanghai-chongqing',
      name: 'Yangtze corridor rail — Shanghai → Chongqing',
      mode: 'rail',
      origin: 'node:port-shanghai',
      dest: 'node:rail-chongqing',
      utilization: 0.64,
      importance: 0.66,
      pts: [
        ll(31.34, 121.65),
        ll(31.3, 120.62), // Suzhou
        ll(32.06, 118.8), // Nanjing
        ll(31.82, 117.23), // Hefei
        ll(30.59, 114.31), // Wuhan
        ll(30.69, 111.29), // Yichang
        ll(29.54, 106.46),
      ],
    },

    // ============================================================ MARITIME
    {
      id: 'route:sea-shanghai-la',
      name: 'Transpacific — Shanghai → Los Angeles',
      mode: 'maritime',
      origin: 'node:port-shanghai',
      dest: 'node:port-la',
      utilization: 0.86,
      importance: 0.95,
      corridorId: 'corridor:transpacific',
      capacity: { value: 30, unit: 'vessels/day' },
      pts: [
        ll(31.34, 121.65),
        ll(30.6, 123.8), // East China Sea
        ll(30.5, 129.5), // south of Kyushu
        ll(32.0, 135.0),
        ll(34.2, 140.5), // south of Tokyo
        ll(38.5, 150.0),
        ll(42.0, 160.0),
        ll(45.5, 172.0),
        ll(47.0, -175.0),
        ll(46.5, -160.0),
        ll(45.0, -150.0),
        ll(42.0, -138.0),
        ll(38.0, -128.0),
        ll(34.5, -121.0),
        ll(33.6, -118.9), // San Pedro approach
        ll(33.73, -118.26),
      ],
    },
    {
      id: 'route:sea-singapore-shanghai',
      name: 'Intra-Asia — Singapore → Shanghai',
      mode: 'maritime',
      origin: 'node:port-singapore',
      dest: 'node:port-shanghai',
      utilization: 0.78,
      importance: 0.8,
      corridorId: 'corridor:intra-asia',
      pts: [
        ll(1.26, 103.83),
        ll(1.2, 104.2), // Singapore Strait
        ll(3.5, 105.5),
        ll(8.0, 109.5),
        ll(15.0, 112.0), // South China Sea
        ll(21.0, 117.0),
        ll(24.5, 119.5), // Taiwan Strait
        ll(28.0, 122.5),
        ll(30.8, 122.3),
        ll(31.34, 121.65),
      ],
    },
    {
      id: 'route:sea-singapore-suez',
      name: 'Asia–Europe leg — Singapore → Suez',
      mode: 'maritime',
      origin: 'node:port-singapore',
      dest: 'node:choke-suez',
      utilization: 0.84,
      importance: 0.92,
      corridorId: 'corridor:asia-europe-sea',
      capacity: { value: 24, unit: 'vessels/day' },
      pts: [
        ll(1.26, 103.83),
        ll(1.5, 103.0),
        ll(2.6, 101.0), // Strait of Malacca
        ll(4.5, 99.5),
        ll(6.0, 95.0), // off Banda Aceh
        ll(6.0, 80.0), // south of Sri Lanka
        ll(10.0, 63.0), // Arabian Sea
        ll(12.5, 48.0), // Gulf of Aden
        ll(12.6, 43.4), // Bab el-Mandeb
        ll(17.0, 40.5), // Red Sea
        ll(21.0, 38.5),
        ll(24.0, 36.5),
        ll(27.6, 34.0),
        ll(29.9, 32.55), // Gulf of Suez
        ll(30.45, 32.35),
      ],
      cons: [
        { type: 'chokepoint', description: 'Strait of Malacca traffic separation', severity: 0.55, at: AT_MALACCA },
        { type: 'chokepoint', description: 'Bab el-Mandeb security corridor', severity: 0.6, at: AT_BAB_EL_MANDEB },
        { type: 'chokepoint', description: 'Suez Canal convoy scheduling', severity: 0.65, at: AT_SUEZ },
      ],
    },
    {
      id: 'route:sea-suez-rotterdam',
      name: 'Asia–Europe leg — Suez → Rotterdam',
      mode: 'maritime',
      origin: 'node:choke-suez',
      dest: 'node:port-rotterdam',
      utilization: 0.82,
      importance: 0.92,
      corridorId: 'corridor:asia-europe-sea',
      capacity: { value: 24, unit: 'vessels/day' },
      pts: [
        ll(30.45, 32.35),
        ll(31.5, 32.3), // Port Said
        ll(33.0, 28.0), // Eastern Med
        ll(34.5, 20.0),
        ll(37.2, 11.2), // Strait of Sicily
        ll(36.9, 3.0),
        ll(35.95, -5.6), // Gibraltar
        ll(38.0, -10.5),
        ll(43.5, -9.5), // off Finisterre
        ll(48.6, -5.5), // Ushant
        ll(50.3, -1.5),
        ll(50.95, 1.35), // Dover
        ll(51.5, 2.8),
        ll(51.95, 4.05),
        ll(51.95, 4.14),
      ],
      cons: [
        { type: 'chokepoint', description: 'Suez Canal convoy scheduling', severity: 0.65, at: AT_SUEZ },
        { type: 'chokepoint', description: 'Strait of Gibraltar convergence', severity: 0.45, at: AT_GIBRALTAR },
        { type: 'chokepoint', description: 'Dover Strait traffic separation', severity: 0.4, at: AT_DOVER },
      ],
    },
    {
      id: 'route:sea-jebelali-suez',
      name: 'Gulf–Med — Jebel Ali → Suez',
      mode: 'maritime',
      origin: 'node:port-jebel-ali',
      dest: 'node:choke-suez',
      utilization: 0.72,
      importance: 0.8,
      corridorId: 'corridor:asia-europe-sea',
      pts: [
        ll(25.01, 55.06),
        ll(25.8, 56.0),
        ll(26.4, 56.6), // Hormuz
        ll(25.0, 58.5),
        ll(22.0, 60.5),
        ll(15.0, 58.0), // Arabian Sea
        ll(13.2, 51.0),
        ll(12.5, 48.0), // Gulf of Aden
        ll(12.6, 43.4), // Bab el-Mandeb
        ll(17.0, 40.5),
        ll(21.5, 38.0),
        ll(24.0, 36.5),
        ll(29.9, 32.55),
        ll(30.45, 32.35),
      ],
      cons: [
        { type: 'chokepoint', description: 'Strait of Hormuz transit', severity: 0.6, at: AT_HORMUZ },
        { type: 'chokepoint', description: 'Bab el-Mandeb security corridor', severity: 0.6, at: AT_BAB_EL_MANDEB },
      ],
    },
    {
      id: 'route:sea-rotterdam-ny',
      name: 'Transatlantic — Rotterdam → New York',
      mode: 'maritime',
      origin: 'node:port-rotterdam',
      dest: 'node:port-ny-nj',
      utilization: 0.68,
      importance: 0.82,
      corridorId: 'corridor:transatlantic',
      pts: [
        ll(51.95, 4.14),
        ll(51.4, 2.8),
        ll(50.95, 1.35), // Dover
        ll(50.2, -1.8),
        ll(49.5, -8.0), // Western Approaches
        ll(48.0, -30.0),
        ll(46.0, -45.0),
        ll(44.0, -55.0), // south of Newfoundland
        ll(41.5, -65.0),
        ll(40.4, -73.6), // Ambrose approach
        ll(40.67, -74.15),
      ],
      cons: [{ type: 'chokepoint', description: 'Dover Strait traffic separation', severity: 0.4, at: AT_DOVER }],
    },
    {
      id: 'route:sea-santos-rotterdam',
      name: 'South Atlantic — Santos → Rotterdam',
      mode: 'maritime',
      origin: 'node:port-santos',
      dest: 'node:port-rotterdam',
      utilization: 0.6,
      importance: 0.66,
      pts: [
        ll(-23.98, -46.3),
        ll(-25.0, -44.0),
        ll(-19.0, -38.5),
        ll(-8.0, -34.0), // off Recife
        ll(2.0, -30.0),
        ll(12.0, -25.0),
        ll(20.0, -20.0),
        ll(30.0, -15.0),
        ll(38.0, -10.5),
        ll(43.5, -9.5),
        ll(48.6, -5.5), // Ushant
        ll(50.95, 1.35), // Dover
        ll(51.95, 4.14),
      ],
      cons: [{ type: 'chokepoint', description: 'Dover Strait traffic separation', severity: 0.4, at: AT_DOVER }],
    },
    {
      id: 'route:sea-porthedland-shanghai',
      name: 'Iron ore lane — Port Hedland → Shanghai',
      mode: 'maritime',
      origin: 'node:port-port-hedland',
      dest: 'node:port-shanghai',
      utilization: 0.9,
      importance: 0.84,
      capacity: { value: 10, unit: 'vessels/day' },
      pts: [
        ll(-20.31, 118.58),
        ll(-18.5, 118.0),
        ll(-14.0, 117.0),
        ll(-11.0, 116.5),
        ll(-8.9, 115.7), // Lombok Strait
        ll(-4.0, 117.4), // Makassar Strait
        ll(-1.0, 118.8),
        ll(3.5, 122.0), // Celebes Sea
        ll(10.0, 127.5), // east of Mindanao
        ll(15.0, 128.0),
        ll(20.0, 126.0),
        ll(25.0, 123.5),
        ll(29.0, 122.5),
        ll(31.34, 121.65),
      ],
    },
    {
      id: 'route:sea-valparaiso-panama-rotterdam',
      name: 'Valparaíso → Panama → Rotterdam',
      mode: 'maritime',
      origin: 'node:port-valparaiso',
      dest: 'node:port-rotterdam',
      utilization: 0.58,
      importance: 0.7,
      pts: [
        ll(-33.03, -71.62),
        ll(-30.0, -72.5),
        ll(-25.0, -73.0),
        ll(-18.0, -72.0),
        ll(-8.0, -78.5), // off Peru
        ll(-3.0, -81.5),
        ll(3.0, -80.5),
        ll(7.0, -79.3), // Gulf of Panama
        ll(8.9, -79.55), // Pacific canal entrance
        ll(9.35, -79.92), // Gatún reach
        ll(10.5, -79.5), // Caribbean
        ll(14.0, -75.0),
        ll(19.5, -65.0),
        ll(30.0, -50.0),
        ll(38.0, -35.0),
        ll(44.0, -20.0),
        ll(48.6, -5.5), // Ushant
        ll(50.95, 1.35), // Dover
        ll(51.95, 4.14),
      ],
      cons: [
        { type: 'chokepoint', description: 'Panama Canal lock transit', severity: 0.6, at: AT_PANAMA },
        { type: 'draft_limit', description: 'Gatún Lake draft restriction (low water)', severity: 0.45, at: AT_PANAMA },
        { type: 'chokepoint', description: 'Dover Strait traffic separation', severity: 0.4, at: AT_DOVER },
      ],
    },
    {
      id: 'route:sea-shanghai-panama-ny',
      name: 'All-water — Shanghai → Panama → New York',
      mode: 'maritime',
      origin: 'node:port-shanghai',
      dest: 'node:port-ny-nj',
      utilization: 0.7,
      importance: 0.78,
      corridorId: 'corridor:transpacific',
      pts: [
        ll(31.34, 121.65),
        ll(30.6, 123.8),
        ll(31.5, 130.0),
        ll(34.2, 140.5),
        ll(40.0, 155.0),
        ll(44.0, 170.0),
        ll(45.0, -175.0),
        ll(40.0, -155.0),
        ll(33.0, -140.0),
        ll(20.0, -120.0),
        ll(12.0, -100.0),
        ll(7.5, -85.0),
        ll(8.9, -79.55),
        ll(9.35, -79.92), // Panama Canal
        ll(10.0, -79.0),
        ll(15.0, -74.5),
        ll(20.0, -73.8), // Windward Passage
        ll(25.0, -73.0),
        ll(32.0, -74.5),
        ll(40.4, -73.6),
        ll(40.67, -74.15),
      ],
      cons: [
        { type: 'chokepoint', description: 'Panama Canal lock transit', severity: 0.6, at: AT_PANAMA },
        { type: 'draft_limit', description: 'Gatún Lake draft restriction (low water)', severity: 0.45, at: AT_PANAMA },
      ],
    },
    {
      id: 'route:sea-rastanura-singapore',
      name: 'Crude lane — Ras Tanura → Singapore',
      mode: 'maritime',
      origin: 'node:port-ras-tanura',
      dest: 'node:port-singapore',
      utilization: 0.8,
      importance: 0.84,
      corridorId: 'corridor:gulf-energy',
      capacity: { value: 8, unit: 'vessels/day' },
      pts: [
        ll(26.64, 50.16),
        ll(26.6, 52.0),
        ll(26.2, 54.5),
        ll(26.4, 56.6), // Hormuz
        ll(24.5, 59.0),
        ll(20.0, 63.0),
        ll(12.0, 70.0),
        ll(6.5, 78.0), // south of India
        ll(5.8, 82.0),
        ll(6.2, 90.0),
        ll(6.0, 95.0),
        ll(4.5, 98.5),
        ll(2.6, 101.0), // Malacca
        ll(1.4, 103.0),
        ll(1.26, 103.83),
      ],
      cons: [
        { type: 'chokepoint', description: 'Strait of Hormuz transit', severity: 0.6, at: AT_HORMUZ },
        { type: 'chokepoint', description: 'Strait of Malacca traffic separation', severity: 0.55, at: AT_MALACCA },
      ],
    },
    {
      id: 'route:sea-hamburg-ny',
      name: 'Transatlantic — Hamburg → New York',
      mode: 'maritime',
      origin: 'node:port-hamburg',
      dest: 'node:port-ny-nj',
      utilization: 0.62,
      importance: 0.7,
      corridorId: 'corridor:transatlantic',
      pts: [
        ll(53.53, 9.93),
        ll(54.2, 8.5), // Elbe estuary
        ll(54.2, 7.0), // German Bight
        ll(52.5, 3.5),
        ll(51.8, 2.5),
        ll(50.95, 1.35), // Dover
        ll(50.2, -2.0),
        ll(48.8, -5.5),
        ll(49.5, -8.0),
        ll(48.0, -30.0),
        ll(46.0, -45.0),
        ll(44.0, -55.0),
        ll(40.4, -73.6),
        ll(40.67, -74.15),
      ],
      cons: [{ type: 'chokepoint', description: 'Dover Strait traffic separation', severity: 0.4, at: AT_DOVER }],
    },
    {
      id: 'route:sea-shenzhen-la',
      name: 'Transpacific — Yantian → Los Angeles',
      mode: 'maritime',
      origin: 'node:port-yantian',
      dest: 'node:port-la',
      utilization: 0.84,
      importance: 0.88,
      corridorId: 'corridor:transpacific',
      pts: [
        ll(22.58, 114.27),
        ll(21.5, 115.5),
        ll(21.0, 118.0),
        ll(20.5, 121.0), // Luzon Strait
        ll(22.0, 124.0),
        ll(27.0, 130.0),
        ll(34.2, 140.5),
        ll(40.5, 155.0),
        ll(44.5, 170.0),
        ll(46.0, -175.0),
        ll(45.0, -150.0),
        ll(38.0, -128.0),
        ll(33.6, -118.9),
        ll(33.73, -118.26),
      ],
    },
    {
      id: 'route:sea-busan-seattle',
      name: 'Transpacific — Busan → Seattle-Tacoma',
      mode: 'maritime',
      origin: 'node:port-busan',
      dest: 'node:port-seattle-tacoma',
      utilization: 0.66,
      importance: 0.72,
      corridorId: 'corridor:transpacific',
      pts: [
        ll(35.08, 129.06),
        ll(34.3, 130.5), // Korea Strait
        ll(35.5, 133.5), // Sea of Japan
        ll(37.5, 135.0),
        ll(40.0, 138.5),
        ll(41.45, 140.9), // Tsugaru Strait
        ll(42.5, 145.0),
        ll(46.0, 160.0),
        ll(50.0, 178.0),
        ll(51.5, -170.0), // south of Aleutians
        ll(52.0, -160.0),
        ll(50.0, -145.0),
        ll(49.0, -133.0),
        ll(48.4, -125.5),
        ll(48.2, -123.0), // Juan de Fuca
        ll(47.27, -122.41),
      ],
    },
    {
      id: 'route:sea-hongkong-singapore',
      name: 'Intra-Asia — Hong Kong → Singapore',
      mode: 'maritime',
      origin: 'node:port-hongkong',
      dest: 'node:port-singapore',
      utilization: 0.74,
      importance: 0.72,
      corridorId: 'corridor:intra-asia',
      pts: [
        ll(22.31, 114.13),
        ll(20.0, 113.0),
        ll(16.0, 112.0),
        ll(11.0, 110.0),
        ll(7.0, 107.5),
        ll(4.5, 106.0),
        ll(1.8, 104.5),
        ll(1.26, 103.83),
      ],
    },
    {
      id: 'route:sea-antwerp-savannah',
      name: 'Transatlantic — Antwerp → Savannah',
      mode: 'maritime',
      origin: 'node:port-antwerp',
      dest: 'node:port-savannah',
      utilization: 0.56,
      importance: 0.6,
      corridorId: 'corridor:transatlantic',
      pts: [
        ll(51.28, 4.34),
        ll(51.4, 3.2), // Scheldt estuary
        ll(51.6, 2.5),
        ll(50.95, 1.35), // Dover
        ll(50.1, -2.0),
        ll(48.8, -5.5),
        ll(45.0, -20.0),
        ll(38.0, -40.0),
        ll(33.5, -60.0),
        ll(32.5, -75.0),
        ll(32.0, -80.6),
        ll(32.13, -81.14),
      ],
      cons: [{ type: 'chokepoint', description: 'Dover Strait traffic separation', severity: 0.4, at: AT_DOVER }],
    },
    {
      id: 'route:sea-piraeus-suez',
      name: 'East Med — Piraeus → Suez',
      mode: 'maritime',
      origin: 'node:port-piraeus',
      dest: 'node:choke-suez',
      utilization: 0.64,
      importance: 0.64,
      corridorId: 'corridor:asia-europe-sea',
      pts: [ll(37.94, 23.62), ll(36.5, 24.5), ll(33.5, 28.0), ll(31.4, 32.3), ll(30.45, 32.35)],
      cons: [{ type: 'chokepoint', description: 'Suez Canal convoy scheduling', severity: 0.65, at: AT_SUEZ }],
    },

    // ============================================================ AIR
    {
      id: 'route:air-hkg-anc-mem',
      name: 'Air cargo — Hong Kong → Anchorage → Memphis',
      mode: 'air',
      origin: 'node:air-hkg',
      dest: 'node:air-mem',
      utilization: 0.82,
      importance: 0.84,
      dwellHours: 5,
      capacity: { value: 900, unit: 't/day' },
      pts: [ll(22.308, 113.918), ll(61.174, -149.996), ll(35.042, -89.979)],
    },
    {
      id: 'route:air-shanghai-frankfurt',
      name: 'Air cargo — Shanghai → Frankfurt',
      mode: 'air',
      origin: 'node:air-pvg',
      dest: 'node:air-fra',
      utilization: 0.74,
      importance: 0.74,
      pts: [ll(31.144, 121.808), ll(50.037, 8.562)],
    },
    {
      id: 'route:air-dubai-amsterdam',
      name: 'Air cargo — Dubai → Amsterdam',
      mode: 'air',
      origin: 'node:air-dwc',
      dest: 'node:air-ams',
      utilization: 0.6,
      importance: 0.6,
      pts: [ll(24.897, 55.161), ll(52.31, 4.76)],
    },
    {
      id: 'route:air-incheon-la',
      name: 'Air cargo — Incheon → Los Angeles',
      mode: 'air',
      origin: 'node:air-icn',
      dest: 'node:air-lax',
      utilization: 0.7,
      importance: 0.68,
      pts: [ll(37.46, 126.44), ll(33.941, -118.408)],
    },
    {
      id: 'route:air-frankfurt-ny',
      name: 'Air cargo — Frankfurt → New York',
      mode: 'air',
      origin: 'node:air-fra',
      dest: 'node:air-jfk',
      utilization: 0.66,
      importance: 0.66,
      corridorId: 'corridor:transatlantic',
      pts: [ll(50.037, 8.562), ll(40.641, -73.778)],
    },
    {
      id: 'route:air-leipzig-guangzhou',
      name: 'Air cargo — Leipzig → Guangzhou',
      mode: 'air',
      origin: 'node:air-lej',
      dest: 'node:air-can',
      utilization: 0.62,
      importance: 0.6,
      pts: [ll(51.42, 12.23), ll(23.392, 113.299)],
    },
    {
      id: 'route:air-chicago-toronto',
      name: 'Air cargo — Chicago → Toronto',
      mode: 'air',
      origin: 'node:air-ord',
      dest: 'node:air-yyz',
      utilization: 0.5,
      importance: 0.5,
      corridorId: 'corridor:na-great-lakes',
      pts: [ll(41.978, -87.904), ll(43.677, -79.63)],
    },
    {
      id: 'route:air-doha-london',
      name: 'Air cargo — Doha → London',
      mode: 'air',
      origin: 'node:air-doh',
      dest: 'node:consumption-london',
      utilization: 0.58,
      importance: 0.56,
      pts: [ll(25.273, 51.608), ll(51.51, -0.13)],
    },
    {
      id: 'route:air-memphis-louisville',
      name: 'Air cargo — Memphis → Louisville',
      mode: 'air',
      origin: 'node:air-mem',
      dest: 'node:air-sdf',
      utilization: 0.55,
      importance: 0.5,
      pts: [ll(35.042, -89.979), ll(38.174, -85.737)],
    },
  ];

  return specs.map(makeRoute);
}

// ------------------------------------------------------------------
// Events
// ------------------------------------------------------------------

function worldEvent(
  id: string,
  name: string,
  description: string,
  category: WorldEvent['category'],
  severity: number,
  start: string,
  end: string,
  affects: string[]
): WorldEvent {
  return {
    id,
    name,
    description,
    affects,
    severity,
    start,
    end,
    category,
    provenance: prov({ validFrom: start, validTo: end }),
  };
}

function buildEvents(): WorldEvent[] {
  return [
    worldEvent(
      'event:suez-convoy-congestion',
      'Suez convoy congestion',
      'Convoy scheduling backlog at the Suez Canal; northbound queue exceeding 40 vessels.',
      'congestion',
      0.7,
      '2026-09-01T00:00:00Z',
      '2026-09-04T00:00:00Z',
      ['route:sea-singapore-suez', 'route:sea-suez-rotterdam', 'route:sea-jebelali-suez', 'route:sea-piraeus-suez', 'node:choke-suez']
    ),
    worldEvent(
      'event:north-pacific-storm',
      'North Pacific storm track',
      'Deep low-pressure system across the great-circle lanes; vessels diverting south, schedules slipping.',
      'weather',
      0.6,
      '2026-08-26T00:00:00Z',
      '2026-08-29T12:00:00Z',
      ['route:sea-shanghai-la', 'route:sea-shenzhen-la', 'route:sea-busan-seattle', 'route:sea-shanghai-panama-ny']
    ),
    worldEvent(
      'event:ambassador-maintenance',
      'Ambassador Bridge maintenance',
      'Deck-joint maintenance closes two of four lanes at the Windsor–Detroit crossing.',
      'closure',
      0.5,
      '2026-09-01T06:00:00Z',
      '2026-09-02T18:00:00Z',
      ['route:road-toronto-detroit', 'node:border-windsor-detroit']
    ),
    worldEvent(
      'event:san-pedro-slowdown',
      'San Pedro Bay labor slowdown',
      'Work-to-rule action at LA/Long Beach terminals; vessel queue building at anchor.',
      'strike',
      0.65,
      '2026-08-19T00:00:00Z',
      '2026-08-24T00:00:00Z',
      ['node:port-la', 'node:port-long-beach', 'route:sea-shanghai-la', 'route:sea-shenzhen-la', 'route:road-la-inland-empire']
    ),
    worldEvent(
      'event:malaszewicze-backlog',
      'Landbridge customs backlog at Małaszewicze',
      'Gauge-break transshipment and customs inspections backing up China–Europe rail traffic.',
      'congestion',
      0.55,
      '2026-08-22T00:00:00Z',
      '2026-09-06T00:00:00Z',
      ['route:rail-chongqing-duisburg', 'node:rail-malaszewicze']
    ),
    worldEvent(
      'event:panama-draft-restrictions',
      'Panama draft restrictions',
      'Low Gatún Lake level holds maximum draft at 13.4 m; daily transit slots reduced. Restriction forecast to persist.',
      'weather',
      0.45,
      '2026-08-17T00:00:00Z',
      '2026-09-14T00:00:00Z',
      ['route:sea-valparaiso-panama-rotterdam', 'route:sea-shanghai-panama-ny', 'node:choke-panama']
    ),
    worldEvent(
      'event:scs-typhoon',
      'Typhoon approach — South China Sea',
      'Forecast typhoon track across the northern South China Sea; terminals pre-closing, lanes diverting.',
      'weather',
      0.75,
      '2026-09-05T00:00:00Z',
      '2026-09-07T12:00:00Z',
      ['route:sea-singapore-shanghai', 'route:sea-hongkong-singapore', 'route:sea-shenzhen-la', 'node:port-yantian', 'node:port-hongkong']
    ),
    worldEvent(
      'event:memphis-demand-surge',
      'Memphis air cargo demand surge',
      'Peak-season pull-forward loading the Memphis superhub above plan.',
      'demand_surge',
      0.5,
      '2026-09-08T00:00:00Z',
      '2026-09-11T00:00:00Z',
      ['node:air-mem', 'route:air-hkg-anc-mem', 'node:dc-memphis']
    ),
    worldEvent(
      'event:bosporus-fog',
      'Bosporus fog delays',
      'Dense morning fog suspends two-way transit through the Bosporus.',
      'weather',
      0.4,
      '2026-08-20T00:00:00Z',
      '2026-08-22T12:00:00Z',
      ['node:choke-bosporus']
    ),
  ];
}

// ------------------------------------------------------------------
// Flows
// ------------------------------------------------------------------

type Leg = [routeId: string, fromNodeId: string, toNodeId: string];

function makeFlow(
  routesById: Map<string, Route>,
  id: string,
  name: string,
  commodityId: string,
  intensity: number,
  status: Flow['status'],
  legs: Leg[]
): Flow {
  const segments: TransportSegment[] = legs.map(([routeId, fromNodeId, toNodeId], i) => {
    const r = routesById.get(routeId);
    return {
      id: `${id}:seg${i}`,
      routeId,
      mode: r ? r.mode : 'road',
      fromNodeId,
      toNodeId,
      sequence: i,
    };
  });
  return {
    id,
    name,
    commodityId,
    originId: legs[0][1],
    destinationId: legs[legs.length - 1][2],
    segments,
    intensity,
    status,
    provenance: prov(),
  };
}

function buildFlows(routesById: Map<string, Route>): Flow[] {
  const f = (
    id: string,
    name: string,
    commodityId: string,
    intensity: number,
    status: Flow['status'],
    legs: Leg[]
  ) => makeFlow(routesById, id, name, commodityId, intensity, status, legs);

  return [
    // THE demo flow — Follow the Load.
    {
      ...f('flow:ftl-toronto-chicago', 'Auto components — Toronto → Chicago', 'commodity:auto-parts', 0.8, 'moving', [
        ['route:road-toronto-detroit', 'node:dc-toronto', 'node:rail-detroit'],
        ['route:rail-detroit-chicago', 'node:rail-detroit', 'node:rail-chicago'],
        ['route:road-chicago-drayage', 'node:rail-chicago', 'node:dc-chicago'],
      ]),
      tags: ['demo:follow-the-load'],
    },
    f('flow:ironore-pilbara-baoshan', 'Iron ore — Pilbara → Baoshan', 'commodity:iron-ore', 0.9, 'moving', [
      ['route:rail-pilbara-port-hedland', 'node:mine-pilbara', 'node:port-port-hedland'],
      ['route:sea-porthedland-shanghai', 'node:port-port-hedland', 'node:port-shanghai'],
      ['route:road-shanghai-baoshan', 'node:port-shanghai', 'node:steel-baoshan'],
    ]),
    f('flow:copper-escondida-duisburg', 'Copper — Escondida → Duisburg', 'commodity:copper', 0.6, 'moving', [
      ['route:road-escondida-valparaiso', 'node:mine-escondida', 'node:port-valparaiso'],
      ['route:sea-valparaiso-panama-rotterdam', 'node:port-valparaiso', 'node:port-rotterdam'],
      ['route:rail-rotterdam-duisburg', 'node:port-rotterdam', 'node:rail-duisburg'],
    ]),
    f('flow:electronics-shenzhen-chicago', 'Electronics — Shenzhen → Chicago', 'commodity:electronics', 0.75, 'moving', [
      ['route:road-shenzhen-yantian', 'node:industry-shenzhen', 'node:port-yantian'],
      ['route:sea-shenzhen-la', 'node:port-yantian', 'node:port-la'],
      ['route:rail-chicago-la', 'node:port-la', 'node:rail-chicago'],
      ['route:road-chicago-drayage', 'node:rail-chicago', 'node:dc-chicago'],
    ]),
    f('flow:parcels-shenzhen-memphis', 'E-commerce parcels — Shenzhen → Memphis', 'commodity:parcels', 0.72, 'moving', [
      ['route:road-shenzhen-hkg', 'node:dc-shenzhen', 'node:air-hkg'],
      ['route:air-hkg-anc-mem', 'node:air-hkg', 'node:air-mem'],
      ['route:road-memphis-drayage', 'node:air-mem', 'node:dc-memphis'],
    ]),
    f('flow:crude-rastanura-singapore', 'Crude oil — Ras Tanura → Singapore', 'commodity:crude-oil', 0.85, 'moving', [
      ['route:sea-rastanura-singapore', 'node:port-ras-tanura', 'node:port-singapore'],
    ]),
    f('flow:grain-cornbelt-memphis', 'Corn Belt grain — Iowa → Memphis', 'commodity:grain', 0.55, 'moving', [
      ['route:road-cornbelt-chicago', 'node:agri-corn-belt', 'node:rail-chicago'],
      ['route:rail-chicago-memphis', 'node:rail-chicago', 'node:dc-memphis'],
    ]),
    f('flow:soy-matogrosso-rotterdam', 'Soybeans — Mato Grosso → Rotterdam', 'commodity:soy', 0.62, 'moving', [
      ['route:road-matogrosso-santos', 'node:agri-mato-grosso', 'node:port-santos'],
      ['route:sea-santos-rotterdam', 'node:port-santos', 'node:port-rotterdam'],
    ]),
    f('flow:machinery-duisburg-chongqing', 'Machinery — Duisburg → Chongqing (landbridge)', 'commodity:machinery', 0.5, 'delayed', [
      ['route:rail-chongqing-duisburg', 'node:rail-duisburg', 'node:rail-chongqing'],
    ]),
    f('flow:vehicles-wolfsburg-ny', 'Finished vehicles — Wolfsburg → New York', 'commodity:vehicles', 0.58, 'moving', [
      ['route:road-wolfsburg-hamburg', 'node:industry-wolfsburg', 'node:port-hamburg'],
      ['route:sea-hamburg-ny', 'node:port-hamburg', 'node:port-ny-nj'],
    ]),
    f('flow:electronics-singapore-rotterdam', 'Asia–Europe headhaul — Singapore → Rotterdam', 'commodity:electronics', 0.78, 'moving', [
      ['route:sea-singapore-suez', 'node:port-singapore', 'node:choke-suez'],
      ['route:sea-suez-rotterdam', 'node:choke-suez', 'node:port-rotterdam'],
    ]),
    f('flow:refined-rotterdam-ny', 'Refined products — Rotterdam → New York', 'commodity:refined-products', 0.48, 'moving', [
      ['route:sea-rotterdam-ny', 'node:port-rotterdam', 'node:port-ny-nj'],
    ]),
    f('flow:parcels-leipzig-guangzhou', 'Express freight — Leipzig → Guangzhou', 'commodity:parcels', 0.45, 'moving', [
      ['route:air-leipzig-guangzhou', 'node:air-lej', 'node:air-can'],
    ]),
    f('flow:electronics-busan-seattle', 'Electronics — Busan → Seattle-Tacoma', 'commodity:electronics', 0.56, 'moving', [
      ['route:sea-busan-seattle', 'node:port-busan', 'node:port-seattle-tacoma'],
    ]),
  ];
}

// ------------------------------------------------------------------
// Standing constraints (entity-attached, not route-inline)
// ------------------------------------------------------------------

function buildConstraints(): Constraint[] {
  const c = (
    id: string,
    entityId: string,
    type: Constraint['type'],
    description: string,
    severity: number,
    validFrom?: string,
    validTo?: string
  ): Constraint => ({ id, entityId, type, description, severity, provenance: prov(), validFrom, validTo });

  return [
    c('constraint:panama-draft', 'node:choke-panama', 'draft_limit', 'Gatún Lake low water: max draft 13.4 m, reduced daily transit slots.', 0.5, DATASET_START, DATASET_END),
    c('constraint:suez-convoy', 'node:choke-suez', 'capacity', 'Single-lane sections transit in scheduled convoys; slots are finite.', 0.45),
    c('constraint:hormuz-risk', 'node:choke-hormuz', 'regulatory', 'Transit advisories in effect; war-risk premiums elevated.', 0.5),
    c('constraint:malacca-density', 'node:choke-malacca', 'congestion', 'Highest-density shipping lane globally; TSS mandatory.', 0.4),
    c('constraint:bab-el-mandeb-security', 'node:choke-bab-el-mandeb', 'regulatory', 'Security corridor transit; escort advisories in effect.', 0.5),
    c('constraint:windsor-detroit-customs', 'node:border-windsor-detroit', 'border', 'Customs clearance at the busiest US–Canada trade crossing.', 0.4),
    c('constraint:malaszewicze-gauge', 'node:rail-malaszewicze', 'border', 'Standard/broad gauge break: every landbridge train transships here.', 0.55),
    c('constraint:san-pedro-gate', 'node:port-la', 'congestion', 'Terminal gate appointments constrained at peak; chassis pool tight.', 0.4),
  ];
}

// ------------------------------------------------------------------
// Assertions & observations — the promise / evidence split
// ------------------------------------------------------------------

interface TransitObsSpec {
  entityId: string;
  devMin: number;
  devMax: number;
  count: number;
}

function buildAssertionsAndObservations(
  routesById: Map<string, Route>
): { assertions: Assertion[]; observations: Observation[] } {
  const assertions: Assertion[] = [];
  const observations: Observation[] = [];
  const ASSERTED_AT = '2026-08-01T00:00:00Z';
  const rangeMs = END_MS - START_MS;

  const addObs = (entityId: string, metric: string, base: number, devMin: number, devMax: number, count: number, unit: string) => {
    for (let i = 0; i < count; i++) {
      const t = new Date(START_MS + Math.round(((i + 1) / (count + 1)) * rangeMs)).toISOString();
      const u = hashUnit(fnv1a(`${entityId}:${metric}:obs:${i}`));
      const value = round1(base * (1 + devMin + (devMax - devMin) * u));
      observations.push({
        id: `obs:${entityId}:${metric}:${i}`,
        entityId,
        t,
        metric,
        value,
        unit,
        provenance: prov({ evidence: [`synthetic-transit-log:${i}`], confidence: 0.85 }),
      });
    }
  };

  // Transit-time promises for key routes, tested by observed transits.
  const transitSpecs: TransitObsSpec[] = [
    { entityId: 'route:sea-shanghai-la', devMin: 0.04, devMax: 0.12, count: 6 },
    { entityId: 'route:sea-shenzhen-la', devMin: 0.04, devMax: 0.12, count: 5 },
    { entityId: 'route:sea-singapore-suez', devMin: 0.04, devMax: 0.12, count: 5 },
    { entityId: 'route:sea-suez-rotterdam', devMin: 0.04, devMax: 0.12, count: 5 },
    { entityId: 'route:sea-rotterdam-ny', devMin: 0.03, devMax: 0.1, count: 4 },
    { entityId: 'route:rail-chongqing-duisburg', devMin: 0.1, devMax: 0.25, count: 5 },
    { entityId: 'route:road-toronto-detroit', devMin: -0.05, devMax: 0.3, count: 6 },
    { entityId: 'route:rail-detroit-chicago', devMin: 0.02, devMax: 0.15, count: 5 },
  ];
  for (const s of transitSpecs) {
    const r = routesById.get(s.entityId);
    if (!r) continue;
    assertions.push({
      id: `assert:${s.entityId}:transit`,
      entityId: s.entityId,
      metric: 'transit_hours',
      value: r.estimatedDurationHours,
      unit: 'h',
      assertedAt: ASSERTED_AT,
      provenance: prov({ knownAt: ASSERTED_AT, validFrom: DATASET_START, validTo: DATASET_END }),
    });
    addObs(s.entityId, 'transit_hours', r.estimatedDurationHours, s.devMin, s.devMax, s.count, 'h');
  }

  // Dwell-time promises for two key ports.
  const dwellSpecs = [
    { entityId: 'node:port-la', value: 84, devMin: 0.05, devMax: 0.45, count: 5 },
    { entityId: 'node:port-rotterdam', value: 42, devMin: -0.05, devMax: 0.2, count: 5 },
  ];
  for (const s of dwellSpecs) {
    assertions.push({
      id: `assert:${s.entityId}:dwell`,
      entityId: s.entityId,
      metric: 'dwell_hours',
      value: s.value,
      unit: 'h',
      assertedAt: ASSERTED_AT,
      provenance: prov({ knownAt: ASSERTED_AT, validFrom: DATASET_START, validTo: DATASET_END }),
    });
    addObs(s.entityId, 'dwell_hours', s.value, s.devMin, s.devMax, s.count, 'h');
  }

  return { assertions, observations };
}

// ------------------------------------------------------------------
// City lights — night-side texture points [lon, lat, intensity]
// ------------------------------------------------------------------

type LightPoint = [number, number, number];

/** Single metro light, authored as (lat, lon, intensity). */
function metro(lat: number, lon: number, intensity: number): LightPoint {
  return [lon, lat, intensity];
}

/**
 * Interpolate `count` points along an urbanized corridor polyline with
 * small hash-derived jitter and intensity variation.
 */
function corridorLights(key: string, anchors: Array<[number, number]>, count: number, intensity: number): LightPoint[] {
  const pts: LonLat[] = anchors.map(([lat, lon]) => ll(lat, lon));
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineKm(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const out: LightPoint[] = [];
  for (let i = 0; i < count; i++) {
    const target = (i / Math.max(1, count - 1)) * total;
    let seg = 1;
    while (seg < cum.length - 1 && cum[seg] < target) seg++;
    const span = cum[seg] - cum[seg - 1] || 1;
    const u = (target - cum[seg - 1]) / span;
    const lon = pts[seg - 1][0] + (pts[seg][0] - pts[seg - 1][0]) * u;
    const lat = pts[seg - 1][1] + (pts[seg][1] - pts[seg - 1][1]) * u;
    const j1 = hashUnit(fnv1a(`${key}:${i}:a`)) - 0.5;
    const j2 = hashUnit(fnv1a(`${key}:${i}:b`)) - 0.5;
    const j3 = hashUnit(fnv1a(`${key}:${i}:c`));
    out.push([
      Math.round((lon + j1 * 0.16) * 100) / 100,
      Math.round((lat + j2 * 0.16) * 100) / 100,
      Math.round(intensity * (0.55 + 0.45 * j3) * 100) / 100,
    ]);
  }
  return out;
}

function buildCityLights(): LightPoint[] {
  const lights: LightPoint[] = [
    // --- North America
    metro(40.71, -74.01, 1.0), // New York
    metro(34.05, -118.24, 0.95), // Los Angeles
    metro(41.88, -87.63, 0.9), // Chicago
    metro(29.76, -95.37, 0.82), // Houston
    metro(32.78, -96.8, 0.8), // Dallas
    metro(25.77, -80.19, 0.8), // Miami
    metro(33.75, -84.39, 0.8), // Atlanta
    metro(33.45, -112.07, 0.72), // Phoenix
    metro(39.74, -104.99, 0.72), // Denver
    metro(44.98, -93.27, 0.7), // Minneapolis
    metro(38.63, -90.2, 0.65), // St. Louis
    metro(47.61, -122.33, 0.78), // Seattle
    metro(45.52, -122.68, 0.65), // Portland
    metro(37.77, -122.42, 0.85), // San Francisco
    metro(36.17, -115.14, 0.7), // Las Vegas
    metro(40.76, -111.89, 0.6), // Salt Lake City
    metro(39.1, -94.58, 0.62), // Kansas City
    metro(36.16, -86.78, 0.62), // Nashville
    metro(35.23, -80.84, 0.62), // Charlotte
    metro(28.54, -81.38, 0.65), // Orlando
    metro(27.95, -82.46, 0.62), // Tampa
    metro(43.65, -79.38, 0.85), // Toronto
    metro(45.5, -73.57, 0.75), // Montreal
    metro(49.28, -123.12, 0.72), // Vancouver
    metro(51.05, -114.07, 0.6), // Calgary
    metro(45.42, -75.7, 0.55), // Ottawa
    metro(19.43, -99.13, 0.85), // Mexico City
    metro(20.67, -103.35, 0.65), // Guadalajara
    metro(25.69, -100.32, 0.68), // Monterrey
    // --- South America
    metro(4.71, -74.07, 0.7), // Bogotá
    metro(6.24, -75.58, 0.55), // Medellín
    metro(-12.05, -77.04, 0.7), // Lima
    metro(-33.45, -70.67, 0.72), // Santiago
    metro(10.49, -66.88, 0.5), // Caracas
    metro(-0.18, -78.47, 0.45), // Quito
    metro(-15.79, -47.88, 0.6), // Brasília
    metro(-19.92, -43.94, 0.6), // Belo Horizonte
    metro(-12.97, -38.5, 0.55), // Salvador
    metro(-3.72, -38.54, 0.55), // Fortaleza
    metro(-8.05, -34.9, 0.55), // Recife
    metro(-30.03, -51.22, 0.55), // Porto Alegre
    metro(-34.9, -56.16, 0.5), // Montevideo
    // --- Europe
    metro(51.51, -0.13, 0.92), // London
    metro(48.86, 2.35, 0.95), // Paris
    metro(40.42, -3.7, 0.8), // Madrid
    metro(41.39, 2.17, 0.78), // Barcelona
    metro(38.72, -9.14, 0.62), // Lisbon
    metro(41.9, 12.5, 0.8), // Rome
    metro(40.85, 14.27, 0.65), // Naples
    metro(52.52, 13.4, 0.85), // Berlin
    metro(48.14, 11.58, 0.78), // Munich
    metro(53.55, 9.99, 0.75), // Hamburg
    metro(48.21, 16.37, 0.72), // Vienna
    metro(47.38, 8.54, 0.68), // Zurich
    metro(52.23, 21.01, 0.7), // Warsaw
    metro(50.08, 14.44, 0.68), // Prague
    metro(47.5, 19.04, 0.65), // Budapest
    metro(44.43, 26.1, 0.6), // Bucharest
    metro(37.98, 23.73, 0.65), // Athens
    metro(59.33, 18.07, 0.68), // Stockholm
    metro(59.91, 10.75, 0.6), // Oslo
    metro(55.68, 12.57, 0.68), // Copenhagen
    metro(60.17, 24.94, 0.58), // Helsinki
    metro(53.35, -6.26, 0.6), // Dublin
    metro(50.45, 30.52, 0.6), // Kyiv
    metro(55.76, 37.62, 0.85), // Moscow
    metro(59.93, 30.34, 0.7), // St. Petersburg
    metro(41.01, 28.98, 0.85), // Istanbul
    // --- Middle East & Africa
    metro(32.08, 34.78, 0.62), // Tel Aviv
    metro(24.71, 46.68, 0.72), // Riyadh
    metro(21.49, 39.19, 0.62), // Jeddah
    metro(35.69, 51.39, 0.72), // Tehran
    metro(33.31, 44.37, 0.55), // Baghdad
    metro(6.52, 3.38, 0.7), // Lagos
    metro(5.6, -0.19, 0.5), // Accra
    metro(5.36, -4.01, 0.5), // Abidjan
    metro(14.72, -17.47, 0.45), // Dakar
    metro(33.57, -7.59, 0.55), // Casablanca
    metro(36.75, 3.06, 0.55), // Algiers
    metro(36.81, 10.18, 0.5), // Tunis
    metro(15.5, 32.56, 0.45), // Khartoum
    metro(9.03, 38.74, 0.5), // Addis Ababa
    metro(-1.29, 36.82, 0.55), // Nairobi
    metro(-6.79, 39.28, 0.45), // Dar es Salaam
    metro(-4.44, 15.27, 0.55), // Kinshasa
    metro(-8.84, 13.23, 0.5), // Luanda
    metro(-26.2, 28.05, 0.7), // Johannesburg
    metro(-33.92, 18.42, 0.6), // Cape Town
    metro(-29.86, 31.02, 0.5), // Durban
    // --- Asia
    metro(19.08, 72.88, 0.88), // Mumbai
    metro(12.97, 77.59, 0.75), // Bangalore
    metro(13.08, 80.27, 0.7), // Chennai
    metro(17.39, 78.49, 0.7), // Hyderabad
    metro(23.02, 72.57, 0.65), // Ahmedabad
    metro(18.52, 73.86, 0.62), // Pune
    metro(24.86, 67.01, 0.75), // Karachi
    metro(31.55, 74.34, 0.7), // Lahore
    metro(23.81, 90.41, 0.75), // Dhaka
    metro(6.93, 79.85, 0.5), // Colombo
    metro(13.76, 100.5, 0.85), // Bangkok
    metro(10.82, 106.63, 0.78), // Ho Chi Minh City
    metro(21.03, 105.85, 0.68), // Hanoi
    metro(14.6, 120.98, 0.8), // Manila
    metro(1.29, 103.85, 0.85), // Singapore
    metro(3.14, 101.69, 0.72), // Kuala Lumpur
    metro(16.87, 96.2, 0.5), // Yangon
    metro(25.03, 121.57, 0.8), // Taipei
    metro(22.62, 120.31, 0.62), // Kaohsiung
    metro(30.57, 104.07, 0.8), // Chengdu
    metro(29.56, 106.55, 0.8), // Chongqing
    metro(30.59, 114.31, 0.78), // Wuhan
    metro(34.34, 108.94, 0.72), // Xi'an
    metro(34.75, 113.62, 0.7), // Zhengzhou
    metro(28.23, 112.94, 0.68), // Changsha
    metro(41.81, 123.43, 0.68), // Shenyang
    metro(45.8, 126.53, 0.62), // Harbin
    metro(25.04, 102.72, 0.58), // Kunming
    metro(43.83, 87.62, 0.5), // Ürümqi
    metro(43.06, 141.35, 0.62), // Sapporo
    metro(38.27, 140.87, 0.58), // Sendai
    metro(43.26, 76.93, 0.5), // Almaty
    metro(41.3, 69.24, 0.5), // Tashkent
    metro(55.03, 82.92, 0.5), // Novosibirsk
    metro(56.84, 60.65, 0.52), // Yekaterinburg
    // --- Oceania
    metro(-33.87, 151.21, 0.78), // Sydney
    metro(-37.81, 144.96, 0.78), // Melbourne
    metro(-27.47, 153.03, 0.68), // Brisbane
    metro(-31.95, 115.86, 0.62), // Perth
    metro(-34.93, 138.6, 0.55), // Adelaide
    metro(-36.85, 174.76, 0.58), // Auckland
  ];

  // Urbanized corridors — clustered filler tracing real conurbations.
  lights.push(
    ...corridorLights('us-northeast', [[42.36, -71.06], [41.82, -71.41], [41.76, -72.68], [41.31, -72.92], [40.71, -74.01], [40.22, -74.74], [39.95, -75.17], [39.29, -76.61], [38.91, -77.04]], 12, 0.85),
    ...corridorLights('great-lakes', [[43.04, -87.91], [41.88, -87.63], [41.6, -87.34], [41.68, -86.25], [42.29, -85.59], [42.33, -83.05], [41.65, -83.54], [41.5, -81.69], [42.13, -80.09], [42.89, -78.88], [43.26, -79.87], [43.65, -79.38]], 14, 0.7),
    ...corridorLights('california', [[32.72, -117.16], [33.19, -117.38], [34.05, -118.24], [34.2, -119.18], [35.28, -120.66], [36.68, -121.66], [37.34, -121.89], [37.77, -122.42], [38.58, -121.49]], 12, 0.75),
    ...corridorLights('texas-triangle', [[29.76, -95.37], [30.27, -97.74], [29.42, -98.49], [31.55, -97.15], [32.78, -96.8], [32.75, -97.33]], 8, 0.65),
    ...corridorLights('rhine-benelux', [[52.37, 4.9], [52.09, 5.12], [51.92, 4.48], [51.22, 4.4], [50.85, 4.35], [50.63, 5.57], [50.94, 6.96], [51.23, 6.77], [51.43, 6.76], [51.46, 7.01], [51.51, 7.47], [50.11, 8.68]], 14, 0.75),
    ...corridorLights('po-valley', [[45.07, 7.69], [45.45, 8.62], [45.46, 9.19], [45.54, 10.22], [45.44, 10.99], [45.55, 11.55], [45.41, 11.88], [44.49, 11.34]], 8, 0.65),
    ...corridorLights('uk-axis', [[51.51, -0.13], [52.04, -0.76], [52.49, -1.89], [53.0, -2.18], [53.48, -2.24], [53.8, -1.55]], 8, 0.7),
    ...corridorLights('tokaido', [[35.68, 139.77], [35.44, 139.64], [34.98, 138.38], [34.72, 137.73], [35.18, 136.91], [35.01, 135.77], [34.69, 135.5], [34.69, 135.2], [34.65, 133.92], [34.39, 132.46], [33.59, 130.4]], 12, 0.85),
    ...corridorLights('seoul-busan', [[37.57, 126.98], [37.26, 127.03], [36.8, 127.15], [36.35, 127.38], [35.87, 128.6], [35.54, 129.31], [35.18, 129.08]], 8, 0.8),
    ...corridorLights('bohai', [[39.63, 118.18], [39.13, 117.2], [39.9, 116.41], [38.04, 114.51], [36.65, 117.0], [36.07, 120.38]], 10, 0.78),
    ...corridorLights('yangtze-delta', [[32.06, 118.8], [31.81, 119.97], [31.49, 120.31], [31.3, 120.62], [31.23, 121.47], [30.27, 120.16], [29.87, 121.54]], 12, 0.82),
    ...corridorLights('pearl-delta', [[23.02, 113.12], [23.13, 113.26], [23.02, 113.75], [22.54, 114.06], [22.32, 114.17]], 10, 0.82),
    ...corridorLights('ganges', [[28.61, 77.21], [27.18, 78.01], [26.45, 80.33], [25.44, 81.85], [25.32, 82.99], [25.59, 85.14], [24.1, 87.0], [22.57, 88.36]], 12, 0.72),
    ...corridorLights('nile-delta', [[30.04, 31.24], [30.79, 31.0], [31.04, 30.47], [31.2, 29.92]], 6, 0.7),
    ...corridorLights('java', [[-6.21, 106.85], [-6.92, 107.61], [-6.71, 108.56], [-6.97, 110.42], [-7.57, 110.82], [-7.26, 112.75]], 10, 0.68),
    ...corridorLights('sp-rio', [[-22.91, -47.06], [-23.55, -46.63], [-23.19, -45.88], [-23.03, -45.56], [-22.52, -44.1], [-22.91, -43.17]], 8, 0.72),
    ...corridorLights('rio-plata', [[-32.95, -60.65], [-34.6, -58.38], [-34.92, -57.95]], 5, 0.62),
    ...corridorLights('gulf-coast', [[27.8, -97.4], [29.76, -95.37], [30.08, -94.1], [30.23, -93.22], [30.45, -91.19], [29.95, -90.07], [30.69, -88.04]], 8, 0.6),
    ...corridorLights('persian-gulf', [[29.38, 47.99], [27.0, 49.66], [26.43, 50.1], [26.22, 50.58], [25.29, 51.53], [24.45, 54.38], [25.2, 55.27], [25.35, 55.42]], 8, 0.68)
  );

  // Deduplicate on a 0.05-degree grid, clamp intensity to 0..1.
  const seen = new Set<string>();
  const out: LightPoint[] = [];
  for (const [lon, lat, i] of lights) {
    const key = `${Math.round(lon * 20)}:${Math.round(lat * 20)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([lon, lat, Math.min(1, Math.max(0, i))]);
  }
  return out;
}

// ------------------------------------------------------------------
// Integrity self-check — cheap insurance, runs in the validator
// ------------------------------------------------------------------

function assertIntegrity(snap: WorldSnapshot): void {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  const routeIds = new Set<string>();
  const commodityIds = new Set(snap.commodities.map((c) => c.id));
  const flowIds = new Set<string>();

  for (const n of snap.nodes) {
    if (nodeIds.has(n.id)) errors.push(`duplicate node id ${n.id}`);
    nodeIds.add(n.id);
  }
  for (const r of snap.routes) {
    if (routeIds.has(r.id)) errors.push(`duplicate route id ${r.id}`);
    routeIds.add(r.id);
    if (!nodeIds.has(r.originId)) errors.push(`${r.id}: dangling originId ${r.originId}`);
    if (!nodeIds.has(r.destinationId)) errors.push(`${r.id}: dangling destinationId ${r.destinationId}`);
    if (r.geometry.coordinates.length < 2) errors.push(`${r.id}: degenerate geometry`);
  }
  for (const f of snap.flows) {
    if (flowIds.has(f.id)) errors.push(`duplicate flow id ${f.id}`);
    flowIds.add(f.id);
    if (!commodityIds.has(f.commodityId)) errors.push(`${f.id}: dangling commodityId ${f.commodityId}`);
    if (!nodeIds.has(f.originId)) errors.push(`${f.id}: dangling originId ${f.originId}`);
    if (!nodeIds.has(f.destinationId)) errors.push(`${f.id}: dangling destinationId ${f.destinationId}`);
    for (const s of f.segments) {
      if (!routeIds.has(s.routeId)) errors.push(`${f.id}/${s.id}: dangling routeId ${s.routeId}`);
      if (!nodeIds.has(s.fromNodeId)) errors.push(`${f.id}/${s.id}: dangling fromNodeId ${s.fromNodeId}`);
      if (!nodeIds.has(s.toNodeId)) errors.push(`${f.id}/${s.id}: dangling toNodeId ${s.toNodeId}`);
    }
  }
  const entityIds = new Set([...nodeIds, ...routeIds, ...flowIds]);
  for (const e of snap.events)
    for (const a of e.affects) if (!entityIds.has(a)) errors.push(`${e.id}: dangling affects ${a}`);
  for (const c of snap.constraints)
    if (!entityIds.has(c.entityId)) errors.push(`${c.id}: dangling entityId ${c.entityId}`);
  for (const a of snap.assertions)
    if (!entityIds.has(a.entityId)) errors.push(`${a.id}: dangling entityId ${a.entityId}`);
  for (const o of snap.observations)
    if (!entityIds.has(o.entityId)) errors.push(`${o.id}: dangling entityId ${o.entityId}`);
  for (const n of snap.nodes)
    for (const rid of n.connectedRouteIds ?? [])
      if (!routeIds.has(rid)) errors.push(`${n.id}: dangling connectedRouteId ${rid}`);

  if (errors.length) {
    throw new Error(`synthetic world integrity check failed:\n  ${errors.join('\n  ')}`);
  }
}

// ------------------------------------------------------------------
// Snapshot assembly (built once, cached)
// ------------------------------------------------------------------

let cached: WorldSnapshot | null = null;

export function buildWorldSnapshot(): WorldSnapshot {
  if (cached) return cached;

  const commodities = buildCommodities();
  const nodes = buildNodes();
  const routes = buildRoutes();
  const events = buildEvents();

  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const routesById = new Map(routes.map((r) => [r.id, r]));

  // Wire facility connectivity from route endpoints.
  for (const r of routes) {
    for (const nid of [r.originId, r.destinationId]) {
      const n = nodesById.get(nid);
      if (n && n.connectedRouteIds && !n.connectedRouteIds.includes(r.id)) {
        n.connectedRouteIds.push(r.id);
      }
    }
  }

  // Precompute the temporal spine with the SAME resolver the provider
  // uses live: one sample every 12 h across the dataset range.
  const stepMs = 12 * 3_600_000;
  for (const r of routes) {
    const samples: RouteStateSample[] = [];
    for (let ms = START_MS; ms <= END_MS; ms += stepMs) {
      const st = resolveEntityState(r.id, r.utilization, r.status, new Date(ms).toISOString(), events);
      samples.push({ t: st.t, utilization: st.utilization, congestion: st.congestion, status: st.status });
    }
    r.historicalState = samples;
  }

  const flows = buildFlows(routesById);
  const constraints = buildConstraints();
  const { assertions, observations } = buildAssertionsAndObservations(routesById);
  const cityLights = buildCityLights();

  const snap: WorldSnapshot = {
    nodes,
    routes,
    flows,
    commodities,
    events,
    constraints,
    assertions,
    observations,
    cityLights,
    timeRange: { start: DATASET_START, end: DATASET_END, now: DATASET_NOW },
    meta: {
      label: 'Synthetic demo world v1',
      disclaimer: 'SYNTHETIC / DEMO DATA — no real shipments represented',
      generatedAt: DATASET_NOW,
    },
  };

  assertIntegrity(snap);
  cached = snap;
  return snap;
}
