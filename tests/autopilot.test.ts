import { describe, expect, it } from 'vitest';
import { Autopilot, type AutopilotRoads } from '../src/drive/Autopilot';
import type { Route } from '../src/nav/Pathfinder';
import type { DynamicCircle } from '../src/physics/CollisionWorld';
import { FLEET, FLEET_ORDER } from '../src/vehicle/fleet';
import { createVehicleState, stepVehicle, type VehicleState } from '../src/vehicle/VehiclePhysics';

const DT = 1 / 120;
const env = { grip: 1, assist: true, heightAt: () => 0 };

/** 300 m north, a right-angle turn east for 200 m, then a sweeping 90° curve. */
function testRoute(): Route {
  const points: number[] = [];
  const cum: number[] = [];
  let d = 0;
  const add = (x: number, z: number) => {
    const n = points.length;
    if (n) d += Math.hypot(x - points[n - 2], z - points[n - 1]);
    points.push(x, z);
    cum.push(d);
  };
  for (let i = 0; i <= 30; i++) add(0, -i * 10);
  for (let i = 1; i <= 20; i++) add(i * 10, -300);
  for (let i = 1; i <= 30; i++) {
    const a = ((i / 30) * Math.PI) / 2;
    add(200 + Math.sin(a) * 120, -300 - (1 - Math.cos(a)) * 120);
  }
  return { steps: [{ edge: 0, towardsB: true, from: 0, to: d }], length: d, points, cum, heights: cum.map(() => 0) };
}

/** Distance along the polyline of the closest point, and the lateral distance to it. */
function project(route: Route, x: number, z: number): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  const p = route.points;
  for (let i = 0; i < p.length / 2 - 1; i++) {
    const ax = p[i * 2];
    const az = p[i * 2 + 1];
    const dx = p[i * 2 + 2] - ax;
    const dz = p[i * 2 + 3] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best.d) best = { s: route.cum[i] + (route.cum[i + 1] - route.cum[i]) * t, d };
  }
  return best;
}

interface Trip {
  arrived: boolean;
  time: number;
  remaining: number;
  maxLaneError: number;
  minSpeedNear: (s: number) => number;
  state: VehicleState;
}

function drive(id: keyof typeof FLEET, roads: Partial<AutopilotRoads>, traffic: () => DynamicCircle[] = () => [], seconds = 150): Trip {
  const route = testRoute();
  const full: AutopilotRoads = { laneOffset: () => 1.6, speedLimit: () => 15, signal: () => null, edgeLength: () => route.length, ...roads };
  const ap = new Autopilot(full);
  ap.engage();
  const s = createVehicleState(0, 0, 0, 0);
  const out = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  const speeds: [number, number][] = [];
  let maxLaneError = 0;
  let t = 0;
  let progress = 0;
  for (; t < seconds; t += DT) {
    const p = project(route, s.x, s.z);
    progress = p.s;
    // Lane keeping on the straights, once settled (corners are cut on purpose).
    const straight = (progress > 40 && progress < 270) || (progress > 340 && progress < 480);
    if (straight) maxLaneError = Math.max(maxLaneError, Math.abs(p.d - 1.6));
    speeds.push([progress, s.vx]);
    ap.update(DT, s, FLEET[id].params, route, progress, traffic(), out);
    stepVehicle(s, out, FLEET[id].params, DT, env);
    if (ap.status === 'arrived') break;
  }
  return {
    arrived: ap.status === 'arrived',
    time: t,
    remaining: route.length - progress,
    maxLaneError,
    minSpeedNear: (at) => Math.min(...speeds.filter(([p]) => Math.abs(p - at) < 15).map(([, v]) => v)),
    state: s,
  };
}

