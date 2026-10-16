/**
 * Player models for the Mumbai workhorses: a black-and-yellow CNG
 * auto-rickshaw, a kaali-peeli Premier Padmini taxi and a red BEST
 * single-decker. Static parts are merged per material; wheels, the handlebar
 * / steering wheel and lamps stay separate so they can animate. All models
 * face −Z with their origin at the centre of mass on the ground, like the GT.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { numberPlateTexture, radialTexture, UI_FONT } from '../world/textures';
import type { PlayerVehicleId } from './fleet';

/** What the drive scene needs from any player vehicle model. */
export interface PlayerModel {
  readonly id: PlayerVehicleId;
  readonly root: THREE.Group;
  readonly body: THREE.Group;
  readonly reflective: THREE.MeshStandardMaterial[];
  update(wheelRotF: number, wheelRotR: number, steer: number): void;
  setBrake(on: boolean): void;
  setReverse(on: boolean): void;
  setHeadlights(on: boolean): void;
  isHeadlightsOn(): boolean;
  setBeamStrength(v: number): void;
  /** Cockpit camera: hide the driver figure and thin the glass. */
  setCockpitView(on: boolean, tint: number): void;
  dispose(): void;
}

type V3 = [number, number, number];

const paint = (color: number, clearcoat = 0.8) =>
  new THREE.MeshPhysicalMaterial({ color, metalness: 0.15, roughness: 0.38, clearcoat, clearcoatRoughness: 0.12, envMapIntensity: 1 });
const std = (color: number, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

/** Collects static geometry per material and merges it into one mesh each. */
class Parts {
  private byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(mat: THREE.Material, geo: THREE.BufferGeometry, pos?: V3, rot?: V3): void {
    if (rot) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')));
    if (pos) geo.translate(pos[0], pos[1], pos[2]);
    if (!this.byMat.has(mat)) this.byMat.set(mat, []);
    this.byMat.get(mat)!.push(geo);
  }

  box(mat: THREE.Material, size: V3, pos: V3, rot?: V3, radius = 0): void {
    const g = radius > 0 ? new RoundedBoxGeometry(size[0], size[1], size[2], 2, Math.min(radius, Math.min(...size) / 2 - 1e-3)) : new THREE.BoxGeometry(...size);
    this.add(mat, g, pos, rot);
  }

  /** A tube between two points. */
  strut(mat: THREE.Material, a: V3, b: V3, r: number, seg = 8): void {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.applyQuaternion(q);
    const mid = va.add(vb).multiplyScalar(0.5);
    g.translate(mid.x, mid.y, mid.z);
    this.add(mat, g);
  }

  build(parent: THREE.Object3D, shadows = true): void {
    for (const [mat, list] of this.byMat) {
      const geos = list.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
        return n;
      });
      const merged = mergeGeometries(geos, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = false;
      parent.add(mesh);
    }
    this.byMat.clear();
  }
}

/**
 * A side profile (points as [z, y]) extruded across the vehicle's width and
 * centred on x = 0. Arches are cut out of the bottom edge as [z, radius].
 */
function profile(pts: [number, number][], width: number, opts: { bevel?: number; arches?: [number, number, number][] } = {}): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  if (opts.arches) {
    // Arches are listed rear-to-front along the bottom edge (shape runs that way).
    for (const [z, r, y] of opts.arches) {
      shape.lineTo(z + r, y);
      shape.absarc(z, y, r, 0, Math.PI, false);
    }
  }
  shape.closePath();
  const bevel = opts.bevel ?? 0;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 14,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

interface WheelRig {
  pivot: THREE.Group;
  spin: THREE.Group;
  front: boolean;
}

function wheel(r: number, w: number, tyre: THREE.Material, rim: THREE.Material, hub: THREE.Material, dual = false): THREE.Group {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 22).rotateZ(Math.PI / 2), tyre);
  t.castShadow = true;
  g.add(t);
  const side = new THREE.Mesh(new THREE.TorusGeometry(r * 0.86, r * 0.12, 6, 22).rotateY(Math.PI / 2), tyre);
  for (const s of [-1, 1]) {
    const m = side.clone();
    m.position.x = (s * w) / 2;
    g.add(m);
  }
  const rimDisc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, w + 0.012, 18).rotateZ(Math.PI / 2), rim);
  g.add(rimDisc);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.26, w + 0.05, 12).rotateZ(Math.PI / 2), hub);
  g.add(cap);
  // Lug bolts make the spin readable.
  const bolt = new THREE.BoxGeometry(w + 0.03, r * 0.07, r * 0.07);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const b = new THREE.Mesh(bolt, hub);
    b.position.set(0, Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38);
    g.add(b);
  }
  if (dual) {
    const inner = g.clone();
    inner.position.x = -w * 1.05;
    const outer = new THREE.Group();
    outer.add(g, inner);
    return outer;
  }
  return g;
}

