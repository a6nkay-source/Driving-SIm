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
}

export function buildBuildingGeometry(list: BuildingData[], opts: { parapets?: boolean; tanks?: boolean } = {}): BuiltBuildings {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const wall: number[] = [];
  const win: number[] = [];
  const idx: number[] = [];
  const tanks: THREE.Matrix4[] = [];
  const walls: number[] = [];
  const parapets = opts.parapets !== false;

  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color, u: number, v: number, w: [number, number, number, number]) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    col.push(c.r, c.g, c.b);
    wall.push(u, v);
    win.push(w[0], w[1], w[2], w[3]);
    return pos.length / 3 - 1;
  };

  for (const b of list) {
    const ring = b.p;
    const n = ring.length / 2;
    if (n < 3) continue;
    const seed = hash01(b.id);
    const palette = PALETTES[b.s] ?? PALETTES[BuildingStyle.Concrete];
    tmpColor.set(palette[Math.floor(hash01(b.id * 3 + 1) * palette.length)]);
    // Slight per-building brightness variation.
    // Weathered, slightly dirty facades; brightness varies per building.
    tmpColor.multiplyScalar(0.7 + hash01(b.id * 5) * 0.2);
    const wallColor = tmpColor.clone();
    const roofColor = new THREE.Color(ROOFS[Math.floor(hash01(b.id * 7) * ROOFS.length)]);
    const fh = FLOOR_H[b.s] ?? 3.2;
    const style = b.s + 1;
    const front = new Set(b.f ?? []);
    const top = b.h;
    const base = b.m;
    const hasParapet = parapets && b.s !== BuildingStyle.GlassTower && b.s !== BuildingStyle.Shed && top > 6;
    const wallTop = hasParapet ? top + 0.9 : top;
    let u = hash01(b.id * 11) * 3;
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
      walls.push(ax, az, bx, bz);
      const w: [number, number, number, number] = [style, front.has(i) ? 1 : 0, seed, fh];
      const v0 = push(ax, base, az, nx, 0, nz, wallColor, u, base, w);
      const v1 = push(bx, base, bz, nx, 0, nz, wallColor, u + len, base, w);
      const v2 = push(bx, wallTop, bz, nx, 0, nz, wallColor, u + len, wallTop, w);
      const v3 = push(ax, wallTop, az, nx, 0, nz, wallColor, u, wallTop, w);
      idx.push(v0, v2, v1, v0, v3, v2);
      if (hasParapet) {
        // Inner face of the parapet, slightly inset.
        const ins = 0.22;
        const roofW: [number, number, number, number] = [0, 0, seed, fh];
        const p0 = push(ax - nx * ins, top, az - nz * ins, -nx, 0, -nz, wallColor, u, top, roofW);
        const p1 = push(bx - nx * ins, top, bz - nz * ins, -nx, 0, -nz, wallColor, u + len, top, roofW);
        const p2 = push(bx - nx * ins, wallTop, bz - nz * ins, -nx, 0, -nz, wallColor, u + len, wallTop, roofW);
        const p3 = push(ax - nx * ins, wallTop, az - nz * ins, -nx, 0, -nz, wallColor, u, wallTop, roofW);
        idx.push(p0, p1, p2, p0, p2, p3);
        // Parapet cap.
        const c0 = push(ax, wallTop, az, 0, 1, 0, roofColor, ax, az, roofW);
        const c1 = push(bx, wallTop, bz, 0, 1, 0, roofColor, bx, bz, roofW);
        const c2 = push(bx - nx * ins, wallTop, bz - nz * ins, 0, 1, 0, roofColor, bx, bz, roofW);
        const c3 = push(ax - nx * ins, wallTop, az - nz * ins, 0, 1, 0, roofColor, ax, az, roofW);
        idx.push(c0, c2, c1, c0, c3, c2);
      }
      u += len;
    }
    // Roof.
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
    for (let i = 0; i < n; i++) push(ring[i * 2], top, ring[i * 2 + 1], 0, 1, 0, roofColor, ring[i * 2], ring[i * 2 + 1], roofW);
    for (const t of tris) {
      const a = contour[t[0]];
      const b2 = contour[t[1]];
      const c = contour[t[2]];
      // Ensure upward-facing triangles: in x/z with +y up, CCW seen from above is negative signed area.
      const cross = (b2.x - a.x) * (c.y - a.y) - (b2.y - a.y) * (c.x - a.x);
      if (cross < 0) idx.push(startIndex + t[0], startIndex + t[1], startIndex + t[2]);
      else idx.push(startIndex + t[0], startIndex + t[2], startIndex + t[1]);
    }

    // Rooftop water tanks (black PVC) on ordinary residential blocks.
    if (opts.tanks !== false && (b.s === BuildingStyle.Concrete || b.s === BuildingStyle.ArtDeco) && top < 45) {
      const area = signedArea(ring);
      if (area > 70 && hash01(b.id * 13) < 0.6) {
        const [cx, cz] = polygonCentroid(ring);
        const count = area > 400 ? 2 + Math.floor(hash01(b.id * 17) * 2) : 1;
        for (let k = 0; k < count; k++) {
          const ox = cx + (hash01(b.id * 19 + k) - 0.5) * Math.sqrt(area) * 0.5;
          const oz = cz + (hash01(b.id * 23 + k) - 0.5) * Math.sqrt(area) * 0.5;
          if (!pointInPolygon(ox, oz, ring)) continue;
          const s = 0.7 + hash01(b.id * 29 + k) * 0.5;
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(ox, top + (hasParapet ? 0 : 0) + 0.65 * s, oz),
            new THREE.Quaternion(),
            new THREE.Vector3(s, s, s),
          );
          tanks.push(m);
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
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return { geometry: g, tanks, walls };
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
