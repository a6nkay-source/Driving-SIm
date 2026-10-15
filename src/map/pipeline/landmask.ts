/**
 * Raster land/water/park/sand mask for a district.
 *
 * OSM represents the sea only by `natural=coastline` lines with land on the
 * left. We rasterise those lines as barriers, seed land on their left and water
 * on their right, flood-fill, then force every road corridor to land. The result
 * is blurred slightly so that a 0.5 threshold yields smooth shorelines which the
 * renderer (ground shader), the physics (sea wall) and the shoreline extractor
 * all agree on.
 */
import { simplify, polylineLength } from '../geometry';
import type { EdgeData } from '../types';
import type { Bounds } from './network';

export interface LandMask {
  width: number;
  height: number;
  res: number;
  minX: number;
  minZ: number;
  /** Land (255) ↔ water (0). */
  r: Uint8Array;
  /** Park / grass coverage. */
  g: Uint8Array;
  /** Beach / sand coverage. */
  b: Uint8Array;
}

const UNKNOWN = 0;
const LAND = 1;
const WATER = 2;
const BARRIER = 3;

export interface LandMaskInput {
  bounds: Bounds;
  res: number;
  coastlines: number[][];
  water: number[][];
  parks: number[][];
  sand: number[][];
  roads: EdgeData[];
}

export function fillPolygon(
  ring: number[],
  width: number,
  height: number,
  res: number,
  minX: number,
  minZ: number,
  set: (idx: number) => void,
): void {
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 1; i < ring.length; i += 2) {
    zMin = Math.min(zMin, ring[i]);
    zMax = Math.max(zMax, ring[i]);
  }
  const j0 = Math.max(0, Math.floor((zMin - minZ) / res));
  const j1 = Math.min(height - 1, Math.ceil((zMax - minZ) / res));
  const xs: number[] = [];
  const n = ring.length;
  for (let j = j0; j <= j1; j++) {
    const z = minZ + (j + 0.5) * res;
    xs.length = 0;
    for (let i = 0; i < n; i += 2) {
      const k = (i + 2) % n;
      const z1 = ring[i + 1];
      const z2 = ring[k + 1];
      if ((z1 <= z && z2 > z) || (z2 <= z && z1 > z)) {
        xs.push(ring[i] + ((z - z1) / (z2 - z1)) * (ring[k] - ring[i]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil((xs[q] - minX) / res - 0.5));
      const i1 = Math.min(width - 1, Math.floor((xs[q + 1] - minX) / res - 0.5));
      for (let i = i0; i <= i1; i++) set(j * width + i);
    }
  }
}

function blur(src: Uint8Array, w: number, h: number, passes: number): Uint8Array {
  let a = Float32Array.from(src);
  let b = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const l = a[j * w + Math.max(0, i - 1)];
        const c = a[j * w + i];
        const r = a[j * w + Math.min(w - 1, i + 1)];
        b[j * w + i] = (l + c + r) / 3;
      }
    }
    [a, b] = [b, a];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const u = a[Math.max(0, j - 1) * w + i];
        const c = a[j * w + i];
        const d = a[Math.min(h - 1, j + 1) * w + i];
        b[j * w + i] = (u + c + d) / 3;
      }
    }
    [a, b] = [b, a];
  }
  const out = new Uint8Array(src.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(a[i]);
  return out;
}

