/**
 * Converts OSM highway ways into a compact road graph:
 *  - drivable ways are clipped to the district bounds,
 *  - split into edges at every junction,
 *  - one-way roads are normalised to run a → b,
 *  - lanes / carriageway widths are derived from tags with sensible defaults,
 *  - bridges ("flyovers") get a smooth per-point elevation profile.
 */
import { polylineLength, projectOnSegment, round1, round2 } from '../geometry';
import type { Projection } from '../projection';
import { SpatialGrid } from '../SpatialGrid';
import { Kind, type EdgeData } from '../types';
import { isBridge, isDrivable, parseNumber, type OsmNode, type OsmWay, type Tags } from './osm';

export interface Bounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface BuiltNetwork {
  nodes: number[];
  edges: EdgeData[];
  names: { en: string; mr?: string }[];
  signals: number[][];
  crossings: [number, number][];
  busStops: [number, number, number][];
  /** Grid over edge segments: id = edgeIndex * 4096 + segmentIndex. */
  grid: SpatialGrid;
  stats: { roadKm: number; edges: number; nodes: number; bridges: number; elevatedKm: number };
}

export const SEG_STRIDE = 4096;

export function kindOf(highway: string): number {
  switch (highway) {
    case 'motorway':
      return Kind.Motorway;
    case 'trunk':
      return Kind.Trunk;
    case 'primary':
      return Kind.Primary;
    case 'secondary':
      return Kind.Secondary;
    case 'tertiary':
      return Kind.Tertiary;
    case 'residential':
      return Kind.Residential;
    case 'living_street':
      return Kind.LivingStreet;
    case 'service':
      return Kind.Service;
    case 'unclassified':
    case 'road':
      return Kind.Unclassified;
    default:
      return highway.endsWith('_link') ? Kind.Link : Kind.Unclassified;
  }
}

/** Default total lane count when the `lanes` tag is missing. */
export function defaultLanes(kind: number, oneway: boolean): number {
  if (oneway) {
    if (kind <= Kind.Primary) return 3;
    if (kind <= Kind.Tertiary) return 2;
    return 1;
  }
  if (kind <= Kind.Primary) return 4;
  if (kind <= Kind.Residential) return 2;
  return 1;
}

export function laneWidth(kind: number): number {
  if (kind <= Kind.Primary) return 3.4;
  if (kind <= Kind.Tertiary) return 3.25;
  return 3.0;
}

export function roadWidth(kind: number, lanes: number, oneway: boolean): number {
  let w = lanes * laneWidth(kind);
  if (!oneway && lanes === 1) w = kind === Kind.Service ? 4.2 : 4.8;
  return Math.min(22, Math.max(oneway ? 3.4 : 4.2, w));
}

export function isOneway(tags: Tags): 0 | 1 | -1 {
  const o = tags.oneway;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'yes' || o === 'true' || o === '1') return 1;
  if (o === 'no') return 0;
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return 1;
  if (tags.highway === 'motorway' || tags.highway === 'motorway_link') return 1;
  return 0;
}

interface Run {
  wayId: number;
  ids: number[];
  pts: number[];
  tags: Tags;
  bridge: boolean;
  layer: number;
}

/** Liang–Barsky clip of a segment to a box; returns [t0, t1] or null. */
function clipSegment(x0: number, z0: number, x1: number, z1: number, b: Bounds): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const p = [-dx, dx, -dz, dz];
  const q = [x0 - b.minX, b.maxX - x0, z0 - b.minZ, b.maxZ - z0];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [t0, t1];
}

export function clipPolyline(
  ids: number[],
  pts: number[],
  b: Bounds,
  synthetic: () => number,
): { ids: number[]; pts: number[] }[] {
  const runs: { ids: number[]; pts: number[] }[] = [];
  let cur: { ids: number[]; pts: number[] } | null = null;
  for (let i = 0; i + 1 < ids.length; i++) {
    const x0 = pts[i * 2];
    const z0 = pts[i * 2 + 1];
    const x1 = pts[i * 2 + 2];
    const z1 = pts[i * 2 + 3];
    const c = clipSegment(x0, z0, x1, z1, b);
    if (!c) {
      if (cur) runs.push(cur);
      cur = null;
      continue;
    }
    const [t0, t1] = c;
    if (!cur) {
      cur = { ids: [], pts: [] };
      if (t0 > 1e-9) cur.ids.push(synthetic());
      else cur.ids.push(ids[i]);
      cur.pts.push(x0 + (x1 - x0) * t0, z0 + (z1 - z0) * t0);
    }
    if (t1 < 1 - 1e-9) {
      cur.ids.push(synthetic());
      cur.pts.push(x0 + (x1 - x0) * t1, z0 + (z1 - z0) * t1);
      runs.push(cur);
      cur = null;
    } else {
      cur.ids.push(ids[i + 1]);
      cur.pts.push(x1, z1);
    }
  }
  if (cur) runs.push(cur);
  return runs.filter((r) => r.ids.length >= 2);
}

const smoothstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * Elevation for every node that sits on a bridge way. Height ramps up with
 * distance (through the bridge chain) from the nearest place the chain meets
 * ground-level road, so flyovers rise and fall smoothly even when OSM splits
 * them into several ways.
 */
export function computeElevations(runs: Run[]): Map<number, number> {
  const ground = new Set<number>();
  const endpointUse = new Map<number, number>();
  const use = new Map<number, number>();
  for (const r of runs) {
    for (const id of r.ids) use.set(id, (use.get(id) ?? 0) + 1);
    for (const id of [r.ids[0], r.ids[r.ids.length - 1]]) endpointUse.set(id, (endpointUse.get(id) ?? 0) + 1);
    if (!r.bridge) for (const id of r.ids) ground.add(id);
  }
  const adj = new Map<number, { to: number; d: number }[]>();
  const layerOf = new Map<number, number>();
  const link = (a: number, b: number, d: number) => {
    let l = adj.get(a);
    if (!l) adj.set(a, (l = []));
    l.push({ to: b, d });
  };
  for (const r of runs) {
    if (!r.bridge) continue;
    for (let i = 0; i < r.ids.length; i++) {
      layerOf.set(r.ids[i], Math.max(layerOf.get(r.ids[i]) ?? 0, r.layer));
      if (i > 0) {
        const d = Math.hypot(r.pts[i * 2] - r.pts[i * 2 - 2], r.pts[i * 2 + 1] - r.pts[i * 2 - 1]);
        link(r.ids[i - 1], r.ids[i], d);
        link(r.ids[i], r.ids[i - 1], d);
      }
    }
  }
  const heights = new Map<number, number>();
  const seen = new Set<number>();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    // Gather the connected bridge component.
    const comp: number[] = [];
    const stack = [start];
    seen.add(start);
    let length = 0;
    let layer = 1;
    while (stack.length) {
      const id = stack.pop()!;
      comp.push(id);
      layer = Math.max(layer, layerOf.get(id) ?? 1);
      for (const e of adj.get(id) ?? []) {
        length += e.d / 2;
        if (!seen.has(e.to)) {
          seen.add(e.to);
          stack.push(e.to);
        }
      }
    }
    const sources = comp.filter(
      (id) => ground.has(id) || (id > 0 && (use.get(id) ?? 0) === 1 && (endpointUse.get(id) ?? 0) === 1),
    );
    if (length < 80 || sources.length === 0) {
      for (const id of comp) heights.set(id, 0);
      continue;
    }
    // Multi-source Dijkstra (components are small, a linear scan queue is fine).
    const dist = new Map<number, number>();
    for (const id of comp) dist.set(id, Infinity);
    for (const s of sources) dist.set(s, 0);
    const open = new Set(comp);
    while (open.size) {
      let best = -1;
      let bestD = Infinity;
      for (const id of open) {
        const d = dist.get(id)!;
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      if (best === -1) break;
      open.delete(best);
      for (const e of adj.get(best) ?? []) {
        const nd = bestD + e.d;
        if (nd < dist.get(e.to)!) dist.set(e.to, nd);
      }
    }
    let maxDist = 0;
    for (const id of comp) {
      const d = dist.get(id)!;
      if (Number.isFinite(d)) maxDist = Math.max(maxDist, d);
    }
    const H = Math.min(2, Math.max(1, layer)) * 6.5;
    const ramp = Math.max(20, Math.min(95, maxDist));
    for (const id of comp) {
      const d = dist.get(id)!;
      heights.set(id, Number.isFinite(d) ? H * smoothstep(d / ramp) : H);
    }
  }
  return heights;
}

