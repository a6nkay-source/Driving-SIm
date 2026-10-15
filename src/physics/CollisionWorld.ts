/**
 * 2D collision for the player car against the streamed city: building walls
 * (segments), poles / trunks / pillars (circles), the sea wall (land-mask
 * iso-line), map bounds and traffic vehicles. The car is approximated by three
 * circles along its length; contacts are resolved with rigid-body impulses so
 * glancing hits slide and off-centre hits spin the car.
 */
import { pointInPolygon } from '../map/geometry';
import { sampleMask, type RuntimeMask } from '../map/MapData';
import { SpatialGrid } from '../map/SpatialGrid';
import { setWorldVelocity, worldVelocity, type VehicleParams, type VehicleState } from '../vehicle/VehiclePhysics';

export interface Contact {
  /** Impact speed into the surface (m/s). */
  impact: number;
  nx: number;
  nz: number;
  kind: 'wall' | 'pole' | 'water' | 'bounds' | 'vehicle';
  /** Index of the traffic vehicle that was hit, if any. */
  vehicle?: number;
}

export interface DynamicCircle {
  x: number;
  z: number;
  r: number;
  id: number;
  vx: number;
  vz: number;
}

/** Car circles: forward offsets from the centre of mass and a shared radius. */
export const CAR_CIRCLES = [1.38, 0, -1.5];
export const CAR_RADIUS = 0.92;

interface Group {
  segs: number[];
  circles: number[];
  polys: number[];
}

export class CollisionWorld {
  private segs: number[] = [];
  private freeSegs: number[] = [];
  private segGrid = new SpatialGrid(16, 1 << 16);
  private circles: number[] = [];
  private freeCircles: number[] = [];
  private circleGrid = new SpatialGrid(16, 1 << 14);
  private polys: (number[] | null)[] = [];
  private freePolys: number[] = [];
  private polyGrid = new SpatialGrid(32, 1 << 14);
  private groups = new Map<string, Group>();
  private lastSafe = { x: 0, z: 0, heading: 0, t: 0 };

  constructor(
    private readonly mask: RuntimeMask | null,
    private readonly bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  ) {}

