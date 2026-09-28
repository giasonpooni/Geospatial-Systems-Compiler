/**
 * Country topology: Natural Earth 110m via world-atlas (TopoJSON).
 * Provides border line geometry, country picking (point-in-polygon on
 * lon/lat), and selection outlines. Geometry source: Natural Earth —
 * public domain; provenance is carried in the UI evidence sections.
 */

import * as THREE from 'three';
import { feature, mesh } from 'topojson-client';
import { latLonToVec3 } from './projection';
import type { LonLat } from '../data/contracts';

export interface CountryPolygon {
  outer: LonLat[];
  holes: LonLat[][];
  bbox: [number, number, number, number]; // west south east north
}

export interface Country {
  id: number;
  name: string;
  iso2: string | null;
  polygons: CountryPolygon[];
}

/** ISO 3166-1 numeric → alpha-2 for countries the corpus references. */
const N3_TO_A2: Record<number, string> = {
  840: 'US', 124: 'CA', 156: 'CN', 702: 'SG', 528: 'NL', 276: 'DE', 36: 'AU',
  152: 'CL', 76: 'BR', 804: 'UA', 682: 'SA', 784: 'AE', 356: 'IN', 392: 'JP',
  410: 'KR', 826: 'GB', 250: 'FR', 616: 'PL', 112: 'BY', 398: 'KZ', 643: 'RU',
  180: 'CD', 484: 'MX', 818: 'EG', 792: 'TR', 591: 'PA', 634: 'QA', 724: 'ES',
  380: 'IT', 56: 'BE', 756: 'CH', 40: 'AT', 203: 'CZ', 752: 'SE', 578: 'NO',
  208: 'DK', 246: 'FI', 620: 'PT', 372: 'IE', 300: 'GR', 504: 'MA', 12: 'DZ',
  566: 'NG', 710: 'ZA', 404: 'KE', 231: 'ET', 764: 'TH', 704: 'VN', 458: 'MY',
  360: 'ID', 608: 'PH', 158: 'TW', 364: 'IR', 368: 'IQ', 376: 'IL', 400: 'JO',
  512: 'OM', 887: 'YE', 586: 'PK', 50: 'BD', 144: 'LK', 104: 'MM', 116: 'KH',
  418: 'LA', 496: 'MN', 860: 'UZ', 795: 'TM', 4: 'AF', 32: 'AR', 604: 'PE',
  170: 'CO', 862: 'VE', 218: 'EC', 68: 'BO', 600: 'PY', 858: 'UY', 554: 'NZ',
  598: 'PG', 320: 'GT', 188: 'CR', 214: 'DO', 192: 'CU', 388: 'JM',
};

export class Countries {
  countries: Country[] = [];
  private topology: any;

  static async load(url: string): Promise<Countries> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`countries topology fetch failed: ${res.status}`);
    const topo = await res.json();
    const c = new Countries();
    c.topology = topo;
    const fc = feature(topo, topo.objects.countries) as any;
    for (const f of fc.features) {
      const id = parseInt(String(f.id), 10);
      const polygons: CountryPolygon[] = [];
      const polys =
        f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const rings of polys) {
        if (!rings.length) continue;
        const outer = rings[0] as LonLat[];
        let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
        for (const [lon, lat] of outer) {
          if (lon < w) w = lon;
          if (lon > e) e = lon;
          if (lat < s) s = lat;
          if (lat > n) n = lat;
        }
        polygons.push({ outer, holes: rings.slice(1) as LonLat[][], bbox: [w, s, e, n] });
      }
      c.countries.push({
        id,
        name: f.properties?.name ?? `#${id}`,
        iso2: N3_TO_A2[id] ?? null,
        polygons,
      });
    }
    return c;
  }

  byIso2(code: string): Country | undefined {
    return this.countries.find((c) => c.iso2 === code);
  }

  /** All country borders + coastlines as one LineSegments object. */
  buildBorders(radius = 1.0015, color = 0x3a556e, opacity = 0.55): THREE.LineSegments {
    const ml = mesh(this.topology, this.topology.objects.countries) as any;
    const positions: number[] = [];
    const v = new THREE.Vector3();
    for (const line of ml.coordinates as LonLat[][]) {
      for (let i = 0; i < line.length - 1; i++) {
        latLonToVec3(line[i][1], line[i][0], radius, v);
        positions.push(v.x, v.y, v.z);
        latLonToVec3(line[i + 1][1], line[i + 1][0], radius, v);
        positions.push(v.x, v.y, v.z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const obj = new THREE.LineSegments(geo, mat);
    obj.renderOrder = 2;
    return obj;
  }

  /** Bright outline of one country, used for selection highlight. */
  buildOutline(country: Country, radius = 1.003, color = 0x4da6ff): THREE.Object3D {
    const group = new THREE.Group();
    const v = new THREE.Vector3();
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (const poly of country.polygons) {
      for (const ring of [poly.outer, ...poly.holes]) {
        const positions: number[] = [];
        for (const [lon, lat] of ring) {
          latLonToVec3(lat, lon, radius, v);
          positions.push(v.x, v.y, v.z);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const line = new THREE.LineLoop(geo, mat);
        line.renderOrder = 3;
        group.add(line);
      }
    }
    return group;
  }

  /**
   * Point-in-polygon country pick from a lat/lon. Even-odd ray cast in
   * lon/lat space with a bbox prefilter (Natural Earth polygons are
   * pre-split at the antimeridian, so no wraparound handling needed).
   */
  pickAt(lat: number, lon: number): Country | null {
    for (const c of this.countries) {
      for (const poly of c.polygons) {
        const [w, s, e, n] = poly.bbox;
        if (lon < w || lon > e || lat < s || lat > n) continue;
        if (!pointInRing(lon, lat, poly.outer)) continue;
        let inHole = false;
        for (const hole of poly.holes) {
          if (pointInRing(lon, lat, hole)) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return c;
      }
    }
    return null;
  }

  /** Rough centroid of the largest polygon (vector mean, normalized). */
  centroidOf(country: Country): { lat: number; lon: number } {
    let best: CountryPolygon = country.polygons[0];
    let bestArea = -1;
    for (const p of country.polygons) {
      const [w, s, e, n] = p.bbox;
      const a = Math.abs((e - w) * (n - s));
      if (a > bestArea) {
        bestArea = a;
        best = p;
      }
    }
    // Vector mean on the sphere (correct across the antimeridian, unlike
    // averaging lon/lat). A geodesic median would be the outlier-robust
    // upgrade if centroids ever drive analytics rather than camera targets.
    const sum = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (const [lon, lat] of best.outer) sum.add(latLonToVec3(lat, lon, 1, v));
    sum.normalize();
    const lat = (Math.asin(THREE.MathUtils.clamp(sum.y, -1, 1)) * 180) / Math.PI;
    const lon = (Math.atan2(-sum.z, sum.x) * 180) / Math.PI;
    return { lat, lon };
  }
}

function pointInRing(x: number, y: number, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1],
      xj = ring[j][0],
      yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
