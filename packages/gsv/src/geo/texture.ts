/**
 * Procedural equirectangular earth textures, generated at boot from
 * Natural Earth 50m land topology + corpus city lights. No external
 * imagery: the planet is drawn, not photographed — dark, cinematic,
 * legible. Deterministic (seeded) so every boot renders the same world.
 */

import * as THREE from 'three';
import { feature } from 'topojson-client';
import type { LonLat } from '../data/contracts';

export interface EarthTextures {
  day: THREE.CanvasTexture;
  night: THREE.CanvasTexture;
  mask: THREE.CanvasTexture; // land = white, ocean = black (specular/lights mask)
}

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

const px = (lon: number, w: number) => ((lon + 180) / 360) * w;
const py = (lat: number, h: number) => ((90 - lat) / 180) * h;

function tracePolys(
  ctx: CanvasRenderingContext2D,
  polys: LonLat[][][],
  w: number,
  h: number
): void {
  ctx.beginPath();
  for (const rings of polys) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const X = px(ring[i][0], w);
        const Y = py(ring[i][1], h);
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      }
      ctx.closePath();
    }
  }
}

export async function generateEarthTextures(
  landTopoUrl: string,
  cityLights: [number, number, number][],
  signal?: AbortSignal
): Promise<EarthTextures> {
  const response = await fetch(landTopoUrl, { signal });
  if (!response.ok) throw new Error(`World topology unavailable: ${response.status}`);
  const topo = await response.json();
  signal?.throwIfAborted();
  const land = feature(topo, topo.objects.land) as any;
  const polys: LonLat[][][] =
    land.features?.flatMap((f: any) =>
      f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    ) ??
    (land.geometry.type === 'Polygon' ? [land.geometry.coordinates] : land.geometry.coordinates);

  // ------------------------------------------------------------- DAY 4096×2048
  const W = 4096, H = 2048;
  const day = document.createElement('canvas');
  day.width = W;
  day.height = H;
  const d = day.getContext('2d')!;

  // ocean: deep vertical gradient, slightly lifted at the equator
  const og = d.createLinearGradient(0, 0, 0, H);
  og.addColorStop(0, '#04070e');
  og.addColorStop(0.28, '#061020');
  og.addColorStop(0.5, '#081527');
  og.addColorStop(0.72, '#061020');
  og.addColorStop(1, '#04070e');
  d.fillStyle = og;
  d.fillRect(0, 0, W, H);

  // faint large-scale ocean variation
  const rand = mulberry32(0x504c44); // 'PLD'
  for (let i = 0; i < 26; i++) {
    const x = rand() * W;
    const y = H * (0.18 + rand() * 0.64);
    const r = W * (0.05 + rand() * 0.1);
    const g = d.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(30, 70, 110, ${0.03 + rand() * 0.035})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    d.fillStyle = g;
    d.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // land drawn on its own canvas so noise/coast glow stay land-only
  const lc = document.createElement('canvas');
  lc.width = W;
  lc.height = H;
  const l = lc.getContext('2d')!;

  // coastal halo: soft teal glow bleeding into the sea, drawn first
  l.save();
  l.shadowColor = 'rgba(56, 214, 200, 0.34)';
  l.shadowBlur = 10;
  l.fillStyle = '#0e1622';
  tracePolys(l, polys, W, H);
  l.fill('evenodd');
  l.restore();

  // land body gradient by latitude (colder poles, warmer mid-lats)
  l.save();
  l.globalCompositeOperation = 'source-atop';
  const lg = l.createLinearGradient(0, 0, 0, H);
  lg.addColorStop(0, '#141c28');
  lg.addColorStop(0.32, '#151e29');
  lg.addColorStop(0.5, '#18212c');
  lg.addColorStop(0.68, '#151e29');
  lg.addColorStop(1, '#141c28');
  l.fillStyle = lg;
  l.fillRect(0, 0, W, H);

  // terrain-ish grain: two octaves of blotch noise, land-only
  for (let i = 0; i < 2600; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 3 + rand() * 26;
    const up = rand() > 0.5;
    l.fillStyle = up
      ? `rgba(46, 62, 82, ${0.05 + rand() * 0.08})`
      : `rgba(6, 9, 14, ${0.05 + rand() * 0.09})`;
    l.beginPath();
    l.ellipse(x, y, r, r * (0.5 + rand() * 0.8), rand() * Math.PI, 0, Math.PI * 2);
    l.fill();
  }
  l.restore();

  // crisp coastline stroke
  l.save();
  l.strokeStyle = 'rgba(90, 160, 170, 0.28)';
  l.lineWidth = 1.4;
  tracePolys(l, polys, W, H);
  l.stroke();
  l.restore();

  d.drawImage(lc, 0, 0);

  // ------------------------------------------------------------- MASK 1024×512
  const MW = 1024, MH = 512;
  const maskC = document.createElement('canvas');
  maskC.width = MW;
  maskC.height = MH;
  const m = maskC.getContext('2d')!;
  m.fillStyle = '#000';
  m.fillRect(0, 0, MW, MH);
  m.fillStyle = '#fff';
  tracePolys(m, polys, MW, MH);
  m.fill('evenodd');

  // ------------------------------------------------------------ NIGHT 2048×1024
  const NW = 2048, NH = 1024;
  const nightC = document.createElement('canvas');
  nightC.width = NW;
  nightC.height = NH;
  const n = nightC.getContext('2d')!;
  n.fillStyle = '#000';
  n.fillRect(0, 0, NW, NH);

  const nr = mulberry32(0x4e495445); // 'NITE'
  n.globalCompositeOperation = 'lighter';
  for (const [lon, lat, intensity] of cityLights) {
    const x = px(lon, NW);
    const y = py(lat, NH);
    const I = Math.max(0.05, Math.min(1, intensity));
    const r = 1.4 + I * 5;
    const g = n.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255, 224, 178, ${0.32 + I * 0.34})`);
    g.addColorStop(0.4, `rgba(255, 196, 120, ${0.1 + I * 0.14})`);
    g.addColorStop(1, 'rgba(255, 170, 80, 0)');
    n.fillStyle = g;
    n.fillRect(x - r, y - r, r * 2, r * 2);
    // pinprick core so metros read as points, not fog
    n.fillStyle = `rgba(255, 240, 210, ${0.35 + I * 0.45})`;
    n.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
    // satellite sprawl around larger metros
    const satellites = Math.floor(I * 10);
    for (let s = 0; s < satellites; s++) {
      const a = nr() * Math.PI * 2;
      const dist = (0.8 + nr() * 2.4) * r;
      const sx = x + Math.cos(a) * dist;
      const sy = y + Math.sin(a) * dist * 0.7;
      const sr = 0.4 + nr() * 1.1;
      const sg = n.createRadialGradient(sx, sy, 0, sx, sy, sr * 2.2);
      sg.addColorStop(0, `rgba(255, 214, 160, ${0.1 + nr() * 0.14})`);
      sg.addColorStop(1, 'rgba(255, 180, 100, 0)');
      n.fillStyle = sg;
      n.fillRect(sx - sr * 3, sy - sr * 3, sr * 6, sr * 6);
    }
  }
  n.globalCompositeOperation = 'source-over';

  const mk = (c: HTMLCanvasElement, srgb = true) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.wrapS = THREE.RepeatWrapping; // longitudinal wrap at the antimeridian seam
    t.needsUpdate = true;
    return t;
  };

  return { day: mk(day), night: mk(nightC), mask: mk(maskC, false) };
}
