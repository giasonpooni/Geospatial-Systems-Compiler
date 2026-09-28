/**
 * Deep-space backdrop: seeded starfield with a faint galactic band.
 */

import * as THREE from 'three';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createStars(): THREE.Points {
  const rand = mulberry32(0x53544152);
  const N = 5200;
  const BAND = 2600;
  const positions = new Float32Array((N + BAND) * 3);
  const colors = new Float32Array((N + BAND) * 3);
  const sizes = new Float32Array(N + BAND);

  const put = (i: number, v: THREE.Vector3, brightness: number, warm: number) => {
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
    const r = brightness * (0.85 + warm * 0.15);
    const g = brightness * (0.9 - warm * 0.05);
    const b = brightness * (1.0 - warm * 0.3);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
    sizes[i] = 0.5 + brightness * 2.0;
  };

  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1)
      .normalize()
      .multiplyScalar(75 + rand() * 10);
    put(i, v, Math.pow(rand(), 2.4) * 0.9 + 0.06, rand());
  }
  // galactic band: cluster around a tilted great circle
  const bandNormal = new THREE.Vector3(0.35, 0.8, 0.5).normalize();
  const tangent = new THREE.Vector3(1, 0, 0).cross(bandNormal).normalize();
  const bitangent = bandNormal.clone().cross(tangent);
  for (let i = 0; i < BAND; i++) {
    const a = rand() * Math.PI * 2;
    const spread = (rand() + rand() + rand() - 1.5) * 0.12;
    v.copy(tangent)
      .multiplyScalar(Math.cos(a))
      .addScaledVector(bitangent, Math.sin(a))
      .addScaledVector(bandNormal, spread)
      .normalize()
      .multiplyScalar(78 + rand() * 8);
    put(N + i, v, Math.pow(rand(), 2.8) * 0.5 + 0.03, rand() * 0.5);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // soft round sprite
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const sprite = new THREE.CanvasTexture(c);

  const mat = new THREE.PointsMaterial({
    size: 1.6,
    map: sprite,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = -1;
  return points;
}
