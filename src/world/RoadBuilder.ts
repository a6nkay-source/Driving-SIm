/**
 * Road meshes per streaming chunk: asphalt ribbons, junction pads, kerbed
 * footpaths, lane markings (Indian convention: white broken centre lines,
 * solid edge lines on arterials), zebra crossings and stop lines, plus
 * flyover decks with parapets, soffits and pillars.
 *
 * Segments are assigned to the chunk containing their midpoint, while miter
 * joints use the whole polyline, so pieces in neighbouring chunks line up.
 */
import * as THREE from 'three';
import type { RoadGraph } from '../map/RoadGraph';
import { Kind, type EdgeData } from '../map/types';

const Y_SIDEWALK = 0.035;
const Y_ROAD = 0.06;
const Y_MARK = 0.075;
const MAX_SEG = 40;

export interface RoadChunkGeometry {
  asphalt: THREE.BufferGeometry | null;
  sidewalk: THREE.BufferGeometry | null;
  markings: THREE.BufferGeometry | null;
  /** Elevated carriageway surface. */
  deckRoad: THREE.BufferGeometry | null;
  /** Parapets and soffits (concrete). */
  deck: THREE.BufferGeometry | null;
  pillars: THREE.Matrix4[];
  /** Pillar collision circles [x, z, r, …]. */
  pillarCircles: number[];
}

class Buf {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  vert(x: number, y: number, z: number, nx = 0, ny = 1, nz = 0, u = 0, v = 0, c?: [number, number, number]): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    if (c) this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }
  build(withColor = false): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Densified polyline (≤ MAX_SEG m per segment) with heights and cumulative distance. */
interface Dense {
  x: number[];
  z: number[];
  h: number[];
  s: number[];
}

function densify(e: EdgeData): Dense {
  const out: Dense = { x: [], z: [], h: [], s: [] };
  let s = 0;
  const n = e.p.length / 2;
  for (let i = 0; i < n; i++) {
    const x = e.p[i * 2];
    const z = e.p[i * 2 + 1];
    const h = e.h ? e.h[i] : 0;
    if (i > 0) {
      const px = e.p[i * 2 - 2];
      const pz = e.p[i * 2 - 1];
      const ph = e.h ? e.h[i - 1] : 0;
      const len = Math.hypot(x - px, z - pz);
      const parts = Math.max(1, Math.ceil(len / (e.h ? 10 : MAX_SEG)));
      for (let k = 1; k < parts; k++) {
        const t = k / parts;
        out.x.push(px + (x - px) * t);
        out.z.push(pz + (z - pz) * t);
        out.h.push(ph + (h - ph) * t);
        out.s.push(s + len * t);
      }
      s += len;
    }
    out.x.push(x);
    out.z.push(z);
    out.h.push(h);
    out.s.push(s);
  }
  return out;
}

/** Left-pointing unit normals (left = (dz, -dx)) with miter at interior points. */
function normals(d: Dense): { nx: number[]; nz: number[]; miter: number[] } {
  const n = d.x.length;
  const nx: number[] = [];
  const nz: number[] = [];
  const miter: number[] = [];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    let ax = d.x[i] - d.x[i0];
    let az = d.z[i] - d.z[i0];
    let bx = d.x[i1] - d.x[i];
    let bz = d.z[i1] - d.z[i];
    const la = Math.hypot(ax, az) || 1;
    const lb = Math.hypot(bx, bz) || 1;
    ax /= la;
    az /= la;
    bx /= lb;
    bz /= lb;
    if (i === 0) {
      ax = bx;
      az = bz;
    }
    if (i === n - 1) {
      bx = ax;
      bz = az;
    }
    let tx = ax + bx;
    let tz = az + bz;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    nx.push(tz);
    nz.push(-tx);
    // Miter length correction, clamped for sharp turns.
    const cos = Math.abs(ax * tx + az * tz);
    miter.push(Math.min(2.2, 1 / Math.max(0.45, cos)));
  }
  return { nx, nz, miter };
}

export interface RoadContext {
  graph: RoadGraph;
  chunkSize: number;
  minX: number;
  minZ: number;
  /** Junction radius per node (max half-width of incident roads). */
  nodeRadius: Float32Array;
  signalNodes: Set<number>;
  crossings: Map<number, number[]>;
}

