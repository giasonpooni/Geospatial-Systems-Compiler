/** Native Three.js backend. Source-bound geometry in; view interaction out. */
import * as THREE from 'three';
import { CameraController } from '../../../packages/gsv/src/core/cameraController';
import { Globe, sunDirectionAt } from '../../../packages/gsv/src/earth/globe';
import { Atmosphere } from '../../../packages/gsv/src/earth/atmosphere';
import { createGraticule } from '../../../packages/gsv/src/earth/graticule';
import { generateEarthTextures } from '../../../packages/gsv/src/geo/texture';
import type { EarthTextures } from '../../../packages/gsv/src/geo/texture';
import { samplePath } from '../../../packages/gsv/src/geo/projection';
import type { InvestigationFrame } from './session';

type Geographic = InvestigationFrame['globe'];
function releaseTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    const drawable = o as THREE.Mesh;
    if (drawable.geometry) geometries.add(drawable.geometry);
    if (drawable.material) for (const m of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) materials.add(m);
  });
  geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose());
  root.clear();
}

/** One mount owns one renderer, observer, animation loop and all GPU resources. */
export class GlobeBackend {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.01, 40);
  private readonly controls: CameraController;
  private readonly network = new THREE.Group();
  private readonly observer: ResizeObserver;
  private readonly abort = new AbortController();
  private readonly raycaster = new THREE.Raycaster();
  private globe: Globe | null = null;
  private atmosphere: Atmosphere | null = null;
  private textures: EarthTextures | null = null;
  private projection: Geographic | null = null;
  private selected: string | null = null;
  private frameTime = '2026-08-31T14:00:00Z';
  private down = { x: 0, y: 0 };
  private raf = 0;
  private last = 0;
  private disposed = false;
  private loaded = false;

  constructor(private readonly host: HTMLElement, private readonly onSelect: (id: string | null) => void,
      private readonly onStatus: (status: string) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x080e19, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', 'Geographic globe');
    this.host.appendChild(this.renderer.domElement);
    this.controls = new CameraController(this.camera, this.renderer.domElement);
    this.controls.setAutoRotate(false);
    this.scene.add(this.network);
    const grid = createGraticule(); this.scene.add(grid);
    this.raycaster.params.Points.threshold = 0.02;
    this.raycaster.params.Line.threshold = 0.012;
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.pick);
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    document.addEventListener('visibilitychange', this.visibility);
    this.resize();
    void this.load();
  }
  private async load(): Promise<void> {
    try {
      // Background topology is cartographic context, not an observation or live satellite image.
      const textures = await generateEarthTextures('/gsc/world/land-50m.json', [], this.abort.signal);
      if (this.disposed) { Object.values(textures).forEach((t) => t.dispose()); return; }
      this.textures = textures;
      this.globe = new Globe(textures); this.atmosphere = new Atmosphere();
      this.scene.add(this.globe.mesh, this.atmosphere.mesh);
      this.loaded = true; this.updateSun();
      this.onStatus('ready'); this.visibility();
    } catch (error) {
      if (!this.disposed) this.onStatus(`unavailable: ${error instanceof Error ? error.message : 'Globe failed'}`);
    }
  }
  private resize = (): void => {
    if (this.disposed) return;
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
  };
  private contextLost = (event: Event): void => {
    event.preventDefault(); cancelAnimationFrame(this.raf);
    this.loaded = false; this.onStatus('unavailable: WebGL context lost; switch views to remount');
  };
  private visibility = (): void => {
    cancelAnimationFrame(this.raf); this.last = 0;
    if (!this.disposed && this.loaded && !document.hidden) this.raf = requestAnimationFrame(this.tick);
  };
  private tick = (time: number): void => {
    if (this.disposed || !this.loaded || document.hidden) return;
    const dt = this.last ? Math.min((time - this.last) / 1000, 0.05) : 0;
    this.last = time; this.controls.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.tick);
  };
  private pointerDown = (event: PointerEvent): void => { this.down = { x: event.clientX, y: event.clientY }; };
  private pick = (event: PointerEvent): void => {
    if (Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 5 || !this.loaded) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(
      (event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), this.camera);
    const surface = this.globe ? this.raycaster.intersectObject(this.globe.mesh)[0]?.distance ?? Infinity : Infinity;
    const hit = this.raycaster.intersectObjects(this.network.children, false).find((item) => item.distance <= surface + 0.035);
    this.onSelect(hit ? hit.object.userData.recordId as string : null);
  };
  private updateSun(): void {
    const direction = sunDirectionAt(Date.parse(this.frameTime));
    this.globe?.setSunDirection(direction); this.atmosphere?.setSunDirection(direction);
  }
  update(projection: Geographic, selected: string | null, at: string): void {
    if (this.disposed) return;
    this.frameTime = at; this.updateSun();
    if (this.projection !== projection) {
      releaseTree(this.network);
      for (const item of projection.items) {
        let object: THREE.Points | THREE.Line;
        const shape = item.sourceGeometry.shape;
        if (shape.type === 'Point') {
          const geometry = new THREE.BufferGeometry().setFromPoints(item.vertices.map((p) => new THREE.Vector3(...p).multiplyScalar(1.008)));
          object = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x5ee1d4, size: 5, sizeAttenuation: false }));
        } else {
          // Display densification only; original geometry and its basis stay in the projection.
          // Antipodal waypoints have no unique great-circle interpolation: refuse instead of choosing one.
          const ambiguous = item.vertices.some((p, i) => i > 0 && new THREE.Vector3(...p).dot(new THREE.Vector3(...item.vertices[i - 1])) < -0.999999);
          if (ambiguous) { this.onStatus('unavailable: antipodal path needs an explicit interpolation basis'); continue; }
          const path = samplePath(shape.coordinates.map((p) => [p[0], p[1]]), { samples: Math.min(512, Math.max(96, shape.coordinates.length * 4)), baseRadius: 1.006 });
          object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path.points),
            new THREE.LineBasicMaterial({ color: 0x477b9d, transparent: true, opacity: 0.75 }));
        }
        object.userData.recordId = item.recordId; this.network.add(object);
      }
      this.projection = projection;
    }
    for (const child of this.network.children) {
      const object = child as THREE.Points | THREE.Line;
      const material = object.material as THREE.PointsMaterial | THREE.LineBasicMaterial;
      const active = object.userData.recordId === selected;
      material.color.set(active ? 0xffd277 : object instanceof THREE.Points ? 0x5ee1d4 : 0x477b9d);
      if (material instanceof THREE.PointsMaterial) material.size = active ? 10 : 5;
    }
    if (selected !== this.selected) {
      const item = projection.items.find((p) => p.recordId === selected);
      if (item) {
        const shape = item.sourceGeometry.shape;
        const p = shape.type === 'Point' ? shape.coordinates : shape.coordinates[Math.floor(shape.coordinates.length / 2)];
        void this.controls.flyToLatLon(p[1], p[0], { distance: 2.6, durationMs: 600 });
      }
      this.selected = selected;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.abort.abort(); cancelAnimationFrame(this.raf);
    this.observer.disconnect(); this.controls.dispose();
    document.removeEventListener('visibilitychange', this.visibility);
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.pick);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    releaseTree(this.scene);
    if (this.textures) Object.values(this.textures).forEach((t) => t.dispose());
    this.renderer.renderLists.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
