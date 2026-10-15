/** Small, allocation-light 2D geometry helpers on flat [x, z, x, z, ...] arrays. */

export function polylineLength(p: ArrayLike<number>): number {
  let len = 0;
  for (let i = 2; i < p.length; i += 2) len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return len;
}

/** Signed area; positive when the ring is counter-clockwise in a +X right / +Z up plot. */
export function signedArea(ring: ArrayLike<number>): number {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    a += ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
  }
  return a / 2;
}

export function polygonCentroid(ring: ArrayLike<number>): [number, number] {
  let cx = 0;
  let cz = 0;
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const cross = ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
    a += cross;
    cx += (ring[i] + ring[j]) * cross;
    cz += (ring[i + 1] + ring[j + 1]) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < n; i += 2) {
      sx += ring[i];
      sz += ring[i + 1];
    }
    return [sx / (n / 2), sz / (n / 2)];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function pointInPolygon(x: number, z: number, ring: ArrayLike<number>): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = ring[i];
    const zi = ring[i + 1];
    const xj = ring[j];
    const zj = ring[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export interface Projected {
  /** Closest point. */
  x: number;
  z: number;
  /** Parameter along the segment, 0..1. */
  t: number;
  /** Distance from the query point. */
  d: number;
}

export function projectOnSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  out: Projected = { x: 0, z: 0, t: 0, d: 0 },
): Projected {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = ax + dx * t;
  out.z = az + dz * t;
  out.t = t;
  out.d = Math.hypot(px - out.x, pz - out.z);
  return out;
}

export function segmentsIntersect(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const d1 = cross3(cx, cz, dx, dz, ax, az);
  const d2 = cross3(cx, cz, dx, dz, bx, bz);
  const d3 = cross3(ax, az, bx, bz, cx, cz);
  const d4 = cross3(ax, az, bx, bz, dx, dz);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function cross3(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

/** Douglas–Peucker simplification of an open polyline. */
export function simplify(p: number[], tolerance: number): number[] {
  const n = p.length / 2;
  if (n <= 2) return p.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tmp: Projected = { x: 0, z: 0, t: 0, d: 0 };
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      projectOnSegment(p[i * 2], p[i * 2 + 1], p[s * 2], p[s * 2 + 1], p[e * 2], p[e * 2 + 1], tmp);
      if (tmp.d > maxD) {
        maxD = tmp.d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}

/** Sample a polyline at distance s; writes position and unit tangent. */
export function samplePolyline(
  p: ArrayLike<number>,
  s: number,
  out: { x: number; z: number; tx: number; tz: number; seg: number },
): void {
  let acc = 0;
  const n = p.length;
  for (let i = 2; i < n; i += 2) {
    const dx = p[i] - p[i - 2];
    const dz = p[i + 1] - p[i - 1];
    const len = Math.hypot(dx, dz);
    if (acc + len >= s || i === n - 2) {
      const t = len > 1e-9 ? Math.min(1, Math.max(0, (s - acc) / len)) : 0;
      out.x = p[i - 2] + dx * t;
      out.z = p[i - 1] + dz * t;
      out.tx = len > 1e-9 ? dx / len : 1;
      out.tz = len > 1e-9 ? dz / len : 0;
      out.seg = i / 2 - 1;
      return;
    }
    acc += len;
  }
  out.x = p[0];
  out.z = p[1];
  out.tx = 1;
  out.tz = 0;
  out.seg = 0;
}

/** Deterministic 32-bit hash → [0, 1). */
export function hash01(n: number): number {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash2(a: number, b: number): number {
  return hash01(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663));
}

/** Mulberry32 seeded PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const round1 = (v: number) => Math.round(v * 10) / 10;
export const round2 = (v: number) => Math.round(v * 100) / 100;