/** A seated or standing figure built from capsules (driver, passengers). */
function person(
  parts: Parts,
  skin: THREE.Material,
  shirt: THREE.Material,
  legs: THREE.Material,
  hair: THREE.Material,
  at: V3,
  opts: { seated?: boolean; armsTo?: V3; heading?: number; scale?: number; floor?: number } = {},
): void {
  const [x, y, z] = at;
  const h = opts.heading ?? 0;
  const k = opts.scale ?? 1;
  const rot = (dx: number, dz: number): [number, number] => [x + dx * Math.cos(h) + dz * Math.sin(h), z - dx * Math.sin(h) + dz * Math.cos(h)];
  const seated = opts.seated ?? true;
  const hip = seated ? y : y + 0.85 * k;
  // Torso and head.
  const [tx, tz] = rot(0, 0.02);
  parts.add(shirt, new THREE.CapsuleGeometry(0.16 * k, 0.32 * k, 4, 10), [tx, hip + 0.3 * k, tz]);
  parts.add(skin, new THREE.SphereGeometry(0.095 * k, 12, 10), [tx, hip + 0.66 * k, tz - 0.01]);
  parts.add(hair, new THREE.SphereGeometry(0.098 * k, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), [tx, hip + 0.68 * k, tz + 0.005]);
  if (seated) {
    const foot = Math.max(opts.floor ?? 0, hip - 0.42 * k) + 0.04;
    for (const s of [-1, 1]) {
      const [kx, kz] = rot(s * 0.1 * k, -0.36 * k);
      const [hx, hz] = rot(s * 0.1 * k, 0);
      parts.strut(legs, [hx, hip + 0.04, hz], [kx, hip + 0.06, kz], 0.065 * k);
      parts.strut(legs, [kx, hip + 0.06, kz], [kx, foot, kz - 0.04], 0.055 * k);
    }
  } else {
    for (const s of [-1, 1]) {
      const [lx, lz] = rot(s * 0.09 * k, 0);
      parts.strut(legs, [lx, y + 0.02, lz], [lx, hip + 0.05, lz], 0.065 * k);
    }
  }
  for (const s of [-1, 1]) {
    const [sx, sz] = rot(s * 0.19 * k, 0);
    const end: V3 = opts.armsTo ? [opts.armsTo[0] + s * (Math.abs(opts.armsTo[0] - x) < 0.5 ? 0.2 : 0.15), opts.armsTo[1], opts.armsTo[2]] : [sx, hip + 0.05, sz - 0.12];
    parts.strut(shirt, [sx, hip + 0.47 * k, sz], end, 0.045 * k);
    parts.add(skin, new THREE.SphereGeometry(0.042 * k, 8, 6), end);
  }
}

function destinationTexture(route: string, en: string, mr: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#060606';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#ffae1a';
  ctx.shadowColor = '#ff8a00';
  ctx.shadowBlur = 10;
  ctx.textBaseline = 'middle';
  ctx.font = `700 92px ${UI_FONT}`;
  ctx.fillText(route, 24, 66);
  ctx.font = `600 50px ${UI_FONT}`;
  ctx.fillText(en, 250, 42);
  ctx.font = `600 44px "Noto Sans Devanagari", "Kohinoor Devanagari", "Mangal", ${UI_FONT}`;
  ctx.fillText(mr, 250, 98);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Shared runtime behaviour: lamps, wheels, steering and disposal. */
abstract class BaseModel implements PlayerModel {
  abstract readonly id: PlayerVehicleId;
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly reflective: THREE.MeshStandardMaterial[] = [];
  protected wheels: WheelRig[] = [];
  /** Parts that turn with the front wheel (auto handlebar, fork). */
  protected steerParts: THREE.Object3D[] = [];
  protected steeringWheel: THREE.Object3D | null = null;
  protected steerRatio = 1;
  protected driver = new THREE.Group();
  protected glass: THREE.MeshPhysicalMaterial;
  protected head = new THREE.MeshStandardMaterial({ color: 0xfffaf0, emissive: 0xfff2d8, emissiveIntensity: 0.1, roughness: 0.2 });
  protected tail = new THREE.MeshStandardMaterial({ color: 0x4a0606, emissive: 0xff1a12, emissiveIntensity: 0.3, roughness: 0.3 });
  protected reverse = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 });
  protected chrome = new THREE.MeshStandardMaterial({ color: 0xc4c8ce, roughness: 0.16, metalness: 1 });
  protected lights: THREE.SpotLight[] = [];
  protected flares: THREE.Sprite[] = [];
  private lightsOn = false;
  private brakeOn = false;
  private textures: THREE.Texture[] = [];

  constructor(glassOpacity = 0.55) {
    this.root.add(this.body);
    this.root.rotation.order = 'YXZ';
    this.glass = new THREE.MeshPhysicalMaterial({ color: 0x1a2129, metalness: 0.1, roughness: 0.05, transparent: true, opacity: glassOpacity, envMapIntensity: 1.4, side: THREE.DoubleSide });
    this.reflective.push(this.glass, this.chrome);
    this.body.add(this.driver);
  }

  protected track(t: THREE.Texture): THREE.Texture {
    this.textures.push(t);
    return t;
  }

  protected addWheel(group: THREE.Group, pos: V3, front: boolean, parent: THREE.Object3D = this.root): void {
    const pivot = new THREE.Group();
    pivot.position.set(...pos);
    const spin = new THREE.Group();
    spin.add(group);
    pivot.add(spin);
    parent.add(pivot);
    this.wheels.push({ pivot, spin, front });
  }

  /** Two headlights (spot + flare) — every model has two so shader light counts never change. */
  protected addLamps(points: V3[], aim: number): void {
    const flareTex = radialTexture();
    for (const p of points) {
      const light = new THREE.SpotLight(0xfff1d6, 0, 60, 0.52, 0.6, 1.6);
      light.position.set(...p);
      light.target.position.set(p[0] * 1.2, 0, p[2] - aim);
      this.body.add(light, light.target);
      this.lights.push(light);
      const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTex, color: 0xfff0d0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      flare.position.set(p[0], p[1], p[2] - 0.04);
      flare.scale.setScalar(0.38);
      this.body.add(flare);
      this.flares.push(flare);
    }
  }

  protected plate(text: string, pos: V3, w: number, rotY = 0): void {
    const tex = this.track(numberPlateTexture(text, true));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.22), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
    m.position.set(...pos);
    m.rotation.y = rotY;
    this.body.add(m);
  }

  update(wheelRotF: number, wheelRotR: number, steer: number): void {
    for (const w of this.wheels) {
      w.spin.rotation.x = -(w.front ? wheelRotF : wheelRotR);
      w.pivot.rotation.y = w.front ? steer : 0;
    }
    for (const p of this.steerParts) p.rotation.y = steer;
    if (this.steeringWheel) this.steeringWheel.rotation.z = steer * this.steerRatio;
  }

  setHeadlights(on: boolean): void {
    this.lightsOn = on;
    for (const l of this.lights) l.intensity = on ? 34 : 0;
    this.head.emissiveIntensity = on ? 3 : 0.1;
    this.updateTail();
  }

  isHeadlightsOn(): boolean {
    return this.lightsOn;
  }

  setBrake(on: boolean): void {
    if (on === this.brakeOn) return;
    this.brakeOn = on;
    this.updateTail();
  }

  setReverse(on: boolean): void {
    this.reverse.emissiveIntensity = on ? 2 : 0;
  }

  private updateTail(): void {
    this.tail.emissiveIntensity = this.brakeOn ? 4.5 : this.lightsOn ? 1.5 : 0.3;
  }

  setBeamStrength(v: number): void {
    for (const f of this.flares) (f.material as THREE.SpriteMaterial).opacity = 0.55 * v;
  }

  setCockpitView(on: boolean, tint: number): void {
    this.driver.visible = !on;
    this.glass.opacity = on ? 0.06 : 0.45 + tint * 0.3;
  }

  dispose(): void {
    const mats = new Set<THREE.Material>();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.Sprite).isSprite) {
        m.geometry?.dispose();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
      }
    });
    mats.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
  }
}

