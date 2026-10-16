/**
 * Ambient traffic that drives on the LEFT (India). Vehicles follow the road
 * graph lane by lane, pick plausible turns at junctions, curve through
 * intersections, keep their distance with the Intelligent Driver Model, stop
 * for red signals, and react to the player (braking, hazard lights after a
 * bump). Only vehicles near the player are simulated; they are recycled as the
 * player moves.
 */
import * as THREE from 'three';
import { hash01 } from '../map/geometry';
import type { RoadGraph } from '../map/RoadGraph';
import { Kind } from '../map/types';
import type { DynamicCircle } from '../physics/CollisionWorld';
import { createTrafficMaterial } from '../world/materials';
import { AMBER, RED, type SignalSystem } from './Signals';
import type { TrafficMix } from '../map/types';
import { CAR_COLORS, SHIRT_COLORS, SPECS, TRUCK_COLORS, vehicleGeometries, type VehicleKind } from './vehicleModels';

interface Vehicle {
  active: boolean;
  kind: VehicleKind;
  slot: number;
  edge: number;
  towardsB: boolean;
  /** Distance travelled along the edge in the travel direction. */
  s: number;
  speed: number;
  v0: number;
  lane: number;
  nextEdge: number;
  nextTowardsB: boolean;
  /** Junction curve progress (−1 when on an edge). */
  curve: number;
  curveLen: number;
  p0: THREE.Vector2;
  c: THREE.Vector2;
  p2: THREE.Vector2;
  x: number;
  z: number;
  y: number;
  heading: number;
  hazard: number;
  braking: boolean;
  stuck: number;
  color: THREE.Color;
  /** Visual length/width scale (hatchbacks vs SUVs). */
  scale: number;
  /** Lateral wander within the lane (bikes filter between cars). */
  jitter: number;
  /** Seconds this vehicle has been held up behind the player. */
  blocked: number;
  nextHonk: number;
}

const KIND_SPEED: Record<number, number> = {
  [Kind.Motorway]: 20,
  [Kind.Trunk]: 17,
  [Kind.Primary]: 14,
  [Kind.Secondary]: 12.5,
  [Kind.Tertiary]: 11,
  [Kind.Unclassified]: 9,
  [Kind.Residential]: 8,
  [Kind.LivingStreet]: 5,
  [Kind.Link]: 10,
};

const KINDS: VehicleKind[] = ['car', 'taxi', 'bus', 'bus1', 'auto', 'bike', 'truck'];
const CAPACITY_SHARE: Record<VehicleKind, number> = { car: 0.8, taxi: 0.55, bus: 0.14, bus1: 0.14, auto: 0.4, bike: 0.5, truck: 0.16 };
/** Traffic density presets: off, light, normal, heavy, Mumbai rush hour. */
export const DENSITY_LEVELS = [0, 40, 90, 160, 240];

export interface PlayerInfo {
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
}

export class TrafficSystem {
  readonly group = new THREE.Group();
  private vehicles: Vehicle[] = [];
  private meshes = new Map<VehicleKind, THREE.InstancedMesh>();
  private stateAttr = new Map<VehicleKind, THREE.InstancedBufferAttribute>();
  private free = new Map<VehicleKind, number[]>();
  private spawnable: number[] = [];
  private weights: number[] = [];
  private grid = new Map<number, Vehicle[]>();
  private target = 0;
  private spawnTimer = 0;
  private tmp = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
  private mix: TrafficMix;
  readonly radius = 420;
  /** Fired when a vehicle honks (blocked by the player, bumped, impatient at a jam). */
  onHonk: ((x: number, z: number, kind: VehicleKind) => void) | null = null;

