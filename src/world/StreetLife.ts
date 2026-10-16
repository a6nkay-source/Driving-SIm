/**
 * Street life per streaming tile: cars, taxis and clusters of two-wheelers
 * parked half on the footpath (as everywhere in Mumbai), and street vendors —
 * vada pav carts, fruit carts, chai stalls and coconut sellers.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../map/geometry';
import type { RoadGraph } from '../map/RoadGraph';
import { Kind } from '../map/types';
import { CAR_COLORS, SHIRT_COLORS, SPECS, vehicleGeometries, type VehicleKind } from '../traffic/vehicleModels';
import { createTrafficMaterial } from './materials';

export interface ParkedVehicle {
  kind: VehicleKind;
  x: number;
  z: number;
  rot: number;
  color: string;
}

export type VendorKind = 'vadapav' | 'fruit' | 'chai' | 'coconut';

export interface Vendor {
  kind: VendorKind;
  x: number;
  z: number;
  rot: number;
}

interface PlaceOpts {
  graph: RoadGraph;
  edgeIds: number[];
  inChunk: (x: number, z: number) => boolean;
  nodeRadius: Float32Array;
  blocked: (x: number, z: number) => boolean;
  /** Street lights already placed (x, z) — parked cars keep clear of them. */
  avoid: [number, number][];
  autoNorthOfZ?: number;
  seed: number;
}

function nearAny(x: number, z: number, pts: [number, number][], r: number): boolean {
  for (const [px, pz] of pts) if (Math.abs(px - x) < r && Math.abs(pz - z) < r && Math.hypot(px - x, pz - z) < r) return true;
  return false;
}

export function placeParked(o: PlaceOpts): ParkedVehicle[] {
  const out: ParkedVehicle[] = [];
  const r = rng(o.seed);
  const p = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
  const taken: [number, number][] = [];
  for (const ei of o.edgeIds) {
    const e = o.graph.edges[ei];
    if (e.h || e.k < Kind.Secondary || e.k > Kind.LivingStreet) continue;
    if (e.k === Kind.Secondary && r() < 0.6) continue;
    const len = o.graph.lengths[ei];
    const start = o.nodeRadius[e.a] + 9;
    const end = len - o.nodeRadius[e.b] - 9;
    const sides = e.o ? [1] : r() < 0.6 ? [1, -1] : [1];
    for (const side of sides) {
      let s = start + r() * 6;
      while (s < end) {
        const roll = r();
        const kind: VehicleKind = roll < 0.18 ? 'bike' : roll < 0.32 ? 'taxi' : 'car';
        if (r() < 0.38) {
          s += 4 + r() * 8;
          continue;
        }
        const n = kind === 'bike' ? 3 + Math.floor(r() * 4) : 1;
        for (let k = 0; k < n && s < end; k++) {
          o.graph.sample(ei, s, p);
          if (!o.inChunk(p.x, p.z)) {
            s += 2;
            continue;
          }
          const lx = p.tz * side;
          const lz = -p.tx * side;
          const off = e.w / 2 + (kind === 'bike' ? 0.75 : 0.45);
          const x = p.x + lx * off;
          const z = p.z + lz * off;
          let k2: VehicleKind = kind;
          if (k2 === 'car' && o.autoNorthOfZ !== undefined && z < o.autoNorthOfZ && r() < 0.25) k2 = 'auto';
          if (!o.blocked(x, z) && !nearAny(x, z, o.avoid, 3) && !nearAny(x, z, taken, kind === 'bike' ? 0.9 : 3.6)) {
            // Bikes park angled to the kerb; cars parallel to it.
            const along = Math.atan2(-p.tx * side, -p.tz * side);
            const rot = kind === 'bike' ? along + (side > 0 ? 1.1 : -1.1) : along;
            const palette = kind === 'bike' ? SHIRT_COLORS : CAR_COLORS;
            out.push({ kind: k2, x, z, rot, color: kind === 'taxi' || k2 === 'auto' ? '#ffffff' : palette[Math.floor(r() * palette.length)] });
            taken.push([x, z]);
          }
          s += kind === 'bike' ? 1.05 : 5.4 + r() * 1.5;
        }
      }
    }
  }
  return out;
}

let parkedMat: THREE.MeshStandardMaterial | null = null;

