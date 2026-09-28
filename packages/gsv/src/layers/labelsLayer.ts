/**
 * DOM label layer: crisp text labels for the most relevant visible
 * nodes, pooled and repositioned each frame, occluded past the limb.
 * Styling is inline so the layer owns its whole appearance.
 */

import * as THREE from 'three';
import type { EntityId } from '../data/contracts';
import type { NodesLayer, NodeEntry } from './nodesLayer';

const POOL = 30;

export class LabelsLayer {
  private container: HTMLDivElement;
  private pool: HTMLDivElement[] = [];
  private enabled = true;
  private selectedId: EntityId | null = null;

  constructor(hud: HTMLElement) {
    this.container = document.createElement('div');
    this.container.style.cssText =
      'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:5;';
    hud.appendChild(this.container);
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:absolute',
        'transform:translate(-50%,-170%)',
        "font-family:'IBM Plex Mono',ui-monospace,monospace",
        'font-size:10px',
        'letter-spacing:0.14em',
        'text-transform:uppercase',
        'color:#8fa3b8',
        'text-shadow:0 1px 3px rgba(0,0,0,0.9),0 0 8px rgba(0,0,0,0.6)',
        'white-space:nowrap',
        'display:none',
        'will-change:transform,left,top',
      ].join(';');
      this.container.appendChild(el);
      this.pool.push(el);
    }
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) for (const el of this.pool) el.style.display = 'none';
  }

  setSelected(id: EntityId | null): void {
    this.selectedId = id;
  }

  update(camera: THREE.PerspectiveCamera, nodesLayer: NodesLayer, altitude: number): void {
    if (!this.enabled) return;
    const camUnit = _cu.copy(camera.position).normalize();
    const horizon = 1 / camera.position.length();
    const maxLabels = altitude < 0.4 ? 28 : altitude < 1.1 ? 18 : altitude < 2.2 ? 12 : 8;

    const candidates: { e: NodeEntry; score: number; facing: number }[] = [];
    for (const e of nodesLayer.entries) {
      if (!nodesLayer.isVisible(e.node.id)) continue;
      const facing = _n.copy(e.pos).normalize().dot(camUnit);
      if (facing < horizon + 0.02) continue;
      let score = e.node.importance + facing * 0.8;
      if (e.node.id === this.selectedId) score += 10;
      candidates.push({ e, score, facing });
    }
    candidates.sort((a, b) => b.score - a.score);
    const chosen = candidates.slice(0, maxLabels);

    const w = window.innerWidth;
    const h = window.innerHeight;
    let i = 0;
    // screen-space collision: a label near an already-placed one is
    // skipped (lower-scored candidates yield to higher-scored ones)
    const placed: { x: number; y: number; hw: number }[] = [];
    for (const { e, facing } of chosen) {
      if (i >= POOL) break;
      _p.copy(e.pos).project(camera);
      if (_p.z > 1) continue;
      const x = ((_p.x + 1) / 2) * w;
      const y = ((1 - _p.y) / 2) * h;
      const hw = e.node.name.length * 3.6 + 8;
      let collides = false;
      for (const q of placed) {
        if (Math.abs(y - q.y) < 16 && Math.abs(x - q.x) < hw + q.hw) {
          collides = true;
          break;
        }
      }
      if (collides) continue;
      placed.push({ x, y, hw });
      const el = this.pool[i++];
      el.textContent = e.node.name;
      el.style.left = `${x.toFixed(1)}px`;
      el.style.top = `${y.toFixed(1)}px`;
      const edgeFade = Math.min(1, Math.max(0, (facing - horizon) * 9));
      el.style.opacity = String(0.35 + 0.65 * edgeFade);
      el.style.color = e.node.id === this.selectedId ? '#dbe7f4' : '#8fa3b8';
      el.style.display = 'block';
    }
    for (; i < POOL; i++) this.pool[i].style.display = 'none';
  }
}

const _cu = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
