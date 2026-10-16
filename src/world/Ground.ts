/**
 * Ground plane (masked land/park/sand), the sea, the sea wall that follows the
 * extracted shoreline, Marine Drive's tetrapods, and low-detail "city beyond"
 * blocks outside the mapped bounds so the horizon never looks empty.
 */
import * as THREE from 'three';
import { hash01, projectOnSegment, rng } from '../map/geometry';
import { sampleMask, type LoadedMap } from '../map/MapData';
import { BuildingStyle, type BuildingData } from '../map/types';
import { buildBuildingGeometry } from './BuildingBuilder';
import { createConcreteMaterial, createGroundMaterial, createWaterMaterial } from './materials';

export interface GroundObjects {
  group: THREE.Group;
  maskTexture: THREE.DataTexture;
  dispose(): void;
}

export function buildGround(map: LoadedMap, buildingMaterial: THREE.Material, seaFaceEdges: Set<number>): GroundObjects {
  const group = new THREE.Group();
  group.name = 'ground';
  const m = map.mask;
  const tex = new THREE.DataTexture(m.rgba, m.width, m.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const b = map.manifest.bounds;
  const margin = 1600;
  const gw = b.maxX - b.minX + margin * 2;
  const gh = b.maxZ - b.minZ + margin * 2;
  const roadTex = roadRaster(map);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(gw, gh).rotateX(-Math.PI / 2),
    createGroundMaterial(tex, { minX: m.minX, minZ: m.minZ, width: m.width * m.res, height: m.height * m.res }, roadTex ?? undefined),
  );
  ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  ground.receiveShadow = true;
  ground.name = 'ground-plane';
  group.add(ground);

  const water = new THREE.Mesh(new THREE.PlaneGeometry(gw + 12000, gh + 12000).rotateX(-Math.PI / 2), createWaterMaterial());
  water.position.set(ground.position.x, -0.9, ground.position.z);
  water.name = 'sea';
  group.add(water);

  // Sea wall + parapet along the shoreline (skipped along sandy beaches).
  const wallPos: number[] = [];
  const wallNor: number[] = [];
  const wallIdx: number[] = [];
  const quad = (p: number[][], n: number[]) => {
    const base = wallPos.length / 3;
    for (const v of p) {
      wallPos.push(v[0], v[1], v[2]);
      wallNor.push(n[0], n[1], n[2]);
    }
    // Wound counter-clockwise as seen from the side the normal points to.
    wallIdx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  const tetra: THREE.Matrix4[][] = [];
  const graph = map.graph;
  const tmp = { x: 0, z: 0, t: 0, d: 0 };
  for (const line of map.network.shore) {
    let batch: THREE.Matrix4[] = [];
    for (let k = 0; k + 3 < line.length; k += 2) {
      const ax = line[k];
      const az = line[k + 1];
      const bx = line[k + 2];
      const bz = line[k + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.2) continue;
      // Land is on the left of the polyline direction.
      const lx = (bz - az) / len;
      const lz = -(bx - ax) / len;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      if (sampleMask(m, mx + lx * 4, mz + lz * 4, 2) > 0.35) continue;
      const top = 0.6;
      const inner = 0.55;
      // Outer face (towards the sea).
      quad(
        [
          [ax, -2.2, az],
          [ax, top, az],
          [bx, top, bz],
          [bx, -2.2, bz],
        ],
        [-lx, 0, -lz],
      );
      // Cap.
      quad(
        [
          [ax, top, az],
          [ax + lx * inner, top, az + lz * inner],
          [bx + lx * inner, top, bz + lz * inner],
          [bx, top, bz],
        ],
        [0, 1, 0],
      );
      // Inner face (towards the promenade).
      quad(
        [
          [ax + lx * inner, top, az + lz * inner],
          [ax + lx * inner, 0, az + lz * inner],
          [bx + lx * inner, 0, bz + lz * inner],
          [bx + lx * inner, top, bz + lz * inner],
        ],
        [lx, 0, lz],
      );
      // Tetrapods along the Marine Drive / sea-face promenades.
      let nearSea = false;
      graph.grid.queryRadius(mx, mz, 70, (id) => {
        const ei = Math.floor(id / 4096);
        if (!seaFaceEdges.has(ei)) return;
        const e = graph.edges[ei];
        const si = id % 4096;
        projectOnSegment(mx, mz, e.p[si * 2], e.p[si * 2 + 1], e.p[si * 2 + 2], e.p[si * 2 + 3], tmp);
        if (tmp.d < 70) {
          nearSea = true;
          return true;
        }
      });
      if (nearSea) {
        const r = rng(Math.floor(mx * 7 + mz * 13));
        for (let s = 0; s < len; s += 2.3) {
          for (let row = 0; row < 2; row++) {
            if (r() < 0.2) continue;
            const t = (s + r() * 1.2) / len;
            const off = 1.8 + row * 2.4 + r() * 0.9;
            const px = ax + (bx - ax) * t - lx * off;
            const pz = az + (bz - az) * t - lz * off;
            const sc = 0.85 + r() * 0.35;
            batch.push(
              new THREE.Matrix4().compose(
                new THREE.Vector3(px, -0.55 - row * 0.35 + r() * 0.25, pz),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 6, r() * 6, r() * 6)),
                new THREE.Vector3(sc, sc, sc),
              ),
            );
            if (batch.length >= 500) {
              tetra.push(batch);
              batch = [];
            }
          }
        }
      }
    }
    if (batch.length) tetra.push(batch);
  }
  if (wallIdx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(wallNor, 3));
    const uv: number[] = [];
    for (let i = 0; i < wallPos.length; i += 3) uv.push((wallPos[i] + wallPos[i + 2]) / 4, wallPos[i + 1] / 4);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(wallIdx);
    g.computeBoundingSphere();
    const wall = new THREE.Mesh(g, createConcreteMaterial(0xc9c3b6));
    wall.receiveShadow = true;
    wall.name = 'sea-wall';
    group.add(wall);
  }
  if (tetra.length) {
    const geo = tetrapodGeometry();
    const mat = createConcreteMaterial(0xa8a399);
    for (const list of tetra) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((mm, i) => mesh.setMatrixAt(i, mm));
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'tetrapods';
      group.add(mesh);
    }
  }

  // City beyond the mapped bounds: low-detail blocks wherever land meets the edge.
  const outside: BuildingData[] = [];
  const r = rng(99);
  let id = 1;
  const edges: [number, number, number, number][] = [
    [b.minX, b.minZ, b.maxX, b.minZ],
    [b.maxX, b.minZ, b.maxX, b.maxZ],
    [b.maxX, b.maxZ, b.minX, b.maxZ],
    [b.minX, b.maxZ, b.minX, b.minZ],
  ];
  for (const [x0, z0, x1, z1] of edges) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ux = (x1 - x0) / len;
    const uz = (z1 - z0) / len;
    // Outward normal of the bounds rectangle edge.
    const ox = uz;
    const oz = -ux;
    for (let s = 20; s < len; s += 34) {
      const px = x0 + ux * s;
      const pz = z0 + uz * s;
      if (sampleMask(m, px - ox * 20, pz - oz * 20, 0) < 0.6) continue;
      for (let row = 0; row < 5; row++) {
        if (r() < 0.25) continue;
        const d = 60 + row * 70 + r() * 30;
        const cx = px + ox * d + ux * (r() - 0.5) * 20;
        const cz = pz + oz * d + uz * (r() - 0.5) * 20;
        const w = 14 + r() * 18;
        const dd = 14 + r() * 18;
        const h = 12 + Math.pow(r(), 2) * 90;
        outside.push({
          id: id++,
          p: [cx - w / 2, cz - dd / 2, cx + w / 2, cz - dd / 2, cx + w / 2, cz + dd / 2, cx - w / 2, cz + dd / 2],
          h,
          m: 0,
          s: h > 50 && hash01(id) < 0.5 ? BuildingStyle.GlassTower : BuildingStyle.Concrete,
        });
      }
    }
  }
  if (outside.length) {
    const { geometry } = buildBuildingGeometry(outside, { parapets: false, tanks: false });
    const mesh = new THREE.Mesh(geometry, buildingMaterial);
    mesh.name = 'city-beyond';
    group.add(mesh);
  }

  return {
    group,
    maskTexture: tex,
    dispose() {
      tex.dispose();
      roadTex?.dispose();
      group.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (mm.isMesh) mm.geometry.dispose();
      });
    },
  };
}

