import { describe, expect, it } from 'vitest';
import { AUTO_PARAMS, BUS_PARAMS, FLEET, FLEET_ORDER, TAXI_PARAMS } from '../src/vehicle/fleet';
import {
  createVehicleState,
  GT_PARAMS,
  speedKmh,
  stepVehicle,
  torqueCurve,
  type VehicleControls,
  type VehicleEnv,
  type VehicleParams,
  type VehicleState,
} from '../src/vehicle/VehiclePhysics';

const flat: VehicleEnv = { grip: 1, assist: true, heightAt: () => 0 };
const DT = 1 / 120;

function run(s: VehicleState, c: Partial<VehicleControls>, seconds: number, env = flat) {
  const controls: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, ...c };
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) stepVehicle(s, controls, GT_PARAMS, DT, env);
}

function timeTo(s: VehicleState, kmh: number, limit = 30): number {
  let t = 0;
  while (speedKmh(s) < kmh && t < limit) {
    stepVehicle(s, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, GT_PARAMS, DT, flat);
    t += DT;
  }
  return t;
}

describe('vehicle physics', () => {
  it('stays perfectly still with no input', () => {
    const s = createVehicleState(10, 20, 0.3);
    run(s, {}, 5);
    expect(s.x).toBeCloseTo(10, 5);
    expect(s.z).toBeCloseTo(20, 5);
    expect(s.heading).toBeCloseTo(0.3, 5);
  });

  it('accelerates 0–100 km/h in a supercar-like time', () => {
    const s = createVehicleState();
    const t = timeTo(s, 100);
    expect(t).toBeGreaterThan(2.4);
    expect(t).toBeLessThan(4.2);
  });

  it('moves forward along -Z when heading is 0 (north)', () => {
    const s = createVehicleState();
    run(s, { throttle: 1 }, 2);
    expect(s.z).toBeLessThan(-5);
    expect(Math.abs(s.x)).toBeLessThan(0.01);
  });

  it('shifts up through the gears and reaches a high but bounded top speed', () => {
    const s = createVehicleState();
    run(s, { throttle: 1 }, 45);
    expect(s.gear).toBeGreaterThanOrEqual(5);
    expect(speedKmh(s)).toBeGreaterThan(260);
    expect(speedKmh(s)).toBeLessThan(345);
    expect(s.rpm).toBeLessThanOrEqual(GT_PARAMS.redline + 200);
  });

  it('brakes from 100 km/h to a stop within a realistic distance', () => {
    const s = createVehicleState();
    timeTo(s, 100);
    const z0 = s.z;
    let t = 0;
    while (s.vx > 0.01 && t < 10) {
      stepVehicle(s, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, GT_PARAMS, DT, flat);
      t += DT;
    }
    const dist = Math.abs(s.z - z0);
    expect(dist).toBeGreaterThan(25);
    expect(dist).toBeLessThan(48);
    expect(s.vx).toBeCloseTo(0, 2);
  });

  it('engages reverse after stopping when brake is held, and drives backwards', () => {
    const s = createVehicleState();
    run(s, { brake: 1 }, 1);
    expect(s.gear).toBe(-1);
    run(s, { brake: 1 }, 2);
    expect(s.vx).toBeLessThan(-2);
    expect(s.z).toBeGreaterThan(1);
    // Throttle brakes the reversing car, then returns to first gear.
    run(s, { throttle: 1 }, 3);
    expect(s.gear).toBe(1);
  });

  it('steers left with positive steer input', () => {
    const s = createVehicleState();
    run(s, { throttle: 0.5 }, 2);
    run(s, { throttle: 0.3, steer: 1 }, 1.5);
    expect(s.heading).toBeGreaterThan(0.3);
    expect(s.x).toBeLessThan(0);
  });

  it('turns in a tighter circle at low speed than at high speed', () => {
    const curvature = (kmh: number) => {
      const s = createVehicleState();
      timeTo(s, kmh);
      const h0 = s.heading;
      const d0 = s.odometer;
      // Hold speed roughly constant while at full lock.
      for (let i = 0; i < 120; i++) {
        stepVehicle(s, { throttle: speedKmh(s) < kmh ? 0.6 : 0, brake: 0, steer: 1, handbrake: 0 }, GT_PARAMS, DT, flat);
      }
      return Math.abs(s.heading - h0) / Math.max(0.1, s.odometer - d0);
    };
    const low = curvature(15);
    const high = curvature(110);
    expect(low).toBeGreaterThan(0.12);
    expect(low).toBeGreaterThan(high * 2.5);
  });

  it('keeps rolling at low speed while steering (no scrub stall)', () => {
    const s = createVehicleState();
    run(s, { throttle: 0.25 }, 1);
    const h0 = s.heading;
    run(s, { steer: 1 }, 1);
    expect(Math.abs(s.heading - h0)).toBeGreaterThan(0.2);
  });

  it('handbrake at speed produces rear slip (drift)', () => {
    const s = createVehicleState();
    timeTo(s, 80);
    run(s, { steer: 0.6, handbrake: 1 }, 0.6);
    expect(Math.abs(s.slipRear)).toBeGreaterThan(0.12);
    expect(s.squeal).toBeGreaterThan(0.3);
  });

  it('stays composed when braking hard mid-corner (stability control)', () => {
    const s = createVehicleState();
    timeTo(s, 80);
    const h0 = s.heading;
    let maxYaw = 0;
    for (let i = 0; i < 180; i++) {
      stepVehicle(s, { throttle: 0, brake: 0, steer: 1, handbrake: 0 }, GT_PARAMS, DT, flat);
      maxYaw = Math.max(maxYaw, Math.abs(s.yawRate));
    }
    for (let i = 0; i < 300; i++) {
      stepVehicle(s, { throttle: 0, brake: 1, steer: 1, handbrake: 0 }, GT_PARAMS, DT, flat);
      maxYaw = Math.max(maxYaw, Math.abs(s.yawRate));
    }
    expect(maxYaw).toBeLessThan(1.6);
    expect(Math.abs(s.heading - h0)).toBeLessThan(2.4);
    expect(Math.abs(s.vy)).toBeLessThan(2);
  });

  it('uses only a few degrees of steering lock at highway speed', () => {
    const s = createVehicleState();
    timeTo(s, 120);
    run(s, { throttle: 0.3, steer: 1 }, 0.5);
    expect(Math.abs(s.steer)).toBeLessThan(0.15);
  });

  it('remains numerically stable through aggressive inputs', () => {
    const s = createVehicleState();
    for (let i = 0; i < 4000; i++) {
      const t = i * DT;
      stepVehicle(
        s,
        {
          throttle: Math.sin(t * 1.3) > 0 ? 1 : 0,
          brake: Math.sin(t * 0.7) > 0.8 ? 1 : 0,
          steer: Math.sin(t * 2.1),
          handbrake: Math.sin(t * 0.9) > 0.9 ? 1 : 0,
        },
        GT_PARAMS,
        DT,
        flat,
      );
      for (const v of [s.x, s.z, s.vx, s.vy, s.yawRate, s.heading, s.rpm]) expect(Number.isFinite(v)).toBe(true);
    }
    expect(Math.abs(s.yawRate)).toBeLessThan(4.01);
  });

  it('follows a ramp surface and pitches the body', () => {
    const ramp: VehicleEnv = { grip: 1, assist: true, heightAt: (_x, z) => Math.max(0, Math.min(6, -z * 0.07)) };
    const s = createVehicleState();
    run(s, { throttle: 0.6 }, 4, ramp);
    expect(s.y).toBeGreaterThan(1);
    expect(s.pitch).toBeGreaterThan(0.03);
  });
});