// ====================================================================== auto-rickshaw
export class AutoRickshawModel extends BaseModel {
  readonly id = 'auto' as const;

  constructor() {
    super(0.35);
    const black = paint(0x101114, 0.6);
    const yellow = paint(0xf3c316, 0.3);
    yellow.roughness = 0.5;
    const plastic = std(0x16171a, 0.75);
    plastic.side = THREE.DoubleSide;
    const seat = std(0x1d1d20, 0.55);
    const floor = std(0x3a3b3e, 0.9);
    const tyre = std(0x121212, 0.92);
    const rim = std(0x9da2a8, 0.35, 0.8);
    const amber = new THREE.MeshStandardMaterial({ color: 0x7a4a00, emissive: 0xff9a1a, emissiveIntensity: 0.25, roughness: 0.3 });
    const meter = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x30ff70, emissiveIntensity: 0.6, roughness: 0.4 });
    const canvasMat = new THREE.MeshStandardMaterial({ color: 0xf3c316, roughness: 0.65, side: THREE.DoubleSide });
    this.reflective.push(black, yellow);
    const P = new Parts();

    // Floor tub and the engine box under the rear bench.
    P.box(black, [1.22, 0.3, 1.6], [0, 0.48, 0.32], undefined, 0.06);
    P.box(black, [1.28, 0.52, 0.5], [0, 0.66, 0.94], undefined, 0.08);
    P.box(floor, [1.12, 0.02, 1.25], [0, 0.64, 0.1]);
    // Front cowl: the rounded nose that carries the headlamp.
    P.add(
      black,
      profile(
        [
          [-0.82, 0.42],
          [-0.82, 1.06],
          [-1.08, 1.1],
          [-1.32, 1.02],
          [-1.44, 0.86],
          [-1.47, 0.6],
          [-1.4, 0.42],
        ],
        0.84,
        { bevel: 0.06 },
      ),
    );
    // Dashboard shelf behind the windshield.
    P.box(plastic, [1.08, 0.08, 0.26], [0, 1.08, -0.92], [0.15, 0, 0], 0.02);
    // Rear wheel fenders (open half-cylinders arching over the tyres).
    for (const s of [-1, 1]) {
      const f = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 18, 1, true, 0, Math.PI);
      f.rotateZ(Math.PI / 2);
      P.add(plastic, f, [s * 0.58, 0.2, 0.75]);
    }
    // Canopy: a yellow hood over the roof that wraps down behind the rear bench.
    const canopyShape: [number, number][] = [];
    const outer: [number, number][] = [
      [-1.08, 1.6],
      [-0.95, 1.7],
      [-0.6, 1.74],
      [0.75, 1.74],
      [1.1, 1.68],
      [1.24, 1.45],
      [1.25, 0.95],
    ];
    const inner: [number, number][] = [
      [1.2, 0.95],
      [1.19, 1.44],
      [1.07, 1.64],
      [0.75, 1.69],
      [-0.6, 1.69],
      [-0.93, 1.65],
      [-1.04, 1.57],
    ];
    canopyShape.push(...outer, ...inner);
    P.add(canvasMat, profile(canopyShape, 1.34, { bevel: 0.02 }));
    // Hood side panels behind the passengers.
    for (const s of [-1, 1]) {
      const side = profile(
        [
          [0.55, 1.7],
          [1.2, 1.7],
          [1.22, 0.95],
          [0.98, 0.95],
          [0.7, 1.15],
          [0.55, 1.42],
        ],
        0.03,
      );
      P.add(canvasMat, side, [s * 0.655, 0, 0]);
      // Rolled-up side curtain under the roof edge.
      P.strut(plastic, [s * 0.66, 1.66, -0.75], [s * 0.66, 1.66, 0.5], 0.035);
      // Windshield pillar and the side grab rail.
      P.strut(plastic, [s * 0.52, 1.06, -0.98], [s * 0.6, 1.66, -1.02], 0.022);
      P.strut(this.chrome, [s * 0.64, 1.0, 0.18], [s * 0.64, 1.0, 0.62], 0.016);
      P.strut(this.chrome, [s * 0.64, 0.62, 0.18], [s * 0.64, 1.0, 0.18], 0.016);
      // Mirrors on stalks.
      P.strut(plastic, [s * 0.55, 1.3, -1.0], [s * 0.72, 1.38, -1.06], 0.012);
      P.add(plastic, new THREE.CylinderGeometry(0.06, 0.06, 0.02, 14).rotateX(Math.PI / 2), [s * 0.74, 1.4, -1.06]);
      // Indicators and tail lamps.
      P.box(amber, [0.08, 0.06, 0.04], [s * 0.3, 1.02, -1.38], [0.5, 0, 0]);
      P.box(this.tail, [0.1, 0.16, 0.03], [s * 0.52, 0.76, 1.2]);
    }
    // Windshield frame.
    P.strut(plastic, [-0.55, 1.62, -1.03], [0.55, 1.62, -1.03], 0.025);
    // Seats: driver's saddle and the rear bench.
    P.box(seat, [0.5, 0.09, 0.42], [0, 0.73, -0.32], undefined, 0.04);
    P.box(plastic, [0.42, 0.08, 0.36], [0, 0.66, -0.32], undefined, 0.03);
    P.box(seat, [1.12, 0.14, 0.46], [0, 0.94, 0.66], undefined, 0.05);
    P.box(seat, [1.12, 0.46, 0.1], [0, 1.22, 0.97], [-0.12, 0, 0], 0.04);
    P.box(plastic, [1.18, 0.08, 0.06], [0, 1.08, 0.08]);
    // Taxi meter and the headlamp ring.
    P.box(plastic, [0.16, 0.12, 0.08], [-0.36, 1.17, -0.9]);
    P.box(meter, [0.12, 0.05, 0.01], [-0.36, 1.18, -0.855]);
    P.add(this.chrome, new THREE.TorusGeometry(0.105, 0.018, 8, 22), [0, 0.9, -1.475]);
    P.add(this.head, new THREE.CircleGeometry(0.1, 20).rotateY(Math.PI), [0, 0.9, -1.48]);
    // Spare wheel on the back and the rear bumper guard.
    P.add(tyre, new THREE.CylinderGeometry(0.2, 0.2, 0.11, 18).rotateX(Math.PI / 2), [0, 1.02, 1.28]);
    P.add(rim, new THREE.CylinderGeometry(0.12, 0.12, 0.12, 14).rotateX(Math.PI / 2), [0, 1.02, 1.28]);
    P.strut(this.chrome, [-0.58, 0.46, 1.24], [0.58, 0.46, 1.24], 0.02);
    // Front wheel fork is part of the steering group below; the cowl hides the column.
    P.build(this.body);

    // Windshield glass.
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.54), this.glass);
    ws.position.set(0, 1.34, -1.0);
    ws.rotation.x = 0.08;
    this.body.add(ws);

    // Steering group: handlebar on the column (turns with the front wheel).
    const bars = new THREE.Group();
    bars.position.set(0, 0, -0.84);
    const B = new Parts();
    B.strut(plastic, [0, 0.9, -0.1], [0, 1.05, 0.04], 0.03);
    B.strut(this.chrome, [-0.34, 1.07, 0.08], [0.34, 1.07, 0.08], 0.018);
    for (const s of [-1, 1]) B.strut(plastic, [s * 0.34, 1.07, 0.08], [s * 0.46, 1.08, 0.1], 0.03);
    B.build(bars);
    this.body.add(bars);
    this.steerParts.push(bars);

    // Wheels: single front on a fork with a turning mudguard, two driven rears.
    const r = 0.205;
    const front = wheel(r, 0.11, tyre, rim, this.chrome);
    this.addWheel(front, [0, r, -1.25], true);
    const fw = this.wheels[0].pivot;
    const F = new Parts();
    const guard = new THREE.CylinderGeometry(0.25, 0.25, 0.15, 16, 1, true, 0, Math.PI);
    guard.rotateZ(Math.PI / 2);
    F.add(plastic, guard, [0, 0, 0]);
    for (const s of [-1, 1]) F.strut(plastic, [s * 0.08, 0, 0], [s * 0.06, 0.3, 0.12], 0.02);
    F.build(fw);
    for (const s of [-1, 1]) this.addWheel(wheel(r, 0.11, tyre, rim, this.chrome), [s * 0.58, r, 0.75], false);

    // The driver, in the khaki uniform of Mumbai's rickshaw-wallahs.
    const D = new Parts();
    person(D, std(0x8d5a3b, 0.7), std(0xb39b6b, 0.85), std(0x3b3a36, 0.85), std(0x111111, 0.9), [0, 0.78, -0.3], { armsTo: [0, 1.07, -0.76], floor: 0.64 });
    D.build(this.driver);

    this.plate('MH 02 R 4417', [0, 0.6, 1.205], 0.34);
    this.plate('MH 02 R 4417', [0, 0.56, -1.475], 0.26, Math.PI);
    this.addLamps(
      [
        [-0.04, 0.9, -1.48],
        [0.04, 0.9, -1.48],
      ],
      22,
    );
  }
}

