import { describe, expect, it } from 'vitest';
import { coastX, generateSyntheticOsm } from '../src/map/fallback';
import { signedArea } from '../src/map/geometry';
import { buildDistrict } from '../src/map/pipeline/index';
import { sampleMask } from '../src/map/pipeline/landmask';
import { clipPolyline, computeElevations } from '../src/map/pipeline/network';
import { createProjection } from '../src/map/projection';
import { RoadGraph } from '../src/map/RoadGraph';
import { Kind } from '../src/map/types';

const { osm, config } = generateSyntheticOsm();
const build = buildDistrict(osm, config, { maskRes: 4 });

describe('projection', () => {
  it('round-trips lat/lon and uses +X east, +Z south', () => {
    const p = createProjection(18.93, 72.82);
    const [x, z] = p.toLocal(18.94, 72.83);
    expect(x).toBeGreaterThan(1000);
    expect(z).toBeLessThan(-1000);
    const [lat, lon] = p.toLatLon(x, z);
    expect(lat).toBeCloseTo(18.94, 9);
    expect(lon).toBeCloseTo(72.83, 9);
  });
});

describe('road network import', () => {
  it('produces a connected graph with valid indices', () => {
    const n = build.network;
    expect(n.edges.length).toBeGreaterThan(200);
    const nodeCount = n.nodes.length / 2;
    for (const e of n.edges) {
      expect(e.a).toBeLessThan(nodeCount);
      expect(e.b).toBeLessThan(nodeCount);
      expect(e.p.length).toBeGreaterThanOrEqual(4);
      expect(e.w).toBeGreaterThan(3);
      // Edge endpoints coincide with their graph nodes.
      expect(Math.hypot(e.p[0] - n.nodes[e.a * 2], e.p[1] - n.nodes[e.a * 2 + 1])).toBeLessThan(0.2);
    }
    const graph = new RoadGraph(n);
    const mainEdges = graph.main.reduce((a, b) => a + b, 0);
    expect(mainEdges / n.edges.length).toBeGreaterThan(0.9);
  });

  it('normalises one-way streets (oneway=-1 is reversed)', () => {
    const oneways = build.network.edges.filter((e) => e.o === 1);
    expect(oneways.length).toBeGreaterThan(10);
    // Street 2 (i=1) is tagged oneway=-1 in the synthetic data: after import it must run south → north.
    const street = build.network.edges.filter((e) => e.n !== undefined && build.network.names[e.n].en === '2th Street');
    expect(street.length).toBeGreaterThan(0);
    for (const e of street) expect(e.p[e.p.length - 1]).toBeLessThan(e.p[1]);
  });

  it('snaps signals into junction clusters', () => {
    expect(build.network.signals.length).toBeGreaterThan(3);
    for (const cluster of build.network.signals) expect(cluster.length).toBeGreaterThan(0);
  });

  it('clips polylines to bounds with synthetic endpoints', () => {
    let id = -1;
    const runs = clipPolyline([1, 2, 3], [-20, 0, 0, 0, 20, 0], { minX: -10, minZ: -10, maxX: 10, maxZ: 10 }, () => id--);
    expect(runs).toHaveLength(1);
    expect(runs[0].pts[0]).toBeCloseTo(-10);
    expect(runs[0].pts[runs[0].pts.length - 2]).toBeCloseTo(10);
    expect(runs[0].ids[0]).toBeLessThan(0);
    expect(runs[0].ids[1]).toBe(2);
  });

  it('gives flyover chains a smooth elevation profile', () => {
    const ground = { wayId: 1, ids: [1, 2], pts: [-100, 0, 0, 0], tags: {}, bridge: false, layer: 0 };
    const ids = [2, 3, 4, 5, 6, 7];
    const pts = ids.flatMap((_, i) => [i * 60, 0]);
    const bridge = { wayId: 2, ids, pts, tags: {}, bridge: true, layer: 1 };
    const tail = { wayId: 3, ids: [7, 8], pts: [300, 0, 400, 0], tags: {}, bridge: false, layer: 0 };
    const h = computeElevations([ground, bridge, tail]);
    expect(h.get(2)).toBe(0);
    expect(h.get(7)).toBe(0);
    expect(h.get(4)!).toBeGreaterThan(5);
    expect(h.get(3)!).toBeGreaterThan(0);
    expect(h.get(3)!).toBeLessThan(h.get(4)!);
  });

  it('flattens very short bridges', () => {
    const ground = { wayId: 1, ids: [1, 2], pts: [-50, 0, 0, 0], tags: {}, bridge: false, layer: 0 };
    const bridge = { wayId: 2, ids: [2, 3], pts: [0, 0, 30, 0], tags: {}, bridge: true, layer: 1 };
    const h = computeElevations([ground, bridge]);
    expect(h.get(3)).toBe(0);
  });
});