/** Rasterises the road network over the land-mask extent (for the distant ground). */
function roadRaster(map: LoadedMap): THREE.CanvasTexture | null {
  const m = map.mask;
  const worldW = m.width * m.res;
  const worldH = m.height * m.res;
  const scale = Math.min(1, 2048 / Math.max(m.width, m.height));
  const W = Math.max(1, Math.round(m.width * scale));
  const H = Math.max(1, Math.round(m.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const sx = W / worldW;
  const sz = H / worldH;
  for (const e of map.network.edges) {
    if (e.h) continue;
    ctx.lineWidth = Math.max(1, e.w * sx);
    ctx.beginPath();
    for (let i = 0; i < e.p.length; i += 2) {
      const x = (e.p[i] - m.minX) * sx;
      const y = (e.p[i + 1] - m.minZ) * sz;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(canvas);
  // Canvas row 0 is min Z, matching the mask's UV convention.
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

let tetraGeo: THREE.BufferGeometry | null = null;
function tetrapodGeometry(): THREE.BufferGeometry {
  if (tetraGeo) return tetraGeo;
  const dirs = [
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0.943, -0.333, 0),
    new THREE.Vector3(-0.471, -0.333, 0.816),
    new THREE.Vector3(-0.471, -0.333, -0.816),
  ];
  const parts: THREE.BufferGeometry[] = [];
  for (const d of dirs) {
    const leg = new THREE.CylinderGeometry(0.22, 0.45, 1.2, 5, 1, true);
    leg.translate(0, 0.6, 0);
    leg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
    parts.push(leg.toNonIndexed());
  }
  const merged = new THREE.BufferGeometry();
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (const p of parts) {
    pos.push(...(p.getAttribute('position').array as Float32Array));
    nor.push(...(p.getAttribute('normal').array as Float32Array));
    uv.push(...(p.getAttribute('uv').array as Float32Array));
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  tetraGeo = merged;
  return merged;
}
