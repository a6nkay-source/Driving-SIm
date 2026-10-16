/**
 * Turns building footprints into one merged mesh per chunk (walls, parapets and
 * roofs) with the attributes the procedural window shader expects, plus
 * instanced rooftop water tanks — a fixture of nearly every Mumbai roof.
 */
import * as THREE from 'three';
import { hash01, pointInPolygon, polygonCentroid, signedArea } from '../map/geometry';
import { BuildingStyle, type BuildingData } from '../map/types';

const PALETTES: Record<number, string[]> = {
  [BuildingStyle.Concrete]: ['#d9d4c7', '#e3d6b4', '#e6d39a', '#bdbab2', '#c9b99a', '#a9c1c9', '#b8c9a3', '#d9b3ac', '#e0b48e', '#cfcbc0', '#d6cfbf', '#c2b8a8'],
  [BuildingStyle.Heritage]: ['#b59a74', '#a88f6a', '#c8ae7e', '#8f8678', '#9c6b52', '#bba27a'],
  [BuildingStyle.GlassTower]: ['#8a9099', '#6f7782', '#a2a8ad', '#7d8590'],
  [BuildingStyle.ArtDeco]: ['#efe2c4', '#e9c3b5', '#cfe0cf', '#e4c27e', '#c7d9e6', '#f0ede4', '#e8d2a6'],
  [BuildingStyle.Shed]: ['#8a6a52', '#5d7a99', '#7b7d80', '#8c8778'],
  [BuildingStyle.Religious]: ['#f2efe6', '#e8a33c', '#ece7dc', '#e9d7b0'],
};
const ROOFS = ['#8f8b84', '#7d7973', '#6f6c67', '#9a958b', '#857f74'];
const FLOOR_H: Record<number, number> = {
  [BuildingStyle.Concrete]: 3.1,
  [BuildingStyle.Heritage]: 4.4,
  [BuildingStyle.GlassTower]: 3.8,
  [BuildingStyle.ArtDeco]: 3.3,
  [BuildingStyle.Shed]: 3.0,
  [BuildingStyle.Religious]: 5.0,
};

const tmpColor = new THREE.Color();

export interface BuiltBuildings {
  geometry: THREE.BufferGeometry;
  tanks: THREE.Matrix4[];
  /** Flat [ax, az, bx, bz, …] wall segments for collision. */
  walls: number[];
  /** Aviation warning lights on tall towers: flat [x, y, z, …]. */
  beacons: number[];
}

function scaleRing(ring: number[], cx: number, cz: number, k: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < ring.length; i += 2) out.push(cx + (ring[i] - cx) * k, cz + (ring[i + 1] - cz) * k);
  return out;
}

