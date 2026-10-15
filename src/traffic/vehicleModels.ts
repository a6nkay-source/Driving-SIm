/**
 * Low-poly traffic vehicles built from boxes and cylinders with per-vertex
 * colour, a tint mask (body panels take the instance colour) and light masks
 * for the emissive head/tail/indicator lamps. Faces −Z like the player car.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type VehicleKind = 'car' | 'taxi' | 'bus' | 'auto';

export interface VehicleSpec {
  kind: VehicleKind;
  length: number;
  width: number;
  /** Collision circles: forward offsets + radius. */
  circles: number[];
  radius: number;
}

export const SPECS: Record<VehicleKind, VehicleSpec> = {
  car: { kind: 'car', length: 4.1, width: 1.72, circles: [1.15, -1.15], radius: 0.86 },
  taxi: { kind: 'taxi', length: 3.95, width: 1.56, circles: [1.1, -1.1], radius: 0.8 },
  bus: { kind: 'bus', length: 11.4, width: 2.5, circles: [4.3, 1.45, -1.45, -4.3], radius: 1.25 },
  auto: { kind: 'auto', length: 2.65, width: 1.32, circles: [0.6, -0.6], radius: 0.68 },
};

interface Part {
  geo: THREE.BufferGeometry;
  color: number;
  tint?: boolean;
  glow?: number;
}

function box(w: number, h: number, l: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, l).translate(x, y, z);
}

function wheel(r: number, w: number, x: number, z: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2).translate(x, r, z);
}

function build(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    g.deleteAttribute('uv');
    const n = g.getAttribute('position').count;
    const c = new THREE.Color(p.color);
    const col = new Float32Array(n * 3);
    const glow = new Float32Array(n);
    const tint = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      glow[i] = p.glow ?? 0;
      tint[i] = p.tint ? 1 : 0;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    g.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
    return g;
  });
  const merged = mergeGeometries(geos, false)!;
  merged.computeBoundingSphere();
  return merged;
}

const GLASS = 0x1a2026;
const TYRE = 0x111111;
const CHROME = 0x9a9ea4;

function sedan(): THREE.BufferGeometry {
  const L = 4.1;
  const W = 1.72;
  return build([
    { geo: box(W, 0.62, L, 0, 0.62, 0), color: 0xffffff, tint: true },
    { geo: box(W - 0.12, 0.52, 2.0, 0, 1.18, 0.15), color: 0xffffff, tint: true },
    { geo: box(W - 0.1, 0.4, 1.9, 0, 1.17, 0.15), color: GLASS },
    { geo: box(W - 0.3, 0.42, 0.05, 0, 1.15, -0.87), color: GLASS },
    { geo: box(W - 0.3, 0.38, 0.05, 0, 1.15, 1.17), color: GLASS },
    { geo: box(W + 0.02, 0.14, L + 0.04, 0, 0.36, 0), color: 0x222428 },
    { geo: box(0.36, 0.14, 0.05, -0.6, 0.78, -L / 2 - 0.01), color: 0xffffff, glow: 1 },
    { geo: box(0.36, 0.14, 0.05, 0.6, 0.78, -L / 2 - 0.01), color: 0xffffff, glow: 1 },
    { geo: box(0.4, 0.14, 0.05, -0.6, 0.8, L / 2 + 0.01), color: 0x8a1010, glow: 2 },
    { geo: box(0.4, 0.14, 0.05, 0.6, 0.8, L / 2 + 0.01), color: 0x8a1010, glow: 2 },
    { geo: box(0.1, 0.08, 0.06, -0.82, 0.7, -L / 2), color: 0xb36a00, glow: 3 },
    { geo: box(0.1, 0.08, 0.06, 0.82, 0.7, -L / 2), color: 0xb36a00, glow: 3 },
    { geo: box(0.1, 0.08, 0.06, -0.82, 0.68, L / 2), color: 0xb36a00, glow: 3 },
    { geo: box(0.1, 0.08, 0.06, 0.82, 0.68, L / 2), color: 0xb36a00, glow: 3 },
    { geo: box(0.7, 0.16, 0.04, 0, 0.5, L / 2 + 0.02), color: 0xf2f2ee },
    { geo: wheel(0.31, 0.2, -0.78, -1.3), color: TYRE },
    { geo: wheel(0.31, 0.2, 0.78, -1.3), color: TYRE },
    { geo: wheel(0.31, 0.2, -0.78, 1.25), color: TYRE },
    { geo: wheel(0.31, 0.2, 0.78, 1.25), color: TYRE },
  ]);
}

