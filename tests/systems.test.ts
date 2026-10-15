import { describe, expect, it } from 'vitest';
import { generateSyntheticOsm } from '../src/map/fallback';
import { buildDistrict } from '../src/map/pipeline/index';
import { RoadGraph } from '../src/map/RoadGraph';
import { Kind, type EdgeData, type NetworkData } from '../src/map/types';
import { findRoute } from '../src/nav/Pathfinder';
import { CAR_CIRCLES, CAR_RADIUS, CollisionWorld } from '../src/physics/CollisionWorld';
import { SurfaceSystem } from '../src/physics/Surface';
import { createVehicleState, GT_PARAMS, stepVehicle, type VehicleEnv } from '../src/vehicle/VehiclePhysics';

/** A tiny hand-built network: a square loop with one one-way side and a dead-end spur. */
function squareNetwork(): NetworkData {
  const nodes = [0, 0, 100, 0, 100, 100, 0, 100, 0, -60];
  const edge = (a: number, b: number, o: 0 | 1, k: number = Kind.Residential): EdgeData => ({
    a,
    b,
    p: [nodes[a * 2], nodes[a * 2 + 1], nodes[b * 2], nodes[b * 2 + 1]],
    k,
    w: 7,
    l: 2,
    o,
  });
  return {
    nodes,
    edges: [edge(0, 1, 0), edge(1, 2, 1), edge(2, 3, 0), edge(3, 0, 0), edge(0, 4, 0)],
    names: [],
    signals: [],
    crossings: [],
    busStops: [],
    shore: [],
    rail: [],
    pois: [],
    landmarks: [],
  };
}

describe('pathfinder', () => {
  const graph = new RoadGraph(squareNetwork());

  it('routes along the shortest legal path', () => {
    // From the middle of edge 0 (0→1) to the middle of edge 2 (2→3).
    const r = findRoute(graph, { edge: 0, s: 50 }, { edge: 2, s: 50 })!;
    expect(r).not.toBeNull();
    // Shortest: 50 to node 1, 100 along the one-way 1→2, then 50 → total 200 (vs 250 the other way).
    expect(r.length).toBeCloseTo(200, 0);
    expect(r.steps.map((s) => s.edge)).toEqual([0, 1, 2]);
  });

  it('never drives the wrong way down a one-way street', () => {
    // From edge 2 back to edge 0: going 2→1 against the one-way is not allowed.
    const r = findRoute(graph, { edge: 2, s: 50 }, { edge: 0, s: 50 })!;
    expect(r).not.toBeNull();
    expect(r.steps.some((s) => s.edge === 1)).toBe(false);
    expect(r.length).toBeGreaterThan(100);
  });

  it('builds a continuous polyline with cumulative distances', () => {
    const r = findRoute(graph, { edge: 4, s: 30 }, { edge: 2, s: 20 })!;
    expect(r.points.length / 2).toBe(r.cum.length);
    for (let i = 1; i < r.cum.length; i++) expect(r.cum[i]).toBeGreaterThan(r.cum[i - 1]);
    expect(r.cum[r.cum.length - 1]).toBeCloseTo(r.length, 5);
  });

  it('finds routes across the generated fallback district', () => {
    const { osm, config } = generateSyntheticOsm();
    const build = buildDistrict(osm, config, { maskRes: 4 });
    const g = new RoadGraph(build.network);
    const mains = g.edges.map((_, i) => i).filter((i) => g.main[i]);
    let ok = 0;
    for (let k = 0; k < 20; k++) {
      const a = mains[(k * 37) % mains.length];
      const b = mains[(k * 91 + 13) % mains.length];
      const r = findRoute(g, { edge: a, s: g.lengths[a] / 2 }, { edge: b, s: g.lengths[b] / 2 });
      if (r) ok++;
    }
    expect(ok).toBe(20);
  });
});

describe('collision world', () => {
  const bounds = { minX: -500, minZ: -500, maxX: 500, maxZ: 500 };

  it('stops the car at a wall without letting it through', () => {
    const world = new CollisionWorld(null, bounds);
    // A long wall across the car's path at z = -40 (car drives north, towards −Z).
    world.addGroup('wall', [-50, -40, 50, -40], [], [[-50, -40, 50, -40, 50, -60, -50, -60]]);
    const s = createVehicleState(0, 0, 0);
    const env: VehicleEnv = { grip: 1, assist: true, heightAt: () => 0 };
    let hit = 0;
    for (let i = 0; i < 120 * 6; i++) {
      stepVehicle(s, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, GT_PARAMS, 1 / 120, env);
      const c = world.resolveVehicle(s, GT_PARAMS, false, [], i / 120);
      if (c) hit = Math.max(hit, c.impact);
    }
    expect(hit).toBeGreaterThan(5);
    // Front circle must stay on the near side of the wall.
    expect(s.z - CAR_CIRCLES[0] - CAR_RADIUS).toBeGreaterThan(-40 - 0.05);
    expect(world.insideBuilding(s.x, s.z)).toBe(false);
  });

  it('pushes the car out of a pole and keeps bounds', () => {
    const world = new CollisionWorld(null, bounds);
    world.addGroup('pole', [], [0, -1, 0.3]);
    const s = createVehicleState(0, 0, 0);
    world.resolveVehicle(s, GT_PARAMS, false, [], 0);
    expect(Math.hypot(s.x, s.z + 1)).toBeGreaterThan(0.3 + CAR_RADIUS - 0.75);
    const edge = createVehicleState(499, 0, 0);
    world.resolveVehicle(edge, GT_PARAMS, false, [], 0);
    expect(edge.x).toBeLessThan(496.5);
  });

  it('removes collision when a chunk unloads', () => {
    const world = new CollisionWorld(null, bounds);
    world.addGroup('c1', [-5, -3, 5, -3], []);
    expect(world.segmentCount).toBe(1);
    expect(world.raycast(0, 0, 0, -10)).toBeLessThan(1);
    world.removeGroup('c1');
    expect(world.segmentCount).toBe(0);
    expect(world.raycast(0, 0, 0, -10)).toBe(1);
  });
});

describe('flyover surfaces', () => {
  const deck: EdgeData = { a: 0, b: 1, p: [0, 0, 100, 0, 200, 0], h: [0, 7, 0], k: Kind.Primary, w: 10, l: 2, o: 0 };
  const surface = new SurfaceSystem([deck]);

  it('lets a car at ground level drive under the deck', () => {
    expect(surface.heightAt(100, 0, 0)).toBe(0);
  });

  it('lets a car on the deck stay on it and climb the ramp', () => {
    expect(surface.heightAt(100, 0, 6.8)).toBeCloseTo(7, 1);
    expect(surface.heightAt(10, 0, 0)).toBeCloseTo(0.7, 1);
  });

  it('keeps an elevated car inside the parapets', () => {
    const car = { x: 100, z: 9, y: 7 };
    const push = surface.constrain(car);
    expect(push).not.toBeNull();
    expect(Math.abs(car.z)).toBeLessThan(5.6);
  });
});