  constructor(
    private readonly graph: RoadGraph,
    private readonly signals: SignalSystem,
    private readonly nodeRadius: Float32Array,
    mix: TrafficMix,
    private readonly capacity = 260,
  ) {
    this.group.name = 'traffic';
    this.mix = mix;
    const geos = vehicleGeometries();
    const mat = createTrafficMaterial();
    for (const k of KINDS) {
      const cap = Math.ceil(capacity * CAPACITY_SHARE[k]);
      const geo = geos[k].clone();
      const st = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
      st.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iState', st);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.meshes.set(k, mesh);
      this.stateAttr.set(k, st);
      this.free.set(k, Array.from({ length: cap }, (_, i) => cap - 1 - i));
      this.group.add(mesh);
    }
    graph.edges.forEach((e, ei) => {
      if (!graph.main[ei] || e.k > Kind.Residential || graph.lengths[ei] < 25) return;
      this.spawnable.push(ei);
      this.weights.push(e.k <= Kind.Primary ? 4 : e.k <= Kind.Tertiary ? 2.5 : 1);
    });
  }

  setDensity(level: number): void {
    this.target = DENSITY_LEVELS[Math.max(0, Math.min(DENSITY_LEVELS.length - 1, level))];
    this.target = Math.min(this.target, this.capacity);
  }

  get activeCount(): number {
    let n = 0;
    for (const v of this.vehicles) if (v.active) n++;
    return n;
  }

  /** Random vehicle type for a spawn at local z (auto-rickshaws only in the suburbs). */
  private pickKind(z: number): VehicleKind {
    const m = this.mix;
    const autos = m.autoNorthOfZ === undefined || z < m.autoNorthOfZ ? m.auto : 0;
    const table: [VehicleKind, number][] = [
      ['car', m.car],
      ['taxi', m.taxi],
      ['bus', m.bus],
      ['auto', autos],
      ['bike', m.bike],
      ['truck', m.truck],
    ];
    const total = table.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * total;
    for (const [k, w] of table) {
      r -= w;
      if (r <= 0) return k === 'bus' && Math.random() < 0.5 ? 'bus1' : k;
    }
    return 'car';
  }

  private laneCount(edge: number, towardsB: boolean): number {
    const e = this.graph.edges[edge];
    void towardsB;
    return e.o ? Math.max(1, e.l) : Math.max(1, Math.floor(e.l / 2));
  }

  /** Lateral offset to the LEFT of the travel direction for a lane index (0 = kerb lane). */
  private laneOffset(edge: number, lane: number): number {
    const e = this.graph.edges[edge];
    const lanes = e.o ? Math.max(1, e.l) : Math.max(1, Math.floor(e.l / 2));
    const laneW = e.o ? e.w / lanes : e.w / 2 / lanes;
    const l = Math.min(lane, lanes - 1);
    if (e.o) return e.w / 2 - laneW * (l + 0.5);
    // Two-way: kerb lane is furthest left of the centre line.
    return e.w / 2 - laneW * (l + 0.5);
  }

  private position(edge: number, towardsB: boolean, s: number, lane: number, out: { x: number; z: number; dx: number; dz: number; h: number }): void {
    const len = this.graph.lengths[edge];
    const p = this.graph.sample(edge, towardsB ? s : len - s, this.tmp);
    const dx = towardsB ? p.tx : -p.tx;
    const dz = towardsB ? p.tz : -p.tz;
    const off = this.laneOffset(edge, lane);
    out.x = p.x + dz * off;
    out.z = p.z - dx * off;
    out.dx = dx;
    out.dz = dz;
    out.h = p.h;
  }

