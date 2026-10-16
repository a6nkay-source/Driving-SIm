/**
 * Cinematic main-menu scene: the car on wet asphalt at the Marine Drive sea
 * wall at night, the Queen's Necklace curving around the bay, and a lit Mumbai
 * skyline beyond. Camera shots blend automatically; the garage mode lets the
 * player orbit the car by dragging.
 */
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { carStore } from '../core/carConfig';
import type { SceneController } from '../engine/Engine';
import { hash01, rng } from '../map/geometry';
import { BuildingStyle, type BuildingData } from '../map/types';
import { CarModel } from '../vehicle/CarModel';
import { isVehicleId, type PlayerVehicleId } from '../vehicle/fleet';
import { createUtilityModel, type PlayerModel } from '../vehicle/MumbaiVehicles';
import { buildBuildingGeometry } from '../world/BuildingBuilder';
import { createBuildingMaterial, createWaterMaterial, worldUniforms } from '../world/materials';
import { asphaltTexture, puddleTexture, radialTexture } from '../world/textures';

export type MenuMode = 'menu' | 'garage' | 'map' | 'settings' | 'about' | 'loading';

interface Shot {
  pos: (t: number) => THREE.Vector3;
  target: (t: number) => THREE.Vector3;
  fov: number;
  duration: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export class MenuScene implements SceneController {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 4000);
  readonly car: CarModel;
  private mode: MenuMode = 'menu';
  private time = 0;
  private shotIndex = 0;
  private shotTime = 0;
  private camPos = V(9, 1.6, 9);
  private camTarget = V(0, 0.7, 0);
  private orbit = { yaw: 0.9, pitch: 0.18, dist: 6.2, dragging: false, lastX: 0, lastY: 0, auto: true };
  private disposers: (() => void)[] = [];
  private reflector: Reflector;
  private necklace: THREE.InstancedMesh;
  private aviation: THREE.Sprite[] = [];
  private turntable = new THREE.Group();
  private envTarget: THREE.WebGLRenderTarget;
  private powerOn = 0;
  private shots: Shot[];
  private hoverShot: number | null = null;
  /** The rickshaw / taxi / bus when one is chosen in the garage. */
  private alt: PlayerModel | null = null;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    RectAreaLightUniformsLib.init();
    const s = this.scene;
    s.fog = new THREE.FogExp2(0x0a1020, 0.0016);
    worldUniforms.uNight.value = 1;
    worldUniforms.uWet.value = 0.7;

    this.envTarget = this.buildEnvironment();
    s.environment = this.envTarget.texture;
    s.environmentIntensity = 1.25;
    s.add(this.buildSky());

    // Car on a slow turntable (only turns in garage mode).
    this.car = new CarModel(carStore.get(), { lights: true, shadows: true });
    this.car.root.rotation.y = -0.35;
    this.turntable.add(this.car.root);
    s.add(this.turntable);
    this.disposers.push(
      carStore.subscribe(() => {
        this.car.applyConfig(carStore.get());
        this.syncVehicle();
      }),
    );
    // Explicit env maps so per-material reflection strengths apply.
    for (const m of [this.car.mats.paint, this.car.mats.glass, this.car.mats.chrome, this.car.mats.headLens, this.car.mats.rim]) m.envMap = this.envTarget.texture;

    // Wet ground: a mirror under a partially transparent asphalt layer.
    this.reflector = new Reflector(new THREE.CircleGeometry(70, 64), {
      clipBias: 0.003,
      textureWidth: 1024,
      textureHeight: 1024,
      color: 0x5a6070,
    });
    this.reflector.rotation.x = -Math.PI / 2;
    this.reflector.position.y = -0.002;
    s.add(this.reflector);
    s.add(this.buildWetAsphalt());
    s.add(this.buildPromenade());
    s.add(this.buildWater());
    this.necklace = this.buildNecklace();
    s.add(this.necklace);
    s.add(this.buildSkyline());
    this.buildLights();

