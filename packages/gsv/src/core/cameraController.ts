/**
 * Inertial orbit camera around the globe.
 *
 * Spherical parameterization chosen so a camera at (theta=lon, phi=90-lat)
 * looks straight down at that lat/lon. Drag rotates with inertia; wheel
 * zooms with exponential smoothing; rotate speed scales with altitude so
 * close-up navigation stays precise. flyTo / followPath drive the same
 * state for cinematic transitions.
 */

import * as THREE from 'three';
import type { LonLat } from '../data/contracts';
import { samplePath, vec3ToLatLon } from '../geo/projection';

const DEG = Math.PI / 180;
const MIN_DIST = 1.065;
const MAX_DIST = 5.4;

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

interface FlightTarget {
  theta: number;
  phi: number;
  dist: number;
}

export class CameraController {
  private theta = -1.4; // start over the Atlantic/Americas
  private phi = Math.PI / 2 - 0.45;
  private dist = 4.4;
  private targetDist = 2.85;

  private velTheta = 0;
  private velPhi = 0;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  private flight: {
    from: FlightTarget;
    to: FlightTarget;
    t: number;
    duration: number;
    resolve: () => void;
  } | null = null;

  private pathFlight: {
    points: THREE.Vector3[];
    t: number;
    duration: number;
    dist: number;
    onProgress?: (u: number) => void;
    resolve: () => void;
  } | null = null;

  private autoRotate = false;
  private idleTime = 0;
  /** Set true after any user interaction; used to pause auto-rotation. */
  private userActive = false;

