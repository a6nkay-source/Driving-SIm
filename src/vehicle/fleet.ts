/**
 * The drivable fleet: the GT coupé plus three Mumbai workhorses — a CNG
 * auto-rickshaw, a kaali-peeli Premier Padmini taxi and a BEST single-decker.
 * Each has its own physics tune, collision footprint, camera geometry and
 * engine-sound profile.
 */
import { GT_CAMERA, type CameraProfile } from '../camera/CameraRig';
import { GT_PARAMS, type VehicleParams } from './VehiclePhysics';

export type PlayerVehicleId = 'gtr' | 'auto' | 'taxi' | 'bus';
export type EngineProfile = 'v6tt' | 'twostroke' | 'inline4' | 'diesel';

export interface FleetEntry {
  id: PlayerVehicleId;
  name: string;
  nameHi: string;
  nameMr: string;
  blurb: string;
  params: VehicleParams;
  camera: CameraProfile;
  engine: EngineProfile;
  /** Spec sheet shown in the garage. */
  specs: { power: string; torque: string; top: string; layout: string };
}

/** Bajaj RE-style CNG auto-rickshaw: 236 cc single, 4 speeds, ~65 km/h flat out. */
export const AUTO_PARAMS: VehicleParams = {
  mass: 520,
  inertia: 360,
  cgToFront: 1.25,
  cgToRear: 0.75,
  cgHeight: 0.62,
  wheelRadius: 0.205,
  gears: [2.9, 1.85, 1.3, 1.0],
  reverseRatio: 3.2,
  finalDrive: 6.4,
  efficiency: 0.85,
  idleRpm: 1500,
  redline: 5600,
  shiftUpRpm: 5200,
  shiftDownRpm: 2500,
  frontTorqueSplit: 0,
  maxSteer: 0.72,
  steerHalfSpeed: 7,
  steerRate: 3.6,
  mu: 0.95,
  tireB: 10,
  tireC: 1.4,
  brakeForce: 3400,
  brakeBias: 0.45,
  drag: 0.5,
  rolling: 9,
  handbrakeRearGrip: 0.5,
  rearGripBias: 1.15,
  stability: 6,
  torque: [
    [1500, 12],
    [3000, 16],
    [5000, 18.5],
    [5600, 16],
  ],
  turbo: 0,
  launchRpm: 2800,
  engineBrake: 260,
  topSpeed: 18.5,
  circles: [0.75, -0.55],
  radius: 0.7,
  rollGain: 2.2,
};

/** Premier Padmini (Fiat 1100 derivative): 1.1 L petrol, rear-wheel drive, column-shift 4-speed. */
export const TAXI_PARAMS: VehicleParams = {
  mass: 980,
  inertia: 1250,
  cgToFront: 1.12,
  cgToRear: 1.27,
  cgHeight: 0.55,
  wheelRadius: 0.29,
  gears: [3.75, 2.16, 1.38, 1.0],
  reverseRatio: 3.6,
  finalDrive: 4.1,
  efficiency: 0.86,
  idleRpm: 800,
  redline: 5400,
  shiftUpRpm: 5000,
  shiftDownRpm: 2200,
  frontTorqueSplit: 0,
  maxSteer: 0.62,
  steerHalfSpeed: 9,
  steerRate: 2.6,
  mu: 0.92,
  tireB: 10,
  tireC: 1.4,
  brakeForce: 7600,
  brakeBias: 0.62,
  drag: 0.44,
  rolling: 10,
  handbrakeRearGrip: 0.42,
  rearGripBias: 1.08,
  stability: 4,
  torque: [
    [800, 52],
    [2000, 68],
    [3000, 76],
    [4500, 72],
    [5400, 60],
  ],
  turbo: 0,
  launchRpm: 2300,
  engineBrake: 520,
  circles: [1.15, -1.15],
  radius: 0.8,
  rollGain: 1.5,
};