  addGroup(key: string, segments: ArrayLike<number>, circles: ArrayLike<number>, polygons: number[][] = []): void {
    this.removeGroup(key);
    const g: Group = { segs: [], circles: [], polys: [] };
    for (let i = 0; i + 3 < segments.length; i += 4) {
      const id = this.freeSegs.pop() ?? this.segs.length / 4;
      const ax = segments[i];
      const az = segments[i + 1];
      const bx = segments[i + 2];
      const bz = segments[i + 3];
      this.segs[id * 4] = ax;
      this.segs[id * 4 + 1] = az;
      this.segs[id * 4 + 2] = bx;
      this.segs[id * 4 + 3] = bz;
      this.segGrid.insert(id, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
      g.segs.push(id);
    }
    for (let i = 0; i + 2 < circles.length; i += 3) {
      const id = this.freeCircles.pop() ?? this.circles.length / 3;
      const x = circles[i];
      const z = circles[i + 1];
      const r = circles[i + 2];
      this.circles[id * 3] = x;
      this.circles[id * 3 + 1] = z;
      this.circles[id * 3 + 2] = r;
      this.circleGrid.insert(id, x - r, z - r, x + r, z + r);
      g.circles.push(id);
    }
    for (const ring of polygons) {
      const id = this.freePolys.pop() ?? this.polys.length;
      this.polys[id] = ring;
      const [minX, minZ, maxX, maxZ] = bbox(ring);
      this.polyGrid.insert(id, minX, minZ, maxX, maxZ);
      g.polys.push(id);
    }
    this.groups.set(key, g);
  }

  removeGroup(key: string): void {
    const g = this.groups.get(key);
    if (!g) return;
    for (const id of g.segs) {
      const ax = this.segs[id * 4];
      const az = this.segs[id * 4 + 1];
      const bx = this.segs[id * 4 + 2];
      const bz = this.segs[id * 4 + 3];
      this.segGrid.remove(id, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
      this.freeSegs.push(id);
    }
    for (const id of g.circles) {
      const x = this.circles[id * 3];
      const z = this.circles[id * 3 + 1];
      const r = this.circles[id * 3 + 2];
      this.circleGrid.remove(id, x - r, z - r, x + r, z + r);
      this.freeCircles.push(id);
    }
    for (const id of g.polys) {
      const ring = this.polys[id]!;
      const [minX, minZ, maxX, maxZ] = bbox(ring);
      this.polyGrid.remove(id, minX, minZ, maxX, maxZ);
      this.polys[id] = null;
      this.freePolys.push(id);
    }
    this.groups.delete(key);
  }

  get segmentCount(): number {
    return this.segs.length / 4 - this.freeSegs.length;
  }

  /** True when the point lies inside a loaded building footprint. */
  insideBuilding(x: number, z: number): boolean {
    let inside = false;
    this.polyGrid.query(x, z, x, z, (id) => {
      const ring = this.polys[id];
      if (ring && pointInPolygon(x, z, ring)) {
        inside = true;
        return true;
      }
    });
    return inside;
  }

  /** Land value 0..1 (1 = land) — 1 when no mask is available. */
  land(x: number, z: number): number {
    return this.mask ? sampleMask(this.mask, x, z, 0) : 1;
  }

  /**
   * Resolves the car against static geometry and traffic. Returns the strongest
   * contact this step (or null). `elevated` skips ground-level obstacles.
   */
  resolveVehicle(s: VehicleState, p: VehicleParams, elevated: boolean, dynamic: DynamicCircle[], time: number): Contact | null {
    let strongest: Contact | null = null;
    const record = (c: Contact) => {
      if (!strongest || c.impact > strongest.impact) strongest = c;
    };
    const fx = -Math.sin(s.heading);
    const fz = -Math.cos(s.heading);
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (const off of CAR_CIRCLES) {
        const cx = s.x + fx * off;
        const cz = s.z + fz * off;
        const r = CAR_RADIUS;
        let best: { nx: number; nz: number; pen: number; px: number; pz: number; kind: Contact['kind']; vehicle?: number; ovx?: number; ovz?: number } | null = null;
        const consider = (nx: number, nz: number, pen: number, px: number, pz: number, kind: Contact['kind'], vehicle?: number, ovx = 0, ovz = 0) => {
          if (pen > 0 && (!best || pen > best.pen)) best = { nx, nz, pen, px, pz, kind, vehicle, ovx, ovz };
        };
        if (!elevated) {
          this.segGrid.queryRadius(cx, cz, r, (id) => {
            const ax = this.segs[id * 4];
            const az = this.segs[id * 4 + 1];
            const bx = this.segs[id * 4 + 2];
            const bz = this.segs[id * 4 + 3];
            const dx = bx - ax;
            const dz = bz - az;
            const len2 = dx * dx + dz * dz;
            let t = len2 > 1e-9 ? ((cx - ax) * dx + (cz - az) * dz) / len2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = ax + dx * t;
            const qz = az + dz * t;
            let nx = cx - qx;
            let nz = cz - qz;
            const d = Math.hypot(nx, nz);
            if (d >= r) return;
            if (d < 1e-6) {
              // Exactly on the wall: use the wall's outward normal.
              const l = Math.sqrt(len2) || 1;
              nx = dz / l;
              nz = -dx / l;
            } else {
              nx /= d;
              nz /= d;
            }
            consider(nx, nz, r - d, qx, qz, 'wall');
          });
          this.circleGrid.queryRadius(cx, cz, r + 1.5, (id) => {
            const ox = this.circles[id * 3];
            const oz = this.circles[id * 3 + 1];
            const or = this.circles[id * 3 + 2];
            const d = Math.hypot(cx - ox, cz - oz);
            if (d >= r + or || d < 1e-6) return;
            const nx = (cx - ox) / d;
            const nz = (cz - oz) / d;
            consider(nx, nz, r + or - d, ox + nx * or, oz + nz * or, 'pole');
          });
          // Sea wall from the land mask.
          if (this.mask) {
            const L = this.land(cx, cz);
            if (L < 0.62) {
              const e = 1.5;
              const gx = (this.land(cx + e, cz) - this.land(cx - e, cz)) / (2 * e);
              const gz = (this.land(cx, cz + e) - this.land(cx, cz - e)) / (2 * e);
              const gl = Math.hypot(gx, gz);
              if (gl > 1e-4) {
                const nx = gx / gl;
                const nz = gz / gl;
                const pen = Math.min(3, (0.62 - L) / gl);
                consider(nx, nz, pen, cx - nx * r, cz - nz * r, 'water');
              }
            }
          }
        }
        for (const d of dynamic) {
          const dist = Math.hypot(cx - d.x, cz - d.z);
          if (dist >= r + d.r || dist < 1e-6) continue;
          const nx = (cx - d.x) / dist;
          const nz = (cz - d.z) / dist;
          consider(nx, nz, r + d.r - dist, d.x + nx * d.r, d.z + nz * d.r, 'vehicle', d.id, d.vx, d.vz);
        }
        // Map bounds.
        const b = this.bounds;
        const m = 4;
        if (cx < b.minX + m) consider(1, 0, b.minX + m - cx, b.minX, cz, 'bounds');
        if (cx > b.maxX - m) consider(-1, 0, cx - (b.maxX - m), b.maxX, cz, 'bounds');
        if (cz < b.minZ + m) consider(0, 1, b.minZ + m - cz, cx, b.minZ, 'bounds');
        if (cz > b.maxZ - m) consider(0, -1, cz - (b.maxZ - m), cx, b.maxZ, 'bounds');

        if (best) {
          any = true;
          const c = best as { nx: number; nz: number; pen: number; px: number; pz: number; kind: Contact['kind']; vehicle?: number; ovx: number; ovz: number };
          s.x += c.nx * c.pen;
          s.z += c.nz * c.pen;
          // Impulse at the contact point.
          const rx = c.px - s.x;
          const rz = c.pz - s.z;
          const [vx, vz] = worldVelocity(s);
          const w = s.yawRate;
          // Velocity of the contact point: v + ω × r (ω about +Y).
          const pvx = vx + w * rz - c.ovx;
          const pvz = vz - w * rx - c.ovz;
          const vn = pvx * c.nx + pvz * c.nz;
          if (vn < 0) {
            const restitution = c.kind === 'water' || c.kind === 'bounds' ? 0.05 : c.kind === 'vehicle' ? 0.25 : 0.18;
            const rn = rz * c.nx - rx * c.nz;
            const invMass = 1 / p.mass;
            const j = (-(1 + restitution) * vn) / (invMass + (rn * rn) / p.inertia);
            let nvx = vx + j * c.nx * invMass;
            let nvz = vz + j * c.nz * invMass;
            let nw = w + (j * rn) / p.inertia;
            // Friction along the surface.
            const tx = -c.nz;
            const tz = c.nx;
            const vt = pvx * tx + pvz * tz;
            const rt = rz * tx - rx * tz;
            let jt = -vt / (invMass + (rt * rt) / p.inertia);
            const mu = c.kind === 'wall' ? 0.22 : 0.35;
            jt = Math.max(-mu * j, Math.min(mu * j, jt));
            nvx += jt * tx * invMass;
            nvz += jt * tz * invMass;
            nw += (jt * rt) / p.inertia;
            setWorldVelocity(s, nvx, nvz);
            s.yawRate = Math.max(-3, Math.min(3, nw));
            if (iter === 0) record({ impact: -vn, nx: c.nx, nz: c.nz, kind: c.kind, vehicle: c.vehicle });
          }
        }
      }
      if (!any) break;
    }
    // Last-resort safety: never let the car end up inside a building footprint.
    if (!elevated && this.insideBuilding(s.x, s.z)) {
      s.x = this.lastSafe.x;
      s.z = this.lastSafe.z;
      s.vx *= -0.2;
      s.vy = 0;
      s.yawRate = 0;
    } else if (time - this.lastSafe.t > 0.25) {
      this.lastSafe = { x: s.x, z: s.z, heading: s.heading, t: time };
    }
    return strongest;
  }

  setSafePoint(x: number, z: number, heading: number, time: number): void {
    this.lastSafe = { x, z, heading, t: time };
  }

  /** Fraction (0..1) along a→b of the first wall hit, or 1 if clear. Used by the camera. */
  raycast(ax: number, az: number, bx: number, bz: number): number {
    let best = 1;
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    const minZ = Math.min(az, bz);
    const maxZ = Math.max(az, bz);
    const rx = bx - ax;
    const rz = bz - az;
    this.segGrid.query(minX, minZ, maxX, maxZ, (id) => {
      const cx = this.segs[id * 4];
      const cz = this.segs[id * 4 + 1];
      const sx = this.segs[id * 4 + 2] - cx;
      const sz = this.segs[id * 4 + 3] - cz;
      const den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-9) return;
      const t = ((cx - ax) * sz - (cz - az) * sx) / den;
      const u = ((cx - ax) * rz - (cz - az) * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < best) best = t;
    });
    return best;
  }

  clear(): void {
    for (const k of [...this.groups.keys()]) this.removeGroup(k);
  }
}

function bbox(ring: number[]): [number, number, number, number] {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    if (ring[i] < minX) minX = ring[i];
    if (ring[i] > maxX) maxX = ring[i];
    if (ring[i + 1] < minZ) minZ = ring[i + 1];
    if (ring[i + 1] > maxZ) maxZ = ring[i + 1];
  }
  return [minX, minZ, maxX, maxZ];
}
