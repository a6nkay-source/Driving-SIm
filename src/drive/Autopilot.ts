/**
 * Autopilot: drives the player's vehicle along the navigation route.
 *
 *  - Pure-pursuit steering towards a look-ahead point offset into the left
 *    lane (India drives on the left).
 *  - Speed planning from the road class, upcoming curvature, red lights,
 *    the vehicle ahead (with a Mumbai-appropriate honk when blocked), and a
 *    smooth stop at the destination.
 *  - Recovery: if it gets wedged it backs up and tries again.
 *
 * It produces the same throttle / brake / steer / handbrake axes as the
 * keyboard, so the regular vehicle physics does the driving.
 */
import type { Route, RouteStep } from '../nav/Pathfinder';
import type { DynamicCircle } from '../physics/CollisionWorld';
import type { VehicleControls, VehicleParams, VehicleState } from '../vehicle/VehiclePhysics';

export type AutopilotStatus = 'driving' | 'signal' | 'traffic' | 'turning' | 'arriving' | 'arrived' | 'recovering';

/** What the autopilot needs to know about the roads it drives on. */
export interface AutopilotRoads {
  /** Distance to shift left of the centre line on this step (metres). */
  laneOffset(step: RouteStep): number;
  /** Speed limit for this step (m/s). */
  speedLimit(step: RouteStep): number;
  /** Stop line (travel distance from where the step's edge is entered) and whether it is red/amber now. */
  signal(step: RouteStep): { stopS: number; stop: boolean } | null;
  edgeLength(edge: number): number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

interface Sample {
  x: number;
  z: number;
  tx: number;
  tz: number;
  step: number;
}

export class Autopilot {
  active = false;
  status: AutopilotStatus = 'driving';
  /** Driver-adjustable pace multiplier ("faster" / "slower"). */
  speedFactor = 1;
  /** True while blocked behind traffic long enough to lean on the horn. */
  wantsHorn = false;
  targetSpeed = 0;
  private route: Route | null = null;
  private stepStart: number[] = [];
  private stuckTime = 0;
  private reverseTime = 0;
  private blockedTime = 0;
  private hornPulse = 0;
  /** Step index of the red light we have committed to stopping for. */
  private stoppingFor = -1;
  /** Seconds left of an overtake (squeezing past a stopped vehicle on the right). */
  private overtakeTime = 0;
  private waitBehind = 0;
  /** Route distance to stop at instead of the route's end (set on arrival). */
  private endAt = Infinity;
  private tmp: Sample = { x: 0, z: 0, tx: 0, tz: 0, step: 0 };

  constructor(private readonly roads: AutopilotRoads) {}

  engage(): void {
    this.endAt = Infinity;
    this.active = true;
    this.status = 'driving';
    this.stuckTime = 0;
    this.reverseTime = 0;
    this.blockedTime = 0;
  }

  disengage(): void {
    this.active = false;
    this.wantsHorn = false;
  }

  /** The destination has been reached: pull over within a comfortable distance. */
  finishSoon(progress: number, speed: number): void {
    this.endAt = Math.min(this.endAt, progress + 10 + (speed * speed) / (2 * 2.2));
  }

  private setRoute(route: Route): void {
    this.route = route;
    this.endAt = Infinity;
    this.stepStart = [];
    let acc = 0;
    for (const st of route.steps) {
      this.stepStart.push(acc);
      acc += Math.abs(st.to - st.from);
    }
  }

  /** Position, tangent and step index at route distance d. */
  sample(route: Route, d: number, out: Sample = this.tmp): Sample {
    const cum = route.cum;
    const n = cum.length;
    d = clamp(d, 0, route.length);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const seg = Math.max(1e-6, cum[hi] - cum[lo]);
    const t = clamp((d - cum[lo]) / seg, 0, 1);
    const ax = route.points[lo * 2];
    const az = route.points[lo * 2 + 1];
    const bx = route.points[hi * 2];
    const bz = route.points[hi * 2 + 1];
    out.x = ax + (bx - ax) * t;
    out.z = az + (bz - az) * t;
    const l = Math.hypot(bx - ax, bz - az) || 1;
    out.tx = (bx - ax) / l;
    out.tz = (bz - az) / l;
    // Step containing d.
    let s = 0;
    for (let i = this.stepStart.length - 1; i >= 0; i--) {
      if (this.stepStart[i] <= d) {
        s = i;
        break;
      }
    }
    out.step = s;
    return out;
  }

