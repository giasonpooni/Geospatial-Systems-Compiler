/**
 * Infrastructure nodes: one GPU point cloud, SDF glyphs per node kind,
 * importance-scaled sizes, progressive disclosure by camera altitude,
 * screen-space picking (precise at planetary scale, no raycast noise).
 */

import * as THREE from 'three';
import type { EntityId, Facility, NodeKind } from '../data/contracts';
import { latLonToVec3 } from '../geo/projection';
import { NODE_CATEGORY_COLORS, type NodeCategory } from '../app/palette';

export function categoryOf(kind: NodeKind): NodeCategory {
  switch (kind) {
    case 'port':
    case 'airport':
    case 'rail_terminal':
    case 'trucking_hub':
    case 'warehouse':
    case 'distribution_center':
      return 'logistics';
    case 'border_crossing':
      return 'border';
    case 'mine':
    case 'oil_field':
    case 'gas_field':
    case 'agricultural_region':
      return 'extraction';
    case 'refinery':
    case 'smelter':
    case 'chemical_plant':
    case 'steel_mill':
    case 'processing_facility':
      return 'processing';
    case 'factory':
    case 'industrial_park':
    case 'manufacturing_cluster':
    case 'consumption_center':
      return 'industry';
    case 'chokepoint':
      return 'chokepoint';
    case 'city':
      return 'world';
  }
}

/** Layer bucket per kind — drives infra.* toggles. */
export function layerBucketOf(kind: NodeKind): string {
  switch (kind) {
    case 'port':
      return 'infra.ports';
    case 'airport':
      return 'infra.airports';
    case 'rail_terminal':
    case 'trucking_hub':
    case 'border_crossing':
      return 'infra.rail_terminals';
    case 'warehouse':
    case 'distribution_center':
      return 'infra.warehouses';
    case 'chokepoint':
      return 'intel.bottlenecks';
    case 'city':
      return 'world.cities';
    default:
      return 'infra.industrial';
  }
}

const GLYPH: Record<NodeCategory, number> = {
  logistics: 1, // diamond
  border: 5, // plus
  extraction: 6, // triangle down
  processing: 5, // plus
  industry: 3, // square
  chokepoint: 4, // ring
  world: 0, // circle
};

const VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aGlyph;
  attribute float aSize;
  attribute float aState;   // 0 normal, 1 hover, 2 selected
  attribute float aAlpha;   // 0 hidden .. 1 visible (LOD/layer)
  attribute float aHalo;    // economy emphasis pulse
  uniform float uDpr;
  varying vec3 vColor;
  varying float vGlyph;
  varying float vState;
  varying float vAlpha;
  varying float vHalo;
  void main() {
    vColor = aColor;
    vGlyph = aGlyph;
    vState = aState;
    vAlpha = aAlpha;
    vHalo = aHalo;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float px = aSize * 26.0 / -mv.z;
    if (aState > 0.5) px *= 1.35;
    gl_PointSize = clamp(px, 5.0, 42.0) * uDpr;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform float uTime;
  varying vec3 vColor;
  varying float vGlyph;
  varying float vState;
  varying float vAlpha;
  varying float vHalo;

  float sdf(vec2 p, float g) {
    if (g < 0.5) return length(p) - 0.42;                                   // circle
    if (g < 1.5) return abs(p.x) + abs(p.y) - 0.62;                          // diamond
    if (g < 2.5) return max(abs(p.x) * 0.866 + p.y * 0.5, -p.y - 0.14) - 0.40; // tri up
    if (g < 3.5) return max(abs(p.x), abs(p.y)) - 0.42;                      // square
    if (g < 4.5) return abs(length(p) - 0.46) - 0.13;                        // ring
    if (g < 5.5) return min(max(abs(p.x) - 0.5, abs(p.y) - 0.15),
                            max(abs(p.y) - 0.5, abs(p.x) - 0.15));           // plus
    return max(abs(p.x) * 0.866 - p.y * 0.5, p.y - 0.14) - 0.40;             // tri down
  }

  void main() {
    if (vAlpha < 0.01) discard;
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = sdf(p, vGlyph);

    float fill = smoothstep(0.05, -0.05, d) * 0.55;
    float edge = smoothstep(0.10, 0.02, abs(d)) * 1.1;
    float glow = exp(-length(p) * 2.2) * 0.5;

    vec3 col = vColor;
    float k = fill + edge + glow;

    if (vState > 1.5) {
      float ringR = 0.72 + 0.12 * sin(uTime * 5.0);
      float ring = smoothstep(0.09, 0.02, abs(length(p) - ringR));
      col = mix(col, vec3(1.0), 0.4);
      k = k * 1.9 + ring * 1.4;
    } else if (vState > 0.5) {
      k *= 1.7;
    }

    if (vHalo > 0.5) {
      float breathe = 0.55 + 0.45 * sin(uTime * 2.2);
      k += exp(-length(p) * 1.4) * 0.8 * breathe;
    }

    gl_FragColor = vec4(col * k * vAlpha, 1.0);
  }
`;

export interface NodeEntry {
  node: Facility;
  index: number;
  pos: THREE.Vector3;
  category: NodeCategory;
  bucket: string;
}

export class NodesLayer {
  readonly points: THREE.Points;
  readonly entries: NodeEntry[] = [];
  private byId = new Map<EntityId, NodeEntry>();
  private stateAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private haloAttr: THREE.BufferAttribute;
  private bucketVisible = new Map<string, boolean>();
  private emphasis = { production: false, demand: false, inventory: false };
  private altitude = 2;
  visibleCount = 0;

  constructor(nodes: Facility[]) {
    const N = nodes.length;
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    const glyphs = new Float32Array(N);
    const sizes = new Float32Array(N);
    const states = new Float32Array(N);
    const alphas = new Float32Array(N);
    const halos = new Float32Array(N);

    const col = new THREE.Color();
    nodes.forEach((node, i) => {
      const [lon, lat] = node.geometry.coordinates;
      const pos = latLonToVec3(lat, lon, 1.006);
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;
      const category = categoryOf(node.kind);
      col.set(NODE_CATEGORY_COLORS[category]);
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
      glyphs[i] = GLYPH[category];
      sizes[i] =
        node.kind === 'city' ? 0.35 + node.importance * 0.3 : 0.5 + node.importance * 0.75;
      alphas[i] = 1;
      const entry: NodeEntry = { node, index: i, pos, category, bucket: layerBucketOf(node.kind) };
      this.entries.push(entry);
      this.byId.set(node.id, entry);
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aGlyph', new THREE.BufferAttribute(glyphs, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.stateAttr = new THREE.BufferAttribute(states, 1);
    this.alphaAttr = new THREE.BufferAttribute(alphas, 1);
    this.haloAttr = new THREE.BufferAttribute(halos, 1);
    geo.setAttribute('aState', this.stateAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setAttribute('aHalo', this.haloAttr);

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uDpr: { value: Math.min(window.devicePixelRatio || 1, 2) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.renderOrder = 6;
  }

  setBucketVisible(bucket: string, visible: boolean): void {
    this.bucketVisible.set(bucket, visible);
    this.applyVisibility();
  }

  setEmphasis(kind: 'production' | 'demand' | 'inventory', on: boolean): void {
    this.emphasis[kind] = on;
    this.applyEmphasis();
  }

  setAltitude(alt: number): void {
    if (Math.abs(alt - this.altitude) < 0.02) return;
    this.altitude = alt;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    // progressive disclosure: minor nodes appear as the camera descends.
    // (At corpus scale this becomes clustering — geodesic-median cluster
    // centroids — behind the same aAlpha channel.)
    const minImportance =
      this.altitude > 2.6 ? 0.62 : this.altitude > 1.5 ? 0.38 : this.altitude > 0.7 ? 0.15 : 0;
    let n = 0;
    for (const e of this.entries) {
      const layerOn = this.bucketVisible.get(e.bucket) ?? true;
      const lodOn = e.node.importance >= minImportance;
      const v = layerOn && lodOn ? 1 : 0;
      this.alphaAttr.setX(e.index, v);
      if (v) n++;
    }
    this.visibleCount = n;
    this.alphaAttr.needsUpdate = true;
  }

  private applyEmphasis(): void {
    for (const e of this.entries) {
      let halo = 0;
      if (this.emphasis.production && (e.category === 'extraction' || e.category === 'processing'))
        halo = 1;
      if (this.emphasis.demand && e.node.kind === 'consumption_center') halo = 1;
      if (
        this.emphasis.inventory &&
        (e.node.kind === 'warehouse' || e.node.kind === 'distribution_center')
      )
        halo = 1;
      this.haloAttr.setX(e.index, halo);
    }
    this.haloAttr.needsUpdate = true;
  }

  setState(id: EntityId, state: 0 | 1 | 2): void {
    const e = this.byId.get(id);
    if (!e) return;
    this.stateAttr.setX(e.index, state);
    this.stateAttr.needsUpdate = true;
  }

  clearStates(keepSelected?: EntityId): void {
    for (const e of this.entries) {
      this.stateAttr.setX(e.index, e.node.id === keepSelected ? 2 : 0);
    }
    this.stateAttr.needsUpdate = true;
  }

  isVisible(id: EntityId): boolean {
    const e = this.byId.get(id);
    return !!e && this.alphaAttr.getX(e.index) > 0.5;
  }

  entry(id: EntityId): NodeEntry | undefined {
    return this.byId.get(id);
  }

  update(dt: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uTime.value += dt;
  }

  /**
   * Screen-space pick: nearest visible node within `radiusPx` of the
   * pointer, front hemisphere only.
   */
  pick(
    ndcX: number,
    ndcY: number,
    camera: THREE.PerspectiveCamera,
    widthPx: number,
    heightPx: number,
    radiusPx = 16
  ): NodeEntry | null {
    const camDist = camera.position.length();
    // nodes sit slightly above the surface, so give the horizon test a
    // little slack — no unpickable dead zone just inside the limb
    const horizon = 1 / camDist - 0.015;
    const px = ((ndcX + 1) / 2) * widthPx;
    const py = ((1 - ndcY) / 2) * heightPx;
    let best: NodeEntry | null = null;
    let bestD = radiusPx;
    const proj = new THREE.Vector3();
    const camUnit = camera.position.clone().normalize();
    for (const e of this.entries) {
      if (this.alphaAttr.getX(e.index) < 0.5) continue;
      const facing = e.pos.clone().normalize().dot(camUnit);
      if (facing < horizon) continue; // behind the limb
      proj.copy(e.pos).project(camera);
      const sx = ((proj.x + 1) / 2) * widthPx;
      const sy = ((1 - proj.y) / 2) * heightPx;
      const d = Math.hypot(sx - px, sy - py);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }
}
