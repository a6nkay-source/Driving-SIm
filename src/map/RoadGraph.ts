import { projectOnSegment } from './geometry';
import { SpatialGrid } from './SpatialGrid';
import { Kind, type EdgeData, type NetworkData } from './types';

export const SEG = 4096;

export interface NearestRoad {
  edge: number;
  seg: number;
  /** Distance along the edge from node a. */
  s: number;
  x: number;
  z: number;
  /** Unit tangent a → b at the projection. */
  tx: number;
  tz: number;
  /** Distance from the query point to the centreline. */
  d: number;
  /** Deck height at the projection (0 at ground level). */
  h: number;
}

export interface EdgeSample {
  x: number;
  z: number;
  tx: number;
  tz: number;
  h: number;
}

export interface Link {
  edge: number;
  /** True when travelling a → b. */
  forward: boolean;
  to: number;
}

/** Runtime road graph with spatial queries, used by traffic, navigation, minimap and spawning. */
export class RoadGraph {
  readonly nodes: Float32Array;
  readonly edges: EdgeData[];
  readonly lengths: Float32Array;
  readonly cum: Float64Array[];
  readonly incident: number[][];
  readonly grid: SpatialGrid;
  readonly main: Uint8Array;
  readonly names: { en: string; mr?: string }[];
  readonly nodeCount: number;

  constructor(net: NetworkData) {
    this.nodes = Float32Array.from(net.nodes);
    this.nodeCount = net.nodes.length / 2;
    this.edges = net.edges;
    this.names = net.names;
    this.lengths = new Float32Array(net.edges.length);
    this.cum = [];
    this.incident = Array.from({ length: this.nodeCount }, () => []);
    this.grid = new SpatialGrid(32, net.edges.length * 6);
    net.edges.forEach((e, ei) => {
      const c = new Float64Array(e.p.length / 2);
      for (let i = 1; i < c.length; i++) {
        c[i] = c[i - 1] + Math.hypot(e.p[i * 2] - e.p[i * 2 - 2], e.p[i * 2 + 1] - e.p[i * 2 - 1]);
      }
      this.cum.push(c);
      this.lengths[ei] = c[c.length - 1];
      this.incident[e.a].push(ei);
      if (e.b !== e.a) this.incident[e.b].push(ei);
      const pad = e.w / 2 + 1;
      for (let i = 0; i + 3 < e.p.length; i += 2) {
        this.grid.insert(
          ei * SEG + i / 2,
          Math.min(e.p[i], e.p[i + 2]) - pad,
          Math.min(e.p[i + 1], e.p[i + 3]) - pad,
          Math.max(e.p[i], e.p[i + 2]) + pad,
          Math.max(e.p[i + 1], e.p[i + 3]) + pad,
        );
      }
    });
    this.main = this.computeMainComponent();
  }