describe('autopilot', () => {
  it.each(FLEET_ORDER)('drives the %s to the end of the route and parks', (id) => {
    const trip = drive(id, {});
    expect(trip.arrived).toBe(true);
    expect(trip.remaining).toBeLessThan(15);
    expect(trip.remaining).toBeGreaterThan(0);
    expect(Math.abs(trip.state.vx)).toBeLessThan(0.5);
    expect(trip.state.gear).toBeGreaterThan(0);
  });

  it('keeps to the left lane on the straights', () => {
    const trip = drive('gtr', {});
    expect(trip.maxLaneError).toBeLessThan(0.9);
  });

  it('respects the speed limit', () => {
    const route = testRoute();
    const ap = new Autopilot({ laneOffset: () => 1.6, speedLimit: () => 10, signal: () => null, edgeLength: () => route.length });
    ap.engage();
    const s = createVehicleState();
    const out = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    let top = 0;
    for (let t = 0; t < 25; t += DT) {
      ap.update(DT, s, FLEET.gtr.params, route, project(route, s.x, s.z).s, [], out);
      stepVehicle(s, out, FLEET.gtr.params, DT, env);
      top = Math.max(top, s.vx);
    }
    expect(top).toBeLessThan(11);
    expect(top).toBeGreaterThan(8.5);
  });

  it('stops at a red light and goes on green', () => {
    let clock = 0;
    const trip = drive('taxi', { signal: () => ({ stopS: 150, stop: clock < 30 }) }, () => {
      clock += DT;
      return [];
    });
    expect(trip.minSpeedNear(145)).toBeLessThan(0.3);
    expect(trip.arrived).toBe(true);
  });

  it('follows a slow vehicle instead of driving into it', () => {
    // A rickshaw ahead in our lane doing 4 m/s for the first 40 seconds.
    let clock = 0;
    let lead = 60;
    let minGap = Infinity;
    const route = testRoute();
    const ap = new Autopilot({ laneOffset: () => 1.6, speedLimit: () => 15, signal: () => null, edgeLength: () => route.length });
    ap.engage();
    const s = createVehicleState();
    const out = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    for (; clock < 35; clock += DT) {
      lead += 4 * DT;
      const c: DynamicCircle = { x: -1.6, z: -lead, r: 0.7, id: 1, vx: 0, vz: -4 };
      minGap = Math.min(minGap, -s.z - lead > 0 ? Infinity : lead + s.z - 2.3 - 0.7);
      ap.update(DT, s, FLEET.gtr.params, route, project(route, s.x, s.z).s, [c], out);
      stepVehicle(s, out, FLEET.gtr.params, DT, env);
    }
    expect(minGap).toBeGreaterThan(1.5);
    expect(Math.abs(s.vx - 4)).toBeLessThan(1);
  });

  it('honks and then squeezes past a vehicle that will not move', () => {
    const route = testRoute();
    const ap = new Autopilot({ laneOffset: () => 1.6, speedLimit: () => 12, signal: () => null, edgeLength: () => route.length });
    ap.engage();
    const s = createVehicleState();
    const out = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    const parked: DynamicCircle[] = [
      { x: -1.6, z: -80, r: 0.9, id: 7, vx: 0, vz: 0 },
      { x: -1.6, z: -82.5, r: 0.9, id: 7, vx: 0, vz: 0 },
    ];
    let honked = false;
    for (let t = 0; t < 40; t += DT) {
      ap.update(DT, s, FLEET.gtr.params, route, project(route, s.x, s.z).s, parked, out);
      stepVehicle(s, out, FLEET.gtr.params, DT, env);
      if (ap.wantsHorn) honked = true;
    }
    expect(honked).toBe(true);
    expect(-s.z).toBeGreaterThan(95);
  });

  it('pulls over soon after the navigator reports arrival', () => {
    const route = testRoute();
    const ap = new Autopilot({ laneOffset: () => 1.6, speedLimit: () => 14, signal: () => null, edgeLength: () => route.length });
    ap.engage();
    const s = createVehicleState();
    const out = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    let finished = false;
    for (let t = 0; t < 60 && ap.status !== 'arrived'; t += DT) {
      const p = project(route, s.x, s.z).s;
      if (!finished && p > 120) {
        ap.finishSoon(p, s.vx);
        finished = true;
      }
      ap.update(DT, s, FLEET.gtr.params, route, p, [], out);
      stepVehicle(s, out, FLEET.gtr.params, DT, env);
    }
    expect(ap.status).toBe('arrived');
    expect(project(route, s.x, s.z).s).toBeLessThan(200);
  });
});