  private chooseNext(v: Vehicle): void {
    const e = this.graph.edges[v.edge];
    const node = v.towardsB ? e.b : e.a;
    const links = this.graph.outgoing(node).filter((l) => {
      if (l.edge === v.edge) return false;
      const o = this.graph.edges[l.edge];
      return this.graph.main[l.edge] && o.k <= Kind.Residential + (o.k === Kind.Link ? 10 : 0) && this.graph.lengths[l.edge] > 8;
    });
    if (!links.length) {
      // Dead end: turn around if the road is two-way, otherwise despawn.
      if (!e.o) {
        v.nextEdge = v.edge;
        v.nextTowardsB = !v.towardsB;
      } else v.nextEdge = -1;
      return;
    }
    // Prefer continuing straight and staying on bigger roads.
    this.position(v.edge, v.towardsB, this.graph.lengths[v.edge] - 0.5, 0, this.posTmp);
    const inDx = this.posTmp.dx;
    const inDz = this.posTmp.dz;
    let total = 0;
    const w = links.map((l) => {
      this.position(l.edge, l.forward, 4, 0, this.posTmp);
      const dot = inDx * this.posTmp.dx + inDz * this.posTmp.dz;
      const o = this.graph.edges[l.edge];
      const cls = o.k <= Kind.Primary ? 3 : o.k <= Kind.Tertiary ? 2 : 1;
      const weight = cls * (dot > 0.7 ? 2.2 : dot > -0.3 ? 1 : 0.15);
      total += weight;
      return weight;
    });
    let r = Math.random() * total;
    for (let i = 0; i < links.length; i++) {
      r -= w[i];
      if (r <= 0) {
        v.nextEdge = links[i].edge;
        v.nextTowardsB = links[i].forward;
        return;
      }
    }
    v.nextEdge = links[0].edge;
    v.nextTowardsB = links[0].forward;
  }

  private posTmp = { x: 0, z: 0, dx: 0, dz: 0, h: 0 };