/** The classic Mumbai "kaali-peeli" — a boxy black-and-yellow Premier Padmini-style taxi. */
function taxi(): THREE.BufferGeometry {
  const L = 3.95;
  const W = 1.56;
  const black = 0x15161a;
  const yellow = 0xf2c200;
  return build([
    { geo: box(W, 0.55, L, 0, 0.6, 0), color: black },
    { geo: box(W - 0.06, 0.08, L - 0.1, 0, 0.92, 0), color: yellow },
    { geo: box(W - 0.14, 0.5, 1.95, 0, 1.2, 0.2), color: yellow },
    { geo: box(W - 0.12, 0.36, 1.85, 0, 1.18, 0.2), color: GLASS },
    { geo: box(W - 0.3, 0.38, 0.05, 0, 1.17, -0.8), color: GLASS },
    { geo: box(W - 0.06, 0.34, 0.95, 0, 0.98, -1.45), color: yellow },
    { geo: box(W - 0.06, 0.3, 0.75, 0, 0.98, 1.6), color: yellow },
    { geo: box(W + 0.04, 0.1, 0.12, 0, 0.42, -L / 2), color: CHROME },
    { geo: box(W + 0.04, 0.1, 0.12, 0, 0.42, L / 2), color: CHROME },
    { geo: new THREE.CylinderGeometry(0.1, 0.1, 0.05, 12).rotateX(Math.PI / 2).translate(-0.55, 0.78, -L / 2 - 0.01), color: 0xffffff, glow: 1 },
    { geo: new THREE.CylinderGeometry(0.1, 0.1, 0.05, 12).rotateX(Math.PI / 2).translate(0.55, 0.78, -L / 2 - 0.01), color: 0xffffff, glow: 1 },
    { geo: box(0.18, 0.12, 0.05, -0.6, 0.78, L / 2 + 0.01), color: 0x8a1010, glow: 2 },
    { geo: box(0.18, 0.12, 0.05, 0.6, 0.78, L / 2 + 0.01), color: 0x8a1010, glow: 2 },
    { geo: box(0.1, 0.08, 0.06, -0.72, 0.6, -L / 2), color: 0xb36a00, glow: 3 },
    { geo: box(0.1, 0.08, 0.06, 0.72, 0.6, L / 2), color: 0xb36a00, glow: 3 },
    { geo: box(0.4, 0.14, 0.3, 0, 1.52, 0.1), color: yellow },
    { geo: wheel(0.29, 0.18, -0.7, -1.2), color: TYRE },
    { geo: wheel(0.29, 0.18, 0.7, -1.2), color: TYRE },
    { geo: wheel(0.29, 0.18, -0.7, 1.2), color: TYRE },
    { geo: wheel(0.29, 0.18, 0.7, 1.2), color: TYRE },
  ]);
}

