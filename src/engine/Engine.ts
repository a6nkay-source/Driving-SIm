/**
 * Owns the WebGL renderer, the post-processing chain and the main loop. Scenes
 * (menu, drive) plug in as SceneControllers and can be swapped at runtime.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Settings } from '../core/settings';

export interface SceneController {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Fixed-step-agnostic update; dt is clamped by the engine. */
  update(dt: number, time: number): void;
  resize?(width: number, height: number): void;
  dispose(): void;
  /** Desired bloom parameters (strength 0 disables). */
  bloom?(): { strength: number; radius: number; threshold: number };
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloomPass: UnrealBloomPass;
  private current: SceneController | null = null;
  private running = false;
  private last = 0;
  private settings: Settings;
  private width = 1;
  private height = 1;
  private observer: ResizeObserver;
  fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  /**
   * Dynamic resolution: a multiplier on the pixel ratio that drops when the
   * GPU cannot hold ~60 fps and climbs back when there is headroom.
   */
  dynScale = 1;
  /** Smoothed GPU time per frame (ms), from timer queries when the browser offers them. */
  gpuMs = 0;
  private timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private queries: WebGLQuery[] = [];
  private frameMs = 16.7;
  private scaleTimer = 0;
  private calmTime = 0;
  private sinceDrop = 100;
  /** Highest scale known to be too slow recently (we stay just under it). */
  private ceiling = 1;
  private basePixelRatio = 1;
  onFrame: ((dt: number) => void) | null = null;
  /** Called when the GPU context is lost (driver reset, tab backgrounded on mobile). */
  onContextLost: (() => void) | null = null;

  constructor(
    private readonly container: HTMLElement,
    settings: Settings,
  ) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.domElement.className = 'game-canvas';
    r.domElement.tabIndex = 0;
    r.domElement.setAttribute('aria-label', 'Drive Mumbai 3D view');
    container.appendChild(r.domElement);
    r.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost?.();
    });

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, target);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 0.85);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.timerExt = r.getContext().getExtension('EXT_disjoint_timer_query_webgl2');

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.applySettings(settings);
    this.resize();
  }

  static isWebGLAvailable(): boolean {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, s.quality === 'ultra' ? 2 : 1.5) * s.renderScale;
    if (!s.autoResolution) this.dynScale = 1;
    this.renderer.setPixelRatio(this.basePixelRatio * this.dynScale);
    this.renderer.shadowMap.enabled = s.shadows;
    this.resize();
  }

  get pixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  setScene(ctrl: SceneController | null): void {
    this.current = ctrl;
    if (ctrl) {
      ctrl.resize?.(this.width, this.height);
      ctrl.camera.aspect = this.width / this.height;
      ctrl.camera.updateProjectionMatrix();
    }
  }

  getScene(): SceneController | null {
    return this.current;
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    if (this.current) {
      this.current.camera.aspect = w / h;
      this.current.camera.updateProjectionMatrix();
      this.current.resize?.(w, h);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.renderer.setAnimationLoop(this.loop);
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  /** GPU time of finished frames, and the resolution adjustment it drives. */
  private adaptResolution(dt: number): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const ext = this.timerExt;
    if (ext) {
      while (this.queries.length && gl.getQueryParameter(this.queries[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = this.queries.shift()!;
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
        gl.deleteQuery(q);
        if (!disjoint) this.gpuMs += (ns / 1e6 - this.gpuMs) * 0.1;
      }
      // A backlog means results are not coming back (e.g. a hidden tab): drop it.
      if (this.queries.length > 12) this.queries.splice(0, this.queries.length - 4).forEach((q) => gl.deleteQuery(q));
    }
    this.frameMs += (dt * 1000 - this.frameMs) * 0.1;
    if (!this.settings.autoResolution || dt <= 0 || dt >= 0.1) return;
    this.scaleTimer -= dt;
    this.sinceDrop += dt;
    if (this.scaleTimer > 0) return;
    this.scaleTimer = 0.5;
    // Decide on real frame pacing (GPU timer queries are not reliable on every
    // driver). Below ~52 fps: step the resolution down. Holding 60 for a few
    // seconds: creep back up, but not straight back to a scale that was too slow.
    let next = this.dynScale;
    if (this.frameMs > 19.2) {
      this.ceiling = this.dynScale;
      next = Math.max(0.6, this.dynScale * (this.frameMs > 26 ? 0.85 : 0.92));
      this.calmTime = 0;
      this.sinceDrop = 0;
    } else if (this.frameMs < 17.4) {
      this.calmTime += 0.5;
      const cap = this.sinceDrop > 20 ? 1 : Math.min(1, this.ceiling * 0.97);
      if (this.calmTime > 3 && this.dynScale < cap) {
        next = Math.min(cap, this.dynScale * 1.05);
        this.calmTime = 0;
      }
    } else this.calmTime = 0;
    if (Math.abs(next - this.dynScale) > 0.005) {
      this.dynScale = next;
      this.renderer.setPixelRatio(this.basePixelRatio * this.dynScale);
      this.resize();
    }
  }

  private loop = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.adaptResolution(dt);
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    const ctrl = this.current;
    if (!ctrl) return;
    ctrl.update(dt, now / 1000);
    this.onFrame?.(dt);
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    let query: WebGLQuery | null = null;
    if (this.timerExt && this.queries.length < 8) {
      query = gl.createQuery();
      if (query) gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, query);
    }
    const bloom = this.settings.bloom ? ctrl.bloom?.() : undefined;
    if (bloom && bloom.strength > 0.01) {
      this.renderPass.scene = ctrl.scene;
      this.renderPass.camera = ctrl.camera;
      this.bloomPass.strength = bloom.strength;
      this.bloomPass.radius = bloom.radius;
      this.bloomPass.threshold = bloom.threshold;
      this.composer.render(dt);
    } else {
      this.renderer.render(ctrl.scene, ctrl.camera);
    }
    if (query && this.timerExt) {
      gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
      this.queries.push(query);
    }
  };

  dispose(): void {
    this.stop();
    this.observer.disconnect();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