export function buildParked(list: ParkedVehicle[]): { meshes: THREE.InstancedMesh[]; circles: number[] } {
  const byKind = new Map<VehicleKind, ParkedVehicle[]>();
  for (const v of list) {
    if (!byKind.has(v.kind)) byKind.set(v.kind, []);
    byKind.get(v.kind)!.push(v);
  }
  parkedMat ??= createTrafficMaterial(false);
  const geos = vehicleGeometries();
  const meshes: THREE.InstancedMesh[] = [];
  const circles: number[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  for (const [kind, items] of byKind) {
    const geo = geos[kind].clone();
    geo.setAttribute('iState', new THREE.InstancedBufferAttribute(new Float32Array(items.length * 2), 2));
    const mesh = new THREE.InstancedMesh(geo, parkedMat, items.length);
    items.forEach((v, i) => {
      q.setFromAxisAngle(up, v.rot);
      m.compose(new THREE.Vector3(v.x, 0.03, v.z), q, one);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(v.color));
      const spec = SPECS[kind];
      const fx = -Math.sin(v.rot);
      const fz = -Math.cos(v.rot);
      for (const off of spec.circles) circles.push(v.x + fx * off, v.z + fz * off, spec.radius);
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.userData.ownGeometry = true;
    meshes.push(mesh);
  }
  return { meshes, circles };
}

// ------------------------------------------------------------------ vendors
function paint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function seller(x: number, z: number, shirt: number): THREE.BufferGeometry[] {
  return [
    paint(new THREE.BoxGeometry(0.36, 0.55, 0.22).translate(x, 1.2, z), shirt),
    paint(new THREE.BoxGeometry(0.3, 0.9, 0.18).translate(x, 0.47, z), 0xe8e2d4),
    paint(new THREE.IcosahedronGeometry(0.11, 0).translate(x, 1.6, z), 0x6b4226),
    paint(new THREE.SphereGeometry(0.115, 6, 3, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(x, 1.62, z), 0x161616),
  ];
}

function cartBase(color: number): THREE.BufferGeometry[] {
  return [
    paint(new THREE.BoxGeometry(1.5, 0.5, 0.85).translate(0, 0.85, 0), color),
    paint(new THREE.BoxGeometry(1.55, 0.05, 0.9).translate(0, 1.12, 0), 0x8d6e63),
    paint(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 10).rotateX(Math.PI / 2).translate(-0.45, 0.3, 0.45), 0x222222),
    paint(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 10).rotateX(Math.PI / 2).translate(-0.45, 0.3, -0.45), 0x222222),
    paint(new THREE.BoxGeometry(0.04, 0.6, 0.04).translate(0.7, 0.9, 0.38), 0x5d4037),
    paint(new THREE.BoxGeometry(0.04, 0.6, 0.04).translate(0.7, 0.9, -0.38), 0x5d4037),
  ];
}

let vendorGeos: Record<VendorKind, THREE.BufferGeometry> | null = null;

function vendorGeometries(): Record<VendorKind, THREE.BufferGeometry> {
  if (vendorGeos) return vendorGeos;
  const umbrella = (color: number) => paint(new THREE.ConeGeometry(1.15, 0.45, 8).translate(0, 2.35, 0), color);
  const pole = paint(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 5).translate(0, 1.75, 0), 0x777777);
  const fruit: THREE.BufferGeometry[] = [];
  const fr = rng(5);
  const fruitColors = [0xff7043, 0xffca28, 0x66bb6a, 0xef5350, 0xffa726];
  for (let i = 0; i < 26; i++) {
    fruit.push(paint(new THREE.IcosahedronGeometry(0.08, 0).translate((fr() - 0.5) * 1.3, 1.2 + fr() * 0.12, (fr() - 0.5) * 0.7), fruitColors[i % fruitColors.length]));
  }
  const coconuts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) coconuts.push(paint(new THREE.IcosahedronGeometry(0.13, 0).translate((fr() - 0.5) * 1.1, 1.25 + fr() * 0.15, (fr() - 0.5) * 0.6), 0x558b2f));
  vendorGeos = {
    vadapav: mergeGeometries(
      [
        ...cartBase(0xe65100),
        pole,
        umbrella(0xffc107),
        paint(new THREE.CylinderGeometry(0.28, 0.2, 0.12, 12).translate(-0.3, 1.2, 0), 0x424242),
        paint(new THREE.BoxGeometry(0.5, 0.12, 0.35).translate(0.35, 1.2, 0), 0xffb74d),
        ...seller(0, 0, 0xf5f5f0).map((g) => g.translate(0, 0, 0.8)),
      ],
      false,
    )!,
    fruit: mergeGeometries([...cartBase(0x2e7d32), ...fruit, ...seller(0, 0, 0x90caf9).map((g) => g.translate(0, 0, 0.8))], false)!,
    chai: mergeGeometries(
      [
        paint(new THREE.BoxGeometry(1.4, 1.0, 0.9).translate(0, 0.5, 0), 0x6d4c41),
        paint(new THREE.BoxGeometry(1.8, 0.06, 1.4).translate(0, 2.1, 0.15), 0x1565c0),
        paint(new THREE.BoxGeometry(0.05, 2.1, 0.05).translate(0.85, 1.05, 0.8), 0x777777),
        paint(new THREE.BoxGeometry(0.05, 2.1, 0.05).translate(-0.85, 1.05, 0.8), 0x777777),
        paint(new THREE.CylinderGeometry(0.12, 0.14, 0.24, 10).translate(-0.3, 1.12, 0), 0xbdbdbd),
        paint(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10).translate(-0.3, 1.02, 0), 0x263238),
        ...seller(0, 0, 0xffffff).map((g) => g.translate(0.2, 0, -0.75)),
      ],
      false,
    )!,
    coconut: mergeGeometries([...cartBase(0x795548), ...coconuts, pole, umbrella(0xd32f2f), ...seller(0, 0, 0xffe082).map((g) => g.translate(0, 0, 0.8))], false)!,
  };
  for (const g of Object.values(vendorGeos)) g.computeBoundingSphere();
  return vendorGeos;
}

