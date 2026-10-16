/**
 * Low-poly traffic vehicles built from boxes and cylinders with per-vertex
 * colour, a tint mask (body panels take the instance colour) and light masks
 * for the emissive head/tail/indicator lamps. Faces −Z like the player car.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type VehicleKind = 'car' | 'taxi' | 'bus' | 'bus1' | 'auto' | 'bike' | 'truck';

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
  bus1: { kind: 'bus1', length: 11.0, width: 2.5, circles: [4.1, 1.4, -1.4, -4.1], radius: 1.25 },
  auto: { kind: 'auto', length: 2.65, width: 1.32, circles: [0.6, -0.6], radius: 0.68 },
  bike: { kind: 'bike', length: 1.9, width: 0.75, circles: [0.45, -0.45], radius: 0.42 },
  truck: { kind: 'truck', length: 6.2, width: 2.05, circles: [2.1, 0, -2.1], radius: 1.05 },
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

/**
 * A side profile ([z, y] points, front at −Z) extruded across the width and
 * centred on x = 0, with wheel arches cut from the bottom edge as [z, radius].
 */
function profile(pts: [number, number][], width: number, arches: [number, number][] = [], bevel = 0.05): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  const y0 = pts[0][1];
  // Arches run rear → front along the bottom edge.
  for (const [z, r] of [...arches].sort((p, q) => q[0] - p[0])) {
    shape.lineTo(z + r, y0);
    shape.absarc(z, y0, r, 0, Math.PI, false);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** A modern compact saloon (the white / silver majority of Mumbai's cars). */
function sedan(): THREE.BufferGeometry {
  const L = 4.1;
  const W = 1.72;
  const fz = -1.3;
  const rz = 1.25;
  return build([
    {
      geo: profile(
        [
          [-2.04, 0.3],
          [-2.07, 0.6],
          [-1.98, 0.76],
          [-1.25, 0.88],
          [-0.78, 0.93],
          [1.25, 0.95],
          [1.95, 0.9],
          [2.06, 0.74],
          [2.04, 0.3],
        ],
        W,
        [
          [fz, 0.37],
          [rz, 0.37],
        ],
      ),
      color: 0xffffff,
      tint: true,
    },
    // Greenhouse: glass band, then the painted roof.
    {
      geo: profile(
        [
          [-0.8, 0.92],
          [-0.22, 1.36],
          [0.86, 1.37],
          [1.3, 0.94],
        ],
        W - 0.18,
        [],
        0.02,
      ),
      color: GLASS,
    },
    {
      geo: profile(
        [
          [-0.26, 1.33],
          [-0.16, 1.42],
          [0.84, 1.43],
          [0.94, 1.33],
        ],
        W - 0.16,
        [],
        0.03,
      ),
      color: 0xffffff,
      tint: true,
    },
    { geo: box(W + 0.03, 0.12, 0.2, 0, 0.38, -L / 2 + 0.06), color: 0x222428 },
    { geo: box(W + 0.03, 0.12, 0.2, 0, 0.4, L / 2 - 0.06), color: 0x222428 },
    { geo: box(W + 0.02, 0.06, 2.0, 0, 0.36, 0), color: 0x222428 },
    { geo: box(0.42, 0.11, 0.06, -0.58, 0.74, -L / 2 + 0.04), color: 0xffffff, glow: 1 },
    { geo: box(0.42, 0.11, 0.06, 0.58, 0.74, -L / 2 + 0.04), color: 0xffffff, glow: 1 },
    { geo: box(0.6, 0.08, 0.04, 0, 0.58, -L / 2 + 0.01), color: 0x18191c },
    { geo: box(0.42, 0.13, 0.06, -0.58, 0.8, L / 2 - 0.08), color: 0x8a1010, glow: 2 },
    { geo: box(0.42, 0.13, 0.06, 0.58, 0.8, L / 2 - 0.08), color: 0x8a1010, glow: 2 },
    { geo: box(0.08, 0.07, 0.06, -0.84, 0.68, -L / 2 + 0.06), color: 0xb36a00, glow: 3 },
    { geo: box(0.08, 0.07, 0.06, 0.84, 0.68, -L / 2 + 0.06), color: 0xb36a00, glow: 3 },
    { geo: box(0.08, 0.07, 0.06, -0.82, 0.7, L / 2 - 0.06), color: 0xb36a00, glow: 3 },
    { geo: box(0.08, 0.07, 0.06, 0.82, 0.7, L / 2 - 0.06), color: 0xb36a00, glow: 3 },
    { geo: box(0.52, 0.13, 0.03, 0, 0.5, L / 2 - 0.02), color: 0xf2f2ee },
    // Mirrors.
    { geo: box(0.12, 0.09, 0.16, -W / 2 - 0.04, 0.98, -0.7), color: 0x1d1e22 },
    { geo: box(0.12, 0.09, 0.16, W / 2 + 0.04, 0.98, -0.7), color: 0x1d1e22 },
    { geo: wheel(0.31, 0.2, -0.77, fz), color: TYRE },
    { geo: wheel(0.31, 0.2, 0.77, fz), color: TYRE },
    { geo: wheel(0.31, 0.2, -0.77, rz), color: TYRE },
    { geo: wheel(0.31, 0.2, 0.77, rz), color: TYRE },
    { geo: wheel(0.19, 0.21, -0.77, fz), color: CHROME },
    { geo: wheel(0.19, 0.21, 0.77, fz), color: CHROME },
    { geo: wheel(0.19, 0.21, -0.77, rz), color: CHROME },
    { geo: wheel(0.19, 0.21, 0.77, rz), color: CHROME },
  ]);
}

/** The classic Mumbai "kaali-peeli" — a black-and-yellow Premier Padmini taxi. */
function taxi(): THREE.BufferGeometry {
  const L = 3.95;
  const W = 1.56;
  const black = 0x15161a;
  const yellow = 0xf2c200;
  const fz = -1.15;
  const rz = 1.22;
  return build([
    {
      geo: profile(
        [
          [-1.9, 0.3],
          [-1.95, 0.62],
          [-1.88, 0.76],
          [-1.4, 0.82],
          [-0.55, 0.88],
          [1.35, 0.88],
          [1.92, 0.82],
          [2.0, 0.72],
          [1.98, 0.3],
        ],
        W,
        [
          [fz, 0.35],
          [rz, 0.35],
        ],
      ),
      color: black,
    },
    {
      geo: profile(
        [
          [-0.52, 0.87],
          [-0.12, 1.3],
          [0.98, 1.3],
          [1.36, 0.87],
        ],
        W - 0.2,
        [],
        0.02,
      ),
      color: GLASS,
    },
    {
      geo: profile(
        [
          [-0.18, 1.28],
          [-0.08, 1.37],
          [0.95, 1.38],
          [1.04, 1.28],
        ],
        W - 0.14,
        [],
        0.03,
      ),
      color: yellow,
    },
    { geo: box(W + 0.06, 0.09, 0.1, 0, 0.42, -L / 2 + 0.02), color: CHROME },
    { geo: box(W + 0.06, 0.09, 0.1, 0, 0.42, L / 2 + 0.02), color: CHROME },
    { geo: box(0.74, 0.18, 0.03, 0, 0.6, -L / 2 + 0.06), color: CHROME },
    { geo: new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12).rotateX(Math.PI / 2).translate(-0.55, 0.62, -L / 2 + 0.06), color: 0xffffff, glow: 1 },
    { geo: new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12).rotateX(Math.PI / 2).translate(0.55, 0.62, -L / 2 + 0.06), color: 0xffffff, glow: 1 },
    { geo: box(0.08, 0.18, 0.05, -0.66, 0.66, L / 2 + 0.01), color: 0x8a1010, glow: 2 },
    { geo: box(0.08, 0.18, 0.05, 0.66, 0.66, L / 2 + 0.01), color: 0x8a1010, glow: 2 },
    { geo: box(0.1, 0.06, 0.06, -0.56, 0.48, -L / 2 + 0.05), color: 0xb36a00, glow: 3 },
    { geo: box(0.1, 0.06, 0.06, 0.56, 0.48, L / 2), color: 0xb36a00, glow: 3 },
    // Roof rack.
    { geo: box(0.04, 0.04, 0.95, -0.55, 1.46, 0.42), color: CHROME },
    { geo: box(0.04, 0.04, 0.95, 0.55, 1.46, 0.42), color: CHROME },
    { geo: box(1.14, 0.04, 0.04, 0, 1.46, 0.1), color: CHROME },
    { geo: box(1.14, 0.04, 0.04, 0, 1.46, 0.75), color: CHROME },
    { geo: wheel(0.29, 0.18, -0.66, fz), color: TYRE },
    { geo: wheel(0.29, 0.18, 0.66, fz), color: TYRE },
    { geo: wheel(0.29, 0.18, -0.66, rz), color: TYRE },
    { geo: wheel(0.29, 0.18, 0.66, rz), color: TYRE },
    { geo: wheel(0.15, 0.19, -0.66, fz), color: CHROME },
    { geo: wheel(0.15, 0.19, 0.66, fz), color: CHROME },
    { geo: wheel(0.15, 0.19, -0.66, rz), color: CHROME },
    { geo: wheel(0.15, 0.19, 0.66, rz), color: CHROME },
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

/** Mumbai auto-rickshaw: black body, yellow hood (Bandra and the suburbs; not allowed in the island city). */
function auto(): THREE.BufferGeometry {
  const yellow = 0xe8c11a;
  const black = 0x141414;
  return build([
    { geo: box(1.25, 0.5, 1.9, 0, 0.62, 0.3), color: black },
    { geo: box(0.9, 0.55, 0.7, 0, 0.75, -0.9), color: black },
    { geo: box(1.3, 0.08, 2.2, 0, 1.78, 0.1), color: yellow },
    { geo: box(1.28, 0.95, 0.06, 0, 1.3, 1.2), color: yellow },
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

/** BEST single-decker: red with a cream waistband and big windows. */
function busSingle(): THREE.BufferGeometry {
  const L = 11.0;
  const W = 2.5;
  const red = 0xb3201d;
  return build([
    { geo: box(W, 2.75, L, 0, 1.72, 0), color: red },
    { geo: box(W + 0.02, 0.95, L - 1.4, 0, 2.15, 0.3), color: GLASS },
    { geo: box(W + 0.03, 0.18, L + 0.02, 0, 1.55, 0), color: 0xe9dfc4 },
    { geo: box(W - 0.2, 1.3, 0.05, 0, 2.05, -L / 2 - 0.01), color: GLASS },
    { geo: box(1.5, 0.28, 0.06, 0, 2.95, -L / 2 - 0.02), color: 0xffb02e, glow: 1 },
    { geo: box(0.3, 0.18, 0.06, -0.95, 0.75, -L / 2 - 0.02), color: 0xffffff, glow: 1 },
    { geo: box(0.3, 0.18, 0.06, 0.95, 0.75, -L / 2 - 0.02), color: 0xffffff, glow: 1 },
    { geo: box(0.25, 0.35, 0.06, -1.05, 0.9, L / 2 + 0.02), color: 0x8a1010, glow: 2 },
    { geo: box(0.25, 0.35, 0.06, 1.05, 0.9, L / 2 + 0.02), color: 0x8a1010, glow: 2 },
    { geo: box(0.12, 0.12, 0.07, -1.2, 0.55, -L / 2), color: 0xb36a00, glow: 3 },
    { geo: box(0.12, 0.12, 0.07, 1.2, 0.55, L / 2), color: 0xb36a00, glow: 3 },
    { geo: box(W + 0.02, 0.3, L, 0, 0.38, 0), color: 0x2a2a2a },
    { geo: box(W - 0.4, 0.25, 2.2, 0, 3.17, 1.5), color: 0x8f949a },
    { geo: wheel(0.5, 0.32, -1.05, -3.4), color: TYRE },
    { geo: wheel(0.5, 0.32, 1.05, -3.4), color: TYRE },
    { geo: wheel(0.5, 0.32, -1.05, 3.2), color: TYRE },
    { geo: wheel(0.5, 0.32, 1.05, 3.2), color: TYRE },
  ]);
}

/** Scooter / motorcycle with a rider (the rider's shirt takes the tint colour). */
function bike(): THREE.BufferGeometry {
  const skin = 0x8d5a3b;
  return build([
    { geo: wheel(0.3, 0.09, 0, -0.68), color: TYRE },
    { geo: wheel(0.3, 0.09, 0, 0.66), color: TYRE },
    { geo: box(0.32, 0.42, 1.05, 0, 0.55, 0.12), color: 0x2b2d33 },
    { geo: box(0.3, 0.22, 0.55, 0, 0.82, 0.32), color: 0x161616 },
    { geo: box(0.22, 0.5, 0.18, 0, 0.75, -0.55), color: 0x2b2d33 },
    { geo: box(0.62, 0.04, 0.04, 0, 1.08, -0.52), color: 0x888888 },
    { geo: new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10).rotateX(Math.PI / 2).translate(0, 0.98, -0.66), color: 0xffffff, glow: 1 },
    { geo: box(0.14, 0.06, 0.04, 0, 0.82, 0.62), color: 0x8a1010, glow: 2 },
    // Rider.
    { geo: box(0.36, 0.56, 0.24, 0, 1.25, 0.18), color: 0xffffff, tint: true },
    { geo: box(0.32, 0.18, 0.5, 0, 0.94, 0.12), color: 0x2a3550 },
    { geo: box(0.1, 0.42, 0.1, -0.2, 1.22, -0.08).rotateX(0.9), color: 0xffffff, tint: true },
    { geo: box(0.1, 0.42, 0.1, 0.2, 1.22, -0.08).rotateX(0.9), color: 0xffffff, tint: true },
    { geo: new THREE.SphereGeometry(0.13, 10, 8).translate(0, 1.66, 0.14), color: skin },
    { geo: new THREE.SphereGeometry(0.15, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(0, 1.68, 0.14), color: 0x1d1d22 },
  ]);
}

/** Tata 407-style tempo: painted cab, tarpaulin-covered cargo box. */
function truck(): THREE.BufferGeometry {
  const L = 6.2;
  const W = 2.05;
  return build([
    { geo: box(W, 1.55, 1.7, 0, 1.38, -L / 2 + 0.85), color: 0xffffff, tint: true },
    { geo: box(W - 0.16, 0.6, 0.05, 0, 1.75, -L / 2 - 0.01), color: GLASS },
    { geo: box(W + 0.02, 0.52, 1.5, 0, 1.75, -L / 2 + 0.9), color: GLASS },
    { geo: box(W, 0.3, 1.72, 0, 2.25, -L / 2 + 0.85), color: 0xffffff, tint: true },
    { geo: box(W + 0.05, 1.9, 4.3, 0, 1.75, 0.85), color: 0x2f5d8a },
    { geo: box(W + 0.07, 0.25, 4.32, 0, 2.75, 0.85), color: 0xd8b04a },
    { geo: box(W, 0.2, L - 0.2, 0, 0.62, 0), color: 0x2a2a2a },
    { geo: box(0.3, 0.16, 0.06, -0.75, 0.95, -L / 2 - 0.02), color: 0xffffff, glow: 1 },
    { geo: box(0.3, 0.16, 0.06, 0.75, 0.95, -L / 2 - 0.02), color: 0xffffff, glow: 1 },
    { geo: box(0.25, 0.14, 0.06, -0.85, 0.85, L / 2 - 0.08), color: 0x8a1010, glow: 2 },
    { geo: box(0.25, 0.14, 0.06, 0.85, 0.85, L / 2 - 0.08), color: 0x8a1010, glow: 2 },
    { geo: box(0.1, 0.1, 0.07, -0.95, 0.85, -L / 2), color: 0xb36a00, glow: 3 },
    { geo: box(0.1, 0.1, 0.07, 0.95, 0.85, L / 2 - 0.05), color: 0xb36a00, glow: 3 },
    { geo: wheel(0.42, 0.26, -0.9, -L / 2 + 1.1), color: TYRE },
    { geo: wheel(0.42, 0.26, 0.9, -L / 2 + 1.1), color: TYRE },
    { geo: wheel(0.42, 0.3, -0.9, 1.9), color: TYRE },
    { geo: wheel(0.42, 0.3, 0.9, 1.9), color: TYRE },
  ]);
}

let cache: Record<VehicleKind, THREE.BufferGeometry> | null = null;

export function vehicleGeometries(): Record<VehicleKind, THREE.BufferGeometry> {
  cache ??= { car: sedan(), taxi: taxi(), bus: bus(), bus1: busSingle(), auto: auto(), bike: bike(), truck: truck() };
  return cache;
}

/** Rider shirt colours for bikes. */
export const SHIRT_COLORS = ['#f2f2ee', '#3d6db5', '#c0392b', '#2e8b57', '#f0c419', '#7b3f99', '#e67e22', '#1f2a44', '#c8c8c8'];
/** Painted tempo cabs (Indian trucks are colourful). */
export const TRUCK_COLORS = ['#e8a33c', '#2f7fbf', '#d64532', '#3f9a5a', '#f2c94c', '#9b59b6'];

/** Common Indian car colours: lots of white and silver. */
export const CAR_COLORS = ['#f2f2ee', '#f2f2ee', '#f2f2ee', '#c9ccd1', '#c9ccd1', '#8d9196', '#2b2d31', '#7a1b1b', '#22406e', '#5b5a3c', '#a23a12', '#3c5e7a'];
