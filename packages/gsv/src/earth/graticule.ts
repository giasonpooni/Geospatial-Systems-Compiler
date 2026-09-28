/**
 * Faint 15° graticule — the technical-instrument grid layer.
 */

import * as THREE from 'three';
import { latLonToVec3 } from '../geo/projection';

export function createGraticule(radius = 1.0012): THREE.LineSegments {
  const positions: number[] = [];
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const seg = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    latLonToVec3(lat1, lon1, radius, v1);
    latLonToVec3(lat2, lon2, radius, v2);
    positions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
  };
  for (let lon = -180; lon < 180; lon += 15) {
    for (let lat = -85; lat < 85; lat += 2.5) seg(lat, lon, lat + 2.5, lon);
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    for (let lon = -180; lon < 180; lon += 2.5) seg(lat, lon, lat, lon + 2.5);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0x4d7ba6,
    transparent: true,
    opacity: 0.07,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.renderOrder = 2;
  return lines;
}