export function placeVendors(o: PlaceOpts & { commercial: boolean }): Vendor[] {
  const out: Vendor[] = [];
  const r = rng(o.seed * 3 + 1);
  const p = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
  const kinds: VendorKind[] = ['vadapav', 'fruit', 'chai', 'coconut'];
  for (const ei of o.edgeIds) {
    const e = o.graph.edges[ei];
    if (e.h || e.k < Kind.Primary || e.k > Kind.Residential) continue;
    const len = o.graph.lengths[ei];
    const chance = o.commercial ? (e.k <= Kind.Tertiary ? 0.55 : 0.3) : e.k <= Kind.Secondary ? 0.15 : 0.05;
    for (let s = o.nodeRadius[e.a] + 12; s < len - o.nodeRadius[e.b] - 12; s += 55 + r() * 30) {
      if (r() > chance) continue;
      o.graph.sample(ei, s, p);
      if (!o.inChunk(p.x, p.z)) continue;
      const side = r() < 0.5 ? 1 : -1;
      const lx = p.tz * side;
      const lz = -p.tx * side;
      const sw = e.k <= Kind.Secondary ? 3.2 : 2.4;
      const off = e.w / 2 + sw * 0.62;
      const x = p.x + lx * off;
      const z = p.z + lz * off;
      if (o.blocked(x, z) || nearAny(x, z, o.avoid, 3.5)) continue;
      // Carts sit parallel to the kerb, seller on the footpath side.
      out.push({ kind: kinds[Math.floor(r() * kinds.length)], x, z, rot: Math.atan2(lx, lz) });
    }
  }
  return out;
}

let vendorMat: THREE.MeshStandardMaterial | null = null;

export function buildVendors(list: Vendor[]): { meshes: THREE.InstancedMesh[]; circles: number[] } {
  vendorMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const geos = vendorGeometries();
  const meshes: THREE.InstancedMesh[] = [];
  const circles: number[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  for (const kind of Object.keys(geos) as VendorKind[]) {
    const items = list.filter((v) => v.kind === kind);
    if (!items.length) continue;
    const mesh = new THREE.InstancedMesh(geos[kind], vendorMat, items.length);
    items.forEach((v, i) => {
      q.setFromAxisAngle(up, v.rot);
      m.compose(new THREE.Vector3(v.x, 0.03, v.z), q, one);
      mesh.setMatrixAt(i, m);
      circles.push(v.x, v.z, 0.95);
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    meshes.push(mesh);
  }
  return { meshes, circles };
}
