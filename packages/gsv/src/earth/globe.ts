/**
 * The Earth: a single high-resolution sphere with a custom shader —
 * day/night terminator driven by sim time, painted land/ocean textures,
 * city lights on the night side, ocean specular glint, warm terminator
 * band and a soft atmospheric rim.
 */

import * as THREE from 'three';
import type { EarthTextures } from '../geo/texture';

const VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uMask;
  uniform vec3 uSunDir;
  uniform float uNightIntensity;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 sun = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vWorldPos);

    float d = dot(n, sun);
    float dayFactor = smoothstep(-0.10, 0.26, d);

    vec3 dayCol = texture2D(uDay, vUv).rgb;
    vec3 nightGlow = texture2D(uNight, vUv).rgb;
    float land = texture2D(uMask, vUv).r;

    // day side: painted world lit by sun angle
    vec3 lit = dayCol * (0.45 + 0.85 * clamp(d, 0.0, 1.0));

    // night side: faint moonlit earth + warm city lights (soft-capped so
    // dense corridors stay legible instead of blooming into fog)
    vec3 lights = nightGlow * uNightIntensity * 1.25;
    lights = lights / (1.0 + lights * 0.9);
    vec3 nightSide = dayCol * 0.14 + lights;

    vec3 col = mix(nightSide, lit, dayFactor);

    // warm band along the terminator
    float band = smoothstep(0.18, 0.0, abs(d - 0.03));
    col += vec3(0.30, 0.13, 0.04) * band * 0.20;

    // ocean specular glint — tight highlight, not a searchlight
    vec3 R = reflect(-sun, n);
    float spec = pow(max(dot(R, V), 0.0), 220.0) * (1.0 - land) * dayFactor;
    col += spec * vec3(0.45, 0.65, 0.9) * 0.30;

    // atmospheric rim (inner fresnel)
    float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    col += fres * mix(vec3(0.05, 0.10, 0.20), vec3(0.10, 0.30, 0.58), dayFactor) * 1.15;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Globe {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(textures: EarthTextures) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uDay: { value: textures.day },
        uNight: { value: textures.night },
        uMask: { value: textures.mask },
        uSunDir: { value: new THREE.Vector3(1, 0.2, 0.4) },
        uNightIntensity: { value: 1.0 },
      },
    });
    const geo = new THREE.SphereGeometry(1, 192, 128);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 0;
  }

  setSunDirection(dir: THREE.Vector3): void {
    (this.material.uniforms.uSunDir.value as THREE.Vector3).copy(dir);
  }

  setNightLights(intensity: number): void {
    this.material.uniforms.uNightIntensity.value = intensity;
  }
}

/**
 * Sun direction from a UTC timestamp: subsolar point from day-of-year
 * declination + hour angle. Approximate (±1°), which is plenty for a
 * terminator that exists to make time scrubbing legible.
 */
export function sunDirectionAt(utcMillis: number, target = new THREE.Vector3()): THREE.Vector3 {
  const d = new Date(utcMillis);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = (utcMillis - start) / 86400000;
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (doy - 81));
  const utcHours =
    d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const subsolarLon = 180 - utcHours * 15;
  const DEG = Math.PI / 180;
  const phi = decl * DEG;
  const lambda = subsolarLon * DEG;
  return target
    .set(
      Math.cos(phi) * Math.cos(lambda),
      Math.sin(phi),
      -Math.cos(phi) * Math.sin(lambda)
    )
    .normalize();
}
