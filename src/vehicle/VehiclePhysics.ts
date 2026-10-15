/**
 * Vehicle dynamics for the player car (pure TypeScript, no rendering).
 *
 * A single-track ("bicycle") model with:
 *  - longitudinal load transfer,
 *  - a saturating Pacejka-style lateral tyre curve with a friction circle,
 *  - AWD torque split with per-axle traction limits (wheelspin),
 *  - twin-turbo spool, torque curve, automatic 6-speed gearbox and reverse,
 *  - handbrake that locks the rear and cuts rear lateral grip (drifting),
 *  - a kinematic blend at walking speed so the car never jitters when stopped.
 *
 * Conventions: heading θ is rotation about +Y (three.js rotation.y). The car's
 * forward is (−sin θ, −cos θ) in world X/Z and its left is (−cos θ, sin θ).
 * Body-frame velocity: vx forward, vy left; yaw rate r > 0 turns left.
 */

export interface VehicleParams {
  mass: number;
  inertia: number;
  cgToFront: number;
  cgToRear: number;
  cgHeight: number;
  wheelRadius: number;
  gears: number[];
  reverseRatio: number;
  finalDrive: number;
  efficiency: number;
  idleRpm: number;
  redline: number;
  shiftUpRpm: number;
  shiftDownRpm: number;
  frontTorqueSplit: number;
  maxSteer: number;
  /** Speed (m/s) at which available steering lock has roughly halved. */
  steerHalfSpeed: number;
  steerRate: number;
  mu: number;
  tireB: number;
  tireC: number;
  brakeForce: number;
  brakeBias: number;
  drag: number;
  rolling: number;
  handbrakeRearGrip: number;
  /** Rear lateral grip multiplier (>1 = stable, slight understeer). */
  rearGripBias: number;
  /** Stability control strength (yaw-rate correction, 1/s). */
  stability: number;
}

/** Tuned to feel like a ~570 PS twin-turbo AWD coupé (0–100 km/h ≈ 3 s). */
export const GT_PARAMS: VehicleParams = {
  mass: 1752,
  inertia: 3050,
  cgToFront: 1.32,
  cgToRear: 1.46,
  cgHeight: 0.48,
  wheelRadius: 0.345,
  gears: [3.8, 2.3, 1.6, 1.22, 0.96, 0.77],
  reverseRatio: 3.4,
  finalDrive: 3.7,
  efficiency: 0.88,
  idleRpm: 900,
  redline: 7100,
  shiftUpRpm: 6850,
  shiftDownRpm: 3000,
  frontTorqueSplit: 0.32,
  maxSteer: 0.58,
  steerHalfSpeed: 11,
  steerRate: 3.2,
  mu: 1.12,
  tireB: 13,
  tireC: 1.42,
  brakeForce: 19500,
  brakeBias: 0.62,
  drag: 0.42,
  rolling: 11,
  handbrakeRearGrip: 0.36,
  rearGripBias: 1.1,
  stability: 5,
};

export interface VehicleControls {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: number;
}

export interface VehicleState {
  x: number;
  y: number;
  z: number;
  heading: number;
  vx: number;
  vy: number;
  yawRate: number;
  vertVel: number;
  steer: number;
  gear: number;
  rpm: number;
  boost: number;
  shiftTimer: number;
  shiftCooldown: number;
  reverseTimer: number;
  accelLong: number;
  accelLat: number;
  slipFront: number;
  slipRear: number;
  wheelspin: number;
  squeal: number;
  onGround: boolean;
  pitch: number;
  roll: number;
  bodyPitch: number;
  bodyRoll: number;
  bodyPitchVel: number;
  bodyRollVel: number;
  wheelRotF: number;
  wheelRotR: number;
  odometer: number;
  drive: number;
  braking: number;
  landed: number;
  /** Seconds since the handbrake was last held (stability control stays off briefly after a drift). */
  sinceHandbrake: number;
}

export function createVehicleState(x = 0, z = 0, heading = 0, y = 0): VehicleState {
  return {
    x,
    y,
    z,
    heading,
    vx: 0,
    vy: 0,
    yawRate: 0,
    vertVel: 0,
    steer: 0,
    gear: 1,
    rpm: 900,
    boost: 0,
    shiftTimer: 0,
    shiftCooldown: 0,
    reverseTimer: 0,
    accelLong: 0,
    accelLat: 0,
    slipFront: 0,
    slipRear: 0,
    wheelspin: 0,
    squeal: 0,
    onGround: true,
    pitch: 0,
    roll: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    bodyPitchVel: 0,
    bodyRollVel: 0,
    wheelRotF: 0,
    wheelRotR: 0,
    odometer: 0,
    drive: 0,
    braking: 0,
    landed: 0,
    sinceHandbrake: 10,
  };
}

