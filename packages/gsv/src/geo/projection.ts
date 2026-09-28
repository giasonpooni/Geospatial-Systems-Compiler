/**
 * Spherical geo math. Earth radius is 1 scene unit.
 * Conventions match THREE.SphereGeometry default UVs:
 *   lon   0° → +X,   lon  90°E → −Z,   north → +Y
 * so an equirectangular canvas texture maps correctly.
 */

import * as THREE from 'three';
import type { LonLat } from '../data/contracts';

export const EARTH_RADIUS = 1;
export const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;

export function latLonToVec3(
  lat: number,
  lon: number,
  radius = EARTH_RADIUS,
  target = new THREE.Vector3()
): THREE.Vector3 {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const c = Math.cos(phi);
  return target.set(
    radius * c * Math.cos(lambda),
    radius * Math.sin(phi),
    -radius * c * Math.sin(lambda)
  );
}

export function vec3ToLatLon(v: THREE.Vector3): { lat: number; lon: number } {
  const r = v.length();
  const lat = Math.asin(THREE.MathUtils.clamp(v.y / r, -1, 1)) / DEG;
  const lon = Math.atan2(-v.z, v.x) / DEG;
  return { lat, lon };
}

/** Great-circle angular distance (radians) between two lon/lat points. */
export function angularDistance(a: LonLat, b: LonLat): number {
  const va = latLonToVec3(a[1], a[0], 1, _va);
  const vb = latLonToVec3(b[1], b[0], 1, _vb);
  return va.angleTo(vb);
}
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();

export function greatCircleKm(a: LonLat, b: LonLat): number {
  return angularDistance(a, b) * EARTH_RADIUS_KM;
}

/**
 * Spherical linear interpolation between two surface points, at radius r.
 */
export function slerpSurface(
  a: THREE.Vector3,
  b: THREE.Vector3,
  t: number,
  r: number,
  target = new THREE.Vector3()
): THREE.Vector3 {
  target.copy(a).normalize();
  _tmp.copy(b).normalize();
  const omega = Math.acos(THREE.MathUtils.clamp(target.dot(_tmp), -1, 1));
  if (omega < 1e-6) return target.multiplyScalar(r);
  const so = Math.sin(omega);
  const f0 = Math.sin((1 - t) * omega) / so;
  const f1 = Math.sin(t * omega) / so;
  target.multiplyScalar(f0).addScaledVector(_tmp, f1).normalize().multiplyScalar(r);
  return target;
}
const _tmp = new THREE.Vector3();

export interface SampledPath {
  /** Evenly re-sampled points (arc-length parameterized, on-sphere + altitude). */
  points: THREE.Vector3[];
  /** Cumulative normalized arc length per point, 0..1. */
  u: number[];
  totalAngle: number; // radians of great-circle length along the path
  lengthKm: number;
}

/**
 * Sample a lon/lat polyline into a smooth 3D path hugging the sphere.
 *
 * - Consecutive waypoints are joined by great-circle arcs.
 * - `altitude(u)` lifts the path above the surface (0 = surface).
 * - Result is arc-length re-parameterized so animation speed is uniform.
 */
export function samplePath(
  coords: LonLat[],
  opts: {
    samples?: number;
    baseRadius?: number;
    altitude?: (u: number) => number;
    smooth?: boolean;
  } = {}
): SampledPath {
  const samples = opts.samples ?? 128;
  const baseRadius = opts.baseRadius ?? EARTH_RADIUS;
  const altitude = opts.altitude ?? (() => 0);

  // 1. waypoints on unit sphere (degenerate single-point paths are padded
  // so the arc-length machinery below always has a segment to walk)
  let unit = coords.map((c) => latLonToVec3(c[1], c[0], 1));
  if (unit.length === 1) unit = [unit[0], unit[0].clone()];

  // 2. optional Catmull-Rom smoothing through waypoints (re-normalized)
  if (opts.smooth && unit.length > 2) {
    const curve = new THREE.CatmullRomCurve3(unit, false, 'centripetal', 0.5);
    const n = Math.max(unit.length * 6, 48);
    unit = curve.getPoints(n).map((p) => p.normalize());
  }

  // 3. dense great-circle sampling between consecutive points
  const dense: THREE.Vector3[] = [];
  const angles: number[] = [0];
  let total = 0;
  for (let i = 0; i < unit.length - 1; i++) {
    const a = unit[i];
    const b = unit[i + 1];
    const omega = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
    const steps = Math.max(1, Math.ceil((omega / Math.PI) * 96));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      dense.push(slerpSurface(a, b, t, 1));
    }
    total += omega;
  }
  dense.push(unit[unit.length - 1].clone());

  // cumulative angles over dense points
  let acc = 0;
  const cum: number[] = [0];
  for (let i = 1; i < dense.length; i++) {
    acc += dense[i - 1].angleTo(dense[i]);
    cum.push(acc);
  }
  const totalAngle = Math.max(acc, 1e-9);

  // 4. arc-length re-parameterized resample + altitude profile
  const points: THREE.Vector3[] = [];
  const u: number[] = [];
  let cursor = 0;
  for (let i = 0; i < samples; i++) {
    const f = i / (samples - 1);
    const targetAngle = f * totalAngle;
    while (cursor < cum.length - 2 && cum[cursor + 1] < targetAngle) cursor++;
    const segSpan = Math.max(cum[cursor + 1] - cum[cursor], 1e-12);
    const lt = (targetAngle - cum[cursor]) / segSpan;
    const p = slerpSurface(dense[cursor], dense[cursor + 1], lt, 1);
    const r = baseRadius + altitude(f);
    points.push(p.multiplyScalar(r));
    u.push(f);
  }

  return { points, u, totalAngle, lengthKm: totalAngle * EARTH_RADIUS_KM };
}

/** Standard air-route altitude profile: sine bump scaled by arc length. */
export function airAltitudeProfile(totalAngle: number): (u: number) => number {
  const peak = THREE.MathUtils.clamp(totalAngle * 0.18, 0.012, 0.11);
  return (u: number) => Math.sin(u * Math.PI) * peak;
}
