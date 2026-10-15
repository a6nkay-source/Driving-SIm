/**
 * Procedural model of the "Vayu GT-35", an original coupé inspired by the
 * Nissan GT-R (R35). No third-party mesh is used: the body is lofted from
 * cross-sections, and detail parts are generated from primitives.
 *
 * Local frame: the car faces −Z, +X is the car's right, origin is at road level
 * under the centre of mass (which is where the physics body lives).
 */
import * as THREE from 'three';
import { CALIPERS, paintById, RIMS, type CarConfig, type WingStyle } from '../core/carConfig';
import { beamTexture, honeycombTexture, numberPlateTexture, radialTexture } from '../world/textures';

// ---------------------------------------------------------------- dimensions
const LENGTH = 4.71;
const FRONT_AXLE = 0.95;
const REAR_AXLE = 3.73;
const CG = 2.27; // design-space X of the centre of mass
const WHEEL_R = 0.345;
const ARCH_R = 0.43;
export const TRACK_HALF = 0.8;

const toZ = (x: number) => x - CG;

// Key stations: [x, halfWidth, bottom, shoulder, top]
const STATIONS: [number, number, number, number, number][] = [
  [0.0, 0.6, 0.34, 0.5, 0.56],
  [0.04, 0.76, 0.26, 0.56, 0.62],
  [0.14, 0.86, 0.2, 0.62, 0.68],
  [0.3, 0.915, 0.17, 0.68, 0.74],
  [0.55, 0.94, 0.165, 0.75, 0.8],
  [0.95, 0.958, 0.165, 0.8, 0.86],
  [1.35, 0.952, 0.165, 0.84, 0.9],
  [1.7, 0.942, 0.16, 0.88, 0.95],
  [2.2, 0.935, 0.16, 0.9, 0.93],
  [2.8, 0.937, 0.16, 0.92, 0.94],
  [3.3, 0.952, 0.165, 0.95, 0.97],
  [3.73, 0.968, 0.17, 0.985, 1.02],
  [4.15, 0.955, 0.19, 1.0, 1.04],
  [4.45, 0.94, 0.23, 1.0, 1.035],
  [4.62, 0.915, 0.29, 0.99, 1.02],
  [4.71, 0.88, 0.35, 0.97, 0.995],
];

function interpStation(x: number): [number, number, number, number] {
  let i = 0;
  while (i < STATIONS.length - 2 && STATIONS[i + 1][0] < x) i++;
  const p0 = STATIONS[Math.max(0, i - 1)];
  const p1 = STATIONS[i];
  const p2 = STATIONS[i + 1];
  const p3 = STATIONS[Math.min(STATIONS.length - 1, i + 2)];
  const t = Math.min(1, Math.max(0, (x - p1[0]) / (p2[0] - p1[0])));
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let k = 1; k <= 4; k++) {
    // Catmull–Rom for smooth longitudinal curves.
    const a = p0[k];
    const b = p1[k];
    const c = p2[k];
    const d = p3[k];
    const t2 = t * t;
    const t3 = t2 * t;
    out[k - 1] = 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  }
  return out;
}

/** Bottom edge of the body: raised into wheel arches. */
function bodyBottom(x: number, base: number): number {
  for (const ax of [FRONT_AXLE, REAR_AXLE]) {
    const dx = x - ax;
    if (Math.abs(dx) < ARCH_R) return Math.max(base, WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - dx * dx) - 0.03);
  }
  return base;
}

function catmull(pts: [number, number][], samples: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (k: 0 | 1) =>
        0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Half cross-section of the lower body at station x: list of (lateral, height) from bottom centre to top centre. */
function bodyHalfProfile(x: number): [number, number][] {
  const [w, ybBase, ys, yt] = interpStation(x);
  const yb = bodyBottom(x, ybBase);
  const side = Math.max(0.02, ys - yb);
  const pts: [number, number][] = [
    [0, yb],
    [w * 0.84, yb],
    [w * 0.975, yb + Math.min(0.05, side * 0.3)],
    [w, yb + side * 0.35],
    [w * 0.998, ys - Math.min(0.1, side * 0.3)],
    [w * 0.955, ys],
    [w * 0.62, yt - 0.012],
    [w * 0.25, yt + 0.004],
    [0, yt],
  ];
  return catmull(pts, 3);
}

// Greenhouse: [x, top, baseHalfWidth, roofHalfWidth]
const CABIN: [number, number, number, number][] = [
  [1.66, 0.955, 0.8, 0.76],
  [1.92, 1.1, 0.84, 0.7],
  [2.22, 1.27, 0.85, 0.65],
  [2.45, 1.345, 0.855, 0.63],
  [2.8, 1.37, 0.86, 0.625],
  [3.2, 1.35, 0.865, 0.62],
  [3.55, 1.25, 0.87, 0.6],
  [3.85, 1.12, 0.87, 0.6],
  [4.08, 1.045, 0.86, 0.62],
];
const CABIN_BASE = (x: number) => interpStation(x)[3] - 0.012;

function interpCabin(x: number): [number, number, number] {
  let i = 0;
  while (i < CABIN.length - 2 && CABIN[i + 1][0] < x) i++;
  const a = CABIN[i];
  const b = CABIN[i + 1];
  const t = Math.min(1, Math.max(0, (x - a[0]) / (b[0] - a[0])));
  const s = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
  return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s];
}