  /**
   * Edges of the largest strongly connected component of the drivable network
   * (one-way streets respected): any main edge can be reached from any other.
   * One-way stubs clipped at the district edge, private compounds and the like
   * are excluded so routing and traffic never get trapped.
   */
  private computeMainComponent(): Uint8Array {
    const n = this.nodeCount;
    const fwd: number[][] = Array.from({ length: n }, () => []);
    const rev: number[][] = Array.from({ length: n }, () => []);
    const drivable = (k: number) => k <= Kind.Residential || k === Kind.Link;
    for (const e of this.edges) {
      if (!drivable(e.k)) continue;
      fwd[e.a].push(e.b);
      rev[e.b].push(e.a);
      if (!e.o) {
        fwd[e.b].push(e.a);
        rev[e.a].push(e.b);
      }
    }
    // Kosaraju, iterative: finish order on the forward graph…
    const order: number[] = [];
    const seen = new Uint8Array(n);
    for (let s0 = 0; s0 < n; s0++) {
      if (seen[s0]) continue;
      const stack: [number, number][] = [[s0, 0]];
      seen[s0] = 1;
      while (stack.length) {
        const top = stack[stack.length - 1];
        const [v, i] = top;
        if (i < fwd[v].length) {
          top[1]++;
          const w = fwd[v][i];
          if (!seen[w]) {
            seen[w] = 1;
            stack.push([w, 0]);
          }
        } else {
          order.push(v);
          stack.pop();
        }
      }
    }
    // …then components on the reverse graph in reverse finish order.
    const comp = new Int32Array(n).fill(-1);
    const sizes: number[] = [];
    for (let k = order.length - 1; k >= 0; k--) {
      const root = order[k];
      if (comp[root] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      const stack = [root];
      comp[root] = id;
      while (stack.length) {
        const v = stack.pop()!;
        size++;
        for (const w of rev[v]) {
          if (comp[w] < 0) {
            comp[w] = id;
            stack.push(w);
          }
        }
      }
      sizes.push(size);
    }
    let best = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
    const main = new Uint8Array(this.edges.length);
    this.edges.forEach((e, ei) => {
      if (drivable(e.k) && comp[e.a] === best && comp[e.b] === best) main[ei] = 1;
    });
    return main;
  }

  nodeX(n: number): number {
    return this.nodes[n * 2];
  }

  nodeZ(n: number): number {
    return this.nodes[n * 2 + 1];
  }

  name(edge: number): string | undefined {
    const n = this.edges[edge].n;
    return n === undefined ? undefined : this.names[n].en;
  }

  nameMr(edge: number): string | undefined {
    const n = this.edges[edge].n;
    return n === undefined ? undefined : this.names[n].mr;
  }

  degree(node: number): number {
    return this.incident[node].length;
  }

  otherEnd(edge: number, node: number): number {
    const e = this.edges[edge];
    return e.a === node ? e.b : e.a;
  }

  /** Edges a vehicle may take when leaving `node`. */
  outgoing(node: number, out: Link[] = []): Link[] {
    out.length = 0;
    for (const ei of this.incident[node]) {
      const e = this.edges[ei];
      if (e.a === node) out.push({ edge: ei, forward: true, to: e.b });
      if (e.b === node && !e.o) out.push({ edge: ei, forward: false, to: e.a });
    }
    return out;
  }

  /** Position/tangent at distance s from node a (tangent always points a → b). */
  sample(edge: number, s: number, out: EdgeSample): EdgeSample {
    const e = this.edges[edge];
    const c = this.cum[edge];
    const n = c.length;
    const len = c[n - 1];
    const d = s < 0 ? 0 : s > len ? len : s;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= d) lo = mid;
      else hi = mid;
    }
    const segLen = c[hi] - c[lo];
    const t = segLen > 1e-9 ? (d - c[lo]) / segLen : 0;
    const ax = e.p[lo * 2];
    const az = e.p[lo * 2 + 1];
    const bx = e.p[hi * 2];
    const bz = e.p[hi * 2 + 1];
    out.x = ax + (bx - ax) * t;
    out.z = az + (bz - az) * t;
    if (segLen > 1e-9) {
      out.tx = (bx - ax) / segLen;
      out.tz = (bz - az) / segLen;
    } else {
      out.tx = 1;
      out.tz = 0;
    }
    out.h = e.h ? e.h[lo] + (e.h[hi] - e.h[lo]) * t : 0;
    return out;
  }

  /** Nearest road centreline within maxDist, optionally filtered. */
  nearest(
    x: number,
    z: number,
    maxDist: number,
    filter?: (e: EdgeData, index: number) => boolean,
    refY?: number,
  ): NearestRoad | null {
    let best: NearestRoad | null = null;
    const tmp = { x: 0, z: 0, t: 0, d: 0 };
    this.grid.queryRadius(x, z, maxDist, (id) => {
      const ei = Math.floor(id / SEG);
      const si = id % SEG;
      const e = this.edges[ei];
      if (filter && !filter(e, ei)) return;
      projectOnSegment(x, z, e.p[si * 2], e.p[si * 2 + 1], e.p[si * 2 + 2], e.p[si * 2 + 3], tmp);
      let d = tmp.d;
      const h = e.h ? e.h[si] + (e.h[si + 1] - e.h[si]) * tmp.t : 0;
      // Prefer the deck/ground level the caller is on.
      if (refY !== undefined) d += Math.abs(h - refY) * 3;
      if (d > maxDist || (best && d >= best.d)) return;
      const c = this.cum[ei];
      const segLen = c[si + 1] - c[si];
      best = {
        edge: ei,
        seg: si,
        s: c[si] + segLen * tmp.t,
        x: tmp.x,
        z: tmp.z,
        tx: segLen > 1e-9 ? (e.p[si * 2 + 2] - e.p[si * 2]) / segLen : 1,
        tz: segLen > 1e-9 ? (e.p[si * 2 + 3] - e.p[si * 2 + 1]) / segLen : 0,
        d,
        h,
      };
    });
    return best;
  }
}