  private spawn(player: PlayerInfo, minD: number, maxD: number, forced?: VehicleKind, aheadOnly = false): boolean {
    if (!this.spawnable.length) return false;
    const fx = -Math.sin(player.heading);
    const fz = -Math.cos(player.heading);
    for (let attempt = 0; attempt < 14; attempt++) {
      // Random point near the player, snapped to a road.
      let ang = Math.random() * Math.PI * 2;
      if (aheadOnly) ang = Math.atan2(fz, fx) + (Math.random() - 0.5) * 1.6;
      const dist = minD + Math.random() * (maxD - minD);
      const px = player.x + Math.cos(ang) * dist;
      const pz = player.z + Math.sin(ang) * dist;
      const near = this.graph.nearest(px, pz, 60, (e, ei) => !!this.graph.main[ei] && e.k <= Kind.Residential && !e.h && this.graph.lengths[ei] > 25);
      if (!near) continue;
      const e = this.graph.edges[near.edge];
      const towardsB = e.o ? true : Math.random() < 0.5;
      const len = this.graph.lengths[near.edge];
      const s = towardsB ? near.s : len - near.s;
      if (s < 6 || s > len - 10) continue;
      const kind = forced ?? this.pickKind(near.z);
      const lanes = this.laneCount(near.edge, towardsB);
      const lane = kind === 'bus' || kind === 'bus1' || kind === 'auto' || kind === 'truck' || kind === 'bike' ? 0 : Math.floor(Math.random() * lanes);
      this.position(near.edge, towardsB, s, lane, this.posTmp);
      if (Math.hypot(this.posTmp.x - player.x, this.posTmp.z - player.z) < Math.max(8, minD * 0.8)) continue;
      // Don't spawn on top of another vehicle.
      const clearance = kind === 'bike' ? 5 : 11;
      let clash = false;
      for (const o of this.vehicles) {
        if (o.active && Math.hypot(o.x - this.posTmp.x, o.z - this.posTmp.z) < clearance) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      const slot = this.free.get(kind)!.pop();
      if (slot === undefined) return false;
      let v = this.vehicles.find((x) => !x.active);
      if (!v) {
        v = {
          active: false,
          kind,
          slot,
          edge: 0,
          towardsB: true,
          s: 0,
          speed: 0,
          v0: 10,
          lane: 0,
          nextEdge: -1,
          nextTowardsB: true,
          curve: -1,
          curveLen: 1,
          p0: new THREE.Vector2(),
          c: new THREE.Vector2(),
          p2: new THREE.Vector2(),
          x: 0,
          z: 0,
          y: 0,
          heading: 0,
          hazard: 0,
          braking: false,
          stuck: 0,
          color: new THREE.Color(),
          scale: 1,
          jitter: 0,
          blocked: 0,
          nextHonk: 0,
        };
        this.vehicles.push(v);
      }
      const seed = Math.random();
      Object.assign(v, {
        active: true,
        kind,
        slot,
        edge: near.edge,
        towardsB,
        s,
        lane,
        curve: -1,
        hazard: 0,
        stuck: 0,
        blocked: 0,
        nextHonk: 0,
        braking: false,
        x: this.posTmp.x,
        z: this.posTmp.z,
        y: this.posTmp.h,
        heading: Math.atan2(-this.posTmp.dx, -this.posTmp.dz),
      });
      const kindFactor: Record<VehicleKind, number> = { car: 1, taxi: 1.05, bus: 0.8, bus1: 0.82, auto: 0.72, bike: 1.12, truck: 0.82 };
      v.v0 = (KIND_SPEED[e.k] ?? 9) * (0.85 + seed * 0.3) * kindFactor[kind];
      v.speed = v.v0 * 0.7;
      v.scale = kind === 'car' ? 0.9 + hash01(seed * 7e5) * 0.24 : 1;
      v.jitter = kind === 'bike' ? (hash01(seed * 3e5) - 0.5) * 1.6 : kind === 'auto' ? (hash01(seed * 3e5) - 0.5) * 0.6 : 0;
      const palette = kind === 'car' ? CAR_COLORS : kind === 'bike' ? SHIRT_COLORS : kind === 'truck' ? TRUCK_COLORS : null;
      v.color.set(palette ? palette[Math.floor(hash01(seed * 1e6) * palette.length)] : '#ffffff');
      this.chooseNext(v);
      return true;
    }
    return false;
  }

  /** Spawns vehicles of a given kind close to the player (used by commands). */
  spawnNear(kind: VehicleKind, count: number, player: PlayerInfo): number {
    let n = 0;
    for (let i = 0; i < count; i++) if (this.spawn(player, 20, 90, kind, i % 2 === 0)) n++;
    return n;
  }

  private despawn(v: Vehicle): void {
    v.active = false;
    this.free.get(v.kind)!.push(v.slot);
    const mesh = this.meshes.get(v.kind)!;
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    mesh.setMatrixAt(v.slot, m);
  }

  /** Called when the player hits a vehicle. */
  bump(id: number): void {
    const v = this.vehicles[id];
    if (!v?.active) return;
    if (v.hazard <= 0) this.onHonk?.(v.x, v.z, v.kind);
    v.speed = 0;
    v.hazard = 5;
  }

  /** Kind of an active vehicle (for audio). */
  kindOf(id: number): VehicleKind | null {
    const v = this.vehicles[id];
    return v?.active ? v.kind : null;
  }

  /** Collision circles for vehicles near a point. */
  circlesNear(x: number, z: number, r: number, out: DynamicCircle[]): DynamicCircle[] {
    out.length = 0;
    this.vehicles.forEach((v, id) => {
      if (!v.active || Math.abs(v.x - x) > r || Math.abs(v.z - z) > r) return;
      const spec = SPECS[v.kind];
      const fx = -Math.sin(v.heading);
      const fz = -Math.cos(v.heading);
      const sp = v.speed;
      for (const off of spec.circles) {
        out.push({ x: v.x + fx * off, z: v.z + fz * off, r: spec.radius, id, vx: fx * sp, vz: fz * sp });
      }
    });
    return out;
  }

  points(out: [number, number][]): [number, number][] {
    out.length = 0;
    for (const v of this.vehicles) if (v.active) out.push([v.x, v.z]);
    return out;
  }

  private cellKey(x: number, z: number): number {
    return Math.floor(x / 24) * 100003 + Math.floor(z / 24);
  }

  update(dt: number, player: PlayerInfo, time: number): void {
    // Spawn / despawn to maintain density around the player.
    let active = 0;
    for (const v of this.vehicles) {
      if (!v.active) continue;
      if (Math.hypot(v.x - player.x, v.z - player.z) > this.radius + 60) this.despawn(v);
      else active++;
    }
    this.spawnTimer -= dt;
    if (active < this.target && this.spawnTimer <= 0) {
      const burst = Math.min(10, this.target - active);
      const initial = active < this.target * 0.3;
      for (let i = 0; i < burst; i++) this.spawn(player, initial ? 35 : 170, this.radius - 20);
      this.spawnTimer = 0.25;
    }

    // Spatial hash for following.
    this.grid.clear();
    for (const v of this.vehicles) {
      if (!v.active) continue;
      const k = this.cellKey(v.x, v.z);
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = []));
      l.push(v);
    }