export function buildLandMask(input: LandMaskInput): LandMask {
  const { bounds, res } = input;
  const width = Math.ceil((bounds.maxX - bounds.minX) / res);
  const height = Math.ceil((bounds.maxZ - bounds.minZ) / res);
  const minX = bounds.minX;
  const minZ = bounds.minZ;
  const N = width * height;
  const state = new Uint8Array(N);
  const cellOf = (x: number, z: number) => {
    const i = Math.floor((x - minX) / res);
    const j = Math.floor((z - minZ) / res);
    if (i < 0 || j < 0 || i >= width || j >= height) return -1;
    return j * width + i;
  };

  // 1. Barriers along coastlines.
  for (const line of input.coastlines) {
    for (let k = 0; k + 3 < line.length; k += 2) {
      const ax = line[k];
      const az = line[k + 1];
      const bx = line[k + 2];
      const bz = line[k + 3];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / (res * 0.3)));
      for (let s = 0; s <= steps; s++) {
        const c = cellOf(ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps);
        if (c >= 0) state[c] = BARRIER;
      }
    }
  }

  // 2. Seeds on either side (land on the left of the coastline direction).
  const queue = new Int32Array(N);
  let qHead = 0;
  let qTail = 0;
  const seed = (x: number, z: number, label: number) => {
    const c = cellOf(x, z);
    if (c >= 0 && state[c] === UNKNOWN) {
      state[c] = label;
      queue[qTail++] = c;
    }
  };
  for (const line of input.coastlines) {
    for (let k = 0; k + 3 < line.length; k += 2) {
      const ax = line[k];
      const az = line[k + 1];
      const bx = line[k + 2];
      const bz = line[k + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const lx = (bz - az) / len;
      const lz = -(bx - ax) / len;
      const steps = Math.max(1, Math.ceil(len / res));
      const off = res * 1.6;
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        seed(x + lx * off, z + lz * off, LAND);
        seed(x - lx * off, z - lz * off, WATER);
      }
    }
  }

  // 3. Flood fill.
  while (qHead < qTail) {
    const c = queue[qHead++];
    const label = state[c];
    const i = c % width;
    const j = (c - i) / width;
    if (i > 0 && state[c - 1] === UNKNOWN) {
      state[c - 1] = label;
      queue[qTail++] = c - 1;
    }
    if (i < width - 1 && state[c + 1] === UNKNOWN) {
      state[c + 1] = label;
      queue[qTail++] = c + 1;
    }
    if (j > 0 && state[c - width] === UNKNOWN) {
      state[c - width] = label;
      queue[qTail++] = c - width;
    }
    if (j < height - 1 && state[c + width] === UNKNOWN) {
      state[c + width] = label;
      queue[qTail++] = c + width;
    }
  }

  const land = new Uint8Array(N);
  for (let c = 0; c < N; c++) {
    if (state[c] === WATER) land[c] = 0;
    else if (state[c] === BARRIER) {
      const i = c % width;
      const j = (c - i) / width;
      let w = 0;
      let l = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= width || jj >= height) continue;
          const s = state[jj * width + ii];
          if (s === WATER) w++;
          else if (s === LAND) l++;
        }
      }
      land[c] = w > l ? 0 : 255;
    } else land[c] = 255;
  }

  // 4. Inland water bodies.
  for (const ring of input.water) fillPolygon(ring, width, height, res, minX, minZ, (c) => (land[c] = 0));

  // 5. Every ground-level road corridor is land.
  for (const e of input.roads) {
    if (e.h) continue;
    const r = e.w / 2 + 1.5;
    for (let k = 0; k + 3 < e.p.length; k += 2) {
      const ax = e.p[k];
      const az = e.p[k + 1];
      const bx = e.p[k + 2];
      const bz = e.p[k + 3];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - minX) / res));
      const i1 = Math.min(width - 1, Math.floor((Math.max(ax, bx) + r - minX) / res));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r - minZ) / res));
      const j1 = Math.min(height - 1, Math.floor((Math.max(az, bz) + r - minZ) / res));
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = minX + (i + 0.5) * res;
          const z = minZ + (j + 0.5) * res;
          let t = ((x - ax) * dx + (z - az) * dz) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          if (Math.hypot(x - ax - dx * t, z - az - dz * t) <= r) land[j * width + i] = 255;
        }
      }
    }
  }

  const park = new Uint8Array(N);
  for (const ring of input.parks) fillPolygon(ring, width, height, res, minX, minZ, (c) => (park[c] = 255));
  const sand = new Uint8Array(N);
  for (const ring of input.sand) fillPolygon(ring, width, height, res, minX, minZ, (c) => (sand[c] = 255));
  for (let c = 0; c < N; c++) {
    if (!land[c]) {
      park[c] = 0;
      sand[c] = 0;
    }
  }

  return {
    width,
    height,
    res,
    minX,
    minZ,
    r: blur(land, width, height, 2),
    g: blur(park, width, height, 1),
    b: blur(sand, width, height, 1),
  };
}