export function buildBuildingGeometry(list: BuildingData[], opts: { parapets?: boolean; tanks?: boolean } = {}): BuiltBuildings {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const wall: number[] = [];
  const win: number[] = [];
  const topArr: number[] = [];
  const idx: number[] = [];
  const tanks: THREE.Matrix4[] = [];
  const walls: number[] = [];
  const beacons: number[] = [];
  const parapets = opts.parapets !== false;
  let curTop = 0;

  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color, u: number, v: number, w: [number, number, number, number]) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    col.push(c.r, c.g, c.b);
    wall.push(u, v);
    win.push(w[0], w[1], w[2], w[3]);
    topArr.push(curTop);
    return pos.length / 3 - 1;
  };

  /** Walls of one extruded ring between `base` and `top` (optionally with a parapet). */
  const emitWalls = (
    ring: number[],
    base: number,
    top: number,
    o: { style: number; seed: number; fh: number; wallColor: THREE.Color; roofColor: THREE.Color; front?: Set<number>; parapet?: boolean; collide?: boolean; u0: number },
  ) => {
    const n = ring.length / 2;
    const wallTop = o.parapet ? top + 0.9 : top;
    let u = o.u0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2];
      const az = ring[i * 2 + 1];
      const bx = ring[j * 2];
      const bz = ring[j * 2 + 1];
      const ex = bx - ax;
      const ez = bz - az;
      const len = Math.hypot(ex, ez);
      if (len < 0.05) continue;
      const nx = ez / len;
      const nz = -ex / len;
      if (o.collide) walls.push(ax, az, bx, bz);
      const w: [number, number, number, number] = [o.style, o.front?.has(i) ? 1 : 0, o.seed, o.fh];
      const v0 = push(ax, base, az, nx, 0, nz, o.wallColor, u, base, w);
      const v1 = push(bx, base, bz, nx, 0, nz, o.wallColor, u + len, base, w);
      const v2 = push(bx, wallTop, bz, nx, 0, nz, o.wallColor, u + len, wallTop, w);
      const v3 = push(ax, wallTop, az, nx, 0, nz, o.wallColor, u, wallTop, w);
      idx.push(v0, v2, v1, v0, v3, v2);
      if (o.parapet) {
        // Inner face of the parapet, slightly inset, plus its cap.
        const ins = 0.22;
        const roofW: [number, number, number, number] = [0, 0, o.seed, o.fh];
        const p0 = push(ax - nx * ins, top, az - nz * ins, -nx, 0, -nz, o.wallColor, u, top, roofW);
        const p1 = push(bx - nx * ins, top, bz - nz * ins, -nx, 0, -nz, o.wallColor, u + len, top, roofW);
        const p2 = push(bx - nx * ins, wallTop, bz - nz * ins, -nx, 0, -nz, o.wallColor, u + len, wallTop, roofW);
        const p3 = push(ax - nx * ins, wallTop, az - nz * ins, -nx, 0, -nz, o.wallColor, u, wallTop, roofW);
        idx.push(p0, p1, p2, p0, p2, p3);
        const c0 = push(ax, wallTop, az, 0, 1, 0, o.roofColor, ax, az, roofW);
        const c1 = push(bx, wallTop, bz, 0, 1, 0, o.roofColor, bx, bz, roofW);
        const c2 = push(bx - nx * ins, wallTop, bz - nz * ins, 0, 1, 0, o.roofColor, bx, bz, roofW);
        const c3 = push(ax - nx * ins, wallTop, az - nz * ins, 0, 1, 0, o.roofColor, ax, az, roofW);
        idx.push(c0, c2, c1, c0, c3, c2);
      }
      u += len;
    }
  };

  const emitRoof = (ring: number[], h: number, roofColor: THREE.Color, seed: number, fh: number) => {
    const n = ring.length / 2;
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(ring[i * 2], ring[i * 2 + 1]));
    let tris: number[][];
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch {
      tris = [];
    }
    const roofW: [number, number, number, number] = [0, 0, seed, fh];
    const startIndex = pos.length / 3;
    for (let i = 0; i < n; i++) push(ring[i * 2], h, ring[i * 2 + 1], 0, 1, 0, roofColor, ring[i * 2], ring[i * 2 + 1], roofW);
    for (const t of tris) {
      const a = contour[t[0]];
      const b2 = contour[t[1]];
      const c = contour[t[2]];
      // Upward-facing triangles: in x/z with +y up, CCW seen from above is negative signed area.
      const cross = (b2.x - a.x) * (c.y - a.y) - (b2.y - a.y) * (c.x - a.x);
      if (cross < 0) idx.push(startIndex + t[0], startIndex + t[1], startIndex + t[2]);
      else idx.push(startIndex + t[0], startIndex + t[2], startIndex + t[1]);
    }
  };

  const plant = new THREE.Color('#5f6266');

  for (const b of list) {
    const ring = b.p;
    const n = ring.length / 2;
    if (n < 3) continue;
    const seed = hash01(b.id);
    const palette = PALETTES[b.s] ?? PALETTES[BuildingStyle.Concrete];
    tmpColor.set(palette[Math.floor(hash01(b.id * 3 + 1) * palette.length)]);
    // Weathered, slightly dirty facades; brightness varies per building.
    tmpColor.multiplyScalar(0.7 + hash01(b.id * 5) * 0.2);
    const wallColor = tmpColor.clone();
    const roofColor = new THREE.Color(ROOFS[Math.floor(hash01(b.id * 7) * ROOFS.length)]);
    const fh = FLOOR_H[b.s] ?? 3.2;
    const style = b.s + 1;
    const front = new Set(b.f ?? []);
    const top = b.h;
    const base = b.m;
    const area = signedArea(ring);
    const tall = top > 55;
    const hasParapet = parapets && b.s !== BuildingStyle.GlassTower && b.s !== BuildingStyle.Shed && top > 6 && !tall;
    const [cx, cz] = polygonCentroid(ring);
    const u0 = hash01(b.id * 11) * 3;
    curTop = top;
    // Skyscrapers step back near the top, Mumbai-tower style.
    const tierH = top > 85 && area > 250 ? Math.round(top * 0.72) : top;
    emitWalls(ring, base, tierH, { style, seed, fh, wallColor, roofColor, front, parapet: hasParapet, collide: true, u0 });
    emitRoof(ring, tierH, roofColor, seed, fh);
    if (tierH < top) {
      const upper = scaleRing(ring, cx, cz, 0.84);
      emitWalls(upper, tierH, top, { style, seed, fh, wallColor, roofColor, u0 });
      emitRoof(upper, top, roofColor, seed, fh);
    }
    if (tall && area > 150) {
      // Mechanical penthouse / crown, and a mast on the tallest towers.
      const crownH = 4 + hash01(b.id * 31) * 4;
      const crown = scaleRing(ring, cx, cz, tierH < top ? 0.38 : 0.45);
      curTop = 0;
      emitWalls(crown, top, top + crownH, { style: BuildingStyle.Shed + 1, seed, fh: 3, wallColor: plant, roofColor, u0 });
      emitRoof(crown, top + crownH, roofColor, seed, fh);
      if (top > 140) {
        const m = 0.45;
        const mast = [cx - m, cz - m, cx + m, cz - m, cx + m, cz + m, cx - m, cz + m];
        const mastH = 12 + hash01(b.id * 37) * 14;
        emitWalls(mast, top + crownH, top + crownH + mastH, { style: BuildingStyle.Shed + 1, seed, fh: 3, wallColor: plant, roofColor: plant, u0 });
        beacons.push(cx, top + crownH + mastH + 0.4, cz);
      }
      beacons.push(crown[0], top + crownH + 0.4, crown[1], crown[4] ?? crown[0], top + crownH + 0.4, crown[5] ?? crown[1]);
    } else if (top > 45) {
      beacons.push(ring[0], top + 0.6, ring[1]);
    }

    // Rooftop water tanks (black PVC) on ordinary residential blocks.
    if (opts.tanks !== false && (b.s === BuildingStyle.Concrete || b.s === BuildingStyle.ArtDeco) && top < 45) {
      if (area > 70 && hash01(b.id * 13) < 0.6) {
        const count = area > 400 ? 2 + Math.floor(hash01(b.id * 17) * 2) : 1;
        for (let k = 0; k < count; k++) {
          const ox = cx + (hash01(b.id * 19 + k) - 0.5) * Math.sqrt(area) * 0.5;
          const oz = cz + (hash01(b.id * 23 + k) - 0.5) * Math.sqrt(area) * 0.5;
          if (!pointInPolygon(ox, oz, ring)) continue;
          const sc = 0.7 + hash01(b.id * 29 + k) * 0.5;
          tanks.push(new THREE.Matrix4().compose(new THREE.Vector3(ox, top + 0.65 * sc, oz), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc)));
        }
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 2));
  g.setAttribute('aWin', new THREE.Float32BufferAttribute(win, 4));
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(topArr, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return { geometry: g, tanks, walls, beacons };
}

let tankGeo: THREE.BufferGeometry | null = null;
let tankMat: THREE.MeshStandardMaterial | null = null;

export function tankMesh(matrices: THREE.Matrix4[]): THREE.InstancedMesh | null {
  if (!matrices.length) return null;
  tankGeo ??= new THREE.CylinderGeometry(0.75, 0.8, 1.3, 14);
  tankMat ??= new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.55, metalness: 0.1 });
  const mesh = new THREE.InstancedMesh(tankGeo, tankMat, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  return mesh;
}