  onInteract: (() => void) | null = null;
  private previousTouchAction = '';
  private disposed = false;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement
  ) {
    this.previousTouchAction = dom.style.touchAction;
    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.style.touchAction = 'none';
  }

  /** GSC lifecycle addition: remove every installed input listener exactly once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.dragging = false;
    this.onInteract = null;
    this.dom.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.style.touchAction = this.previousTouchAction;
  }

  // ------------------------------------------------------------ input

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.velTheta = 0;
    this.velPhi = 0;
    this.interrupt();
  };

  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    const speed = this.rotateSpeed();
    this.theta -= dx * speed;
    this.phi = clampPhi(this.phi - dy * speed);
    // store velocity for inertia (per-event; frame loop decays it)
    this.velTheta = -dx * speed * 60;
    this.velPhi = -dy * speed * 60;
  };

  private onUp = () => {
    this.dragging = false;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.interrupt();
    const k = e.deltaMode === 1 ? 0.06 : 0.0018;
    this.targetDist = THREE.MathUtils.clamp(
      this.targetDist * Math.exp(e.deltaY * k),
      MIN_DIST,
      MAX_DIST
    );
  };

  private interrupt(): void {
    this.userActive = true;
    this.idleTime = 0;
    if (this.flight) {
      this.flight.resolve();
      this.flight = null;
    }
    if (this.pathFlight) {
      this.pathFlight.resolve();
      this.pathFlight = null;
    }
    this.onInteract?.();
  }

  private rotateSpeed(): number {
    // slower rotation when zoomed in: precision scales with altitude
    const alt = this.dist - 1;
    return 0.0032 * THREE.MathUtils.clamp(alt / 1.8, 0.045, 1);
  }

  // ------------------------------------------------------------ programmatic

  setAutoRotate(enabled: boolean): void {
    this.autoRotate = enabled;
  }

  altitudeRadii(): number {
    return this.dist - 1;
  }

  currentLatLon(): { lat: number; lon: number } {
    return { lat: 90 - this.phi / DEG, lon: this.theta / DEG };
  }

  cancel(): void {
    if (this.flight) {
      this.flight.resolve();
      this.flight = null;
    }
    if (this.pathFlight) {
      this.pathFlight.resolve();
      this.pathFlight = null;
    }
  }

  flyToLatLon(
    lat: number,
    lon: number,
    opts: { distance?: number; durationMs?: number } = {}
  ): Promise<void> {
    this.cancel();
    const to: FlightTarget = {
      theta: lon * DEG,
      phi: clampPhi(Math.PI / 2 - lat * DEG),
      dist: THREE.MathUtils.clamp(opts.distance ?? this.targetDist, MIN_DIST, MAX_DIST),
    };
    // wrap theta the short way
    const from: FlightTarget = { theta: this.theta, phi: this.phi, dist: this.dist };
    let d = to.theta - from.theta;
    d = ((d + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    to.theta = from.theta + d;
    const duration = (opts.durationMs ?? 1800) / 1000;
    return new Promise((resolve) => {
      this.flight = { from, to, t: 0, duration, resolve };
    });
  }

  followPath(
    coords: LonLat[],
    opts: { durationMs: number; distance?: number; onProgress?: (u: number) => void }
  ): Promise<void> {
    this.cancel();
    const path = samplePath(coords, { samples: 160 });
    return new Promise((resolve) => {
      this.pathFlight = {
        points: path.points,
        t: 0,
        duration: opts.durationMs / 1000,
        dist: THREE.MathUtils.clamp(opts.distance ?? 1.3, MIN_DIST, MAX_DIST),
        onProgress: opts.onProgress,
        resolve,
      };
    });
  }

  // ------------------------------------------------------------ frame

  update(dt: number): void {
    if (this.flight) {
      const f = this.flight;
      f.t += dt / f.duration;
      const k = easeInOutCubic(Math.min(1, f.t));
      this.theta = THREE.MathUtils.lerp(f.from.theta, f.to.theta, k);
      this.phi = THREE.MathUtils.lerp(f.from.phi, f.to.phi, k);
      this.dist = THREE.MathUtils.lerp(f.from.dist, f.to.dist, k);
      this.targetDist = this.dist;
      if (f.t >= 1) {
        f.resolve();
        this.flight = null;
      }
    } else if (this.pathFlight) {
      const p = this.pathFlight;
      p.t += dt / p.duration;
      const u = easeInOutCubic(Math.min(1, p.t));
      const idx = u * (p.points.length - 1);
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, p.points.length - 1);
      _v.copy(p.points[i0]).lerp(p.points[i1], idx - i0);
      const ll = vec3ToLatLon(_v);
      this.theta = approachAngle(this.theta, ll.lon * DEG);
      this.phi = clampPhi(Math.PI / 2 - ll.lat * DEG);
      // gentle altitude envelope: slightly higher at the ends, low mid-leg
      this.dist = 1 + (p.dist - 1) * (1.25 - 0.25 * Math.sin(u * Math.PI));
      this.targetDist = this.dist;
      p.onProgress?.(u);
      if (p.t >= 1) {
        p.resolve();
        this.pathFlight = null;
      }
    } else {
      // inertia
      if (!this.dragging) {
        const decay = Math.exp(-dt * 3.2);
        this.velTheta *= decay;
        this.velPhi *= decay;
        if (Math.abs(this.velTheta) > 1e-5 || Math.abs(this.velPhi) > 1e-5) {
          this.theta += this.velTheta * dt;
          this.phi = clampPhi(this.phi + this.velPhi * dt);
        }
        this.idleTime += dt;
        if (this.autoRotate && this.idleTime > 6) {
          this.theta += dt * 0.018 * THREE.MathUtils.clamp(this.dist - 1, 0.2, 1);
        }
      } else {
        this.idleTime = 0;
      }
      // smooth zoom
      this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 7);
    }

    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      this.dist * sinPhi * Math.cos(this.theta),
      this.dist * Math.cos(this.phi),
      -this.dist * sinPhi * Math.sin(this.theta)
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
  }
}

const _v = new THREE.Vector3();

function clampPhi(phi: number): number {
  return THREE.MathUtils.clamp(phi, 0.08, Math.PI - 0.08);
}

/** Move an angle toward a target through the shortest arc (no spin-around). */
function approachAngle(current: number, target: number): number {
  let d = target - current;
  d = ((d + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return current + d;
}