// ====================================================================== kaali-peeli taxi
export class TaxiModel extends BaseModel {
  readonly id = 'taxi' as const;

  constructor() {
    super(0.55);
    const black = paint(0x0b0b0d, 1);
    const yellow = paint(0xf6c414, 0.9);
    const trim = std(0x111214, 0.6);
    const tyre = std(0x111111, 0.92);
    const steel = std(0x1a1a1c, 0.5, 0.4);
    const seatMat = std(0x6b1f24, 0.6);
    const dash = std(0x15161a, 0.7);
    const amber = new THREE.MeshStandardMaterial({ color: 0x7a4a00, emissive: 0xff9a1a, emissiveIntensity: 0.25, roughness: 0.3 });
    const grille = std(0x050505, 0.8);
    this.reflective.push(black, yellow);
    const P = new Parts();
    const fz = -1.12;
    const rz = 1.27;

    // Lower body with wheel arches.
    P.add(
      black,
      profile(
        [
          [-1.86, 0.3],
          [-1.9, 0.62],
          [-1.84, 0.76],
          [-1.4, 0.82],
          [-0.55, 0.88],
          [1.35, 0.88],
          [1.98, 0.82],
          [2.1, 0.72],
          [2.08, 0.3],
        ],
        1.56,
        { bevel: 0.05, arches: [
          [rz, 0.36, 0.3],
          [fz, 0.36, 0.3],
        ] },
      ),
    );
    // Greenhouse: glass, yellow roof and black pillars.
    const glassGeo = profile(
      [
        [-0.52, 0.87],
        [-0.12, 1.3],
        [0.98, 1.3],
        [1.36, 0.87],
      ],
      1.36,
    );
    const glassMesh = new THREE.Mesh(glassGeo, this.glass);
    this.body.add(glassMesh);
    P.add(
      yellow,
      profile(
        [
          [-0.18, 1.29],
          [-0.08, 1.38],
          [0.95, 1.39],
          [1.04, 1.29],
        ],
        1.42,
        { bevel: 0.03 },
      ),
    );
    for (const s of [-1, 1]) {
      const x = s * 0.69;
      P.strut(trim, [x, 0.88, -0.52], [x, 1.31, -0.13], 0.03);
      P.strut(trim, [x, 0.88, 0.45], [x, 1.31, 0.45], 0.035);
      P.strut(trim, [x, 0.88, 1.34], [x, 1.31, 0.98], 0.04);
      // Chrome belt strip, door handles, side mirror, rain gutter.
      P.strut(this.chrome, [s * 0.785, 0.86, -1.6], [s * 0.785, 0.86, 1.9], 0.008);
      P.box(this.chrome, [0.03, 0.025, 0.12], [s * 0.79, 0.8, -0.15]);
      P.box(this.chrome, [0.03, 0.025, 0.12], [s * 0.79, 0.8, 0.8]);
      P.strut(this.chrome, [s * 0.74, 0.86, -0.85], [s * 0.82, 0.98, -0.85], 0.012);
      P.add(this.chrome, new THREE.CylinderGeometry(0.06, 0.06, 0.03, 14).rotateX(Math.PI / 2), [s * 0.83, 1.0, -0.86]);
      // Round headlamps with chrome bezels, indicators and slim tail lamps.
      P.add(this.chrome, new THREE.TorusGeometry(0.095, 0.02, 8, 22), [s * 0.56, 0.62, -1.905]);
      P.add(this.head, new THREE.CircleGeometry(0.088, 20).rotateY(Math.PI), [s * 0.56, 0.62, -1.91]);
      P.box(amber, [0.1, 0.05, 0.03], [s * 0.56, 0.47, -1.9]);
      P.box(this.tail, [0.08, 0.2, 0.03], [s * 0.68, 0.64, 2.1]);
      P.box(this.reverse, [0.06, 0.05, 0.03], [s * 0.68, 0.5, 2.1]);
      // Roof rack rails.
      P.strut(this.chrome, [s * 0.55, 1.47, -0.02], [s * 0.55, 1.47, 0.9], 0.015);
      P.strut(this.chrome, [s * 0.55, 1.39, -0.02], [s * 0.55, 1.47, -0.02], 0.012);
      P.strut(this.chrome, [s * 0.55, 1.39, 0.9], [s * 0.55, 1.47, 0.9], 0.012);
    }
    for (const z of [0.1, 0.45, 0.8]) P.strut(this.chrome, [-0.55, 1.47, z], [0.55, 1.47, z], 0.012);
    // Chrome bumpers with over-riders, and the grille.
    P.box(this.chrome, [1.62, 0.09, 0.08], [0, 0.4, -1.93], undefined, 0.03);
    P.box(this.chrome, [1.62, 0.09, 0.08], [0, 0.4, 2.13], undefined, 0.03);
    for (const s of [-1, 1]) {
      P.box(this.chrome, [0.06, 0.2, 0.06], [s * 0.35, 0.44, -1.96], undefined, 0.02);
      P.box(this.chrome, [0.06, 0.2, 0.06], [s * 0.35, 0.44, 2.16], undefined, 0.02);
    }
    P.box(grille, [0.78, 0.2, 0.02], [0, 0.6, -1.9]);
    for (let i = 0; i < 4; i++) P.box(this.chrome, [0.8, 0.012, 0.025], [0, 0.52 + i * 0.055, -1.912]);
    // Interior: maroon bench seats, dashboard, a little dashboard deity.
    P.box(seatMat, [1.3, 0.14, 0.5], [0, 0.43, 0.05], undefined, 0.05);
    P.box(seatMat, [1.3, 0.5, 0.12], [0, 0.72, 0.32], [-0.15, 0, 0], 0.05);
    P.box(seatMat, [1.3, 0.14, 0.5], [0, 0.43, 0.95], undefined, 0.05);
    P.box(seatMat, [1.3, 0.5, 0.12], [0, 0.72, 1.22], [-0.15, 0, 0], 0.05);
    P.box(std(0x222326, 0.9), [1.4, 0.03, 2.2], [0, 0.3, 0.3]);
    P.box(dash, [1.38, 0.16, 0.3], [0, 0.8, -0.5], undefined, 0.04);
    P.add(std(0xff7a1a, 0.5), new THREE.SphereGeometry(0.035, 10, 8), [-0.3, 0.97, -0.5]);
    P.add(std(0xe34b1a, 0.5), new THREE.ConeGeometry(0.03, 0.06, 10), [-0.3, 0.94, -0.5]);
    P.build(this.body);

    // Steering wheel (right-hand drive).
    const sw = new THREE.Group();
    const S = new Parts();
    S.add(dash, new THREE.TorusGeometry(0.19, 0.014, 8, 28));
    S.strut(dash, [-0.18, 0, 0], [0.18, 0, 0], 0.012);
    S.strut(dash, [0, 0, 0], [0, -0.18, 0], 0.012);
    S.build(sw, false);
    sw.position.set(0.36, 0.92, -0.32);
    sw.rotation.x = -0.45;
    this.body.add(sw);
    this.steeringWheel = sw;
    this.steerRatio = -5;

    // Black steel wheels with chrome hubcaps.
    const r = 0.29;
    for (const s of [-1, 1]) {
      this.addWheel(wheel(r, 0.16, tyre, steel, this.chrome), [s * 0.62, r, fz], true);
      this.addWheel(wheel(r, 0.16, tyre, steel, this.chrome), [s * 0.62, r, rz], false);
    }

    const D = new Parts();
    person(D, std(0x8d5a3b, 0.7), std(0xe8e4d6, 0.85), std(0x2e2f33, 0.85), std(0x161616, 0.9), [0.36, 0.5, 0.08], { armsTo: [0.36, 0.92, -0.3], scale: 0.92, floor: 0.32 });
    D.build(this.driver);

    this.plate('MH 01 T 7864', [0, 0.52, 2.18], 0.42);
    this.plate('MH 01 T 7864', [0, 0.28, -1.92], 0.42, Math.PI);
    this.addLamps(
      [
        [-0.56, 0.62, -1.92],
        [0.56, 0.62, -1.92],
      ],
      26,
    );
  }
}