export function buildNetwork(
  ways: OsmWay[],
  points: OsmNode[],
  proj: Projection,
  bounds: Bounds,
): BuiltNetwork {
  let syntheticId = -1;
  const synthetic = () => syntheticId--;
  const runs: Run[] = [];
  for (const w of ways) {
    if (!isDrivable(w.tags)) continue;
    const tags = w.tags!;
    const pts: number[] = [];
    for (const g of w.geometry) {
      const [x, z] = proj.toLocal(g.lat, g.lon);
      pts.push(x, z);
    }
    let ids = w.nodes.slice();
    let flat = pts;
    if (isOneway(tags) === -1) {
      ids = ids.reverse();
      const rev: number[] = [];
      for (let i = flat.length - 2; i >= 0; i -= 2) rev.push(flat[i], flat[i + 1]);
      flat = rev;
    }
    const bridge = isBridge(tags);
    const layer = parseNumber(tags.layer) ?? (bridge ? 1 : 0);
    for (const r of clipPolyline(ids, flat, bounds, synthetic)) {
      runs.push({ wayId: w.id, ids: r.ids, pts: r.pts, tags, bridge, layer });
    }
  }

  const elevation = computeElevations(runs);

  // Junction detection.
  const use = new Map<number, number>();
  for (const r of runs) {
    r.ids.forEach((id, i) => {
      const extra = i === 0 || i === r.ids.length - 1 ? 2 : 1;
      use.set(id, (use.get(id) ?? 0) + extra);
    });
  }
  const nodeIndex = new Map<number, number>();
  const nodes: number[] = [];
  const nodeOf = (id: number, x: number, z: number) => {
    let i = nodeIndex.get(id);
    if (i === undefined) {
      i = nodes.length / 2;
      nodeIndex.set(id, i);
      nodes.push(round1(x), round1(z));
    }
    return i;
  };

  const names: { en: string; mr?: string }[] = [];
  const nameIndex = new Map<string, number>();
  const nameOf = (tags: Tags): number | undefined => {
    const en = tags.name ?? tags['name:en'] ?? tags.ref;
    if (!en) return undefined;
    const key = `${en}|${tags['name:mr'] ?? ''}`;
    let i = nameIndex.get(key);
    if (i === undefined) {
      i = names.length;
      names.push(tags['name:mr'] ? { en, mr: tags['name:mr'] } : { en });
      nameIndex.set(key, i);
    }
    return i;
  };

  const crossingIds = new Set<number>();
  const signalPoints: { id: number; x: number; z: number }[] = [];
  const busStopPoints: [number, number][] = [];
  for (const n of points) {
    const hw = n.tags?.highway;
    if (hw === 'crossing') crossingIds.add(n.id);
    else if (hw === 'traffic_signals') {
      const [x, z] = proj.toLocal(n.lat, n.lon);
      signalPoints.push({ id: n.id, x, z });
    } else if (hw === 'bus_stop') {
      const [x, z] = proj.toLocal(n.lat, n.lon);
      if (x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ) busStopPoints.push([x, z]);
    }
  }
  const signalIdSet = new Set(signalPoints.map((s) => s.id));

  const edges: EdgeData[] = [];
  const crossings: [number, number][] = [];
  const midBlockSignals: { edge: number; s: number }[] = [];
  let bridges = 0;
  let elevatedKm = 0;

  const emit = (r: Run, from: number, to: number) => {
    const ids = r.ids.slice(from, to + 1);
    const p = r.pts.slice(from * 2, to * 2 + 2);
    // Drop duplicate consecutive points.
    const cleanIds: number[] = [ids[0]];
    const cleanP: number[] = [p[0], p[1]];
    for (let i = 1; i < ids.length; i++) {
      const lx = cleanP[cleanP.length - 2];
      const lz = cleanP[cleanP.length - 1];
      if (Math.hypot(p[i * 2] - lx, p[i * 2 + 1] - lz) < 0.05 && i < ids.length - 1) continue;
      cleanIds.push(ids[i]);
      cleanP.push(p[i * 2], p[i * 2 + 1]);
    }
    if (cleanIds.length < 2 || polylineLength(cleanP) < 0.5) return;
    const tags = r.tags;
    const kind = kindOf(tags.highway);
    const oneway = isOneway(tags) !== 0;
    const lanes = Math.max(1, Math.min(8, Math.round(parseNumber(tags.lanes) ?? defaultLanes(kind, oneway))));
    const a = nodeOf(cleanIds[0], cleanP[0], cleanP[1]);
    const b = nodeOf(cleanIds[cleanIds.length - 1], cleanP[cleanP.length - 2], cleanP[cleanP.length - 1]);
    const edge: EdgeData = {
      a,
      b,
      p: cleanP.map(round1),
      k: kind,
      w: round1(roadWidth(kind, lanes, oneway)),
      l: lanes,
      o: oneway ? 1 : 0,
    };
    const n = nameOf(tags);
    if (n !== undefined) edge.n = n;
    if (r.bridge) {
      const hs = cleanIds.map((id) => elevation.get(id) ?? 0);
      // Synthetic clip points inherit their neighbour's height.
      for (let i = 0; i < hs.length; i++) {
        if (cleanIds[i] < 0) hs[i] = hs[i === 0 ? 1 : i - 1] ?? 0;
      }
      if (hs.some((h) => h > 0.05)) {
        edge.h = hs.map(round2);
        bridges++;
        elevatedKm += polylineLength(cleanP) / 1000;
      }
    }
    const index = edges.length;
    edges.push(edge);
    // Zebra crossings and mid-block pedestrian signals on interior points.
    let s = 0;
    for (let i = 1; i < cleanIds.length - 1; i++) {
      s += Math.hypot(cleanP[i * 2] - cleanP[i * 2 - 2], cleanP[i * 2 + 1] - cleanP[i * 2 - 1]);
      if (crossingIds.has(cleanIds[i])) crossings.push([index, round1(s)]);
      else if (signalIdSet.has(cleanIds[i])) midBlockSignals.push({ edge: index, s });
    }
  };

  for (const r of runs) {
    let start = 0;
    for (let i = 1; i < r.ids.length; i++) {
      const isJunction = (use.get(r.ids[i]) ?? 0) >= 2;
      if (!isJunction && i < r.ids.length - 1) continue;
      if (r.ids[start] === r.ids[i]) {
        // Closed loop between the same junction: split at the middle point.
        const mid = Math.floor((start + i) / 2);
        if (mid > start && mid < i) {
          use.set(r.ids[mid], 2);
          emit(r, start, mid);
          emit(r, mid, i);
        }
      } else {
        emit(r, start, i);
      }
      start = i;
    }
  }

  // Edge segment grid for spatial queries.
  const grid = new SpatialGrid(40, edges.length * 8);
  let roadKm = 0;
  edges.forEach((e, ei) => {
    roadKm += polylineLength(e.p) / 1000;
    for (let i = 0; i + 3 < e.p.length; i += 2) {
      const pad = e.w / 2;
      grid.insert(
        ei * SEG_STRIDE + i / 2,
        Math.min(e.p[i], e.p[i + 2]) - pad,
        Math.min(e.p[i + 1], e.p[i + 3]) - pad,
        Math.max(e.p[i], e.p[i + 2]) + pad,
        Math.max(e.p[i + 1], e.p[i + 3]) + pad,
      );
    }
  });

  // Node degrees for junction detection.
  const degree = new Array(nodes.length / 2).fill(0);
  for (const e of edges) {
    degree[e.a]++;
    degree[e.b]++;
  }

  // Signals: snap each OSM signal to the nearest junction within 35 m, then
  // cluster nearby signalised junctions (dual carriageways form several nodes).
  const signalised = new Set<number>();
  for (const sp of signalPoints) {
    let best = -1;
    let bestD = 35;
    for (let i = 0; i < degree.length; i++) {
      if (degree[i] < 3) continue;
      const d = Math.hypot(nodes[i * 2] - sp.x, nodes[i * 2 + 1] - sp.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) signalised.add(best);
  }
  const list = [...signalised];
  const parent = new Map<number, number>(list.map((i) => [i, i]));
  const find = (i: number): number => {
    while (parent.get(i)! !== i) {
      parent.set(i, parent.get(parent.get(i)!)!);
      i = parent.get(i)!;
    }
    return i;
  };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (Math.hypot(nodes[a * 2] - nodes[b * 2], nodes[a * 2 + 1] - nodes[b * 2 + 1]) < 45) {
        parent.set(find(a), find(b));
      }
    }
  }
  const clusters = new Map<number, number[]>();
  for (const i of list) {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r)!.push(i);
  }
  const signals = [...clusters.values()];

  // Mid-block signals far from any junction become zebra crossings.
  for (const m of midBlockSignals) crossings.push([m.edge, round1(m.s)]);

  // Bus stops: snap to the nearest major road and face it.
  const busStops: [number, number, number][] = [];
  const tmp = { x: 0, z: 0, t: 0, d: 0 };
  for (const [x, z] of busStopPoints) {
    let best: { e: EdgeData; px: number; pz: number; d: number } | null = null;
    grid.queryRadius(x, z, 30, (id) => {
      const ei = Math.floor(id / SEG_STRIDE);
      const si = id % SEG_STRIDE;
      const e = edges[ei];
      if (e.k > Kind.Residential || e.h) return;
      projectOnSegment(x, z, e.p[si * 2], e.p[si * 2 + 1], e.p[si * 2 + 2], e.p[si * 2 + 3], tmp);
      if (!best || tmp.d < best.d) best = { e, px: tmp.x, pz: tmp.z, d: tmp.d };
    });
    if (!best) continue;
    const b = best as { e: EdgeData; px: number; pz: number; d: number };
    let dx = x - b.px;
    let dz = z - b.pz;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const off = b.e.w / 2 + 2.2;
    const sx = b.px + dx * off;
    const sz = b.pz + dz * off;
    // Shelter faces the road: local -Z points back towards the carriageway.
    busStops.push([round1(sx), round1(sz), round2(Math.atan2(dx, dz))]);
  }

  return {
    nodes,
    edges,
    names,
    signals,
    crossings,
    busStops,
    grid,
    stats: {
      roadKm: Math.round(roadKm * 10) / 10,
      edges: edges.length,
      nodes: nodes.length / 2,
      bridges,
      elevatedKm: Math.round(elevatedKm * 100) / 100,
    },
  };
}
