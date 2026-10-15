/**
 * Sky, sun / moon, haze, image-based lighting, time of day and monsoon rain.
 * Sunset puts the sun low over the Arabian Sea to the west — Marine Drive's
 * famous view.
 */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { Quality, TimeOfDay, Weather } from '../core/settings';
import { rng } from '../map/geometry';
import { worldUniforms } from './materials';
import { radialTexture } from './textures';

interface Preset {
  elevation: number;
  azimuth: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fog: number;
  fogDensity: number;
  turbidity: number;
  rayleigh: number;
  mie: number;
  mieG: number;
  night: number;
  exposure: number;
}

const PRESETS: Record<TimeOfDay, Preset> = {
  day: {
    elevation: 58,
    azimuth: 150,
    sunColor: 0xfff1dc,
    sunIntensity: 3.4,
    hemiSky: 0x9fbbe0,
    hemiGround: 0x6b5d4c,
    hemiIntensity: 0.95,
    fog: 0xa9b9c6,
    fogDensity: 0.0006,
    turbidity: 4,
    rayleigh: 1.9,
    mie: 0.004,
    mieG: 0.8,
    night: 0,
    exposure: 0.58,
  },
  sunset: {
    elevation: 5,
    azimuth: -78,
    sunColor: 0xffa75c,
    sunIntensity: 3.0,
    hemiSky: 0xf2b48c,
    hemiGround: 0x4a3a40,
    hemiIntensity: 1.25,
    fog: 0xb98466,
    fogDensity: 0.00095,
    turbidity: 9,
    rayleigh: 2.6,
    mie: 0.006,
    mieG: 0.86,
    night: 0.4,
    exposure: 0.5,
  },
  night: {
    elevation: 40,
    azimuth: 40,
    sunColor: 0x9fb6ff,
    sunIntensity: 0.32,
    hemiSky: 0x2a3b5e,
    hemiGround: 0x0e0c0c,
    hemiIntensity: 0.45,
    fog: 0x0c1324,
    fogDensity: 0.0014,
    turbidity: 1,
    rayleigh: 0.2,
    mie: 0.001,
    mieG: 0.8,
    night: 1,
    exposure: 1.05,
  },
};

const RAIN_COUNT = 9000;

/** Renders an object at the far plane so huge sky elements never get clipped. */
function pinToFarPlane(mat: THREE.Material, after: string): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(after, `${after}\n gl_Position.z = gl_Position.w;`);
  };
}