// ====================================================================== BEST bus
export class BusModel extends BaseModel {
  readonly id = 'bus' as const;

  constructor() {
    super(0.5);
    const red = paint(0xb51f1b, 0.7);
    const cream = paint(0xeee3c4, 0.6);
    const roof = std(0xdcdad4, 0.6);
    const black = std(0x0f1012, 0.6);
    const rubber = std(0x161616, 0.9);
    const tyre = std(0x121212, 0.92);
    const steel = std(0x9a9ea4, 0.4, 0.7);
    const seatMat = std(0x7a1f25, 0.6);
    const floor = std(0x4a4f4c, 0.9);
    const amber = new THREE.MeshStandardMaterial({ color: 0x7a4a00, emissive: 0xff9a1a, emissiveIntensity: 0.25, roughness: 0.3 });
    this.reflective.push(red, cream);
    const P = new Parts();
    const W = 2.55;
    const fz = -3.05;
    const rz = 2.55;
    const front = -5.35;
    const back = 6.0;

    // Lower body (red) with wheel arches, cream waistband, window band and red upper band.
    P.add(
      red,
      profile(
        [
          [front, 0.42],
          [front - 0.04, 1.3],
          [back, 1.3],
          [back, 0.42],
        ],
        W,
        { bevel: 0.06, arches: [
          [rz, 0.62, 0.42],
          [fz, 0.6, 0.42],
        ] },
      ),
    );
    P.box(cream, [W + 0.01, 0.12, back - front + 0.02], [0, 1.36, (front + back) / 2], undefined, 0.04);
    P.box(red, [W, 0.42, back - front], [0, 2.66, (front + back) / 2], undefined, 0.06);
    P.box(roof, [W - 0.12, 0.1, back - front - 0.2], [0, 2.9, (front + back) / 2], undefined, 0.04);
    for (const z of [-2.6, 0.6, 3.8]) P.box(black, [0.9, 0.08, 0.7], [0, 2.98, z], undefined, 0.03);
    // Interior floor, seats in 2+2 rows and ceiling grab rails.
    P.box(floor, [W - 0.2, 0.04, back - front - 0.4], [0, 0.82, (front + back) / 2]);
    for (let z = -3.4; z < 5.5; z += 0.82) {
      for (const s of [-1, 1]) {
        if (s < 0 && z > -0.6 && z < 1.0) continue; // middle door
        P.box(seatMat, [0.9, 0.12, 0.44], [s * 0.72, 1.24, z], undefined, 0.04);
        P.box(seatMat, [0.9, 0.5, 0.08], [s * 0.72, 1.52, z + 0.25], [-0.12, 0, 0], 0.03);
        P.strut(steel, [s * 0.3, 0.84, z], [s * 0.3, 1.18, z], 0.02);
      }
    }
    for (const s of [-1, 1]) P.strut(steel, [s * 0.32, 2.5, front + 1.2], [s * 0.32, 2.5, back - 0.4], 0.02);
    for (let z = -2.5; z < 5.5; z += 1.6) P.strut(steel, [0.32, 2.5, z], [0.32, 0.84, z], 0.018);
    // Window pillars down both sides.
    for (const s of [-1, 1]) {
      for (let z = front + 0.9; z < back - 0.1; z += 1.05) P.box(black, [0.04, 1.06, 0.08], [s * (W / 2 + 0.005), 1.94, z]);
      P.box(black, [0.04, 0.05, back - front - 0.4], [s * (W / 2 + 0.005), 1.94, (front + back) / 2]);
    }
    // Doors on the kerb (left) side: front entry and middle exit.
    for (const [z0, z1] of [
      [-4.95, -4.0],
      [-0.55, 0.95],
    ]) {
      P.box(black, [0.05, 1.98, z1 - z0], [-W / 2 - 0.01, 1.45, (z0 + z1) / 2]);
      P.box(rubber, [0.06, 1.9, 0.04], [-W / 2 - 0.02, 1.45, (z0 + z1) / 2]);
    }
    // Front: windshield pillar, destination board housing, headlamps, bumper.
    P.box(black, [0.08, 1.12, 0.06], [0, 1.9, front - 0.02]);
    P.box(black, [W - 0.1, 0.36, 0.06], [0, 2.62, front - 0.01]);
    P.box(black, [W, 0.32, 0.18], [0, 0.55, front - 0.06], undefined, 0.05);
    for (const s of [-1, 1]) {
      for (const dx of [0, 0.22]) {
        P.add(this.chrome, new THREE.TorusGeometry(0.085, 0.016, 8, 20), [s * (0.82 + dx), 0.92, front - 0.045]);
        P.add(this.head, new THREE.CircleGeometry(0.078, 18).rotateY(Math.PI), [s * (0.82 + dx), 0.92, front - 0.05]);
      }
      P.box(amber, [0.14, 0.08, 0.04], [s * 0.95, 0.76, front - 0.05]);
      // Big bus mirrors on arms.
      P.strut(black, [s * (W / 2 - 0.05), 2.35, front + 0.3], [s * (W / 2 + 0.28), 2.35, front - 0.25], 0.025);
      P.strut(black, [s * (W / 2 + 0.28), 2.35, front - 0.25], [s * (W / 2 + 0.28), 1.95, front - 0.25], 0.02);
      P.box(black, [0.06, 0.42, 0.24], [s * (W / 2 + 0.3), 2.1, front - 0.25], undefined, 0.02);
      // Rear lamp clusters, reverse lamps, rear marker.
      P.box(this.tail, [0.16, 0.42, 0.04], [s * 1.05, 1.0, back + 0.02]);
      P.box(this.reverse, [0.12, 0.08, 0.04], [s * 1.05, 0.72, back + 0.02]);
      P.box(amber, [0.12, 0.08, 0.04], [s * 1.05, 1.28, back + 0.02]);
    }
    P.box(black, [W, 0.3, 0.16], [0, 0.55, back + 0.04], undefined, 0.05);
    for (let i = 0; i < 6; i++) P.box(black, [1.2, 0.03, 0.03], [0, 0.85 + i * 0.07, back + 0.02]);
    // Driver's cab.
    P.box(black, [W - 0.2, 0.3, 0.55], [0, 1.2, front + 0.35], undefined, 0.05);
    P.box(std(0x3a3d42, 0.6), [0.5, 0.12, 0.5], [0.75, 1.3, front + 1.05], undefined, 0.04);
    P.box(std(0x3a3d42, 0.6), [0.5, 0.6, 0.1], [0.75, 1.62, front + 1.32], undefined, 0.04);
    P.build(this.body);

    // Glass: side windows, windshield and the rear window.
    const glassParts = new Parts();
    for (const s of [-1, 1]) glassParts.box(this.glass, [0.02, 1.06, back - front - 0.25], [s * (W / 2 - 0.01), 1.94, (front + back) / 2]);
    glassParts.box(this.glass, [W - 0.12, 1.08, 0.02], [0, 1.92, front + 0.01], [-0.04, 0, 0]);
    glassParts.box(this.glass, [W - 0.3, 0.8, 0.02], [0, 2.0, back - 0.01]);
    glassParts.build(this.body, false);

    // Destination boards (front and rear).
    const dest = this.track(destinationTexture('138', 'CSMT', 'सी.एस.एम.टी.'));
    const board = new THREE.MeshBasicMaterial({ map: dest, toneMapped: false });
    const fb = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.25, 0.27), board);
    fb.position.set(0, 2.62, front - 0.045);
    fb.rotation.y = Math.PI;
    this.body.add(fb);
    const rb = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.15), board);
    rb.position.set(0, 2.62, back + 0.01);
    this.body.add(rb);

    // A full bus: passengers seated and standing.
    const crowd = new Parts();
    const skin = [std(0x8d5a3b, 0.7), std(0x6e4128, 0.7), std(0xa86e4a, 0.7)];
    const shirts = [0xf0ede4, 0x2f5f9e, 0xc0392b, 0x2e8b57, 0xe6b422, 0x7b3f99, 0xd35d8a].map((c) => std(c, 0.85));
    const legsMat = std(0x2b2c30, 0.85);
    const hair = std(0x111111, 0.9);
    let k = 0;
    for (let z = -3.4; z < 5.5; z += 0.82) {
      for (const s of [-1, 1]) {
        for (const off of [-0.22, 0.22]) {
          k++;
          if (s < 0 && z > -0.6 && z < 1.0) continue;
          if ((k * 7) % 5 === 0) continue;
          person(crowd, skin[k % 3], shirts[k % shirts.length], legsMat, hair, [s * 0.72 + off, 1.3, z + 0.02], { heading: 0 });
        }
      }
      if ((k * 3) % 4 === 0) person(crowd, skin[k % 3], shirts[(k + 3) % shirts.length], legsMat, hair, [0.05, 0.84, z + 0.4], { seated: false, armsTo: [0.32, 2.45, z + 0.35] });
    }
    crowd.build(this.body, false);

    // Steering wheel: big, nearly flat.
    const sw = new THREE.Group();
    const S = new Parts();
    S.add(black, new THREE.TorusGeometry(0.25, 0.018, 8, 28));
    S.strut(black, [-0.24, 0, 0], [0.24, 0, 0], 0.014);
    S.build(sw, false);
    sw.position.set(0.75, 1.72, front + 0.55);
    sw.rotation.x = -1.05;
    this.body.add(sw);
    this.steeringWheel = sw;
    this.steerRatio = -9;

    const D = new Parts();
    person(D, std(0x7a4a30, 0.7), std(0xb39b6b, 0.85), std(0x3b3a36, 0.85), hair, [0.75, 1.36, front + 1.05], { armsTo: [0.75, 1.72, front + 0.62] });
    D.build(this.driver);

    // Wheels: single fronts, twin rears.
    const r = 0.5;
    for (const s of [-1, 1]) {
      this.addWheel(wheel(r, 0.3, tyre, steel, this.chrome), [s * 1.0, r, fz], true);
      const dual = wheel(r, 0.26, tyre, steel, this.chrome, true);
      if (s < 0) dual.rotation.y = Math.PI;
      this.addWheel(dual, [s * 1.07, r, rz], false);
    }

    this.plate('MH 01 AP 2231', [0, 0.45, back + 0.13], 0.5);
    this.plate('MH 01 AP 2231', [0, 0.47, front - 0.16], 0.5, Math.PI);
    this.addLamps(
      [
        [-0.93, 0.92, front - 0.06],
        [0.93, 0.92, front - 0.06],
      ],
      30,
    );
  }
}

export function createUtilityModel(id: Exclude<PlayerVehicleId, 'gtr'>): PlayerModel {
  if (id === 'auto') return new AutoRickshawModel();
  if (id === 'taxi') return new TaxiModel();
  return new BusModel();
}
