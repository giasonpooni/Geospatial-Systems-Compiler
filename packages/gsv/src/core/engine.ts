/**
 * Render engine: WebGL renderer, scene, camera, cinematic post chain
 * (bloom), frame loop with fps tracking and hidden-tab pause.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export type FrameCallback = (dt: number, elapsed: number) => void;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private callbacks: FrameCallback[] = [];
  private clock = new THREE.Clock();
  private running = false;
  private frames = 0;
  private fpsAccum = 0;
  fps = 60;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setClearColor(0x020409, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 120);
    this.camera.position.set(0, 0.6, 4.4);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.75, 0.82);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clock.stop();
      else this.clock.start();
    });
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  onFrame(cb: FrameCallback): void {
    this.callbacks.push(cb);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      if (document.hidden) return;
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const elapsed = this.clock.elapsedTime;
      for (const cb of this.callbacks) cb(dt, elapsed);
      this.composer.render();
      this.fpsAccum += dt;
      this.frames++;
      if (this.fpsAccum >= 0.5) {
        this.fps = this.frames / this.fpsAccum;
        this.frames = 0;
        this.fpsAccum = 0;
      }
    };
    requestAnimationFrame(loop);
  }
}