describe('drivable fleet', () => {
  const topSpeed = (p: VehicleParams, seconds = 70) => {
    const s = createVehicleState();
    for (let i = 0; i < seconds / DT; i++) stepVehicle(s, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, p, DT, flat);
    return speedKmh(s);
  };

  it('gives each vehicle a believable top speed', () => {
    expect(topSpeed(AUTO_PARAMS)).toBeGreaterThan(55);
    expect(topSpeed(AUTO_PARAMS)).toBeLessThan(70);
    expect(topSpeed(TAXI_PARAMS)).toBeGreaterThan(105);
    expect(topSpeed(TAXI_PARAMS)).toBeLessThan(135);
    // The BEST bus is governed to 70 km/h.
    expect(topSpeed(BUS_PARAMS)).toBeGreaterThan(60);
    expect(topSpeed(BUS_PARAMS)).toBeLessThan(72);
  });

  it('pulls away from rest in every vehicle (the launch rpm suits each engine)', () => {
    for (const id of FLEET_ORDER) {
      const s = createVehicleState();
      for (let i = 0; i < 3 / DT; i++) stepVehicle(s, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, FLEET[id].params, DT, flat);
      expect(s.vx, id).toBeGreaterThan(3);
    }
  });

  it('turns the rickshaw tighter than the bus', () => {
    const radius = (p: VehicleParams) => {
      const s = createVehicleState();
      for (let i = 0; i < 15 / DT; i++) stepVehicle(s, { throttle: speedKmh(s) < 15 ? 0.5 : 0, brake: 0, steer: 1, handbrake: 0 }, p, DT, flat);
      return Math.abs(s.vx / s.yawRate);
    };
    expect(radius(AUTO_PARAMS)).toBeLessThan(4.5);
    expect(radius(BUS_PARAMS)).toBeGreaterThan(9);
  });

  it('interpolates custom torque curves', () => {
    expect(torqueCurve(1500, AUTO_PARAMS)).toBeCloseTo(12);
    expect(torqueCurve(4000, AUTO_PARAMS)).toBeCloseTo(17.25);
    expect(torqueCurve(9000, AUTO_PARAMS)).toBeCloseTo(16);
    // The GT keeps its original curve.
    expect(torqueCurve(4000)).toBe(632);
  });

  it('keeps the GT exactly as tuned before', () => {
    expect(FLEET.gtr.params).toBe(GT_PARAMS);
  });
});
