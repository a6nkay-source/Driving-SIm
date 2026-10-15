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
    const dpr = Math.min(window.devicePixelRatio || 1, s.quality === 'ultra' ? 2 : 1.5) * s.renderScale;
    this.renderer.setPixelRatio(dpr);
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

  private loop = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
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
  };

  dispose(): void {
    this.stop();
    this.observer.disconnect();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
