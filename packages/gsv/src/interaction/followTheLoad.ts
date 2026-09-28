/**
 * FOLLOW THE LOAD — cinematic demo scenario controller.
 *
 * Drives the camera along a tagged multimodal demo flow
 * (Toronto → Detroit border → Chicago → DC chain), narrating each leg
 * through 'demo' events that the HUD caption bar renders. Pure
 * view-level orchestration: reads the store, talks only to AppApi.
 */

import type { Flow, Route, TransportMode, TransportSegment } from '../data/contracts';
import type { AppApi, LayerId } from '../app/api';

const DEMO_TAG = 'demo:follow-the-load';
const TITLE = 'FOLLOW THE LOAD';
const SUBTITLE = 'Auto components · Toronto → Chicago';

const DEMO_LAYERS: LayerId[] = [
  'transport.road',
  'transport.rail',
  'infra.rail_terminals',
  'infra.warehouses',
];

const MODE_WORD: Record<TransportMode, string> = {
  road: 'TRUCK',
  rail: 'RAIL',
  maritime: 'VESSEL',
  air: 'AIR FREIGHT',
};

/** Corridor midpoint for the establishing shot (~Lake St Clair). */
const ESTABLISH_LAT = 42.8;
const ESTABLISH_LON = -83.5;
/** Chicago fallback for the finale framing. */
const CHICAGO_LAT = 41.85;
const CHICAGO_LON = -87.65;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export class FollowTheLoad {
  private readonly api: AppApi;
  private _active = false;
  /** Generation counter — bumped by stop(); every await re-checks it. */
  private gen = 0;

  constructor(api: AppApi) {
    this.api = api;
  }

  get active(): boolean {
    return this._active;
  }

  async start(): Promise<void> {
    if (this._active) return;

    const flow = this.findDemoFlow();
    if (!flow) {
      this.api.events.emit('toast', {
        title: 'DEMO UNAVAILABLE',
        body: 'No flow tagged demo:follow-the-load in the current snapshot.',
        tone: 'alert',
      });
      return;
    }

    this._active = true;
    const myGen = ++this.gen;
    const cancelled = (): boolean => this.gen !== myGen || !this._active;

    const segments = flow.segments.slice().sort((a, b) => a.sequence - b.sequence);
    const totalSteps = segments.length;

    try {
      // -- 1 · setup (no step number during the establishing shot) ------
      this.api.events.emit('demo', {
        active: true,
        totalSteps,
        title: TITLE,
        caption: SUBTITLE,
      });
      for (const layer of DEMO_LAYERS) this.api.setLayerVisible(layer, true);
      this.api.setFlowMode(true);
      this.api.camera.setAutoRotate(false);

      // -- 2 · establishing shot ---------------------------------------
      await this.api.camera.flyToLatLon(ESTABLISH_LAT, ESTABLISH_LON, {
        distance: 1.75,
        durationMs: 2600,
      });
      if (cancelled()) return;
      this.api.select(flow.id, 'demo');
      await this.sleep(700);
      if (cancelled()) return;

      // -- 3 · leg by leg ----------------------------------------------
      for (let k = 0; k < segments.length; k++) {
        const seg = segments[k];
        const route = this.api.store.route(seg.routeId);

        this.emitDemo(k + 1, totalSteps, this.legCaption(seg, k, totalSteps));
        this.api.select(seg.routeId, 'demo');

        if (route) {
          await this.api.camera.followPath(route.geometry.coordinates, {
            durationMs: clamp(route.distanceKm * 14, 5000, 11000),
            distance: 1.28,
          });
        } else {
          // Route missing from the snapshot — hold on the caption instead.
          await this.sleep(2000);
        }
        if (cancelled()) return;

        await this.sleep(700);
        if (cancelled()) return;

        // Border beat between leg 1 and leg 2.
        if (k === 0 && segments.length > 1) {
          const border = this.findBorderNode(segments[0], segments[1]);
          if (border) {
            this.emitDemo(k + 1, totalSteps, 'BORDER CROSSING · Windsor–Detroit');
            const [lon, lat] = border.geometry.coordinates;
            await this.api.camera.flyToLatLon(lat, lon, {
              distance: 1.12,
              durationMs: 1600,
            });
            if (cancelled()) return;
            await this.sleep(700);
            if (cancelled()) return;
          }
        }
      }

      // -- 4 · finale ---------------------------------------------------
      this.api.select(flow.id, 'demo');
      const longest = this.longestRoute(segments);
      if (longest) {
        await this.api.camera.frameRoute(longest.id, { durationMs: 2000 });
      } else {
        await this.api.camera.flyToLatLon(CHICAGO_LAT, CHICAGO_LON, {
          distance: 1.5,
          durationMs: 2000,
        });
      }
      if (cancelled()) return;

      this.emitDemo(
        totalSteps,
        totalSteps,
        'DELIVERED · Chicago distribution centre — EVIDENCE: DEMO DATA'
      );
      await this.sleep(2500);
      if (cancelled()) return;
    } finally {
      // Guarantee the HUD is released even on an error or early bail.
      // If stop() already ran (gen advanced) it has emitted this itself.
      if (this.gen === myGen) {
        this._active = false;
        this.api.events.emit('demo', { active: false });
        this.api.camera.setAutoRotate(true);
        // Selection deliberately left on the flow.
      }
    }
  }

  stop(): void {
    this.gen++;
    this.api.camera.cancel();
    this._active = false;
    this.api.events.emit('demo', { active: false });
    this.api.camera.setAutoRotate(true);
  }

  // ------------------------------------------------------------------ internals

  private findDemoFlow(): Flow | undefined {
    return this.api.store.snapshot.flows.find((f) => f.tags?.includes(DEMO_TAG));
  }

  private nodeName(id: string): string {
    return this.api.store.node(id)?.name ?? id;
  }

  private legCaption(seg: TransportSegment, index: number, totalSteps: number): string {
    // Final road leg of a multimodal chain reads as drayage.
    const isFinalRoadLeg = seg.mode === 'road' && index === totalSteps - 1 && totalSteps > 1;
    const word = isFinalRoadLeg ? 'DRAYAGE' : MODE_WORD[seg.mode];
    return `${word} · ${this.nodeName(seg.fromNodeId)} → ${this.nodeName(seg.toNodeId)}`;
  }

  private findBorderNode(a: TransportSegment, b: TransportSegment) {
    const ids = [a.fromNodeId, a.toNodeId, b.fromNodeId, b.toNodeId];
    for (const id of ids) {
      const node = this.api.store.node(id);
      if (node?.kind === 'border_crossing') return node;
    }
    // the crossing usually sits ON a leg rather than at its endpoints —
    // find a border node attached to either leg's route (or demo-tagged)
    const routeIds = new Set([a.routeId, b.routeId]);
    return this.api.store.snapshot.nodes.find(
      (n) =>
        n.kind === 'border_crossing' &&
        (n.connectedRouteIds?.some((r) => routeIds.has(r)) || n.tags?.includes(DEMO_TAG))
    );
  }

  private longestRoute(segments: TransportSegment[]): Route | undefined {
    let best: Route | undefined;
    for (const seg of segments) {
      const r = this.api.store.route(seg.routeId);
      if (r && (!best || r.distanceKm > best.distanceKm)) best = r;
    }
    return best;
  }

  private emitDemo(step: number, totalSteps: number, caption: string): void {
    this.api.events.emit('demo', {
      active: true,
      step,
      totalSteps,
      title: TITLE,
      caption,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }
}