export interface VehicleEnv {
  /** Tyre grip multiplier (rain, sand). */
  grip: number;
  /** Counter-steer / stability assist. */
  assist: boolean;
  /** Surface height under a point given the car's current height (decks vs ground). */
  heightAt(x: number, z: number, refY: number): number;
}

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Engine torque (N·m) at full load. */
export function torqueCurve(rpm: number): number {
  if (rpm < 1500) return 330 + (rpm - 900) * 0.25;
  if (rpm < 3300) return 480 + ((rpm - 1500) / 1800) * 150;
  if (rpm < 5800) return 632;
  if (rpm < 7100) return 632 - ((rpm - 5800) / 1300) * 70;
  return 520;
}

function tire(alpha: number, B: number, C: number): number {
  return Math.sin(C * Math.atan(B * alpha));
}

export function speedKmh(s: VehicleState): number {
  return Math.abs(s.vx) * 3.6;
}

export function forwardVector(heading: number): [number, number] {
  return [-Math.sin(heading), -Math.cos(heading)];
}

export function worldVelocity(s: VehicleState): [number, number] {
  const sin = Math.sin(s.heading);
  const cos = Math.cos(s.heading);
  return [-sin * s.vx - cos * s.vy, -cos * s.vx + sin * s.vy];
}

export function setWorldVelocity(s: VehicleState, wx: number, wz: number): void {
  const sin = Math.sin(s.heading);
  const cos = Math.cos(s.heading);
  s.vx = -sin * wx - cos * wz;
  s.vy = -cos * wx + sin * wz;
}