function cabinHalfProfile(x: number): [number, number][] {
  const [top, wb, wr] = interpCabin(x);
  const base = CABIN_BASE(x);
  const h = Math.max(0.004, top - base);
  return catmull(
    [
      [wb, base],
      [wb * 0.985, base + h * 0.3],
      [wr * 1.06, top - h * 0.12],
      [wr * 0.82, top - 0.012],
      [wr * 0.4, top - 0.002],
      [0, top],
    ],
    3,
  );
}

type Region = (x: number, v: number) => number;

/**
 * Lofts symmetric half-profiles along X into an indexed geometry with
 * material groups decided per quad by `region(x, v)` (v: 0 left base … 0.5 top … 1 right base).
 */
function loft(xs: number[], half: (x: number) => [number, number][], region: Region, materials: number, capEnds: boolean): THREE.BufferGeometry {
  const rings: [number, number, number][][] = xs.map((x) => {
    const hp = half(x);
    const ring: [number, number, number][] = [];
    for (let i = hp.length - 1; i >= 0; i--) ring.push([-hp[i][0], hp[i][1], toZ(x)]);
    for (let i = 1; i < hp.length; i++) ring.push([hp[i][0], hp[i][1], toZ(x)]);
    return ring;
  });
  const n = rings[0].length;
  const pos: number[] = [];
  for (const r of rings) for (const p of r) pos.push(p[0], p[1], p[2]);
  const groups: number[][] = Array.from({ length: materials }, () => []);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j;
      const b = (i + 1) * n + j;
      const v = (j + 0.5) / (n - 1);
      const m = region((xs[i] + xs[i + 1]) / 2, v);
      if (m < 0) continue; // region intentionally left open
      // Ring order runs left→top→right with x increasing rearwards; this winding faces outward.
      groups[m].push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  if (capEnds) {
    for (const [ri, flip] of [
      [0, true],
      [rings.length - 1, false],
    ] as [number, boolean][]) {
      const r = rings[ri];
      let cy = 0;
      for (const p of r) cy += p[1];
      cy /= r.length;
      const centre = pos.length / 3;
      pos.push(0, cy, r[0][2]);
      for (let j = 0; j < n - 1; j++) {
        const a = ri * n + j;
        if (flip) groups[0].push(centre, a + 1, a);
        else groups[0].push(centre, a, a + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const index: number[] = [];
  groups.forEach((list, mi) => {
    g.addGroup(index.length, list.length, mi);
    index.push(...list);
  });
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function range(a: number, b: number, step: number): number[] {
  const out: number[] = [];
  for (let x = a; x < b - 1e-6; x += step) out.push(x);
  out.push(b);
  return out;
}

function bodyStations(): number[] {
  const xs = new Set<number>();
  for (const x of range(0, LENGTH, 0.06)) xs.add(Math.round(x * 1000) / 1000);
  for (const ax of [FRONT_AXLE, REAR_AXLE]) {
    for (const x of range(ax - ARCH_R - 0.06, ax + ARCH_R + 0.06, 0.025)) xs.add(Math.round(x * 1000) / 1000);
  }
  for (const x of range(0, 0.2, 0.02)) xs.add(Math.round(x * 1000) / 1000);
  for (const x of range(4.5, LENGTH, 0.02)) xs.add(Math.round(x * 1000) / 1000);
  return [...xs].sort((a, b) => a - b);
}

/** A point on the lower body surface at station x and half-profile parameter t (0 bottom centre → 1 top centre), right side. */
function bodySurface(x: number, t: number, offset = 0.004): THREE.Vector3 {
  const hp = bodyHalfProfile(x);
  const f = Math.min(hp.length - 1.0001, Math.max(0, t * (hp.length - 1)));
  const i = Math.floor(f);
  const k = f - i;
  const a = hp[i];
  const b = hp[i + 1];
  const px = a[0] + (b[0] - a[0]) * k;
  const py = a[1] + (b[1] - a[1]) * k;
  // Outward normal of the profile segment.
  let nx = b[1] - a[1];
  let ny = -(b[0] - a[0]);
  const len = Math.hypot(nx, ny) || 1;
  nx /= len;
  ny /= len;
  return new THREE.Vector3(px + nx * offset, py + ny * offset, toZ(x));
}

/** Builds a surface-conforming patch on the right side (mirrored later for the left). */
function bodyPatch(x0: number, x1: number, t0: (x: number) => number, t1: (x: number) => number, nx = 10, nt = 6, offset = 0.005): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx;
    for (let j = 0; j <= nt; j++) {
      const t = t0(x) + ((t1(x) - t0(x)) * j) / nt;
      const p = bodySurface(x, t, offset);
      pos.push(p.x, p.y, p.z);
      uv.push(i / nx, j / nt);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nt; j++) {
      const a = i * (nt + 1) + j;
      const b = (i + 1) * (nt + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  m.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  // Restore winding after the reflection.
  const idx = m.getIndex();
  if (idx) {
    const arr = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  m.computeVertexNormals();
  return m;
}

// ---------------------------------------------------------------- wheels
function tireGeometry(width: number): THREE.BufferGeometry {
  const rIn = 0.255;
  const rOut = WHEEL_R;
  const hw = width / 2;
  const prof: THREE.Vector2[] = [];
  prof.push(new THREE.Vector2(rIn, -hw * 0.92));
  prof.push(new THREE.Vector2(rIn + 0.03, -hw));
  prof.push(new THREE.Vector2(rOut - 0.035, -hw * 1.02));
  prof.push(new THREE.Vector2(rOut - 0.008, -hw * 0.9));
  prof.push(new THREE.Vector2(rOut, -hw * 0.6));
  prof.push(new THREE.Vector2(rOut, hw * 0.6));
  prof.push(new THREE.Vector2(rOut - 0.008, hw * 0.9));
  prof.push(new THREE.Vector2(rOut - 0.035, hw * 1.02));
  prof.push(new THREE.Vector2(rIn + 0.03, hw));
  prof.push(new THREE.Vector2(rIn, hw * 0.92));
  const g = new THREE.LatheGeometry(prof, 40);
  g.rotateZ(-Math.PI / 2);
  return g;
}

function rimGeometry(width: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hw = width / 2;
  // Barrel + lip.
  const barrel = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.24, -hw * 0.85),
      new THREE.Vector2(0.252, -hw * 0.9),
      new THREE.Vector2(0.255, hw * 0.8),
      new THREE.Vector2(0.262, hw * 0.86),
      new THREE.Vector2(0.258, hw * 0.92),
      new THREE.Vector2(0.235, hw * 0.88),
    ],
    36,
  );
  barrel.rotateZ(-Math.PI / 2);
  parts.push(barrel);
  // Six twin spokes, slightly dished.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + (i % 2 ? 0.11 : -0.11) + (Math.floor(i / 2) * 0);
    const spoke = new THREE.BoxGeometry(0.02, 0.17, 0.032);
    spoke.translate(0, 0.14, 0);
    spoke.rotateX(-0.12);
    const m = new THREE.Matrix4().makeRotationX(a);
    spoke.applyMatrix4(m);
    spoke.translate(hw * 0.78, 0, 0);
    parts.push(spoke);
  }
  const hub = new THREE.CylinderGeometry(0.065, 0.075, 0.05, 20);
  hub.rotateZ(Math.PI / 2);
  hub.translate(hw * 0.74, 0, 0);
  parts.push(hub);
  const merged = mergeGeometries(parts);
  return merged;
}

/** Tiny merge helper (positions, normals, uvs) so we avoid an extra import. */
function mergeGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let offset = 0;
  for (const g0 of geoms) {
    const g = g0.index ? g0 : g0;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + offset);
    else for (let i = 0; i < p.count; i++) idx.push(i + offset);
    offset += p.count;
    g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

export interface WheelRig {
  pivot: THREE.Group;
  spin: THREE.Group;
  front: boolean;
  left: boolean;
}

export interface CarMaterials {
  paint: THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial;
  trim: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  rim: THREE.MeshStandardMaterial;
  tire: THREE.MeshStandardMaterial;
  caliper: THREE.MeshStandardMaterial;
  carbon: THREE.MeshStandardMaterial;
  headLens: THREE.MeshPhysicalMaterial;
  headLed: THREE.MeshStandardMaterial;
  drl: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  tailRing: THREE.MeshStandardMaterial;
  reverse: THREE.MeshStandardMaterial;
  interior: THREE.MeshStandardMaterial;
  plate: THREE.MeshStandardMaterial;
}

/** The complete car: body group with wheels, lights and runtime controls. */
export class CarModel {
  readonly root = new THREE.Group();
  /** Body (pitches/rolls on the suspension); wheels stay on the road. */
  readonly body = new THREE.Group();
  readonly wheels: WheelRig[] = [];
  readonly mats: CarMaterials;
  readonly headlights: THREE.SpotLight[] = [];
  readonly flares: THREE.Sprite[] = [];
  readonly beams: THREE.Mesh[] = [];
  readonly steeringWheel = new THREE.Group();
  readonly interior = new THREE.Group();
  private wings: Record<WingStyle, THREE.Object3D | null> = { stock: null, track: null, none: null };
  private plates: THREE.Mesh[] = [];
  private headlightsOn = false;
  private brakeOn = false;
  private reverseOn = false;
  private drlLevel = 1;

  constructor(config: CarConfig, opts: { lights?: boolean; shadows?: boolean } = {}) {
    this.mats = createMaterials();
    this.root.add(this.body);
    this.root.name = 'player-car';
    this.buildBody();
    this.buildDetails();
    this.buildWheels();
    this.buildInterior();
    if (opts.lights !== false) this.buildLights();
    this.applyConfig(config);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = opts.shadows !== false;
        o.receiveShadow = false;
      }
    });
    this.setHeadlights(false);
  }

  private add(g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], parent: THREE.Object3D = this.body): THREE.Mesh {
    const mesh = new THREE.Mesh(g, m);
    parent.add(mesh);
    return mesh;
  }

  private buildBody(): void {
    const M = this.mats;
    // Lower body shell (single material).
    // Ring parameter v runs top-centre (0) → bottom (0.5) → top-centre (1), so
    // `up` = |v − 0.5|·2 is 0 at the underside and 1 on the centre line on top.
    // The shell is left open under the greenhouse so the cabin (and the cockpit
    // camera) sees the interior instead of a painted lid.
    const body = loft(bodyStations(), bodyHalfProfile, (x, v) => (x > 1.74 && x < 3.98 && Math.abs(v - 0.5) * 2 > 0.66 ? -1 : 0), 1, true);
    this.add(body, [M.paint]);

    // Greenhouse with glass / pillar / trim regions.
    const xs = range(CABIN[0][0], CABIN[CABIN.length - 1][0], 0.03);
    const cabin = loft(
      xs,
      cabinHalfProfile,
      (x, v) => {
        const up = Math.abs(v - 0.5) * 2; // 0 at the beltline, 1 on the roof centre line
        if (up < 0.06) return 2; // beltline trim
        if (up >= 0.5) {
          // Top surface: windscreen, roof, rear window (with pillar margins).
          if (x < 2.38) return up > 0.57 ? 1 : 0;
          if (x > 3.48 && x < 4.02) return up > 0.6 ? 1 : 0;
          return 0;
        }
        // Sides: daylight openings between the A- and kinked C-pillars.
        if (x > 1.98 && x < 3.42) {
          const kink = x > 3.12 ? (x - 3.12) * 1.3 : 0;
          return up > 0.09 && up < 0.46 - kink ? 1 : 0;
        }
        return 0;
      },
      3,
      false,
    );
    this.add(cabin, [M.paint, M.glass, M.trim]);
    // Headliner and pillar trim seen from inside: the same surface rendered
    // back-facing in a dark material, with the glass openings left clear.
    const lining = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.95, side: THREE.BackSide });
    const clear = new THREE.MeshBasicMaterial({ visible: false });
    this.add(cabin, [lining, clear, lining], this.interior);

    // Wheel-well liners hide the open arches.
    for (const ax of [FRONT_AXLE, REAR_AXLE]) {
      const liner = new THREE.CylinderGeometry(ARCH_R + 0.01, ARCH_R + 0.01, 1.78, 28, 1, true, Math.PI * 0.95, Math.PI * 1.1);
      liner.rotateZ(Math.PI / 2);
      liner.rotateX(Math.PI / 2);
      const mesh = this.add(liner, M.trim);
      mesh.position.set(0, WHEEL_R, toZ(ax));
      mesh.material = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, side: THREE.DoubleSide });
    }
    // Underbody.
    const under = new THREE.BoxGeometry(1.7, 0.04, REAR_AXLE - FRONT_AXLE - ARCH_R * 2 - 0.05);
    const um = this.add(under, M.trim);
    um.position.set(0, 0.18, toZ((FRONT_AXLE + REAR_AXLE) / 2));
  }

  private buildDetails(): void {
    const M = this.mats;
    const both = (g: THREE.BufferGeometry, m: THREE.Material) => {
      this.add(g, m);
      this.add(mirrorX(g), m);
    };
    // Headlight housings: boomerang lenses swept up into the fenders.
    const lensT0 = (x: number) => 0.6 + (x - 0.1) * 0.05;
    const lensT1 = (x: number) => 0.78 - Math.max(0, x - 0.3) * 0.12;
    both(bodyPatch(0.1, 0.62, lensT0, lensT1, 12, 6, 0.006), M.headLens);
    // DRL "check-mark" strip along the lower edge of the lens.
    both(
      bodyPatch(0.12, 0.58, (x) => lensT0(x) + 0.008, (x) => lensT0(x) + 0.03 + (x > 0.4 ? (x - 0.4) * 0.05 : 0), 10, 2, 0.009),
      M.drl,
    );
    // LED projector clusters.
    for (const [x, t] of [
      [0.27, 0.7],
      [0.38, 0.705],
      [0.49, 0.71],
    ]) {
      const p = bodySurface(x, t, 0.012);
      const led = new THREE.CylinderGeometry(0.032, 0.036, 0.02, 18);
      led.rotateX(Math.PI / 2 - 0.5);
      led.translate(p.x, p.y, p.z);
      both(led, M.headLed);
    }

    // Grille, intakes, splitter.
    const grille = new THREE.Shape();
    grille.moveTo(-0.36, 0.0);
    grille.lineTo(0.36, 0.0);
    grille.lineTo(0.42, 0.17);
    grille.lineTo(-0.42, 0.17);
    grille.closePath();
    const gGeo = new THREE.ShapeGeometry(grille);
    const gMesh = this.add(gGeo, new THREE.MeshStandardMaterial({ map: honeycombTexture(), roughness: 0.6, metalness: 0.4 }));
    gMesh.position.set(0, 0.355, toZ(0.0) - 0.006);
    gMesh.rotation.x = -0.05;
    gMesh.rotation.y = Math.PI;
    (gMesh.material as THREE.MeshStandardMaterial).map!.repeat.set(3, 0.7);
    // Chrome surround.
    const outer = new THREE.Shape();
    outer.moveTo(-0.39, -0.02);
    outer.lineTo(0.39, -0.02);
    outer.lineTo(0.455, 0.19);
    outer.lineTo(-0.455, 0.19);
    outer.closePath();
    outer.holes.push(grille as unknown as THREE.Path);
    const fm = this.add(new THREE.ShapeGeometry(outer), M.chrome);
    fm.position.copy(gMesh.position).add(new THREE.Vector3(0, 0, -0.002));
    fm.rotation.copy(gMesh.rotation);
    for (const s of [-1, 1]) {
      const intake = new THREE.PlaneGeometry(0.28, 0.12);
      const im = this.add(intake, new THREE.MeshStandardMaterial({ map: honeycombTexture(), roughness: 0.7, side: THREE.DoubleSide }));
      im.position.set(s * 0.62, 0.27, toZ(0.1) - 0.02);
      im.rotation.y = Math.PI + s * 0.45;
    }
    const splitter = new THREE.BoxGeometry(1.7, 0.025, 0.22);
    const sm = this.add(splitter, M.carbon);
    sm.position.set(0, 0.155, toZ(0.14));

    // Side skirts.
    const skirt = new THREE.BoxGeometry(0.06, 0.07, REAR_AXLE - FRONT_AXLE - ARCH_R * 2 + 0.05);
    for (const s of [-1, 1]) {
      const m = this.add(skirt, M.carbon);
      m.position.set(s * 0.93, 0.19, toZ((FRONT_AXLE + REAR_AXLE) / 2));
    }
    // Fender vents behind the front wheels.
    both(bodyPatch(1.42, 1.58, () => 0.36, () => 0.47, 3, 3, 0.006), M.trim);
    for (let k = 0; k < 3; k++) {
      both(bodyPatch(1.44 + k * 0.045, 1.46 + k * 0.045, () => 0.37, () => 0.46, 1, 2, 0.01), M.chrome);
    }

    // Mirrors.
    for (const s of [-1, 1]) {
      const cap = new THREE.SphereGeometry(0.1, 16, 10);
      cap.scale(0.55, 0.55, 1.05);
      const m = this.add(cap, M.paint);
      m.position.set(s * 1.0, 1.02, toZ(2.0));
      const glass = new THREE.PlaneGeometry(0.1, 0.07);
      const gm = this.add(glass, M.chrome);
      gm.position.set(s * 1.0, 1.02, toZ(2.0) + 0.105);
      const stalk = new THREE.BoxGeometry(0.1, 0.025, 0.06);
      const st = this.add(stalk, M.trim);
      st.position.set(s * 0.93, 0.98, toZ(1.98));
    }

    // Quad round tail lights.
    const rearZ = toZ(LENGTH);
    for (const s of [-1, 1]) {
      for (const lx of [0.47, 0.69]) {
        const ring = new THREE.TorusGeometry(0.082, 0.02, 10, 32);
        const rm = this.add(ring, M.tailRing);
        rm.position.set(s * lx, 0.85, rearZ + 0.012);
        const disc = new THREE.CircleGeometry(0.066, 28);
        const dm = this.add(disc, M.tail);
        dm.position.set(s * lx, 0.85, rearZ + 0.008);
      }
      const rev = new THREE.PlaneGeometry(0.14, 0.035);
      const rv = this.add(rev, M.reverse);
      rv.position.set(s * 0.6, 0.47, rearZ + 0.012);
    }
    // Tail panel trim and high-mount stop light.
    const panel = new THREE.PlaneGeometry(1.0, 0.06);
    const pm = this.add(panel, M.chrome);
    pm.position.set(0, 0.85, rearZ + 0.004);
    const chmsl = new THREE.PlaneGeometry(0.4, 0.018);
    const cm = this.add(chmsl, M.tail);
    cm.position.set(0, 1.04, toZ(4.06));
    cm.rotation.x = -0.9;

    // Diffuser and quad exhaust.
    const diffuser = new THREE.BoxGeometry(1.5, 0.16, 0.3);
    const dfm = this.add(diffuser, M.carbon);
    dfm.position.set(0, 0.27, toZ(4.55));
    for (let k = -3; k <= 3; k += 2) {
      const fin = new THREE.BoxGeometry(0.012, 0.12, 0.3);
      const fn = this.add(fin, M.carbon);
      fn.position.set(k * 0.12, 0.23, toZ(4.6));
    }
    for (const s of [-1, 1]) {
      for (const ex of [0.42, 0.58]) {
        const tip = new THREE.CylinderGeometry(0.052, 0.052, 0.14, 20, 1, true);
        tip.rotateX(Math.PI / 2);
        const tm = this.add(tip, M.chrome);
        tm.position.set(s * ex, 0.3, toZ(LENGTH) + 0.02);
        const inner = new THREE.CircleGeometry(0.046, 18);
        const ii = this.add(inner, new THREE.MeshBasicMaterial({ color: 0x050505 }));
        ii.position.set(s * ex, 0.3, toZ(LENGTH) + 0.0);
      }
    }

    // Number plates.
    const plateGeo = new THREE.PlaneGeometry(0.52, 0.114);
    const front = this.add(plateGeo, M.plate);
    front.position.set(0, 0.27, toZ(0.04) - 0.012);
    front.rotation.y = Math.PI;
    const rear = this.add(plateGeo, M.plate);
    rear.position.set(0, 0.62, rearZ + 0.006);
    this.plates.push(front, rear);

    // Wings.
    this.wings.stock = this.makeWing(false);
    this.wings.track = this.makeWing(true);
    this.body.add(this.wings.stock, this.wings.track);
  }

  private makeWing(track: boolean): THREE.Group {
    const g = new THREE.Group();
    const M = this.mats;
    const span = track ? 1.62 : 1.38;
    const blade = new THREE.BoxGeometry(span, 0.022, track ? 0.3 : 0.2);
    blade.rotateX(track ? 0.12 : 0.05);
    const bm = new THREE.Mesh(blade, track ? M.carbon : M.paint);
    bm.position.set(0, track ? 1.32 : 1.13, toZ(track ? 4.42 : 4.48));
    g.add(bm);
    for (const s of [-1, 1]) {
      const post = new THREE.BoxGeometry(0.03, track ? 0.28 : 0.09, 0.09);
      const pm = new THREE.Mesh(post, track ? M.carbon : M.paint);
      pm.position.set(s * (track ? 0.55 : 0.6), track ? 1.17 : 1.075, toZ(4.45));
      g.add(pm);
      if (track) {
        const plate = new THREE.BoxGeometry(0.012, 0.16, 0.36);
        const plm = new THREE.Mesh(plate, M.carbon);
        plm.position.set(s * span * 0.5, 1.31, toZ(4.42));
        g.add(plm);
      }
    }
    return g;
  }

  private buildWheels(): void {
    const M = this.mats;
    for (const front of [true, false]) {
      for (const left of [true, false]) {
        const width = front ? 0.255 : 0.285;
        const pivot = new THREE.Group();
        pivot.position.set((left ? -1 : 1) * TRACK_HALF, WHEEL_R, toZ(front ? FRONT_AXLE : REAR_AXLE));
        const spin = new THREE.Group();
        pivot.add(spin);
        const tire = new THREE.Mesh(tireGeometry(width), M.tire);
        const rim = new THREE.Mesh(rimGeometry(width), M.rim);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.028, 32).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5c5f63, metalness: 0.85, roughness: 0.45 }));
        disc.position.x = -0.03;
        spin.add(tire, rim, disc);
        // Calipers do not spin.
        const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.1), M.caliper);
        caliper.position.set(0.0, 0.1, front ? 0.11 : -0.11);
        caliper.rotation.x = front ? -0.6 : 0.6;
        pivot.add(caliper);
        if (left) pivot.scale.x = -1;
        this.root.add(pivot);
        this.wheels.push({ pivot, spin, front, left });
      }
    }
  }

  private buildInterior(): void {
    const M = this.mats;
    const g = this.interior;
    // Interior tub (floor, door cards, firewall, rear bulkhead) so the cockpit
    // view never sees through the single-sided body shell.
    const tubMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9, side: THREE.DoubleSide });
    const x0 = 1.7;
    const x1 = 3.62;
    const floorY = 0.3;
    const top = 0.93;
    const half = 0.86;
    const len = x1 - x0;
    const zc = toZ((x0 + x1) / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, len).rotateX(-Math.PI / 2), tubMat);
    floor.position.set(0, floorY, zc);
    g.add(floor);
    for (const sgn of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(len, top - floorY).rotateY(Math.PI / 2), tubMat);
      door.position.set(sgn * half, (top + floorY) / 2, zc);
      g.add(door);
    }
    const firewall = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, top - floorY), tubMat);
    firewall.position.set(0, (top + floorY) / 2, toZ(x0));
    g.add(firewall);
    const bulkhead = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 0.75), tubMat);
    bulkhead.position.set(0, floorY + 0.37, toZ(x1));
    g.add(bulkhead);
    const tunnel = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, len * 0.8), M.interior);
    tunnel.position.set(0, floorY + 0.15, zc);
    g.add(tunnel);
    const dash = new THREE.BoxGeometry(1.5, 0.16, 0.42);
    const dm = new THREE.Mesh(dash, M.interior);
    dm.position.set(0, 0.88, toZ(2.08));
    g.add(dm);
    const hood = new THREE.BoxGeometry(0.42, 0.06, 0.2);
    const hm = new THREE.Mesh(hood, M.interior);
    hm.position.set(0.37, 0.98, toZ(2.12));
    g.add(hm);
    // Gauge glow.
    const gauges = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.09), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.55 }));
    gauges.position.set(0.37, 0.95, toZ(2.22));
    gauges.rotation.x = -0.35;
    g.add(gauges);
    for (const s of [-1, 1]) {
      const seat = new THREE.BoxGeometry(0.5, 0.55, 0.12);
      const sm = new THREE.Mesh(seat, M.interior);
      sm.position.set(s * 0.37, 0.72, toZ(3.05));
      sm.rotation.x = -0.25;
      g.add(sm);
      const cushion = new THREE.BoxGeometry(0.5, 0.12, 0.5);
      const cm = new THREE.Mesh(cushion, M.interior);
      cm.position.set(s * 0.37, 0.42, toZ(2.8));
      g.add(cm);
    }
    // Right-hand-drive steering wheel (India / Japan).
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 10, 36), M.interior);
    this.steeringWheel.add(rim);
    for (let k = 0; k < 3; k++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), M.trim);
      spoke.position.set(Math.cos((k * Math.PI * 2) / 3 - Math.PI / 2) * 0.08, Math.sin((k * Math.PI * 2) / 3 - Math.PI / 2) * 0.08, 0);
      spoke.rotation.z = (k * Math.PI * 2) / 3 - Math.PI / 2;
      this.steeringWheel.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16).rotateX(Math.PI / 2), M.trim);
    this.steeringWheel.add(hub);
    this.steeringWheel.position.set(0.37, 0.86, toZ(2.42));
    this.steeringWheel.rotation.x = -0.35;
    g.add(this.steeringWheel);
    this.body.add(g);
  }

  private buildLights(): void {
    const flareTex = radialTexture();
    for (const s of [-1, 1]) {
      const light = new THREE.SpotLight(0xfff4e0, 0, 70, 0.5, 0.55, 1.6);
      const p = bodySurface(0.32, 0.7, 0.05);
      light.position.set(s * p.x, p.y, p.z);
      light.target.position.set(s * 0.9, 0, toZ(0) - 24);
      light.castShadow = false;
      this.body.add(light, light.target);
      this.headlights.push(light);
      const flare = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: flareTex, color: 0xdfe9ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
      );
      flare.position.set(s * p.x, p.y, p.z - 0.05);
      flare.scale.setScalar(0.42);
      this.body.add(flare);
      this.flares.push(flare);
      // Fake volumetric beam for menus / night ambience (apex at the lamp, opening forwards).
      const beamGeo = new THREE.ConeGeometry(1.4, 9, 24, 1, true);
      beamGeo.translate(0, -4.5, 0);
      beamGeo.rotateX(Math.PI / 2 - 0.06);
      const beam = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({
          map: beamTexture(),
          color: 0xd8e4ff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      beam.position.copy(flare.position);
      this.body.add(beam);
      this.beams.push(beam);
    }
  }

  applyConfig(c: CarConfig): void {
    const paint = paintById(c.paint);
    const pm = this.mats.paint;
    pm.color.set(paint.color);
    pm.metalness = paint.finish === 'matte' ? 0.35 : paint.finish === 'gloss' ? 0.15 : 0.62;
    pm.roughness = paint.finish === 'matte' ? 0.62 : paint.finish === 'gloss' ? 0.18 : 0.3;
    pm.clearcoat = paint.finish === 'matte' ? 0 : 1;
    pm.clearcoatRoughness = 0.035;
    pm.iridescence = paint.finish === 'pearl' ? 0.55 : 0;
    pm.iridescenceIOR = 1.32;
    pm.sheen = paint.finish === 'pearl' ? 0.4 : 0;
    pm.sheenColor.set(paint.finish === 'pearl' ? '#8f7cff' : '#000000');
    const rim = RIMS.find((r) => r.id === c.rims) ?? RIMS[0];
    this.mats.rim.color.set(rim.color);
    this.mats.rim.metalness = rim.metalness;
    this.mats.rim.roughness = rim.roughness;
    const cal = CALIPERS.find((k) => k.id === c.caliper) ?? CALIPERS[0];
    this.mats.caliper.color.set(cal.color);
    this.mats.glass.opacity = 0.55 + c.tint * 0.4;
    this.mats.glass.color.setScalar(0.06 + (1 - c.tint) * 0.12);
    for (const w of Object.keys(this.wings) as WingStyle[]) {
      const obj = this.wings[w];
      if (obj) obj.visible = w === c.wing;
    }
    const tex = numberPlateTexture(c.plate);
    this.mats.plate.map = tex;
    this.mats.plate.needsUpdate = true;
  }

  setHeadlights(on: boolean): void {
    this.headlightsOn = on;
    for (const l of this.headlights) l.intensity = on ? 38 : 0;
    this.updateLightMaterials();
  }

  isHeadlightsOn(): boolean {
    return this.headlightsOn;
  }

  setBrake(on: boolean): void {
    if (on === this.brakeOn) return;
    this.brakeOn = on;
    this.updateLightMaterials();
  }

  setReverse(on: boolean): void {
    if (on === this.reverseOn) return;
    this.reverseOn = on;
    this.mats.reverse.emissiveIntensity = on ? 2.2 : 0;
  }

  /** 0..1 power of the daytime running lights (used by the menu power-on animation). */
  setDrl(level: number): void {
    this.drlLevel = level;
    this.updateLightMaterials();
  }

  /** Beam / flare visibility (0..1) — night ambience and menu effect. */
  setBeamStrength(v: number): void {
    for (const b of this.beams) (b.material as THREE.MeshBasicMaterial).opacity = 0.035 * v;
    for (const f of this.flares) (f.material as THREE.SpriteMaterial).opacity = 0.55 * v;
  }

  private updateLightMaterials(): void {
    const M = this.mats;
    M.drl.emissiveIntensity = 2.2 * this.drlLevel;
    M.headLed.emissiveIntensity = this.headlightsOn ? 3.2 : 0.15;
    const tail = this.brakeOn ? 5 : this.headlightsOn ? 1.6 : 0.35;
    M.tail.emissiveIntensity = tail;
    M.tailRing.emissiveIntensity = tail * 1.2;
  }

  /** Animates wheels (spin, steer) and the steering wheel. */
  update(wheelRotF: number, wheelRotR: number, steer: number): void {
    for (const w of this.wheels) {
      // A mirror in X commutes with rotation about X, so both sides spin alike.
      w.spin.rotation.x = -(w.front ? wheelRotF : wheelRotR);
      w.pivot.rotation.y = w.front ? steer : 0;
    }
    this.steeringWheel.rotation.z = steer * 6;
  }

  setInteriorVisible(v: boolean): void {
    this.interior.visible = v;
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const m of Object.values(this.mats)) (m as THREE.Material).dispose();
  }
}

function createMaterials(): CarMaterials {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: 0x3a3d42, metalness: 0.62, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.25 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x0d1015,
      metalness: 0.2,
      roughness: 0.04,
      transparent: true,
      opacity: 0.85,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
    }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.55, metalness: 0.2 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.18, metalness: 1 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x3b3e44, roughness: 0.35, metalness: 0.9 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, metalness: 0 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xe09a1a, roughness: 0.35, metalness: 0.3 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.3, metalness: 0.5 }),
    headLens: new THREE.MeshPhysicalMaterial({ color: 0x1a1d22, roughness: 0.05, metalness: 0.6, clearcoat: 1, envMapIntensity: 2 }),
    headLed: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf2ff, emissiveIntensity: 0.15, roughness: 0.2 }),
    drl: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfeaff, emissiveIntensity: 3, roughness: 0.3 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x3a0306, emissive: 0xff1a1a, emissiveIntensity: 0.35, roughness: 0.3 }),
    tailRing: new THREE.MeshStandardMaterial({ color: 0x5a0508, emissive: 0xff2020, emissiveIntensity: 0.4, roughness: 0.25 }),
    reverse: new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.8 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
  };
}