    this.shots = [
      {
        // Low hero 3/4 front, slow orbit.
        pos: (t) => {
          const a = 0.55 + t * 0.045;
          return V(Math.sin(a) * 6.4, 0.75 + t * 0.02, Math.cos(a) * 6.4 - 1.2);
        },
        target: () => V(0, 0.62, -0.6),
        fov: 34,
        duration: 9,
      },
      {
        // Headlight dolly.
        pos: (t) => V(-2.6 + t * 0.12, 0.72, -4.4 + t * 0.05),
        target: () => V(-0.6, 0.65, -2.0),
        fov: 30,
        duration: 7,
      },
      {
        // Side profile tracking shot with skyline behind.
        pos: (t) => V(6.8 - t * 0.35, 1.05, 2.4 + t * 0.12),
        target: (t) => V(0.2 - t * 0.1, 0.7, -0.3),
        fov: 32,
        duration: 8,
      },
      {
        // High rear 3/4 looking out over the bay.
        pos: (t) => {
          const a = 2.55 + t * 0.03;
          return V(Math.sin(a) * 7.5, 2.4 - t * 0.04, Math.cos(a) * 7.5);
        },
        target: () => V(0, 0.4, -6),
        fov: 40,
        duration: 8,
      },
    ];

    const dom = renderer.domElement;
    const down = (e: PointerEvent) => {
      if (this.mode !== 'garage') return;
      this.orbit.dragging = true;
      this.orbit.auto = false;
      this.orbit.lastX = e.clientX;
      this.orbit.lastY = e.clientY;
      dom.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!this.orbit.dragging) return;
      this.orbit.yaw -= (e.clientX - this.orbit.lastX) * 0.008;
      this.orbit.pitch = Math.max(0.02, Math.min(0.7, this.orbit.pitch + (e.clientY - this.orbit.lastY) * 0.004));
      this.orbit.lastX = e.clientX;
      this.orbit.lastY = e.clientY;
    };
    const up = () => (this.orbit.dragging = false);
    const wheel = (e: WheelEvent) => {
      if (this.mode !== 'garage') return;
      const k = this.vehicleScale();
      this.orbit.dist = Math.max(4.5 * k, Math.min(13 * k, this.orbit.dist + e.deltaY * 0.006 * k));
    };
    dom.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    dom.addEventListener('wheel', wheel, { passive: true });
    this.disposers.push(() => {
      dom.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dom.removeEventListener('wheel', wheel);
    });
  }

  setMode(mode: MenuMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'garage') {
      this.orbit.auto = true;
      this.orbit.yaw = 0.9;
      this.orbit.pitch = 0.14;
      this.orbit.dist = 9.2 * this.vehicleScale();
    }
    this.syncVehicle();
  }

  private selected(): PlayerVehicleId {
    const v = carStore.get().vehicle;
    return isVehicleId(v) ? v : 'gtr';
  }

  private vehicleScale(): number {
    const v = this.selected();
    return this.mode !== 'garage' ? 1 : v === 'bus' ? 2.1 : v === 'auto' ? 0.78 : v === 'taxi' ? 0.95 : 1;
  }

  /** The garage shows the chosen vehicle; the cinematic menu shots always feature the GT. */
  private syncVehicle(): void {
    const want = this.mode === 'garage' ? this.selected() : 'gtr';
    if (want === 'gtr') {
      this.car.root.visible = true;
      if (this.alt) {
        this.turntable.remove(this.alt.root);
        this.alt.dispose();
        this.alt = null;
      }
      return;
    }
    if (this.alt?.id === want) return;
    if (this.alt) {
      this.turntable.remove(this.alt.root);
      this.alt.dispose();
    }
    const m = createUtilityModel(want);
    m.root.rotation.y = -0.35;
    for (const mat of m.reflective) mat.envMap = this.envTarget.texture;
    m.setHeadlights(true);
    m.setBeamStrength(0.8);
    this.turntable.add(m.root);
    this.alt = m;
    this.car.root.visible = false;
    if (this.mode === 'garage') this.orbit.dist = 9.2 * this.vehicleScale();
  }

  /** Previews a specific shot while a menu button is hovered (null resumes the cycle). */
  previewShot(index: number | null): void {
    if (index !== this.hoverShot) {
      this.hoverShot = index;
      if (index !== null) this.shotTime = 0;
    }
  }

  private buildEnvironment(): THREE.WebGLRenderTarget {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x05070c);
    const box = (w: number, h: number, color: number, intensity: number, pos: THREE.Vector3, look = V(0, 0, 0)) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
      m.position.copy(pos);
      m.lookAt(look);
      env.add(m);
    };
    // Softbox above, strip lights on the sides, warm city glow on the horizon.
    box(10, 3, 0xffffff, 2.2, V(0, 9, 0));
    box(14, 0.6, 0xbfd4ff, 3.2, V(-8, 3.5, 2));
    box(14, 0.6, 0xffc58a, 2.6, V(8, 3, -2));
    box(6, 0.5, 0xffffff, 2.5, V(0, 4, 9));
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(30, 30, 3, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8a3a).multiplyScalar(0.55), side: THREE.BackSide }),
    );
    ring.position.y = 0.5;
    env.add(ring);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(env, 0.035);
    pmrem.dispose();
    return rt;
  }

  private buildSky(): THREE.Object3D {
    const g = new THREE.Group();
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 zenith = vec3(0.012, 0.02, 0.055);
          vec3 mid = vec3(0.03, 0.05, 0.11);
          vec3 glow = vec3(0.32, 0.17, 0.09);
          vec3 c = mix(mid, zenith, smoothstep(0.05, 0.6, h));
          c = mix(glow, c, smoothstep(-0.02, 0.18, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMat);
    dome.renderOrder = -10;
    g.add(dome);
    // Stars.
    const r = rng(9);
    const starPos: number[] = [];
    for (let i = 0; i < 900; i++) {
      const a = r() * Math.PI * 2;
      const y = 0.12 + r() * 0.88;
      const rad = Math.sqrt(1 - y * y);
      starPos.push(Math.cos(a) * rad * 2800, y * 2800, Math.sin(a) * rad * 2800);
    }
    const stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3)),
      new THREE.PointsMaterial({ color: 0xcfd8ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.75, fog: false }),
    );
    g.add(stars);
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), color: 0xe9eeff, fog: false, transparent: true }));
    moon.position.set(-900, 900, -2200);
    moon.scale.setScalar(140);
    g.add(moon);
    return g;
  }

  private buildWetAsphalt(): THREE.Mesh {
    const tex = asphaltTexture().clone();
    tex.repeat.set(14, 14);
    tex.needsUpdate = true;
    const alpha = puddleTexture().clone();
    alpha.repeat.set(5, 5);
    alpha.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      color: 0x8a8d94,
      roughness: 0.42,
      metalness: 0.0,
      transparent: true,
      opacity: 0.86,
      alphaMap: alpha,
      envMapIntensity: 0.6,
    });
    // Puddles are where the alpha map is bright → invert so puddles show the mirror.
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <alphamap_fragment>',
        `#ifdef USE_ALPHAMAP
          diffuseColor.a *= 1.0 - 0.75 * smoothstep(0.2, 0.75, texture2D( alphaMap, vAlphaMapUv ).g);
        #endif`,
      );
    };
    const m = new THREE.Mesh(new THREE.CircleGeometry(70, 64), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.004;
    m.receiveShadow = true;
    return m;
  }

  private buildPromenade(): THREE.Group {
    const g = new THREE.Group();
    const conc = new THREE.MeshStandardMaterial({ color: 0x9b968c, roughness: 0.85 });
    // The famous Marine Drive parapet people sit on.
    const wall = new THREE.Mesh(new THREE.BoxGeometry(140, 0.6, 0.8), conc);
    wall.position.set(0, 0.3, -13);
    wall.receiveShadow = true;
    g.add(wall);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.5, metalness: 0.6 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffb45a, emissiveIntensity: 4 });
    const halo = radialTexture();
    for (let i = -5; i <= 5; i++) {
      const x = i * 14 + 4;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 7, 10), lampMat);
      pole.position.set(x, 3.5, -13.6);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.4), lampMat);
      arm.position.set(x, 6.9, -13.0);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), headMat);
      head.position.set(x, 6.8, -12.4);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color: 0xffb860, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
      glow.position.copy(head.position);
      glow.scale.setScalar(2.4);
      g.add(pole, arm, head, glow);
    }
    return g;
  }

  private buildWater(): THREE.Mesh {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 3000), createWaterMaterial());
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -1.2, -1500 - 13.5);
    return water;
  }

  private buildNecklace(): THREE.InstancedMesh {
    const pts: THREE.Vector3[] = [];
    const R = 820;
    const cz = 260;
    for (let a = -0.92; a <= 0.92; a += 0.0062) pts.push(V(Math.sin(a) * R, 6, cz - Math.cos(a) * R));
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.9, 8, 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.7, 0.32).multiplyScalar(4) }),
      pts.length,
    );
    const m = new THREE.Matrix4();
    pts.forEach((p, i) => {
      m.makeTranslation(p.x, p.y, p.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.frustumCulled = false;
    // Reflections of the necklace on the bay: long vertical streaks.
    const streakTex = radialTexture();
    const streaks = new THREE.Group();
    pts.forEach((p, i) => {
      if (i % 3) return;
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: streakTex, color: 0xffa648, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 }),
      );
      sp.position.set(p.x, -1.0, p.z + 6);
      sp.scale.set(4, 34, 1);
      streaks.add(sp);
    });
    mesh.add(streaks);
    return mesh;
  }

  private buildSkyline(): THREE.Mesh {
    const r = rng(42);
    const list: BuildingData[] = [];
    const R = 820;
    const cz = 260;
    let id = 1;
    const addBox = (x: number, z: number, w: number, d: number, h: number, style: BuildingData['s'], rot: number) => {
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const pts = [
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [w / 2, d / 2],
        [-w / 2, d / 2],
      ].flatMap(([px, pz]) => [x + px * c - pz * s, z + px * s + pz * c]);
      list.push({ id: id++, p: pts, h, m: 0, s: style });
    };
    // Art Deco front row along the curve, towers behind.
    for (let a = -0.9; a <= 0.9; a += 0.028) {
      const rr = R + 22 + r() * 8;
      addBox(Math.sin(a) * rr, cz - Math.cos(a) * rr, 18 + r() * 10, 16 + r() * 6, 16 + r() * 12, BuildingStyle.ArtDeco, -a);
    }
    for (let k = 0; k < 260; k++) {
      const a = -1.05 + r() * 2.1;
      const rr = R + 260 + Math.pow(r(), 0.7) * 900;
      const tall = r() < 0.32;
      const h = tall ? 55 + Math.pow(r(), 1.8) * 170 : 16 + r() * 34;
      addBox(Math.sin(a) * rr, cz - Math.cos(a) * rr, 18 + r() * 26, 18 + r() * 26, h, tall && r() < 0.6 ? BuildingStyle.GlassTower : BuildingStyle.Concrete, r() * 3);
      if (h > 150) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), color: 0xff2020, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        sp.position.set(Math.sin(a) * rr, h + 3, cz - Math.cos(a) * rr);
        sp.scale.setScalar(10);
        sp.userData.phase = hash01(k);
        this.aviation.push(sp);
        this.scene.add(sp);
      }
    }
    const { geometry } = buildBuildingGeometry(list, { tanks: false });
    const mesh = new THREE.Mesh(geometry, createBuildingMaterial());
    mesh.frustumCulled = false;
    return mesh;
  }

  private buildLights(): void {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x3a4a78, 0x0b0a0a, 0.35));
    const strip = new THREE.RectAreaLight(0xe8eeff, 11, 7, 1.4);
    strip.position.set(0, 5.5, 0.6);
    strip.lookAt(0, 0, 0);
    s.add(strip);
    const strip2 = new THREE.RectAreaLight(0xffd2a0, 7, 6, 0.8);
    strip2.position.set(5.5, 2.2, -2.5);
    strip2.lookAt(0, 0.6, 0);
    s.add(strip2);
    const rim = new THREE.SpotLight(0xff9b40, 140, 30, 0.55, 0.6, 1.4);
    rim.position.set(-6, 4.5, -7);
    rim.target.position.set(0, 0.5, 0);
    s.add(rim, rim.target);
    const key = new THREE.SpotLight(0x9fb6ff, 160, 40, 0.5, 0.7, 1.4);
    key.position.set(7, 7, 6);
    key.target.position.set(0, 0.5, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    s.add(key, key.target);
  }

  update(dt: number): void {
    this.time += dt;
    worldUniforms.uTime.value = this.time;
    worldUniforms.uNight.value = 1;
    worldUniforms.uWet.value = 0.7;

    // Headlight power-on sequence: DRL sweep, then a double flash and steady beams.
    this.powerOn += dt;
    const p = this.powerOn;
    const drl = p < 0.4 ? 0 : p < 1.0 ? (p - 0.4) / 0.6 * (0.7 + 0.3 * Math.sin(p * 60)) : 1;
    this.car.setDrl(Math.max(0, drl));
    const on = p > 1.3 && !(p > 1.42 && p < 1.55);
    if (on !== this.car.isHeadlightsOn()) this.car.setHeadlights(on);
    this.car.setBeamStrength(on ? Math.min(1, (p - 1.3) * 2) * (0.9 + 0.1 * Math.sin(this.time * 1.7)) : 0);

    for (const a of this.aviation) {
      (a.material as THREE.SpriteMaterial).opacity = Math.sin(this.time * 3 + a.userData.phase * 6) > 0.6 ? 1 : 0.08;
    }

    // Camera.
    let desiredPos: THREE.Vector3;
    let desiredTarget: THREE.Vector3;
    let fov: number;
    if (this.mode === 'garage') {
      if (this.orbit.auto) this.orbit.yaw += dt * 0.12;
      const o = this.orbit;
      desiredPos = V(Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, 0.5 + Math.sin(o.pitch) * o.dist, Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
      desiredTarget = V(0, 0.55 * (this.alt?.id === 'bus' ? 2.6 : 1), 0);
      fov = 34;
    } else if (this.mode === 'map' || this.mode === 'loading') {
      const a = this.time * 0.03;
      desiredPos = V(Math.sin(a) * 14, 9, 12 + Math.cos(a) * 3);
      desiredTarget = V(0, 0, -30);
      fov = 45;
    } else {
      this.shotTime += dt;
      const idx = this.hoverShot ?? this.shotIndex;
      const shot = this.shots[idx % this.shots.length];
      if (this.hoverShot === null && this.shotTime > shot.duration) {
        this.shotIndex = (this.shotIndex + 1) % this.shots.length;
        this.shotTime = 0;
      }
      desiredPos = shot.pos(this.shotTime);
      desiredTarget = shot.target(this.shotTime);
      fov = shot.fov;
      // Menu panels sit on the left: nudge the framing so the car stays visible.
      if (this.mode === 'settings' || this.mode === 'about') desiredTarget.x -= 1.4;
    }
    // Portrait screens: widen the vertical FOV so the car stays in frame.
    if (this.camera.aspect < 1) fov = Math.min(80, fov / Math.pow(this.camera.aspect, 0.75));
    const k = 1 - Math.exp(-dt * (this.mode === 'garage' ? 6 : 1.6));
    this.camPos.lerp(desiredPos, k);
    this.camTarget.lerp(desiredTarget, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.camera.fov += (fov - this.camera.fov) * k;
    this.camera.updateProjectionMatrix();
  }

  bloom() {
    return { strength: 0.85, radius: 0.55, threshold: 0.82 };
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.car.dispose();
    this.alt?.dispose();
    this.envTarget.dispose();
    this.reflector.getRenderTarget().dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m !== this.reflector) m.geometry?.dispose();
    });
  }
}
