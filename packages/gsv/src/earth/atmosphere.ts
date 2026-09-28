/**
 * Atmospheric scattering shell: a back-face sphere slightly larger than
 * the globe with an additive fresnel falloff, tinted by sun position.
 */

import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec3 vViewNormal;
  varying vec3 vWorldNormal;
  void main() {
    vViewNormal = normalize(normalMatrix * normal);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  varying vec3 vViewNormal;
  varying vec3 vWorldNormal;
  void main() {
    // back-face shell: glow strongest at the limb
    float rim = pow(0.68 - dot(vViewNormal, vec3(0.0, 0.0, 1.0)), 2.4);
    float sunSide = clamp(dot(normalize(vWorldNormal), normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
    vec3 dayColor = vec3(0.22, 0.50, 0.95);
    vec3 nightColor = vec3(0.05, 0.09, 0.22);
    vec3 col = mix(nightColor, dayColor, sunSide) * rim;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Atmosphere {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uSunDir: { value: new THREE.Vector3(1, 0, 0) } },
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1.05, 96, 64), this.material);
    this.mesh.renderOrder = 1;
  }

  setSunDirection(dir: THREE.Vector3): void {
    (this.material.uniforms.uSunDir.value as THREE.Vector3).copy(dir);
  }
}
