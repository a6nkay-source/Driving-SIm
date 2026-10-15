/**
 * Deterministic tree placement: mapped OSM trees, roadside avenues (Mumbai's
 * rain trees and gulmohars), park edges and coconut palms near the sea.
 */
import { hash01, pointInPolygon, projectOnSegment, rng } from '../geometry';
import { SpatialGrid } from '../SpatialGrid';
import { Kind, type BuildingData, type EdgeData } from '../types';
import { buildingClearance } from './buildings';
import { sampleMask, type LandMask } from './landmask';
import { SEG_STRIDE } from './network';

export const TREE_RAIN = 0;
export const TREE_PALM = 1;
export const TREE_GULMOHAR = 2;
export const TREE_ASHOKA = 3;

export interface ParkArea {
  ring: number[];
  /** Woodland-like areas are filled densely; maidans only get edge rows. */
  density: 'dense' | 'park' | 'edge';
}

export interface TreeInput {
  edges: EdgeData[];
  roadGrid: SpatialGrid;
  buildings: BuildingData[];
  buildingGrid: SpatialGrid;
  mask: LandMask;
  osmTrees: [number, number][];
  parks: ParkArea[];
  shore: number[][];
}

export function placeTrees(input: TreeInput): number[] {
  const { edges, roadGrid, buildings, buildingGrid, mask } = input;
  const out: number[] = [];
  const shoreGrid = new SpatialGrid(60, 4096);
  const shoreSegs: number[] = [];
  for (const line of input.shore) {
    for (let k = 0; k + 3 < line.length; k += 2) {
      const id = shoreSegs.length / 4;
      shoreSegs.push(line[k], line[k + 1], line[k + 2], line[k + 3]);
      shoreGrid.insert(
        id,
        Math.min(line[k], line[k + 2]),
        Math.min(line[k + 1], line[k + 3]),
        Math.max(line[k], line[k + 2]),
        Math.max(line[k + 1], line[k + 3]),
      );
    }
  }
  const tmp = { x: 0, z: 0, t: 0, d: 0 };
  const nearShore = (x: number, z: number, r: number) => {
    let hit = false;
    shoreGrid.queryRadius(x, z, r, (id) => {
      const s = id * 4;
      projectOnSegment(x, z, shoreSegs[s], shoreSegs[s + 1], shoreSegs[s + 2], shoreSegs[s + 3], tmp);
      if (tmp.d < r) {
        hit = true;
        return true;
      }
    });
    return hit;
  };
  const clearOfRoads = (x: number, z: number, margin: number) => {
    let ok = true;
    roadGrid.queryRadius(x, z, 14, (id) => {
      const e = edges[Math.floor(id / SEG_STRIDE)];
      const si = id % SEG_STRIDE;
      projectOnSegment(x, z, e.p[si * 2], e.p[si * 2 + 1], e.p[si * 2 + 2], e.p[si * 2 + 3], tmp);
      if (tmp.d < e.w / 2 + margin) {
        ok = false;
        return true;
      }
    });
    return ok;
  };
  const placed = new SpatialGrid(10, 1 << 15);
  const placedXZ: number[] = [];
  const farFromOthers = (x: number, z: number, r: number) => {
    let ok = true;
    placed.queryRadius(x, z, r, (id) => {
      if (Math.hypot(placedXZ[id * 2] - x, placedXZ[id * 2 + 1] - z) < r) {
        ok = false;
        return true;
      }
    });
    return ok;
  };
  const tryPlace = (x: number, z: number, type: number, spacing = 4.5) => {
    if (sampleMask(mask, mask.r, x, z) < 220) return false;
    if (sampleMask(mask, mask.b, x, z) > 120) return false;
    if (!clearOfRoads(x, z, 1.3)) return false;
    if (buildingClearance(x, z, buildings, buildingGrid, 3) < 1.8) return false;
    if (!farFromOthers(x, z, spacing)) return false;
    const id = placedXZ.length / 2;
    placedXZ.push(x, z);
    placed.insert(id, x, z, x, z);
    out.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10, type);
    return true;
  };
  const pickType = (x: number, z: number, seed: number) => {
    const r = hash01(seed);
    if (nearShore(x, z, 140)) return r < 0.65 ? TREE_PALM : r < 0.85 ? TREE_RAIN : TREE_GULMOHAR;
    return r < 0.58 ? TREE_RAIN : r < 0.8 ? TREE_GULMOHAR : r < 0.93 ? TREE_ASHOKA : TREE_PALM;
  };

  for (const [x, z] of input.osmTrees) tryPlace(x, z, TREE_RAIN, 2);

  // Roadside avenues.
  edges.forEach((e, ei) => {
    if (e.h || e.k < Kind.Secondary || e.k > Kind.LivingStreet) return;
    const rand = rng(ei * 7919 + 13);
    const off = e.w / 2 + 2.4;
    let acc = 0;
    let next = 14 + rand() * 8;
    let side = rand() < 0.5 ? 1 : -1;
    let total = 0;
    for (let i = 2; i < e.p.length; i += 2) total += Math.hypot(e.p[i] - e.p[i - 2], e.p[i + 1] - e.p[i - 1]);
    for (let i = 2; i < e.p.length; i += 2) {
      const ax = e.p[i - 2];
      const az = e.p[i - 1];
      const dx = e.p[i] - ax;
      const dz = e.p[i + 1] - az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      while (next <= acc + len) {
        const t = (next - acc) / len;
        if (next > 12 && next < total - 12 && rand() < 0.72) {
          const nx = dz / len;
          const nz = -dx / len;
          const x = ax + dx * t + nx * off * side;
          const z = az + dz * t + nz * off * side;
          tryPlace(x, z, pickType(x, z, ei * 131 + Math.floor(next)));
        }
        if (e.o === 0 || rand() < 0.5) side = -side;
        next += 13 + rand() * 9;
      }
      acc += len;
    }
  });

  // Parks and maidans.
  input.parks.forEach((park, pi) => {
    const ring = park.ring;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]);
      maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]);
      maxZ = Math.max(maxZ, ring[i + 1]);
    }
    if ((maxX - minX) * (maxZ - minZ) > 4e6) return;
    const rand = rng(pi * 104729 + 7);
    const step = 9;
    for (let x = minX + step / 2; x < maxX; x += step) {
      for (let z = minZ + step / 2; z < maxZ; z += step) {
        const jx = x + (rand() - 0.5) * step * 0.8;
        const jz = z + (rand() - 0.5) * step * 0.8;
        if (!pointInPolygon(jx, jz, ring)) continue;
        let edgeDist = Infinity;
        for (let i = 0; i < ring.length; i += 2) {
          const j = (i + 2) % ring.length;
          projectOnSegment(jx, jz, ring[i], ring[i + 1], ring[j], ring[j + 1], tmp);
          edgeDist = Math.min(edgeDist, tmp.d);
        }
        const p = edgeDist < 9 ? 0.8 : park.density === 'dense' ? 0.7 : park.density === 'park' ? 0.16 : 0;
        if (rand() < p) tryPlace(jx, jz, pickType(jx, jz, pi * 31 + Math.floor(jx * 7 + jz * 13)), 5);
      }
    }
  });

  return out;
}