export function makeRoadContext(graph: RoadGraph, chunkSize: number, minX: number, minZ: number, signalClusters: number[][], crossings: [number, number][]): RoadContext {
  const nodeRadius = new Float32Array(graph.nodeCount);
  graph.edges.forEach((e) => {
    nodeRadius[e.a] = Math.max(nodeRadius[e.a], e.w / 2);
    nodeRadius[e.b] = Math.max(nodeRadius[e.b], e.w / 2);
  });
  const signalNodes = new Set<number>();
  for (const c of signalClusters) for (const n of c) signalNodes.add(n);
  const cr = new Map<number, number[]>();
  for (const [e, s] of crossings) {
    if (!cr.has(e)) cr.set(e, []);
    cr.get(e)!.push(s);
  }
  return { graph, chunkSize, minX, minZ, nodeRadius, signalNodes, crossings: cr };
}

const WHITE: [number, number, number] = [0.86, 0.86, 0.82];
const YELLOW: [number, number, number] = [0.85, 0.62, 0.1];

export function chunkOf(ctx: RoadContext, x: number, z: number): [number, number] {
  return [Math.floor((x - ctx.minX) / ctx.chunkSize), Math.floor((z - ctx.minZ) / ctx.chunkSize)];
}

/** Edges that touch a chunk (by segment midpoints) — computed once per map. */
export function indexEdgesByChunk(ctx: RoadContext): Map<string, number[]> {
  const map = new Map<string, number[]>();
  ctx.graph.edges.forEach((e, ei) => {
    const seen = new Set<string>();
    const d = densify(e);
    for (let i = 0; i + 1 < d.x.length; i++) {
      const [cx, cz] = chunkOf(ctx, (d.x[i] + d.x[i + 1]) / 2, (d.z[i] + d.z[i + 1]) / 2);
      const key = `${cx}_${cz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ei);
    }
    // Junction pads belong to the chunk of their node.
    for (const n of [e.a, e.b]) {
      const [cx, cz] = chunkOf(ctx, ctx.graph.nodeX(n), ctx.graph.nodeZ(n));
      const key = `${cx}_${cz}`;
      if (!seen.has(key)) {
        seen.add(key);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(ei);
      }
    }
  });
  return map;
}

export function buildRoadChunk(ctx: RoadContext, cx: number, cz: number, edgeIds: number[]): RoadChunkGeometry {
  const asphalt = new Buf();
  const side = new Buf();
  const mark = new Buf();
  const deck = new Buf();
  const deckRoad = new Buf();
  const pillars: THREE.Matrix4[] = [];
  const pillarCircles: number[] = [];
  const g = ctx.graph;
  const inChunk = (x: number, z: number) => {
    const [a, b] = chunkOf(ctx, x, z);
    return a === cx && b === cz;
  };
  const padNodes = new Set<number>();

  for (const ei of edgeIds) {
    const e = g.edges[ei];
    const d = densify(e);
    const { nx, nz, miter } = normals(d);
    const n = d.x.length;
    const hw = e.w / 2;
    const elevated = !!e.h;
    const total = d.s[n - 1];
    const sidewalks = !elevated && e.k <= Kind.Residential && e.k !== Kind.Motorway && e.k !== Kind.Link;
    const swW = e.k <= Kind.Secondary ? 3.2 : 2.4;
    const rA = ctx.nodeRadius[e.a];
    const rB = ctx.nodeRadius[e.b];

    for (let i = 0; i + 1 < n; i++) {
      const mx = (d.x[i] + d.x[i + 1]) / 2;
      const mz = (d.z[i] + d.z[i + 1]) / 2;
      if (!inChunk(mx, mz)) continue;
      const yb0 = elevated ? d.h[i] : 0;
      const yb1 = elevated ? d.h[i + 1] : 0;
      const ry0 = yb0 + Y_ROAD;
      const ry1 = yb1 + Y_ROAD;
      const w0 = hw * miter[i];
      const w1 = hw * miter[i + 1];
      // Asphalt: world-space UVs (texture is 8 m square).
      const L0x = d.x[i] + nx[i] * w0;
      const L0z = d.z[i] + nz[i] * w0;
      const R0x = d.x[i] - nx[i] * w0;
      const R0z = d.z[i] - nz[i] * w0;
      const L1x = d.x[i + 1] + nx[i + 1] * w1;
      const L1z = d.z[i + 1] + nz[i + 1] * w1;
      const R1x = d.x[i + 1] - nx[i + 1] * w1;
      const R1z = d.z[i + 1] - nz[i + 1] * w1;
      const tgt = elevated ? deckRoad : asphalt;
      {
        const a = tgt.vert(L0x, ry0, L0z, 0, 1, 0, L0x / 8, L0z / 8);
        const b = tgt.vert(L1x, ry1, L1z, 0, 1, 0, L1x / 8, L1z / 8);
        const c = tgt.vert(R1x, ry1, R1z, 0, 1, 0, R1x / 8, R1z / 8);
        const dd = tgt.vert(R0x, ry0, R0z, 0, 1, 0, R0x / 8, R0z / 8);
        // Left edge a→b, right edge dd→c; wound so the face points up.
        tgt.idx.push(a, dd, b, b, dd, c);
      }
      if (sidewalks) {
        // Footpath on both sides; u along the road (2 m / repeat), v across (0 = kerb).
        for (const sgn of [1, -1]) {
          const iw0 = w0;
          const ow0 = w0 + swW * miter[i];
          const iw1 = w1;
          const ow1 = w1 + swW * miter[i + 1];
          const ix0 = d.x[i] + nx[i] * iw0 * sgn;
          const iz0 = d.z[i] + nz[i] * iw0 * sgn;
          const ox0 = d.x[i] + nx[i] * ow0 * sgn;
          const oz0 = d.z[i] + nz[i] * ow0 * sgn;
          const ix1 = d.x[i + 1] + nx[i + 1] * iw1 * sgn;
          const iz1 = d.z[i + 1] + nz[i + 1] * iw1 * sgn;
          const ox1 = d.x[i + 1] + nx[i + 1] * ow1 * sgn;
          const oz1 = d.z[i + 1] + nz[i + 1] * ow1 * sgn;
          const u0 = d.s[i] / 4;
          const u1 = d.s[i + 1] / 4;
          const a = side.vert(ix0, Y_SIDEWALK, iz0, 0, 1, 0, u0, 0);
          const b = side.vert(ix1, Y_SIDEWALK, iz1, 0, 1, 0, u1, 0);
          const c = side.vert(ox1, Y_SIDEWALK, oz1, 0, 1, 0, u1, 1);
          const dd = side.vert(ox0, Y_SIDEWALK, oz0, 0, 1, 0, u0, 1);
          if (sgn > 0) side.idx.push(a, b, dd, b, c, dd);
          else side.idx.push(a, dd, b, b, dd, c);
        }
      }
      if (elevated) {
        const avgH = (yb0 + yb1) / 2;
        // Parapets (both sides) and soffit underneath.
        const ph = 0.95;
        for (const sgn of [1, -1]) {
          const ox0 = d.x[i] + nx[i] * (w0 + 0.25) * sgn;
          const oz0 = d.z[i] + nz[i] * (w0 + 0.25) * sgn;
          const ox1 = d.x[i + 1] + nx[i + 1] * (w1 + 0.25) * sgn;
          const oz1 = d.z[i + 1] + nz[i + 1] * (w1 + 0.25) * sgn;
          const ix0 = d.x[i] + nx[i] * (w0 - 0.05) * sgn;
          const iz0 = d.z[i] + nz[i] * (w0 - 0.05) * sgn;
          const ix1 = d.x[i + 1] + nx[i + 1] * (w1 - 0.05) * sgn;
          const iz1 = d.z[i + 1] + nz[i + 1] * (w1 - 0.05) * sgn;
          const onx = nx[i] * sgn;
          const onz = nz[i] * sgn;
          const bottom0 = yb0 - (avgH > 1.5 ? 1.1 : 0.15);
          const bottom1 = yb1 - (avgH > 1.5 ? 1.1 : 0.15);
          // Outer face.
          let a = deck.vert(ox0, bottom0, oz0, onx, 0, onz, d.s[i] / 4, 0);
          let b = deck.vert(ox1, bottom1, oz1, onx, 0, onz, d.s[i + 1] / 4, 0);
          let c = deck.vert(ox1, yb1 + ph, oz1, onx, 0, onz, d.s[i + 1] / 4, 0.5);
          let dd = deck.vert(ox0, yb0 + ph, oz0, onx, 0, onz, d.s[i] / 4, 0.5);
          if (sgn > 0) deck.idx.push(a, c, b, a, dd, c);
          else deck.idx.push(a, b, c, a, c, dd);
          // Inner face.
          a = deck.vert(ix0, yb0, iz0, -onx, 0, -onz, d.s[i] / 4, 0);
          b = deck.vert(ix1, yb1, iz1, -onx, 0, -onz, d.s[i + 1] / 4, 0);
          c = deck.vert(ix1, yb1 + ph, iz1, -onx, 0, -onz, d.s[i + 1] / 4, 0.3);
          dd = deck.vert(ix0, yb0 + ph, iz0, -onx, 0, -onz, d.s[i] / 4, 0.3);
          if (sgn > 0) deck.idx.push(a, b, c, a, c, dd);
          else deck.idx.push(a, c, b, a, dd, c);
          // Top cap.
          a = deck.vert(ix0, yb0 + ph, iz0, 0, 1, 0, 0, 0);
          b = deck.vert(ix1, yb1 + ph, iz1, 0, 1, 0, 0, 0);
          c = deck.vert(ox1, yb1 + ph, oz1, 0, 1, 0, 0, 0);
          dd = deck.vert(ox0, yb0 + ph, oz0, 0, 1, 0, 0, 0);
          if (sgn > 0) deck.idx.push(a, b, dd, b, c, dd);
          else deck.idx.push(a, dd, b, b, dd, c);
        }
        if (avgH > 1.5) {
          const sx0 = d.x[i] + nx[i] * (w0 + 0.25);
          const sz0 = d.z[i] + nz[i] * (w0 + 0.25);
          const sx1 = d.x[i + 1] + nx[i + 1] * (w1 + 0.25);
          const sz1 = d.z[i + 1] + nz[i + 1] * (w1 + 0.25);
          const tx0 = d.x[i] - nx[i] * (w0 + 0.25);
          const tz0 = d.z[i] - nz[i] * (w0 + 0.25);
          const tx1 = d.x[i + 1] - nx[i + 1] * (w1 + 0.25);
          const tz1 = d.z[i + 1] - nz[i + 1] * (w1 + 0.25);
          const a = deck.vert(sx0, yb0 - 1.1, sz0, 0, -1, 0);
          const b = deck.vert(sx1, yb1 - 1.1, sz1, 0, -1, 0);
          const c = deck.vert(tx1, yb1 - 1.1, tz1, 0, -1, 0);
          const dd = deck.vert(tx0, yb0 - 1.1, tz0, 0, -1, 0);
          deck.idx.push(a, b, dd, b, c, dd);
        }
        // Pillars every ~24 m where the deck is high enough.
        const segLen = d.s[i + 1] - d.s[i];
        for (let s = Math.ceil(d.s[i] / 24) * 24; s < d.s[i + 1]; s += 24) {
          const t = segLen > 0 ? (s - d.s[i]) / segLen : 0;
          const h = yb0 + (yb1 - yb0) * t;
          if (h < 3.2) continue;
          const px = d.x[i] + (d.x[i + 1] - d.x[i]) * t;
          const pz = d.z[i] + (d.z[i + 1] - d.z[i]) * t;
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(px, (h - 1.1) / 2, pz),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(nx[i], nz[i])),
            new THREE.Vector3(Math.min(hw * 1.4, 7), h - 1.1, 1),
          );
          pillars.push(m);
          pillarCircles.push(px, pz, 1.0);
        }
      }

      // ---- Markings (skip near junctions).
      const s0 = d.s[i];
      const s1 = d.s[i + 1];
      const clearA = rA + 2.5;
      const clearB = total - (rB + 2.5);
      const ms0 = Math.max(s0, clearA);
      const ms1 = Math.min(s1, clearB);
      if (ms1 > ms0 && e.w >= 5.5 && e.k <= Kind.Residential) {
        const segLen = s1 - s0;
        const lerpPt = (s: number, off: number): [number, number, number] => {
          const t = segLen > 0 ? (s - s0) / segLen : 0;
          const x = d.x[i] + (d.x[i + 1] - d.x[i]) * t;
          const z = d.z[i] + (d.z[i + 1] - d.z[i]) * t;
          const y = (elevated ? d.h[i] + (d.h[i + 1] - d.h[i]) * t : 0) + Y_MARK;
          const lnx = nx[i] + (nx[i + 1] - nx[i]) * t;
          const lnz = nz[i] + (nz[i + 1] - nz[i]) * t;
          return [x + lnx * off, y, z + lnz * off];
        };
        const stripe = (from: number, to: number, off: number, width: number, color: [number, number, number]) => {
          const p0a = lerpPt(from, off - width / 2);
          const p0b = lerpPt(from, off + width / 2);
          const p1a = lerpPt(to, off - width / 2);
          const p1b = lerpPt(to, off + width / 2);
          const a = mark.vert(p0b[0], p0b[1], p0b[2], 0, 1, 0, 0, 0, color);
          const b = mark.vert(p1b[0], p1b[1], p1b[2], 0, 1, 0, 0, 0, color);
          const c = mark.vert(p1a[0], p1a[1], p1a[2], 0, 1, 0, 0, 0, color);
          const dd = mark.vert(p0a[0], p0a[1], p0a[2], 0, 1, 0, 0, 0, color);
          mark.idx.push(a, dd, b, b, dd, c);
        };
        const dashed = (off: number, dash: number, gap: number, width: number, color: [number, number, number]) => {
          const period = dash + gap;
          let s = Math.ceil(ms0 / period) * period;
          if (s - period + dash > ms0) stripe(ms0, Math.min(ms1, s - period + dash), off, width, color);
          for (; s < ms1; s += period) stripe(s, Math.min(ms1, s + dash), off, width, color);
        };
        const laneW = e.w / Math.max(1, e.l);
        if (e.o) {
          for (let k = 1; k < e.l; k++) dashed(hw - laneW * k, 3, 5, 0.12, WHITE);
        } else if (e.l >= 2) {
          if (e.k <= Kind.Primary && e.l >= 4) {
            // Double solid centre line on wide two-way arterials.
            stripe(ms0, ms1, 0.12, 0.1, YELLOW);
            stripe(ms0, ms1, -0.12, 0.1, YELLOW);
          } else dashed(0, 3, 4.5, 0.12, WHITE);
          const perSide = Math.floor(e.l / 2);
          for (let k = 1; k < perSide; k++) {
            dashed(laneW * k, 3, 5, 0.1, WHITE);
            dashed(-laneW * k, 3, 5, 0.1, WHITE);
          }
        }
        if (e.k <= Kind.Secondary) {
          stripe(ms0, ms1, hw - 0.3, 0.12, WHITE);
          stripe(ms0, ms1, -hw + 0.3, 0.12, WHITE);
        }
      }
    }

    // Zebra crossings at mapped crossings and stop lines at signalised approaches.
    const zebra = (s: number, full: boolean, leftOnly: boolean) => {
      const p = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
      g.sample(ei, s, p);
      if (!inChunk(p.x, p.z)) return;
      const lx = p.tz;
      const lz = -p.tx;
      const y = p.h + Y_MARK;
      const stripes = Math.max(3, Math.floor(e.w / 0.9));
      for (let k = 0; k < stripes; k++) {
        const off = -hw + (k + 0.5) * (e.w / stripes);
        if (!full && leftOnly && off < 0) continue;
        const cxp = p.x + lx * off;
        const czp = p.z + lz * off;
        const half = (e.w / stripes) * 0.28;
        const len = 1.6;
        const corners: [number, number][] = [
          [cxp + lx * half - p.tx * len, czp + lz * half - p.tz * len],
          [cxp + lx * half + p.tx * len, czp + lz * half + p.tz * len],
          [cxp - lx * half + p.tx * len, czp - lz * half + p.tz * len],
          [cxp - lx * half - p.tx * len, czp - lz * half - p.tz * len],
        ];
        const a = mark.vert(corners[0][0], y, corners[0][1], 0, 1, 0, 0, 0, WHITE);
        const b = mark.vert(corners[1][0], y, corners[1][1], 0, 1, 0, 0, 0, WHITE);
        const c = mark.vert(corners[2][0], y, corners[2][1], 0, 1, 0, 0, 0, WHITE);
        const dd = mark.vert(corners[3][0], y, corners[3][1], 0, 1, 0, 0, 0, WHITE);
        mark.idx.push(a, dd, b, b, dd, c);
      }
    };
    for (const s of ctx.crossings.get(ei) ?? []) zebra(s, true, false);
    if (!elevated && e.k <= Kind.Residential) {
      if (ctx.signalNodes.has(e.b) && total > rB + 8) zebra(total - rB - 3.2, !!e.o, true);
      if (ctx.signalNodes.has(e.a) && total > rA + 8) zebra(rA + 3.2, !!e.o, true);
    }

    // Junction pads.
    for (const node of [e.a, e.b]) {
      if (padNodes.has(node) || g.degree(node) < 2 || elevated) continue;
      const x = g.nodeX(node);
      const z = g.nodeZ(node);
      if (!inChunk(x, z)) continue;
      padNodes.add(node);
      const r = ctx.nodeRadius[node] * 1.08;
      const centre = asphalt.vert(x, Y_ROAD - 0.004, z, 0, 1, 0, x / 8, z / 8);
      const segs = 20;
      const first = asphalt.pos.length / 3;
      for (let k = 0; k < segs; k++) {
        const a = (k / segs) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        asphalt.vert(px, Y_ROAD - 0.004, pz, 0, 1, 0, px / 8, pz / 8);
      }
      for (let k = 0; k < segs; k++) asphalt.idx.push(centre, first + ((k + 1) % segs), first + k);
    }
  }

  return {
    asphalt: asphalt.build(),
    sidewalk: side.build(),
    markings: mark.build(true),
    deckRoad: deckRoad.build(),
    deck: deck.build(),
    pillars,
    pillarCircles,
  };
}