export class Environment {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private sky = new Sky();
  private nightDome: THREE.Mesh;
  private stars: THREE.Points;
  private moon: THREE.Sprite;
  private rain: THREE.LineSegments;
  private rainMat: THREE.ShaderMaterial;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private pmrem: THREE.PMREMGenerator;
  private sunDir = new THREE.Vector3();
  private weather: Weather = 'clear';
  private lightning = 0;
  private nextLightning = 8;
  private baseHemi = 1;
  night = 0;
  wet = 0;
  shadowExtent = 90;
  /**
   * Materials that need their own reflection strength. three.js replaces a
   * material's envMapIntensity with scene.environmentIntensity unless the
   * material has an explicit envMap, so these get the env map assigned directly.
   */
  private reflective = new Set<THREE.MeshStandardMaterial>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sky.scale.setScalar(20000);
    this.sky.name = 'sky';
    scene.add(this.sky);
    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
      fragmentShader: `varying vec3 vDir;
        uniform vec3 uHaze;
        void main(){
          float h = vDir.y;
          vec3 zenith = vec3(0.01, 0.018, 0.05);
          vec3 mid = vec3(0.025, 0.045, 0.1);
          vec3 c = mix(mid, zenith, smoothstep(0.05, 0.6, h));
          c = mix(uHaze, c, smoothstep(-0.03, 0.2, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
      uniforms: { uHaze: { value: new THREE.Color(0.3, 0.16, 0.08) } },
    });
    this.nightDome = new THREE.Mesh(new THREE.SphereGeometry(15000, 32, 16), domeMat);
    this.nightDome.renderOrder = -10;
    scene.add(this.nightDome);
    const r = rng(17);
    const starPos: number[] = [];
    for (let i = 0; i < 1200; i++) {
      const a = r() * Math.PI * 2;
      const y = 0.1 + r() * 0.9;
      const rad = Math.sqrt(1 - y * y);
      starPos.push(Math.cos(a) * rad * 12000, y * 12000, Math.sin(a) * rad * 12000);
    }
    this.stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3)),
      new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.8, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 }),
    );
    pinToFarPlane(this.stars.material as THREE.Material, '#include <project_vertex>');
    scene.add(this.stars);
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), color: 0xeef2ff, fog: false, transparent: true }));
    this.moon.scale.setScalar(500);
    pinToFarPlane(this.moon.material, 'gl_Position = projectionMatrix * mvPosition;');
    scene.add(this.moon);

    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target, this.hemi);

    // Monsoon rain: streaks animated entirely on the GPU around the camera.
    const pos = new Float32Array(RAIN_COUNT * 2 * 3);
    const seed = new Float32Array(RAIN_COUNT * 2);
    for (let i = 0; i < RAIN_COUNT; i++) {
      const x = (r() - 0.5) * 90;
      const y = r() * 40;
      const z = (r() - 0.5) * 90;
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        seed[i * 2 + k] = k;
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(seed, 1));
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: worldUniforms.uTime, uCenter: { value: new THREE.Vector3() }, uOpacity: { value: 0 } },
      vertexShader: `
        attribute float aEnd;
        uniform float uTime;
        uniform vec3 uCenter;
        varying float vEnd;
        void main() {
          vec3 p = position;
          float fall = mod(p.y - uTime * 22.0, 40.0);
          vec3 w = vec3(p.x + uCenter.x, fall + uCenter.y - 12.0, p.z + uCenter.z);
          w.x = uCenter.x + mod(w.x - uCenter.x + 45.0, 90.0) - 45.0;
          w += vec3(0.25, 1.0, 0.1) * aEnd * 0.9;
          vEnd = aEnd;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: `
        uniform float uOpacity;
        varying float vEnd;
        void main() { gl_FragColor = vec4(0.75, 0.8, 0.88, uOpacity * (0.35 + 0.65 * vEnd)); }`,
    });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
  }

  apply(time: TimeOfDay, weather: Weather, quality: Quality, shadows: boolean): void {
    const p = PRESETS[time];
    this.weather = weather;
    const monsoon = weather === 'monsoon';
    const phi = THREE.MathUtils.degToRad(90 - p.elevation);
    const theta = THREE.MathUtils.degToRad(p.azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = monsoon ? 18 : p.turbidity;
    u.rayleigh.value = monsoon ? 0.6 : p.rayleigh;
    u.mieCoefficient.value = monsoon ? 0.02 : p.mie;
    u.mieDirectionalG.value = p.mieG;
    const isNight = time === 'night';
    this.sky.visible = !isNight;
    this.nightDome.visible = isNight;
    this.stars.visible = isNight && !monsoon;
    this.moon.visible = isNight && !monsoon;
    this.moon.position.copy(this.sunDir).multiplyScalar(11000);

    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity * (monsoon ? 0.3 : 1);
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    if (monsoon) {
      this.hemi.color.lerp(new THREE.Color(0x9aa4ad), 0.6);
    }
    this.baseHemi = p.hemiIntensity * (monsoon ? 1.15 : 1);
    this.hemi.intensity = this.baseHemi;
    const fogColor = new THREE.Color(p.fog);
    if (monsoon) fogColor.lerp(new THREE.Color(isNight ? 0x10161f : 0x7e8891), 0.7);
    this.scene.fog = new THREE.FogExp2(fogColor, p.fogDensity * (monsoon ? 2.1 : 1));
    this.scene.background = fogColor;
    this.renderer.toneMappingExposure = p.exposure * (monsoon && !isNight ? 0.95 : 1);
    this.night = p.night;
    this.wet = monsoon ? 1 : 0;
    worldUniforms.uNight.value = this.night;
    worldUniforms.uWet.value = this.wet;
    this.rain.visible = monsoon;
    this.rainMat.uniforms.uOpacity.value = isNight ? 0.3 : 0.45;

    // Shadows.
    const size = quality === 'ultra' ? 4096 : quality === 'high' ? 2048 : 1024;
    this.sun.castShadow = shadows;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    this.shadowExtent = quality === 'ultra' ? 130 : quality === 'high' ? 95 : 70;
    const cam = this.sun.shadow.camera;
    cam.left = -this.shadowExtent;
    cam.right = this.shadowExtent;
    cam.top = this.shadowExtent;
    cam.bottom = -this.shadowExtent;
    cam.near = 1;
    cam.far = 900;
    cam.updateProjectionMatrix();

    this.rebuildEnvMap(isNight, fogColor);
  }

  private rebuildEnvMap(isNight: boolean, fog: THREE.Color): void {
    const env = new THREE.Scene();
    if (isNight) {
      const dome = this.nightDome.clone();
      dome.scale.setScalar(0.01);
      env.add(dome);
      // City lights reflected in the paint.
      const strip = (color: number, y: number, intensity: number) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(120, 120, 6, 32, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.BackSide }));
        m.position.y = y;
        env.add(m);
      };
      strip(0xffa24a, 3, 0.5);
      strip(0x6f8ccf, 14, 0.12);
    } else {
      const sky = new Sky();
      sky.scale.setScalar(1000);
      const su = sky.material.uniforms;
      const u = this.sky.material.uniforms;
      for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) su[k].value = u[k].value;
      su.sunPosition.value.copy(u.sunPosition.value);
      env.add(sky);
      // The raw Preetham sky is far brighter than the direct lighting; dim it
      // inside the probe so reflections sit naturally in the scene.
      const dimmer = new THREE.Mesh(
        new THREE.SphereGeometry(900, 24, 12),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: this.weather === 'monsoon' ? 0.55 : 0.72, side: THREE.BackSide, depthWrite: false }),
      );
      env.add(dimmer);
      // Ground bounce so undersides are not black.
      const ground = new THREE.Mesh(new THREE.CircleGeometry(800, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: fog.clone().multiplyScalar(0.35) }));
      ground.position.y = -5;
      env.add(ground);
    }
    const rt = this.pmrem.fromScene(env, 0.04, 1, 2000);
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    for (const m of this.reflective) {
      m.envMap = rt.texture;
      m.needsUpdate = true;
    }
    this.scene.environmentIntensity = isNight ? 0.55 : this.weather === 'monsoon' ? 0.75 : 0.8;
    env.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m !== this.nightDome) m.geometry.dispose();
    });
  }

  /** Gives a material its own reflections (respecting its envMapIntensity). */
  addReflective(...mats: THREE.MeshStandardMaterial[]): void {
    for (const m of mats) {
      this.reflective.add(m);
      if (this.envRT) {
        m.envMap = this.envRT.texture;
        m.needsUpdate = true;
      }
    }
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera): void {
    // Shadow camera follows the car, snapped to texels to avoid shimmering.
    const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunDir.x * 400, Math.max(60, this.sunDir.y * 400), fz + this.sunDir.z * 400);
    this.sun.target.updateMatrixWorld();
    this.nightDome.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.sky.position.copy(camera.position);
    this.moon.position.copy(camera.position).addScaledVector(this.sunDir, 11000);
    if (this.rain.visible) {
      (this.rainMat.uniforms.uCenter.value as THREE.Vector3).copy(camera.position);
      // Lightning over the bay on monsoon nights.
      this.nextLightning -= dt;
      if (this.night > 0.5 && this.nextLightning <= 0) {
        this.lightning = 0.35;
        this.nextLightning = 10 + Math.random() * 20;
      }
    }
    if (this.lightning > 0) {
      this.lightning -= dt;
      const flash = this.lightning > 0.2 || (this.lightning > 0.05 && this.lightning < 0.12) ? 2.2 : 0;
      this.hemi.intensity = this.baseHemi + flash;
    } else this.hemi.intensity = this.baseHemi;
  }

  get sunDirection(): THREE.Vector3 {
    return this.sunDir;
  }

  bloom(): { strength: number; radius: number; threshold: number } {
    // Bloom is for lamps, neon and headlights; keep sunlit walls from glowing.
    // The bloom pass sees HDR values before exposure / tone mapping, so the
    // threshold must sit above sunlit surfaces (≈ albedo × sun intensity).
    // The Preetham sky itself is extremely bright in HDR, so daytime bloom would
    // smear it across the frame as haze: bloom is a night-time effect here.
    if (this.night > 0.7) return { strength: this.weather === 'monsoon' ? 0.6 : 0.75, radius: 0.55, threshold: 0.85 };
    if (this.night > 0.2) return { strength: 0.12, radius: 0.35, threshold: 9 };
    return { strength: 0, radius: 0.4, threshold: 10 };
  }

  dispose(): void {
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.rain.geometry.dispose();
    this.rainMat.dispose();
    this.scene.remove(this.sky, this.nightDome, this.stars, this.moon, this.rain, this.sun, this.sun.target, this.hemi);
  }
}