describe('buildings', () => {
  it('stores counter-clockwise rings with positive height', () => {
    let count = 0;
    for (const chunk of build.chunks) {
      for (const b of chunk.buildings) {
        expect(signedArea(b.p)).toBeGreaterThan(0);
        expect(b.h).toBeGreaterThan(b.m);
        count++;
      }
    }
    expect(count).toBeGreaterThan(150);
    expect(count).toBe(build.manifest.stats.buildings);
  });

  it('marks road-facing shop frontages', () => {
    const withFront = build.chunks.flatMap((c) => c.buildings).filter((b) => b.f && b.f.length > 0);
    expect(withFront.length).toBeGreaterThan(20);
  });
});

describe('land mask and shoreline', () => {
  it('floods the sea on the water side of the coastline', () => {
    const m = build.mask;
    expect(sampleMask(m, m.r, coastX(0) - 150, 0)).toBeLessThan(10);
    expect(sampleMask(m, m.r, coastX(0) + 200, 0)).toBeGreaterThan(245);
  });

  it('extracts shoreline polylines with land on the left', () => {
    expect(build.network.shore.length).toBeGreaterThan(0);
    const line = build.network.shore.reduce((a, b) => (a.length > b.length ? a : b));
    const k = Math.floor(line.length / 4) * 2;
    const dx = line[k + 2] - line[k];
    const dz = line[k + 3] - line[k + 1];
    const len = Math.hypot(dx, dz);
    const lx = line[k] + (dz / len) * 12;
    const lz = line[k + 1] + (-dx / len) * 12;
    expect(sampleMask(build.mask, build.mask.r, lx, lz)).toBeGreaterThan(128);
  });

  it('keeps every ground-level road on land', () => {
    for (const e of build.network.edges) {
      if (e.h) continue;
      for (let i = 0; i < e.p.length; i += 2) {
        expect(sampleMask(build.mask, build.mask.r, e.p[i], e.p[i + 1])).toBeGreaterThan(127);
      }
    }
  });

  it('places trees on land away from roads', () => {
    const graph = new RoadGraph(build.network);
    const trees = build.chunks.flatMap((c) => {
      const out: [number, number][] = [];
      for (let i = 0; i < c.trees.length; i += 3) out.push([c.trees[i], c.trees[i + 1]]);
      return out;
    });
    expect(trees.length).toBeGreaterThan(100);
    for (const [x, z] of trees.slice(0, 300)) {
      const near = graph.nearest(x, z, 30);
      if (near) expect(near.d).toBeGreaterThan(graph.edges[near.edge].w / 2);
    }
  });
});

describe('RoadGraph', () => {
  const graph = new RoadGraph(build.network);
  it('finds the nearest road and samples along edges', () => {
    const e = graph.edges.findIndex((x) => x.k === Kind.Primary);
    const mid = graph.lengths[e] / 2;
    const s = graph.sample(e, mid, { x: 0, z: 0, tx: 0, tz: 0, h: 0 });
    const near = graph.nearest(s.x + 1, s.z + 1, 20)!;
    expect(near).not.toBeNull();
    expect(near.d).toBeLessThan(2);
    expect(Math.hypot(s.tx, s.tz)).toBeCloseTo(1, 5);
  });

  it('respects one-way streets in outgoing links', () => {
    const oneway = graph.edges.findIndex((e) => e.o === 1);
    const e = graph.edges[oneway];
    expect(graph.outgoing(e.a).some((l) => l.edge === oneway && l.forward)).toBe(true);
    expect(graph.outgoing(e.b).some((l) => l.edge === oneway)).toBe(false);
  });
});