/** BEST single-decker: turbo-diesel, five speeds, governed to 70 km/h. */
export const BUS_PARAMS: VehicleParams = {
  mass: 11500,
  inertia: 105000,
  cgToFront: 3.05,
  cgToRear: 2.55,
  cgHeight: 1.25,
  wheelRadius: 0.5,
  gears: [6.5, 3.8, 2.4, 1.5, 1.0],
  reverseRatio: 6.2,
  finalDrive: 4.9,
  efficiency: 0.88,
  idleRpm: 650,
  redline: 2600,
  shiftUpRpm: 2300,
  shiftDownRpm: 1100,
  frontTorqueSplit: 0,
  maxSteer: 0.62,
  steerHalfSpeed: 7,
  steerRate: 1.5,
  mu: 0.9,
  tireB: 9,
  tireC: 1.4,
  brakeForce: 78000,
  brakeBias: 0.55,
  drag: 3.1,
  rolling: 70,
  handbrakeRearGrip: 0.6,
  rearGripBias: 1.2,
  stability: 6,
  torque: [
    [650, 480],
    [1200, 720],
    [1900, 720],
    [2600, 560],
  ],
  turbo: 0.25,
  launchRpm: 1000,
  engineBrake: 9000,
  topSpeed: 19.5,
  circles: [4.35, 1.45, -1.45, -4.35],
  radius: 1.3,
  rollGain: 1.8,
};

export const FLEET: Record<PlayerVehicleId, FleetEntry> = {
  gtr: {
    id: 'gtr',
    name: 'GT-R inspired coupé',
    nameHi: 'स्पोर्ट्स कार',
    nameMr: 'स्पोर्ट्स कार',
    blurb: 'Twin-turbo AWD grand tourer. Fast, planted, and very out of place in a Dadar traffic jam.',
    params: GT_PARAMS,
    camera: GT_CAMERA,
    engine: 'v6tt',
    specs: { power: '570 PS', torque: '632 N·m', top: '315 km/h', layout: 'AWD · 6-speed' },
  },
  auto: {
    id: 'auto',
    name: 'Auto-rickshaw',
    nameHi: 'ऑटो रिक्शा',
    nameMr: 'रिक्षा',
    blurb: 'Three wheels, a CNG single and a meter. Squeezes through gaps nothing else can. Leans in corners.',
    params: AUTO_PARAMS,
    camera: { scale: 0.78, cockpit: [0, 1.43, -0.3], hood: [0, 1.55, -0.95], lookHeight: 1.1 },
    engine: 'twostroke',
    specs: { power: '11 PS', torque: '18.5 N·m', top: '65 km/h', layout: 'RWD · 4-speed' },
  },
  taxi: {
    id: 'taxi',
    name: 'Kaali-peeli taxi',
    nameHi: 'काली-पीली टैक्सी',
    nameMr: 'काळी-पिवळी टॅक्सी',
    blurb: 'The Premier Padmini that ran Mumbai for fifty years: black body, yellow roof, column shift.',
    params: TAXI_PARAMS,
    camera: { scale: 0.92, cockpit: [0.36, 1.1, 0.07], hood: [0, 1.22, -0.95], lookHeight: 1.05 },
    engine: 'inline4',
    specs: { power: '40 PS', torque: '76 N·m', top: '120 km/h', layout: 'RWD · 4-speed' },
  },
  bus: {
    id: 'bus',
    name: 'BEST bus',
    nameHi: 'बेस्ट बस',
    nameMr: 'बेस्ट बस',
    blurb: 'Eleven metres of red BEST single-decker. Wide turns, air brakes, governed to 70 km/h.',
    params: BUS_PARAMS,
    camera: { scale: 1.75, cockpit: [0.75, 2.02, -4.32], hood: [0, 3.2, -4.9], lookHeight: 2.4 },
    engine: 'diesel',
    specs: { power: '180 PS', torque: '720 N·m', top: '70 km/h', layout: 'RWD · 5-speed' },
  },
};

export const FLEET_ORDER: PlayerVehicleId[] = ['gtr', 'auto', 'taxi', 'bus'];

export function isVehicleId(v: unknown): v is PlayerVehicleId {
  return typeof v === 'string' && v in FLEET;
}