/** Bilinear sample of a mask channel at world position (0..255). */
export function sampleMask(m: LandMask, ch: Uint8Array, x: number, z: number): number {
  const fx = (x - m.minX) / m.res - 0.5;
  const fz = (z - m.minZ) / m.res - 0.5;
  const i = Math.max(0, Math.min(m.width - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(m.height - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - i));
  const tz = Math.max(0, Math.min(1, fz - j));
  const w = m.width;
  const a = ch[j * w + i];
  const b = ch[j * w + i + 1];
  const c = ch[(j + 1) * w + i];
  const d = ch[(j + 1) * w + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/**
 * Marching squares on the land channel at the 50% iso-level. Returns polylines
 * (flat x,z) oriented with land on the left of the direction of travel.
 */
export function extractShoreline(m: LandMask, minLength = 40, tolerance = 0.8): number[][] {
  const { width: W, height: H, res, minX, minZ } = m;
  const v = m.r;
  const T = 127.5;
  const hEdge = (i: number, j: number) => (j * W + i) * 2;
  const vEdge = (i: number, j: number) => (j * W + i) * 2 + 1;
  const point = (edge: number): [number, number] => {
    const base = edge >> 1;
    const i = base % W;
    const j = (base - i) / W;
    if ((edge & 1) === 0) {
      const a = v[j * W + i];
      const b = v[j * W + i + 1];
      const t = (T - a) / (b - a);
      return [minX + (i + t + 0.5) * res, minZ + (j + 0.5) * res];
    }
    const a = v[j * W + i];
    const b = v[(j + 1) * W + i];
    const t = (T - a) / (b - a);
    return [minX + (i + 0.5) * res, minZ + (j + t + 0.5) * res];
  };

  const segs: number[] = [];
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const v0 = v[j * W + i];
      const v1 = v[j * W + i + 1];
      const v2 = v[(j + 1) * W + i + 1];
      const v3 = v[(j + 1) * W + i];
      const idx = (v0 > T ? 1 : 0) | (v1 > T ? 2 : 0) | (v2 > T ? 4 : 0) | (v3 > T ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const top = hEdge(i, j);
      const bottom = hEdge(i, j + 1);
      const left = vEdge(i, j);
      const right = vEdge(i + 1, j);
      const centerHigh = (v0 + v1 + v2 + v3) / 4 > T;
      switch (idx) {
        case 1:
        case 14:
          segs.push(left, top);
          break;
        case 2:
        case 13:
          segs.push(top, right);
          break;
        case 3:
        case 12:
          segs.push(left, right);
          break;
        case 4:
        case 11:
          segs.push(right, bottom);
          break;
        case 6:
        case 9:
          segs.push(top, bottom);
          break;
        case 7:
        case 8:
          segs.push(left, bottom);
          break;
        case 5:
          if (centerHigh) segs.push(top, right, left, bottom);
          else segs.push(left, top, right, bottom);
          break;
        case 10:
          if (centerHigh) segs.push(left, top, right, bottom);
          else segs.push(top, right, left, bottom);
          break;
      }
    }
  }

  // Stitch segments into chains.
  const byEdge = new Map<number, number[]>();
  const nSeg = segs.length / 2;
  for (let s = 0; s < nSeg; s++) {
    for (const e of [segs[s * 2], segs[s * 2 + 1]]) {
      let l = byEdge.get(e);
      if (!l) byEdge.set(e, (l = []));
      l.push(s);
    }
  }
  const used = new Uint8Array(nSeg);
  const chains: number[][] = [];
  const walk = (startSeg: number, startEdge: number) => {
    const edgesSeq: number[] = [startEdge];
    let seg = startSeg;
    let edge = startEdge;
    while (seg >= 0 && !used[seg]) {
      used[seg] = 1;
      const other = segs[seg * 2] === edge ? segs[seg * 2 + 1] : segs[seg * 2];
      edgesSeq.push(other);
      edge = other;
      seg = -1;
      for (const s of byEdge.get(edge) ?? []) {
        if (!used[s]) {
          seg = s;
          break;
        }
      }
    }
    const pts: number[] = [];
    for (const e of edgesSeq) {
      const [x, z] = point(e);
      pts.push(x, z);
    }
    chains.push(pts);
  };
  // Open chains first (they start at the grid boundary), then closed loops.
  for (const [e, list] of byEdge) {
    if (list.length === 1 && !used[list[0]]) walk(list[0], e);
  }
  for (let s = 0; s < nSeg; s++) if (!used[s]) walk(s, segs[s * 2]);

  const out: number[][] = [];
  for (const raw of chains) {
    if (polylineLength(raw) < minLength) continue;
    let pts = simplify(raw, tolerance);
    // Orient so land is on the left.
    let score = 0;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const dx = pts[k + 2] - pts[k];
      const dz = pts[k + 3] - pts[k + 1];
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const mx = (pts[k] + pts[k + 2]) / 2 + (dz / len) * res * 1.5;
      const mz = (pts[k + 1] + pts[k + 3]) / 2 + (-dx / len) * res * 1.5;
      score += sampleMask(m, m.r, mx, mz) > T ? 1 : -1;
    }
    if (score < 0) {
      const rev: number[] = [];
      for (let k = pts.length - 2; k >= 0; k -= 2) rev.push(pts[k], pts[k + 1]);
      pts = rev;
    }
    out.push(pts.map((n) => Math.round(n * 10) / 10));
  }
  return out;
}