    const pfx = -Math.sin(player.heading);
    const pfz = -Math.cos(player.heading);
    const playerSpeed = player.vx * pfx + player.vz * pfz;
    for (const v of this.vehicles) {
      if (!v.active) continue;
      const spec = SPECS[v.kind];
      const fx = -Math.sin(v.heading);
      const fz = -Math.cos(v.heading);
      const lx = fz;
      const lz = -fx;
      // ---- Gap to the vehicle ahead (other traffic or the player).
      let gap = 80;
      let leadSpeed = v.v0;
      let leadIsPlayer = false;
      // Bikes squeeze through gaps, so they only react to what is directly ahead.
      const laneHalf = v.kind === 'bike' ? 1.1 : 2.3;
      const consider = (ox: number, oz: number, oLen: number, oSpeed: number, isPlayer = false) => {
        const rx = ox - v.x;
        const rz = oz - v.z;
        const along = rx * fx + rz * fz;
        if (along <= 0 || along > 45) return;
        const lat = Math.abs(rx * lx + rz * lz);
        if (lat > laneHalf) return;
        const g = along - (spec.length + oLen) / 2;
        if (g < gap) {
          gap = g;
          leadSpeed = oSpeed;
          leadIsPlayer = isPlayer;
        }
      };
      const cx = Math.floor(v.x / 24);
      const cz = Math.floor(v.z / 24);
      for (let ix = cx - 2; ix <= cx + 2; ix++) {
        for (let iz = cz - 2; iz <= cz + 2; iz++) {
          const l = this.grid.get(ix * 100003 + iz);
          if (!l) continue;
          for (const o of l) {
            if (o === v) continue;
            const ofx = -Math.sin(o.heading);
            const ofz = -Math.cos(o.heading);
            const dot = ofx * fx + ofz * fz;
            if (dot < 0.5) {
              // Crossing or oncoming: only yield to a vehicle that is moving through
              // right in front of us. Two vehicles waiting on each other at a
              // junction would otherwise gridlock forever.
              if (o.speed < 0.6 || (o.x - v.x) * fx + (o.z - v.z) * fz > 7) continue;
            }
            consider(o.x, o.z, SPECS[o.kind].length, o.speed * dot);
          }
        }
      }
      consider(player.x, player.z, 4.7, playerSpeed * (pfx * fx + pfz * fz), true);

      // ---- Signals.
      let atRed = false;
      if (v.curve < 0) {
        const light = this.signals.state(v.edge, v.towardsB);
        const stop = this.signals.stopLine(v.edge, v.towardsB);
        if (light !== null && stop !== null && light !== 2) {
          const d = stop - v.s - spec.length / 2;
          // Run an amber light we cannot stop for.
          const canStop = d > (v.speed * v.speed) / (2 * 4) - 1;
          if (d > -1.5 && (light === RED || (light === AMBER && canStop))) {
            if (d < gap) {
              gap = Math.max(0.1, d);
              leadSpeed = 0;
              atRed = true;
            }
          }
        }
      }

      // ---- Slow for sharp turns ahead.
      let v0 = v.v0;
      const len = this.graph.lengths[v.edge];
      const remain = len - v.s;
      if (v.curve < 0 && v.nextEdge >= 0 && remain < 30) {
        this.position(v.edge, v.towardsB, len - 0.5, 0, this.posTmp);
        const ax = this.posTmp.dx;
        const az = this.posTmp.dz;
        this.position(v.nextEdge, v.nextTowardsB, 3, 0, this.posTmp);
        const dot = ax * this.posTmp.dx + az * this.posTmp.dz;
        if (dot < 0.6) v0 = Math.min(v0, dot < -0.5 ? 3 : 6.5);
      }
      if (v.curve >= 0) v0 = Math.min(v0, 7);
      if (v.hazard > 0) {
        v.hazard -= dt;
        v0 = v.hazard > 2 ? 0 : v0 * 0.5;
      }

      // ---- Intelligent Driver Model.
      const a = v.kind === 'bus' ? 1.1 : 1.9;
      const b = 3.2;
      const s0 = 2.4;
      const T = 1.25;
      const dv = v.speed - leadSpeed;
      const sStar = s0 + Math.max(0, v.speed * T + (v.speed * dv) / (2 * Math.sqrt(a * b)));
      let acc = a * (1 - Math.pow(v.speed / Math.max(0.1, v0), 4) - Math.pow(sStar / Math.max(0.1, gap), 2));
      acc = Math.max(-9, Math.min(a, acc));
      v.speed = Math.max(0, v.speed + acc * dt);
      if (gap < 0.4) v.speed = 0;
      v.braking = acc < -1.2 || (v.speed < 0.5 && (atRed || gap < 6));

      // Mumbai manners: lean on the horn when the player blocks the way, and
      // the occasional impatient honk while waiting at a red light.
      if (leadIsPlayer && gap < 12 && Math.abs(playerSpeed) < 1.2) v.blocked += dt;
      else v.blocked = Math.max(0, v.blocked - dt * 2);
      if (time > v.nextHonk) {
        const impatient = v.blocked > 1.2 || (atRed && v.speed < 0.3 && Math.random() < dt * 0.06);
        if (impatient) {
          this.onHonk?.(v.x, v.z, v.kind);
          v.nextHonk = time + 2.5 + Math.random() * 4;
        }
      }

      // Gridlock breaker.
      if (v.speed < 0.3 && !atRed && v.hazard <= 0) {
        v.stuck += dt;
        const far = Math.hypot(v.x - player.x, v.z - player.z);
        if ((v.stuck > 14 && far > 60) || (v.stuck > 30 && far > 18 && !leadIsPlayer)) {
          this.despawn(v);
          continue;
        }
      } else v.stuck = 0;

      // ---- Advance along the edge / through the junction curve.
      const step = v.speed * dt;
      if (v.curve >= 0) {
        v.curve += step / v.curveLen;
        if (v.curve >= 1) {
          v.curve = -1;
          v.edge = v.nextEdge;
          v.towardsB = v.nextTowardsB;
          v.s = Math.min(this.graph.lengths[v.edge] - 0.5, this.junctionR(v, true));
          v.lane = Math.min(v.lane, this.laneCount(v.edge, v.towardsB) - 1);
          this.chooseNext(v);
        }
      } else {
        v.s += step;
        const rEnd = this.junctionR(v, false);
        if (v.s >= len - rEnd) {
          if (v.nextEdge < 0) {
            this.despawn(v);
            continue;
          }
          // Build a quadratic Bézier through the junction.
          this.position(v.edge, v.towardsB, len - rEnd, v.lane, this.posTmp);
          v.p0.set(this.posTmp.x, this.posTmp.z);
          const d0x = this.posTmp.dx;
          const d0z = this.posTmp.dz;
          const nextLane = Math.min(v.lane, this.laneCount(v.nextEdge, v.nextTowardsB) - 1);
          const rStart = Math.min(this.graph.lengths[v.nextEdge] - 0.5, this.junctionRFor(v.nextEdge, v.nextTowardsB));
          this.position(v.nextEdge, v.nextTowardsB, rStart, nextLane, this.posTmp);
          v.p2.set(this.posTmp.x, this.posTmp.z);
          const d2x = this.posTmp.dx;
          const d2z = this.posTmp.dz;
          // Control point: intersection of the two tangent lines (fallback: midpoint).
          const den = d0x * d2z - d0z * d2x;
          if (Math.abs(den) > 0.05) {
            const t = ((v.p2.x - v.p0.x) * d2z - (v.p2.y - v.p0.y) * d2x) / den;
            const tc = Math.max(0, Math.min(25, t));
            v.c.set(v.p0.x + d0x * tc, v.p0.y + d0z * tc);
          } else v.c.set((v.p0.x + v.p2.x) / 2, (v.p0.y + v.p2.y) / 2);
          v.curveLen = Math.max(1, v.p0.distanceTo(v.c) + v.c.distanceTo(v.p2));
          v.curve = 0;
        }
      }

      // ---- Pose.
      let x: number;
      let z: number;
      let h: number;
      let dx: number;
      let dz: number;
      if (v.curve >= 0) {
        const t = v.curve;
        const u = 1 - t;
        x = u * u * v.p0.x + 2 * u * t * v.c.x + t * t * v.p2.x;
        z = u * u * v.p0.y + 2 * u * t * v.c.y + t * t * v.p2.y;
        dx = 2 * u * (v.c.x - v.p0.x) + 2 * t * (v.p2.x - v.c.x);
        dz = 2 * u * (v.c.y - v.p0.y) + 2 * t * (v.p2.y - v.c.y);
        h = v.y;
      } else {
        this.position(v.edge, v.towardsB, v.s, v.lane, this.posTmp);
        x = this.posTmp.x + this.posTmp.dz * v.jitter;
        z = this.posTmp.z - this.posTmp.dx * v.jitter;
        h = this.posTmp.h;
        dx = this.posTmp.dx;
        dz = this.posTmp.dz;
      }
      v.x = x;
      v.z = z;
      v.y += (h - v.y) * Math.min(1, dt * 8);
      if (Math.hypot(dx, dz) > 1e-4) {
        const target = Math.atan2(-dx, -dz);
        let diff = target - v.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        v.heading += diff * Math.min(1, dt * 10);
      }
    }