  /** Tangent direction averaged over ±2 m (route polylines have sharp corners). */
  private heading(route: Route, d: number): number {
    const a = this.sample(route, d - 2, { x: 0, z: 0, tx: 0, tz: 0, step: 0 });
    const b = this.sample(route, d + 2, { x: 0, z: 0, tx: 0, tz: 0, step: 0 });
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  update(
    dt: number,
    s: VehicleState,
    p: VehicleParams,
    route: Route,
    progress: number,
    traffic: DynamicCircle[],
    out: VehicleControls,
  ): VehicleControls {
    out.throttle = 0;
    out.brake = 0;
    out.steer = 0;
    out.handbrake = 0;
    if (route !== this.route) this.setRoute(route);
    const v = s.vx;
    const speed = Math.abs(v);
    const L = p.cgToFront + p.cgToRear;
    const front = (p.circles?.[0] ?? 1.38) + (p.radius ?? 0.92);
    const tall = p.cgHeight > 1 ? 2 : p.cgHeight > 0.6 ? 1 : 0;
    const aLat = [3.2, 2.4, 1.7][tall];
    const aDec = [3.2, 2.8, 2.0][tall];
    const brakeDecel = p.brakeForce / p.mass;
    const remaining = Math.min(route.length, this.endAt) - progress;
    const fx = -Math.sin(s.heading);
    const fz = -Math.cos(s.heading);
    const lx = fz;
    const lz = -fx;

    // ---- Recovery: back up with opposite lock for a moment.
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      this.status = 'recovering';
      const t = this.sample(route, progress + 8);
      const rx = t.x - s.x;
      const rz = t.z - s.z;
      const side = rx * lx + rz * lz;
      out.brake = 0.55;
      out.steer = side > 0 ? -1 : 1;
      if (this.reverseTime <= 0) this.stuckTime = 0;
      return out;
    }

    // ---- Steering: pure pursuit to a look-ahead point in the left lane.
    const Ld = clamp(4 + speed * 0.75, 6, 28) + Math.max(0, L - 2.8) * 1.3;
    const tgt = this.sample(route, progress + Ld);
    // Overtaking shifts the path one lane to the right of our usual left lane.
    const off = this.roads.laneOffset(route.steps[tgt.step]) - (this.overtakeTime > 0 ? 3.1 : 0);
    if (this.overtakeTime > 0) this.overtakeTime -= dt;
    const px = tgt.x + tgt.tz * off;
    const pz = tgt.z - tgt.tx * off;
    const dx = px - s.x;
    const dz = pz - s.z;
    const ahead = dx * fx + dz * fz;
    const left = dx * lx + dz * lz;
    const dist2 = Math.max(1, dx * dx + dz * dz);
    let kappa = (2 * left) / dist2;
    if (ahead < 0) kappa = Math.sign(left || 1) * 0.35; // target behind: full lock round
    const delta = Math.atan(kappa * L);
    const maxSteer = p.maxSteer / (1 + Math.pow(speed / p.steerHalfSpeed, 1.4));
    out.steer = clamp(delta / Math.max(0.05, maxSteer), -1, 1);

    // ---- Speed planning. Each constraint is a target speed vT at distance D;
    // it caps the speed allowed now and, when we are faster than vT, the
    // deceleration needed to get there (used as brake feed-forward).
    let vMax = this.roads.speedLimit(route.steps[this.sample(route, progress).step]) * this.speedFactor;
    if (p.topSpeed) vMax = Math.min(vMax, p.topSpeed * 0.95);
    let aReq = 0;
    // Held in an object so the constraint closure can update it.
    const plan: { status: AutopilotStatus } = { status: 'driving' };
    const constrain = (vT: number, D: number, why: AutopilotStatus | null): void => {
      const allowed = Math.sqrt(vT * vT + 2 * aDec * Math.max(0, D));
      if (allowed < vMax) {
        vMax = allowed;
        if (why) plan.status = why;
      }
      if (v > vT) aReq = Math.max(aReq, (v * v - vT * vT) / (2 * Math.max(0.6, D)));
    };
    // Curvature over the next ~100 m.
    let prevH = this.heading(route, progress);
    const horizon = Math.min(110, remaining);
    for (let d = 4; d <= horizon; d += 4) {
      const h = this.heading(route, progress + d);
      let dh = h - prevH;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      prevH = h;
      const k = Math.abs(dh) / 4;
      if (k < 0.004) continue;
      const vc = Math.sqrt(aLat / k);
      constrain(vc, d - 6, vc < 7 && d < 30 ? 'turning' : null);
    }
    // Red lights on the next steps.
    const first = this.sample(route, progress).step;
    for (let i = first; i < route.steps.length; i++) {
      const st = route.steps[i];
      const startD = this.stepStart[i];
      if (startD - progress > 100) break;
      const sig = this.roads.signal(st);
      if (!sig) continue;
      const len = this.roads.edgeLength(st.edge);
      const enter = st.towardsB ? st.from : len - st.from;
      const lineD = startD + (sig.stopS - enter) - progress - front - 0.8;
      if (lineD < -1.5) continue;
      if (sig.stop) {
        // Once committed, stop; otherwise only if it can be done without a panic stop
        // (an amber light too close to stop for is driven through).
        const canStop = this.stoppingFor === i || (speed * speed) / (2 * Math.max(0.5, lineD)) < Math.min(5, brakeDecel * 0.8);
        if (canStop) {
          this.stoppingFor = i;
          constrain(0, lineD, 'signal');
        } else this.stoppingFor = -1;
      } else this.stoppingFor = -1;
      break;
    }
    // The vehicle ahead (following distance and a honk when it will not move).
    const curv = Math.tan(s.steer) / L;
    let lead = Infinity;
    let leadSpeed = 0;
    for (const c of traffic) {
      const rx = c.x - s.x;
      const rz = c.z - s.z;
      const fwd = rx * fx + rz * fz;
      if (fwd < 0 || fwd > 55) continue;
      const lat = rx * lx + rz * lz;
      // Path ahead: current steering arc, eased one lane right while overtaking.
      const expected = (curv * fwd * fwd) / 2 - (this.overtakeTime > 0 ? 3.1 * Math.min(1, fwd / 10) : 0);
      if (Math.abs(lat - expected) > 1.15 + c.r) continue;
      const gap = fwd - front - c.r;
      if (gap < lead) {
        lead = gap;
        leadSpeed = Math.max(0, c.vx * fx + c.vz * fz);
      }
    }
    if (lead < Infinity) {
      const s0 = 2.5;
      constrain(leadSpeed, lead - s0 - speed * 0.6, 'traffic');
    }
    // Stuck behind something that is not moving (and not a red light): go round it.
    if (lead < 14 && leadSpeed < 0.5 && this.stoppingFor < 0 && speed < 2) this.waitBehind += dt;
    else this.waitBehind = Math.max(0, this.waitBehind - dt * 0.5);
    if (this.waitBehind > 6 && this.overtakeTime <= 0) {
      this.overtakeTime = 7;
      this.waitBehind = 0;
    }
    // Arrival.
    if (remaining < 80) constrain(0, remaining - 8, 'arriving');
    vMax = Math.max(0, vMax);
    this.targetSpeed = vMax;

    // ---- Longitudinal control.
    const err = vMax - v;
    if (vMax < 0.3 && speed < 0.8) {
      // Hold with the handbrake: holding the brake at rest would select reverse.
      out.handbrake = 1;
      if (plan.status === 'arriving' && remaining < 30 && speed < 0.25) plan.status = 'arrived';
    } else if (aReq > aDec * 0.6 || err < -0.3) {
      // Brake for the deceleration the plan needs (feed-forward) plus the overspeed, scaled to this vehicle's brakes.
      const want = Math.max(aReq * 1.15, -err * 1.1 + 0.3);
      out.brake = clamp(want / brakeDecel, 0, 1);
    } else if (err > 0) {
      out.throttle = clamp(0.12 + err * 0.32, 0, 1) * (Math.abs(out.steer) > 0.7 && speed > 8 ? 0.4 : 1);
    }
    // Do not engage reverse while creeping forward with the brake applied.
    if (out.brake > 0 && speed < 0.8) {
      out.brake = 0;
      out.handbrake = 1;
    }

    // ---- Horn when stuck behind someone (it is Mumbai).
    if (plan.status === 'traffic' && speed < 1.5) this.blockedTime += dt;
    else this.blockedTime = Math.max(0, this.blockedTime - dt * 2);
    this.hornPulse -= dt;
    if (this.blockedTime > 2.5 && this.hornPulse <= -1.6) this.hornPulse = 0.35;
    this.wantsHorn = this.hornPulse > 0;

    // ---- Stuck detection: wanting to move, not moving, nothing in the way.
    if (vMax > 2 && speed < 0.4 && plan.status !== 'traffic' && plan.status !== 'signal') this.stuckTime += dt;
    else this.stuckTime = Math.max(0, this.stuckTime - dt);
    if (this.stuckTime > 2.2) {
      this.reverseTime = 1.6;
      this.stuckTime = 0;
    }
    this.status = plan.status;
    return out;
  }
}