export function stepVehicle(s: VehicleState, c: VehicleControls, p: VehicleParams, dt: number, env: VehicleEnv): void {
  const m = p.mass;
  const g = 9.81;
  const a = p.cgToFront;
  const b = p.cgToRear;
  const L = a + b;
  const speed = Math.hypot(s.vx, s.vy);

  // ---- Gear selection: brake at a standstill engages reverse, throttle returns to drive.
  const throttleIn = clamp(c.throttle, 0, 1);
  const brakeIn = clamp(c.brake, 0, 1);
  if (s.gear > 0) {
    if (brakeIn > 0.1 && throttleIn < 0.1 && Math.abs(s.vx) < 0.7) {
      s.reverseTimer += dt;
      if (s.reverseTimer > 0.22) {
        s.gear = -1;
        s.reverseTimer = 0;
      }
    } else s.reverseTimer = 0;
  } else {
    if (throttleIn > 0.1 && brakeIn < 0.1 && Math.abs(s.vx) < 0.7) {
      s.reverseTimer += dt;
      if (s.reverseTimer > 0.12) {
        s.gear = 1;
        s.reverseTimer = 0;
      }
    } else s.reverseTimer = 0;
  }
  const reverse = s.gear < 0;
  const drive = reverse ? brakeIn : throttleIn;
  const brakeCmd = reverse ? throttleIn : brakeIn;
  const handbrake = clamp(c.handbrake, 0, 1);
  s.drive = drive;
  s.braking = brakeCmd;

  // ---- Steering with speed-sensitive lock and optional counter-steer assist.
  // Speed-sensitive lock: generous when parking, a few degrees at highway speed.
  const maxSteer = p.maxSteer / (1 + Math.pow(Math.abs(s.vx) / p.steerHalfSpeed, 1.4));
  let target = clamp(c.steer, -1, 1) * maxSteer;
  if (env.assist && Math.abs(s.vx) > 5 && s.vx > 0) {
    const beta = Math.atan2(s.vy, Math.abs(s.vx));
    const excess = Math.sign(beta) * Math.max(0, Math.abs(beta) - 0.05);
    target += clamp(excess * (handbrake > 0 ? 0.25 : 0.65), -0.35, 0.35);
  }
  target = clamp(target, -p.maxSteer, p.maxSteer);
  const dSteer = target - s.steer;
  s.steer += clamp(dSteer, -p.steerRate * dt, p.steerRate * dt);

  // ---- Axle loads with longitudinal transfer.
  const transfer = (p.cgHeight / L) * m * s.accelLong * 0.6;
  const fzF = Math.max(0.15 * m * g, (m * g * b) / L - transfer);
  const fzR = Math.max(0.15 * m * g, (m * g * a) / L + transfer);
  const mu = p.mu * env.grip;

  // ---- Engine & gearbox.
  const ratio = reverse ? p.reverseRatio : p.gears[s.gear - 1];
  const total = ratio * p.finalDrive;
  const wheelRpm = (Math.abs(s.vx) / p.wheelRadius) * (60 / TAU);
  let rpm = wheelRpm * total;
  const clutchSlip = p.idleRpm + drive * 3000 * (1 - smooth(4, 14, Math.abs(s.vx)));
  rpm = Math.max(rpm, clutchSlip, p.idleRpm);
  const boostTarget = drive * clamp((rpm - 1800) / 2600, 0.2, 1);
  const tau = boostTarget > s.boost ? 0.32 : 0.1;
  s.boost += (boostTarget - s.boost) * (1 - Math.exp(-dt / tau));
  let torque = torqueCurve(Math.min(rpm, p.redline)) * (0.58 + 0.42 * s.boost) * drive;
  if (rpm > p.redline + 60) torque = 0;
  if (s.shiftTimer > 0) {
    s.shiftTimer -= dt;
    torque *= 0.2;
  }
  s.shiftCooldown -= dt;
  if (!reverse && s.shiftCooldown <= 0) {
    if (rpm > p.shiftUpRpm && s.gear < p.gears.length && drive > 0.05) {
      s.gear++;
      s.shiftCooldown = 0.45;
      s.shiftTimer = 0.11;
    } else if (rpm < p.shiftDownRpm && s.gear > 1) {
      s.gear--;
      s.shiftCooldown = 0.35;
      s.shiftTimer = 0.06;
    }
  }
  s.rpm += (Math.min(rpm, p.redline + 120) - s.rpm) * (1 - Math.exp(-dt / 0.05));

  const driveForce = ((torque * total * p.efficiency) / p.wheelRadius) * (reverse ? -1 : 1);
  let fxF = driveForce * p.frontTorqueSplit;
  let fxR = driveForce * (1 - p.frontTorqueSplit);

  // ---- Brakes oppose motion.
  const dir = Math.abs(s.vx) > 0.05 ? Math.sign(s.vx) : 0;
  const brakeF = brakeCmd * p.brakeForce;
  fxF -= dir * brakeF * p.brakeBias;
  fxR -= dir * brakeF * (1 - p.brakeBias);
  if (handbrake > 0) fxR -= dir * mu * fzR * 0.85 * handbrake;
  // Engine braking when coasting in gear.
  if (drive < 0.05 && !reverse) fxR -= dir * 1100 * (s.rpm / p.redline);

  const capF = mu * fzF;
  const capR = mu * fzR;
  const spinR = Math.max(0, Math.abs(fxR) - capR) / capR;
  const spinF = Math.max(0, Math.abs(fxF) - capF) / capF;
  fxF = clamp(fxF, -capF, capF);
  fxR = clamp(fxR, -capR, capR);
  s.wheelspin = clamp(Math.max(spinR, spinF) * (drive > 0.2 ? 1 : 0), 0, 1);

  // ---- Lateral tyre forces with a friction circle.
  const vxAbs = Math.max(Math.abs(s.vx), 0.8);
  const sv = Math.sign(s.vx) || 1;
  const alphaF = Math.atan2(s.vy + a * s.yawRate, vxAbs) - s.steer * sv;
  const alphaR = Math.atan2(s.vy - b * s.yawRate, vxAbs);
  const latCapF = Math.sqrt(Math.max(0, capF * capF - fxF * fxF));
  const rearGrip = handbrake > 0 ? 1 - (1 - p.handbrakeRearGrip) * handbrake : 1;
  const latCapR = Math.sqrt(Math.max(0, capR * capR - fxR * fxR)) * rearGrip * p.rearGripBias;
  const fyF = -latCapF * tire(alphaF, p.tireB, p.tireC);
  const fyR = -latCapR * tire(alphaR, p.tireB, p.tireC);
  s.slipFront = alphaF;
  s.slipRear = alphaR;

  const cosD = Math.cos(s.steer);
  const sinD = Math.sin(s.steer);
  // Below walking pace the slip-angle model is meaningless; motion is kinematic.
  const blend = smooth(0.6, 4.5, speed);
  const dragF = p.drag * s.vx * Math.abs(s.vx) + p.rolling * s.vx;
  const fx = fxF * cosD - fyF * sinD * blend + fxR - dragF;
  const fy = fxF * sinD + fyF * cosD + fyR - p.drag * 0.6 * s.vy * Math.abs(s.vy);
  const tq = a * (fxF * sinD + fyF * cosD) - b * fyR;

  const ax = fx / m;
  const ay = fy / m;
  let vx = s.vx + (ax + s.yawRate * s.vy) * dt;
  let vy = s.vy + (ay - s.yawRate * s.vx) * dt;
  let r = s.yawRate + (tq / p.inertia) * dt;

  // ---- Stability control: pull the yaw rate back towards what the steering
  // asks for, unless the driver is deliberately drifting with the handbrake.
  s.sinceHandbrake = handbrake > 0 ? 0 : s.sinceHandbrake + dt;
  if (env.assist && s.sinceHandbrake > 0.9 && Math.abs(vx) > 6) {
    const wanted = (vx * Math.tan(s.steer)) / L;
    const limit = (mu * g * 0.95) / Math.max(4, Math.abs(vx));
    const target = Math.max(-limit, Math.min(limit, wanted));
    const excess = r - target;
    if (Math.sign(excess) === Math.sign(r) || Math.abs(r) > limit) {
      r -= excess * Math.min(1, p.stability * dt);
      vy *= 1 - Math.min(0.5, p.stability * 0.35 * dt);
    }
  }

  // ---- Kinematic blend at very low speed (prevents jitter / creeping).
  const rKin = (vx * Math.tan(s.steer)) / L;
  r = rKin + (r - rKin) * blend;
  vy *= 0.2 + 0.8 * blend;
  // Brakes hold the car at a standstill rather than reversing it.
  if (dir !== 0 && Math.sign(vx) !== dir && drive < 0.05) vx = 0;
  if (drive < 0.02 && Math.abs(vx) < 0.25) {
    vx *= brakeCmd > 0 || handbrake > 0 ? 0 : 0.92;
    if (Math.abs(vx) < 0.02) vx = 0;
  }
  s.accelLong += ((vx - s.vx) / dt - s.accelLong) * 0.2;
  s.accelLat += (ay - s.accelLat) * 0.2;
  s.vx = vx;
  s.vy = vy;
  s.yawRate = clamp(r, -4, 4);

  // ---- Integrate pose.
  const sin = Math.sin(s.heading);
  const cos = Math.cos(s.heading);
  const wx = -sin * s.vx - cos * s.vy;
  const wz = -cos * s.vx + sin * s.vy;
  s.x += wx * dt;
  s.z += wz * dt;
  s.heading += s.yawRate * dt;
  if (s.heading > Math.PI) s.heading -= TAU;
  else if (s.heading < -Math.PI) s.heading += TAU;
  s.odometer += Math.hypot(wx, wz) * dt;

  // ---- Vertical: follow road / deck surface, fall when airborne.
  const fxw = -Math.sin(s.heading);
  const fzw = -Math.cos(s.heading);
  const h = env.heightAt(s.x, s.z, s.y);
  if (s.y <= h + 0.05) {
    if (!s.onGround && s.vertVel < -3) s.landed = Math.min(1, -s.vertVel / 10);
    s.y += (h - s.y) * Math.min(1, dt * 30);
    if (h - s.y > 0.4) s.y = h - 0.4;
    s.vertVel = 0;
    s.onGround = true;
  } else {
    s.vertVel -= g * dt;
    s.y += s.vertVel * dt;
    s.onGround = false;
    if (s.y < h) {
      s.y = h;
      s.landed = Math.min(1, -s.vertVel / 10);
      s.vertVel = 0;
      s.onGround = true;
    }
  }
  const hF = env.heightAt(s.x + fxw * a, s.z + fzw * a, s.y);
  const hR = env.heightAt(s.x - fxw * b, s.z - fzw * b, s.y);
  const targetPitch = Math.atan2(hF - hR, L);
  s.pitch += (targetPitch - s.pitch) * Math.min(1, dt * 12);

  // ---- Visual body motion (springy pitch and roll).
  const pitchTarget = clamp(s.accelLong * 0.0042, -0.045, 0.04);
  const rollTarget = clamp(-s.accelLat * 0.0062, -0.07, 0.07);
  const k = 120;
  const d = 16;
  s.bodyPitchVel += ((pitchTarget - s.bodyPitch) * k - s.bodyPitchVel * d) * dt;
  s.bodyRollVel += ((rollTarget - s.bodyRoll) * k - s.bodyRollVel * d) * dt;
  s.bodyPitch += s.bodyPitchVel * dt;
  s.bodyRoll += s.bodyRollVel * dt;
  if (s.landed > 0) s.landed = Math.max(0, s.landed - dt * 2);

  // ---- Wheel rotation (rear spins up under wheelspin, locks under handbrake).
  const omega = s.vx / p.wheelRadius;
  s.wheelRotF += omega * dt;
  s.wheelRotR += (handbrake > 0.5 ? 0 : omega + (reverse ? -1 : 1) * s.wheelspin * 40) * dt;

  // ---- Tyre noise intensity.
  const lateral = Math.max(0, Math.abs(alphaR) - 0.09) * 5 + Math.max(0, Math.abs(alphaF) - 0.12) * 4;
  const hardBrake = brakeCmd > 0.8 && Math.abs(s.vx) > 12 ? 0.25 : 0;
  const hb = handbrake > 0 && Math.abs(s.vx) > 4 ? 0.55 : 0;
  s.squeal = speed > 2.5 ? clamp(lateral + s.wheelspin * 0.9 + hardBrake + hb, 0, 1) : 0;
}

/** Teleports the car and clears its motion (used for spawn and reset). */
export function resetVehicle(s: VehicleState, x: number, z: number, heading: number, y = 0): void {
  Object.assign(s, createVehicleState(x, z, heading, y), { odometer: s.odometer });
}