/** Red double-decker in the spirit of Mumbai's BEST buses. */
function bus(): THREE.BufferGeometry {
  const L = 11.4;
  const W = 2.5;
  const red = 0xb3201d;
  const cream = 0xe9dfc4;
  return build([
    { geo: box(W, 3.75, L, 0, 2.22, 0), color: red },
    { geo: box(W + 0.02, 0.85, L - 1.2, 0, 1.75, 0.2), color: GLASS },
    { geo: box(W + 0.02, 0.85, L - 0.8, 0, 3.35, 0.0), color: GLASS },
    { geo: box(W + 0.03, 0.2, L + 0.02, 0, 2.55, 0), color: cream },
    { geo: box(W - 0.2, 1.2, 0.05, 0, 1.85, -L / 2 - 0.01), color: GLASS },
    { geo: box(W - 0.2, 0.75, 0.05, 0, 3.3, -L / 2 - 0.01), color: GLASS },
    { geo: box(1.4, 0.25, 0.06, 0, 2.62, -L / 2 - 0.02), color: 0xffb02e, glow: 1 },
    { geo: box(0.3, 0.18, 0.06, -0.95, 0.75, -L / 2 - 0.02), color: 0xffffff, glow: 1 },
    { geo: box(0.3, 0.18, 0.06, 0.95, 0.75, -L / 2 - 0.02), color: 0xffffff, glow: 1 },
    { geo: box(0.25, 0.35, 0.06, -1.05, 0.9, L / 2 + 0.02), color: 0x8a1010, glow: 2 },
    { geo: box(0.25, 0.35, 0.06, 1.05, 0.9, L / 2 + 0.02), color: 0x8a1010, glow: 2 },
    { geo: box(0.12, 0.12, 0.07, -1.2, 0.55, -L / 2), color: 0xb36a00, glow: 3 },
    { geo: box(0.12, 0.12, 0.07, 1.2, 0.55, L / 2), color: 0xb36a00, glow: 3 },
    { geo: box(W + 0.02, 0.3, L, 0, 0.38, 0), color: 0x2a2a2a },
    { geo: wheel(0.5, 0.32, -1.05, -3.6), color: TYRE },
    { geo: wheel(0.5, 0.32, 1.05, -3.6), color: TYRE },
    { geo: wheel(0.5, 0.32, -1.05, 3.4), color: TYRE },
    { geo: wheel(0.5, 0.32, 1.05, 3.4), color: TYRE },
  ]);
}

/** Black-and-yellow auto-rickshaw (Bandra and the suburbs; banned in South Mumbai). */
function auto(): THREE.BufferGeometry {
  const yellow = 0xe8c11a;
  const black = 0x141414;
  return build([
    { geo: box(1.25, 0.5, 1.9, 0, 0.62, 0.3), color: yellow },
    { geo: box(0.9, 0.55, 0.7, 0, 0.75, -0.9), color: yellow },
    { geo: box(1.3, 0.08, 2.2, 0, 1.78, 0.1), color: black },
    { geo: box(1.28, 0.95, 0.06, 0, 1.3, 1.2), color: black },
    { geo: box(0.05, 1.0, 0.05, -0.6, 1.3, -0.95), color: black },
    { geo: box(0.05, 1.0, 0.05, 0.6, 1.3, -0.95), color: black },
    { geo: box(1.0, 0.55, 0.05, 0, 1.45, -0.98), color: GLASS },
    { geo: new THREE.CylinderGeometry(0.09, 0.09, 0.05, 10).rotateX(Math.PI / 2).translate(0, 0.95, -1.27), color: 0xffffff, glow: 1 },
    { geo: box(0.14, 0.1, 0.05, -0.5, 0.75, 1.24), color: 0x8a1010, glow: 2 },
    { geo: box(0.14, 0.1, 0.05, 0.5, 0.75, 1.24), color: 0x8a1010, glow: 2 },
    { geo: wheel(0.22, 0.12, 0, -1.0), color: TYRE },
    { geo: wheel(0.22, 0.12, -0.58, 0.85), color: TYRE },
    { geo: wheel(0.22, 0.12, 0.58, 0.85), color: TYRE },
  ]);
}

let cache: Record<VehicleKind, THREE.BufferGeometry> | null = null;

export function vehicleGeometries(): Record<VehicleKind, THREE.BufferGeometry> {
  cache ??= { car: sedan(), taxi: taxi(), bus: bus(), auto: auto() };
  return cache;
}

/** Common Indian car colours: lots of white and silver. */
export const CAR_COLORS = ['#f2f2ee', '#f2f2ee', '#f2f2ee', '#c9ccd1', '#c9ccd1', '#8d9196', '#2b2d31', '#7a1b1b', '#22406e', '#5b5a3c', '#a23a12', '#3c5e7a'];
