/**
 * A* shortest path over the directed road graph (one-way streets respected).
 * Start and goal are arbitrary points snapped onto road edges.
 */
import type { RoadGraph } from '../map/RoadGraph';
import { Kind } from '../map/types';

export interface RoutePoint {
  edge: number;
  /** Distance from node a. */
  s: number;
}

export interface RouteStep {
  edge: number;
  towardsB: boolean;
  /** Portion of the edge used, as distances from node a. */
  from: number;
  to: number;
}

export interface Route {
  steps: RouteStep[];
  length: number;
  /** Flat [x, z, …] polyline from start to goal. */
  points: number[];
  /** Cumulative distance at each polyline vertex. */
  cum: number[];
  /** Deck height at each vertex (0 at ground level). */
  heights: number[];
}

class Heap {
  private items: number[] = [];
  private prio: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: number, p: number): void {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      [this.prio[parent], this.prio[i]] = [this.prio[i], this.prio[parent]];
      i = parent;
    }
  }
  pop(): number {
    const top = this.items[0];
    const lastI = this.items.pop()!;
    const lastP = this.prio.pop()!;
    if (this.items.length) {
      this.items[0] = lastI;
      this.prio[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.items.length && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        [this.items[m], this.items[i]] = [this.items[i], this.items[m]];
        [this.prio[m], this.prio[i]] = [this.prio[i], this.prio[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Edges a route may use: drivable roads of the main network. */
export function routable(graph: RoadGraph, edge: number): boolean {
  const e = graph.edges[edge];
  return !!graph.main[edge] || e.k <= Kind.Residential;
}

function cost(graph: RoadGraph, edge: number, len: number): number {
  const k = graph.edges[edge].k;
  // Mild preference for arterials, like a real sat-nav.
  return len * (k <= Kind.Primary ? 0.92 : k <= Kind.Tertiary ? 1 : k <= Kind.Residential ? 1.12 : 1.4);
}

export function findRoute(graph: RoadGraph, start: RoutePoint, goal: RoutePoint, preferHeading?: { dx: number; dz: number }): Route | null {
  const sE = graph.edges[start.edge];
  const gE = graph.edges[goal.edge];
  const sLen = graph.lengths[start.edge];
  const gLen = graph.lengths[goal.edge];
  const gx = graph.nodeX(gE.a) * 0.5 + graph.nodeX(gE.b) * 0.5;
  const gz = graph.nodeZ(gE.a) * 0.5 + graph.nodeZ(gE.b) * 0.5;

  // Same edge, reachable directly.
  if (start.edge === goal.edge) {
    if (goal.s >= start.s) return assemble(graph, [{ edge: start.edge, towardsB: true, from: start.s, to: goal.s }]);
    if (!sE.o) return assemble(graph, [{ edge: start.edge, towardsB: false, from: start.s, to: goal.s }]);
  }

  const n = graph.nodeCount;
  const g = new Float64Array(n).fill(Infinity);
  const prevEdge = new Int32Array(n).fill(-1);
  const prevNode = new Int32Array(n).fill(-1);
  const heap = new Heap();
  const h = (node: number) => Math.hypot(graph.nodeX(node) - gx, graph.nodeZ(node) - gz) * 0.9;

  // Heading preference: travelling against the car's facing costs a U-turn.
  let towardsBPenalty = 0;
  let towardsAPenalty = 0;
  if (preferHeading) {
    const p = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
    graph.sample(start.edge, start.s, p);
    const dot = p.tx * preferHeading.dx + p.tz * preferHeading.dz;
    if (dot > 0.3) towardsAPenalty = 120;
    else if (dot < -0.3) towardsBPenalty = 120;
  }
  const seed = (node: number, c: number) => {
    if (c < g[node]) {
      g[node] = c;
      prevEdge[node] = -2; // start marker
      heap.push(node, c + h(node));
    }
  };
  seed(sE.b, cost(graph, start.edge, sLen - start.s) + towardsBPenalty);
  if (!sE.o) seed(sE.a, cost(graph, start.edge, start.s) + towardsAPenalty);

  let best = Infinity;
  let bestEnd = -1;
  const finishCost = (node: number): number => {
    if (node === gE.a) return cost(graph, goal.edge, goal.s);
    if (node === gE.b && !gE.o) return cost(graph, goal.edge, gLen - goal.s);
    return Infinity;
  };
  const visited = new Uint8Array(n);
  let iterations = 0;
  while (heap.size && iterations++ < 200000) {
    const node = heap.pop();
    if (visited[node]) continue;
    visited[node] = 1;
    if (g[node] >= best) break;
    const fc = finishCost(node);
    if (g[node] + fc < best) {
      best = g[node] + fc;
      bestEnd = node;
    }
    for (const l of graph.outgoing(node)) {
      if (!routable(graph, l.edge)) continue;
      const c = g[node] + cost(graph, l.edge, graph.lengths[l.edge]);
      if (c < g[l.to]) {
        g[l.to] = c;
        prevEdge[l.to] = l.edge;
        prevNode[l.to] = node;
        heap.push(l.to, c + h(l.to));
      }
    }
  }
  if (bestEnd < 0) return null;
  // Reconstruct.
  const steps: RouteStep[] = [];
  steps.push(bestEnd === gE.a ? { edge: goal.edge, towardsB: true, from: 0, to: goal.s } : { edge: goal.edge, towardsB: false, from: gLen, to: goal.s });
  let node = bestEnd;
  while (prevEdge[node] >= 0) {
    const e = prevEdge[node];
    const edge = graph.edges[e];
    const towardsB = !(edge.a === node && edge.b === prevNode[node]);
    steps.push({ edge: e, towardsB, from: towardsB ? 0 : graph.lengths[e], to: towardsB ? graph.lengths[e] : 0 });
    node = prevNode[node];
  }
  // First (partial) step from the start point to `node`.
  steps.push(node === sE.b ? { edge: start.edge, towardsB: true, from: start.s, to: sLen } : { edge: start.edge, towardsB: false, from: start.s, to: 0 });
  steps.reverse();
  return assemble(graph, steps);
}

function assemble(graph: RoadGraph, steps: RouteStep[]): Route {
  const points: number[] = [];
  const cum: number[] = [];
  const heights: number[] = [];
  const p = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
  let total = 0;
  const push = (x: number, z: number, h: number) => {
    const n = points.length;
    if (n >= 2) {
      const d = Math.hypot(x - points[n - 2], z - points[n - 1]);
      if (d < 0.5) return;
      total += d;
    }
    points.push(x, z);
    cum.push(total);
    heights.push(h);
  };
  for (const st of steps) {
    const e = graph.edges[st.edge];
    const c = graph.cum[st.edge];
    graph.sample(st.edge, st.from, p);
    push(p.x, p.z, p.h);
    // Interior vertices between from and to, in travel order.
    const lo = Math.min(st.from, st.to);
    const hi = Math.max(st.from, st.to);
    const idx: number[] = [];
    for (let i = 0; i < c.length; i++) if (c[i] > lo && c[i] < hi) idx.push(i);
    if (!st.towardsB) idx.reverse();
    for (const i of idx) push(e.p[i * 2], e.p[i * 2 + 1], e.h ? e.h[i] : 0);
    graph.sample(st.edge, st.to, p);
    push(p.x, p.z, p.h);
  }
  return { steps, length: total, points, cum, heights };
}