    // ---- Upload instance data.
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const counts = new Map<VehicleKind, number>();
    for (const v of this.vehicles) {
      if (!v.active) continue;
      const mesh = this.meshes.get(v.kind)!;
      q.setFromAxisAngle(up, v.heading);
      // Hatchbacks to SUVs: vary length, width and height a little.
      scale.set(0.94 + (v.scale - 0.9) * 0.4, 0.95 + (v.scale - 0.9) * 0.6, v.scale);
      m.compose(new THREE.Vector3(v.x, v.y + 0.02, v.z), q, scale);
      mesh.setMatrixAt(v.slot, m);
      mesh.setColorAt(v.slot, v.color);
      const st = this.stateAttr.get(v.kind)!;
      st.setXY(v.slot, v.braking ? 1 : 0, v.hazard > 0 ? 1 : 0);
      counts.set(v.kind, Math.max(counts.get(v.kind) ?? 0, v.slot + 1));
    }
    for (const [k, mesh] of this.meshes) {
      mesh.count = counts.get(k) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.stateAttr.get(k)!.needsUpdate = true;
    }
  }

  private junctionR(v: Vehicle, atStart: boolean): number {
    const e = this.graph.edges[v.edge];
    const node = atStart ? (v.towardsB ? e.a : e.b) : v.towardsB ? e.b : e.a;
    return Math.min(this.graph.lengths[v.edge] * 0.4, this.nodeRadius[node] + 2.5);
  }

  private junctionRFor(edge: number, towardsB: boolean): number {
    const e = this.graph.edges[edge];
    const node = towardsB ? e.a : e.b;
    return Math.min(this.graph.lengths[edge] * 0.4, this.nodeRadius[node] + 2.5);
  }

  clear(): void {
    for (const v of this.vehicles) if (v.active) this.despawn(v);
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
  }
}
