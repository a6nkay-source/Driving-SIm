/**
 * Street furniture and vegetation, all instanced: trees, street lights with
 * night-time light pools, bus shelters, regulatory signs, blue direction
 * boards with real road names and shop sign boards.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash01, hash2, pointInPolygon, rng } from '../map/geometry';
import type { RoadGraph } from '../map/RoadGraph';
import { Kind, type BuildingData } from '../map/types';
import { createFoliageMaterial, worldUniforms } from './materials';
import { directionBoardAtlas, radialTexture, regulatorySignAtlas, SHOP_ATLAS, shopSignAtlas, type SignSpec } from './textures';

// ------------------------------------------------------------------ helpers
function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, jitter = 0, seed = 1): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  const r = rng(seed);
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (r() - 0.5) * jitter;
    for (let v = 0; v < 3 && i + v < n; v++) {
      arr[(i + v) * 3] = c.r * k;
      arr[(i + v) * 3 + 1] = c.g * k;
      arr[(i + v) * 3 + 2] = c.b * k;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts, false)!;
  m.computeBoundingSphere();
  return m;
}

function blob(radius: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, seed: number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.getAttribute('position');
  const r = rng(seed);
  for (let i = 0; i < p.count; i++) {
    const k = 0.82 + r() * 0.36;
    p.setXYZ(i, p.getX(i) * sx * k, p.getY(i) * sy * k, p.getZ(i) * sz * k);
  }
  g.translate(x, y, z);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ trees
let treeGeos: THREE.BufferGeometry[] | null = null;

export function treeGeometries(): THREE.BufferGeometry[] {
  if (treeGeos) return treeGeos;
  const bark = 0x4a3a2c;
  // 0: rain tree — broad umbrella canopy.
  const rain = merge([
    paint(new THREE.CylinderGeometry(0.22, 0.38, 4.6, 7).translate(0, 2.3, 0), bark),
    paint(new THREE.CylinderGeometry(0.1, 0.18, 2.6, 5).rotateZ(0.8).translate(0.9, 4.6, 0), bark),
    paint(new THREE.CylinderGeometry(0.1, 0.18, 2.6, 5).rotateZ(-0.8).rotateY(2).translate(-0.6, 4.6, 0.5), bark),
    paint(blob(1, 4.4, 1.9, 4.2, 0, 6.6, 0, 3), 0x3f6b2a, 0.35, 3),
    paint(blob(1, 2.8, 1.5, 2.8, 2.2, 6.0, 1.2, 4, 0), 0x4d7a31, 0.35, 4),
    paint(blob(1, 2.6, 1.4, 2.6, -2.1, 6.2, -1.0, 5, 0), 0x365f25, 0.35, 5),
  ]);
  // 1: coconut palm — slender curved trunk and long arching fronds.
  const palmParts: THREE.BufferGeometry[] = [];
  let px = 0;
  for (let k = 0; k < 7; k++) {
    const seg = new THREE.CylinderGeometry(0.13 - k * 0.006, 0.16 - k * 0.006, 1.35, 6);
    seg.rotateZ(-0.04 - k * 0.022);
    seg.translate(px, 0.68 + k * 1.3, 0);
    px += 0.05 + k * 0.025;
    palmParts.push(paint(seg, k % 2 ? 0x75644c : 0x67583f));
  }
  const top = new THREE.Vector3(px, 9.3, 0);
  const frond = (len: number, width: number, droop: number, yaw: number, pitch: number, color: number, seed: number) => {
    const f = new THREE.PlaneGeometry(width, len, 1, 6);
    const p = f.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + len / 2; // 0 at the crown → len at the tip
      const t = y / len;
      // Leaflets taper to the tip; the rachis arches up then droops.
      p.setXYZ(i, p.getX(i) * (1 - t * 0.9) * (0.6 + Math.sin(t * Math.PI) * 0.8), y * (1 - t * 0.25), -t * t * droop);
    }
    f.rotateX(-pitch);
    f.rotateY(yaw);
    f.translate(top.x, top.y, top.z);
    return paint(f, color, 0.25, seed);
  };
  for (let i = 0; i < 11; i++) palmParts.push(frond(4.4, 0.75, 3.2, (i / 11) * Math.PI * 2, 0.55 + (i % 3) * 0.12, i % 2 ? 0x56782a : 0x637f2e, 20 + i));
  for (let i = 0; i < 5; i++) palmParts.push(frond(2.6, 0.5, 0.6, (i / 5) * Math.PI * 2 + 0.3, 0.15, 0x7a9438, 40 + i));
  for (let i = 0; i < 4; i++) palmParts.push(paint(new THREE.SphereGeometry(0.17, 6, 4).translate(top.x + Math.cos(i * 1.6) * 0.3, top.y - 0.35, Math.sin(i * 1.6) * 0.3), 0x6d5a24));
  const palm = merge(palmParts);
  // 2: gulmohar — flame tree with red-orange blossom.
  const gul = merge([
    paint(new THREE.CylinderGeometry(0.18, 0.3, 3.8, 7).translate(0, 1.9, 0), bark),
    paint(blob(1, 3.6, 1.6, 3.4, 0, 5.2, 0, 7), 0x4e7a2c, 0.3, 7),
    paint(blob(1, 2.2, 1.0, 2.0, 1.2, 6.0, 0.6, 8, 0), 0xd2451f, 0.3, 8),
    paint(blob(1, 1.8, 0.9, 2.0, -1.4, 5.8, -0.8, 9, 0), 0xe35a24, 0.3, 9),
    paint(blob(1, 1.5, 0.8, 1.5, 0.2, 6.4, -1.6, 10, 0), 0xc93a1b, 0.3, 10),
  ]);
  // 3: ashoka — tall, narrow, dark green.
  const ashoka = merge([
    paint(new THREE.CylinderGeometry(0.12, 0.2, 2, 6).translate(0, 1, 0), bark),
    paint(blob(1, 1.3, 5.2, 1.3, 0, 6.2, 0, 11), 0x2c4f22, 0.3, 11),
  ]);
  treeGeos = [rain, palm, gul, ashoka];
  return treeGeos;
}

let foliageMat: THREE.MeshStandardMaterial | null = null;
export function foliageMaterial(): THREE.MeshStandardMaterial {
  foliageMat ??= createFoliageMaterial();
  return foliageMat;
}

export function buildTrees(trees: number[], shadows: boolean): { meshes: THREE.InstancedMesh[]; circles: number[] } {
  const byType: number[][] = [[], [], [], []];
  for (let i = 0; i < trees.length; i += 3) byType[trees[i + 2]]?.push(trees[i], trees[i + 1]);
  const geos = treeGeometries();
  const meshes: THREE.InstancedMesh[] = [];
  const circles: number[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  byType.forEach((list, type) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geos[type], foliageMaterial(), list.length / 2);
    for (let k = 0; k < list.length; k += 2) {
      const x = list[k];
      const z = list[k + 1];
      const h = hash2(Math.round(x * 10), Math.round(z * 10));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h * Math.PI * 2);
      const sc = 0.75 + h * 0.6;
      s.set(sc, sc * (0.9 + hash01(h * 1e6) * 0.25), sc);
      p.set(x, 0, z);
      m.compose(p, q, s);
      mesh.setMatrixAt(k / 2, m);
      col.setHSL(0, 0, 0.82 + hash01(h * 7e5) * 0.3);
      mesh.setColorAt(k / 2, col);
      circles.push(x, z, type === 1 ? 0.28 : 0.4 * sc);
    }
    mesh.castShadow = shadows;
    mesh.receiveShadow = false;
    mesh.name = 'trees';
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  });
  return { meshes, circles };
}

// ------------------------------------------------------------------ street lights
let lampGeos: { pole: THREE.BufferGeometry; head: THREE.BufferGeometry; pool: THREE.BufferGeometry } | null = null;
let lampMats: { pole: THREE.MeshStandardMaterial; head: THREE.MeshStandardMaterial; pool: THREE.MeshBasicMaterial } | null = null;

export function lampMaterials() {
  lampMats ??= {
    pole: new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.55, metalness: 0.6 }),
    head: new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffb45a, emissiveIntensity: 0.2, roughness: 0.4 }),
    pool: new THREE.MeshBasicMaterial({
      map: radialTexture(),
      color: 0xffa94d,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -24,
    }),
  };
  return lampMats;
}

function lampGeometries() {
  if (lampGeos) return lampGeos;
  const pole = merge([
    paint(new THREE.CylinderGeometry(0.07, 0.11, 8.4, 8).translate(0, 4.2, 0), 0xffffff),
    paint(new THREE.BoxGeometry(0.08, 0.08, 1.9).translate(0, 8.25, 0.9), 0xffffff),
    paint(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8).translate(0, 0.25, 0), 0xffffff),
  ]);
  const head = new THREE.BoxGeometry(0.34, 0.14, 0.7).translate(0, 8.15, 1.75);
  const pool = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  lampGeos = { pole, head, pool };
  return lampGeos;
}

export interface LampPlacement {
  x: number;
  z: number;
  /** Rotation so local +Z (the arm) points over the road. */
  rot: number;
}

/** Street-light positions along roads within a chunk. */
export function placeLamps(
  graph: RoadGraph,
  edgeIds: number[],
  inChunk: (x: number, z: number) => boolean,
  nodeRadius: Float32Array,
  seaFace: Set<number>,
  blocked: (x: number, z: number) => boolean,
): LampPlacement[] {
  const out: LampPlacement[] = [];
  const p = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
  for (const ei of edgeIds) {
    const e = graph.edges[ei];
    if (e.h || e.k > Kind.Residential || e.k === Kind.Link) continue;
    const sea = seaFace.has(ei);
    const spacing = sea ? 22 : e.k <= Kind.Primary ? 30 : e.k <= Kind.Secondary ? 34 : e.k <= Kind.Tertiary ? 40 : 52;
    const len = graph.lengths[ei];
    const start = nodeRadius[e.a] + 7;
    const end = len - nodeRadius[e.b] - 7;
    let k = 0;
    for (let s = start + (hash01(ei) * spacing) / 2; s < end; s += spacing, k++) {
      graph.sample(ei, s, p);
      if (!inChunk(p.x, p.z)) continue;
      let side = e.o ? 1 : k % 2 === 0 ? 1 : -1;
      if (e.k >= Kind.Residential && !e.o) side = 1;
      const lx = p.tz;
      const lz = -p.tx;
      const off = e.w / 2 + 0.75;
      const x = p.x + lx * off * side;
      const z = p.z + lz * off * side;
      if (blocked(x, z)) continue;
      // Arm (+Z local) points back over the road: direction −side·left.
      const dx = -lx * side;
      const dz = -lz * side;
      out.push({ x, z, rot: Math.atan2(dx, dz) });
    }
  }
  return out;
}

export function buildLamps(list: LampPlacement[], shadows: boolean): { meshes: THREE.Object3D[]; circles: number[] } {
  if (!list.length) return { meshes: [], circles: [] };
  const geos = lampGeometries();
  const mats = lampMaterials();
  const poles = new THREE.InstancedMesh(geos.pole, mats.pole, list.length);
  const heads = new THREE.InstancedMesh(geos.head, mats.head, list.length);
  const pools = new THREE.InstancedMesh(geos.pool, mats.pool, list.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const circles: number[] = [];
  list.forEach((l, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.rot);
    m.compose(new THREE.Vector3(l.x, 0, l.z), q, one);
    poles.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
    const hx = l.x + Math.sin(l.rot) * 2.4;
    const hz = l.z + Math.cos(l.rot) * 2.4;
    m.compose(new THREE.Vector3(hx, 0.1, hz), q, new THREE.Vector3(15, 1, 15));
    pools.setMatrixAt(i, m);
    circles.push(l.x, l.z, 0.18);
  });
  poles.castShadow = shadows;
  pools.renderOrder = 2;
  for (const x of [poles, heads, pools]) x.computeBoundingSphere();
  return { meshes: [poles, heads, pools], circles };
}

/** Night factor drives lamp emissive and light-pool opacity. */
export function updateLampMaterials(night: number): void {
  const mats = lampMaterials();
  mats.head.emissiveIntensity = 0.15 + night * 5.5;
  mats.pool.opacity = night * 0.6;
  mats.pool.visible = night > 0.02;
}

// ------------------------------------------------------------------ shop signs
let shopGeo: THREE.BufferGeometry | null = null;
let shopMat: THREE.MeshStandardMaterial | null = null;

function shopMaterial(): THREE.MeshStandardMaterial {
  if (shopMat) return shopMat;
  const atlas = shopSignAtlas();
  const mat = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.6 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = worldUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vMapUv = (vec2(aCell.x, ${SHOP_ATLAS.rows - 1}.0 - aCell.y) + uv) / vec2(${SHOP_ATLAS.cols}.0, ${SHOP_ATLAS.rows}.0);
        vEmissiveMapUv = vMapUv;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uNight * 9.0;');
  };
  mat.customProgramCacheKey = () => 'shop-atlas';
  shopMat = mat;
  return mat;
}

export function buildShopSigns(buildings: BuildingData[], seed: number): THREE.InstancedMesh | null {
  shopGeo ??= new THREE.PlaneGeometry(3.6, 0.9);
  const mats: THREE.Matrix4[] = [];
  const cells: number[] = [];
  const total = SHOP_ATLAS.cols * SHOP_ATLAS.rows;
  for (const b of buildings) {
    if (!b.f?.length) continue;
    const ring = b.p;
    const n = ring.length / 2;
    for (const i of b.f) {
      const j = (i + 1) % n;
      const ax = ring[i * 2];
      const az = ring[i * 2 + 1];
      const bx = ring[j * 2];
      const bz = ring[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 5) continue;
      const nx = (bz - az) / len;
      const nz = -(bx - ax) / len;
      const count = Math.floor(len / 9);
      for (let k = 0; k < Math.max(1, count); k++) {
        const h = hash2(b.id + seed, i * 31 + k);
        if (h > 0.45) continue;
        const t = (k + 0.5) / Math.max(1, count);
        const x = ax + (bx - ax) * t + nx * 0.08;
        const z = az + (bz - az) * t + nz * 0.08;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x, 3.55, z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(nx, nz)),
          new THREE.Vector3(1, 1, 1),
        );
        mats.push(m);
        const c = Math.floor(hash01(h * 9973) * total);
        cells.push(c % SHOP_ATLAS.cols, Math.floor(c / SHOP_ATLAS.cols));
      }
    }
  }
  if (!mats.length) return null;
  const geo = shopGeo.clone();
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cells), 2));
  const mesh = new THREE.InstancedMesh(geo, shopMaterial(), mats.length);
  mats.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.computeBoundingSphere();
  return mesh;
}

// ------------------------------------------------------------------ bus shelters
export function buildBusStops(stops: [number, number, number][]): { mesh: THREE.InstancedMesh | null; sign: THREE.InstancedMesh | null; circles: number[] } {
  if (!stops.length) return { mesh: null, sign: null, circles: [] };
  const steel = 0x8d939a;
  const shelter = merge([
    paint(new THREE.BoxGeometry(4.2, 0.12, 1.9).translate(0, 2.7, 0.1), 0xb0b6bd),
    paint(new THREE.BoxGeometry(4.0, 1.6, 0.06).translate(0, 1.6, 0.95), 0x2f4f6f),
    paint(new THREE.BoxGeometry(0.08, 2.7, 0.08).translate(-2, 1.35, 0.9), steel),
    paint(new THREE.BoxGeometry(0.08, 2.7, 0.08).translate(2, 1.35, 0.9), steel),
    paint(new THREE.BoxGeometry(0.08, 2.7, 0.08).translate(-2, 1.35, -0.7), steel),
    paint(new THREE.BoxGeometry(0.08, 2.7, 0.08).translate(2, 1.35, -0.7), steel),
    paint(new THREE.BoxGeometry(3.2, 0.08, 0.45).translate(0, 0.5, 0.6), 0x6b6f75),
    paint(new THREE.BoxGeometry(4.2, 0.35, 0.05).translate(0, 2.55, -0.85), 0xb3201d),
  ]);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 });
  const mesh = new THREE.InstancedMesh(shelter, mat, stops.length);
  const signGeo = new THREE.PlaneGeometry(0.9, 0.9);
  setAtlasCell(signGeo, 4, 5);
  const signPole = new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6).translate(0, -1.3, -0.03);
  const sign = new THREE.InstancedMesh(mergeSign(signGeo, signPole), signMaterial(), stops.length);
  const circles: number[] = [];
  const m = new THREE.Matrix4();
  stops.forEach(([x, z, rot], i) => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    m.compose(new THREE.Vector3(x, 0.03, z), q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
    const sx = x + Math.cos(rot) * 2.6;
    const sz = z - Math.sin(rot) * 2.6;
    m.compose(new THREE.Vector3(sx, 2.7, sz), q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)), new THREE.Vector3(1, 1, 1));
    sign.setMatrixAt(i, m);
    const fx = Math.sin(rot);
    const fz = Math.cos(rot);
    // Back wall as two small circles.
    circles.push(x + fx * 0.9 + Math.cos(rot) * 1.2, z + fz * 0.9 - Math.sin(rot) * 1.2, 0.5);
    circles.push(x + fx * 0.9 - Math.cos(rot) * 1.2, z + fz * 0.9 + Math.sin(rot) * 1.2, 0.5);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  sign.computeBoundingSphere();
  return { mesh, sign, circles };
}

// ------------------------------------------------------------------ regulatory signs
let signMat: THREE.MeshStandardMaterial | null = null;
function signMaterial(): THREE.MeshStandardMaterial {
  signMat ??= new THREE.MeshStandardMaterial({ map: regulatorySignAtlas(), roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
  return signMat;
}

function setAtlasCell(g: THREE.BufferGeometry, cell: number, cells: number): void {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, (cell + uv.getX(i)) / cells);
  uv.needsUpdate = true;
}

function mergeSign(face: THREE.BufferGeometry, pole: THREE.BufferGeometry): THREE.BufferGeometry {
  const f = face.index ? face.toNonIndexed() : face;
  const p = pole.toNonIndexed();
  // Pole uses a grey corner of the atlas (bottom-left of cell 4, the blue board edge is fine at this size).
  const puv = p.getAttribute('uv');
  for (let i = 0; i < puv.count; i++) puv.setXY(i, 0.995, 0.02);
  return merge([f, p]);
}

export interface SignPlacement {
  type: number;
  x: number;
  z: number;
  rot: number;
}

/** Speed limits on arterials, STOP at minor-to-major junctions, occasional no-parking / no-horn. */
export function placeRegulatorySigns(graph: RoadGraph, signalNodes: Set<number>, nodeRadius: Float32Array): SignPlacement[] {
  const out: SignPlacement[] = [];
  const p = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
  graph.edges.forEach((e, ei) => {
    if (e.h || e.k > Kind.Residential) return;
    const len = graph.lengths[ei];
    const place = (s: number, type: number, towardsB: boolean) => {
      graph.sample(ei, s, p);
      const dirx = towardsB ? p.tx : -p.tx;
      const dirz = towardsB ? p.tz : -p.tz;
      const lx = dirz;
      const lz = -dirx;
      const off = e.w / 2 + 1.1;
      // Facing oncoming (to-be-informed) traffic on the left side.
      out.push({ type, x: p.x + lx * off, z: p.z + lz * off, rot: Math.atan2(-dirx, -dirz) });
    };
    if (e.k <= Kind.Primary && len > 160 && hash01(ei * 3) < 0.55) place(len * 0.35, 0, true);
    if (!e.o && e.k <= Kind.Primary && len > 160 && hash01(ei * 5) < 0.4) place(len * 0.65, 0, false);
    if (e.k >= Kind.Tertiary && len > 70 && hash01(ei * 7) < 0.12) place(len * 0.5, 1, hash01(ei) < 0.5);
    if (len > 90 && hash01(ei * 11) < 0.05) place(len * 0.4, 3, true);
    // STOP where a residential street meets an arterial without signals.
    if (e.k >= Kind.Residential) {
      for (const [node, atEnd] of [
        [e.b, true],
        [e.a, false],
      ] as [number, boolean][]) {
        if (signalNodes.has(node) || (e.o && !atEnd)) continue;
        const major = graph.incident[node].some((o) => o !== ei && graph.edges[o].k <= Kind.Secondary);
        if (!major || len < nodeRadius[node] + 12) continue;
        const s = atEnd ? len - nodeRadius[node] - 4 : nodeRadius[node] + 4;
        place(s, 2, atEnd);
      }
    }
  });
  return out;
}

export function buildRegulatorySigns(list: SignPlacement[]): THREE.InstancedMesh[] {
  const byType = new Map<number, SignPlacement[]>();
  for (const s of list) {
    if (!byType.has(s.type)) byType.set(s.type, []);
    byType.get(s.type)!.push(s);
  }
  const meshes: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4();
  for (const [type, items] of byType) {
    const face = new THREE.PlaneGeometry(0.75, 0.75);
    setAtlasCell(face, type, 5);
    face.translate(0, 2.35, 0);
    const pole = new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6).translate(0, 1.15, -0.03);
    const geo = mergeSign(face, pole);
    const mesh = new THREE.InstancedMesh(geo, signMaterial(), items.length);
    items.forEach((s, i) => {
      m.compose(new THREE.Vector3(s.x, 0, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot), new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
    });
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  }
  return meshes;
}

// ------------------------------------------------------------------ direction boards
/** Blue gantry boards at signalised junctions, listing the real roads ahead / left / right. */
export function buildDirectionBoards(graph: RoadGraph, clusters: number[][], nodeRadius: Float32Array, max = 32): THREE.Mesh | null {
  const specs: SignSpec[] = [];
  const placements: { x: number; z: number; rot: number }[] = [];
  const p = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
  const scored = clusters
    .map((c) => ({ c, names: new Set(c.flatMap((n) => graph.incident[n].map((e) => graph.name(e)).filter(Boolean))) }))
    .filter((x) => x.names.size >= 2)
    .sort((a, b) => b.names.size - a.names.size)
    .slice(0, max);
  for (const { c } of scored) {
    const set = new Set(c);
    // Approach: the longest major edge entering the cluster.
    let best = -1;
    let bestLen = 0;
    let towardsB = true;
    for (const n of c) {
      for (const ei of graph.incident[n]) {
        const e = graph.edges[ei];
        if (e.h || e.k > Kind.Secondary) continue;
        const into = e.b === n && !set.has(e.a) ? true : e.a === n && !set.has(e.b) && !e.o ? false : null;
        if (into === null) continue;
        if (graph.lengths[ei] > bestLen) {
          bestLen = graph.lengths[ei];
          best = ei;
          towardsB = into;
        }
      }
    }
    if (best < 0 || bestLen < 60) continue;
    const e = graph.edges[best];
    const node = towardsB ? e.b : e.a;
    const s = towardsB ? graph.lengths[best] - nodeRadius[node] - 32 : nodeRadius[node] + 32;
    graph.sample(best, s, p);
    const dx = towardsB ? p.tx : -p.tx;
    const dz = towardsB ? p.tz : -p.tz;
    // Classify outgoing roads from the cluster by turn angle.
    const lines: SignSpec['lines'] = [];
    const used = new Set<string>();
    const approachName = graph.name(best);
    for (const n of c) {
      for (const ei of graph.incident[n]) {
        if (ei === best) continue;
        const name = graph.name(ei);
        if (!name || used.has(name) || name === approachName) continue;
        const o = graph.edges[ei];
        const out = o.a === n ? 1 : -1;
        if (o.o && out < 0) continue;
        graph.sample(ei, out > 0 ? Math.min(25, graph.lengths[ei]) : Math.max(0, graph.lengths[ei] - 25), p);
        const vx = p.x - graph.nodeX(n);
        const vz = p.z - graph.nodeZ(n);
        const cross = dx * vz - dz * vx;
        const dot = dx * vx + dz * vz;
        const ang = Math.atan2(cross, dot);
        const arrow: '↑' | '←' | '→' = Math.abs(ang) < 0.6 ? '↑' : ang < 0 ? '←' : '→';
        used.add(name);
        lines.push({ arrow, en: name, mr: graph.nameMr(ei) });
      }
    }
    if (approachName && !used.has(approachName)) lines.unshift({ arrow: '↑', en: approachName, mr: graph.nameMr(best) });
    if (lines.length < 2) continue;
    lines.sort((a, b) => '←↑→'.indexOf(a.arrow) - '←↑→'.indexOf(b.arrow));
    specs.push({ lines: lines.slice(0, 3) });
    const lx = dz;
    const lz = -dx;
    const off = e.w / 2 + 1.4;
    placements.push({ x: p.x + lx * off, z: p.z + lz * off, rot: Math.atan2(-dx, -dz) });
  }
  if (!specs.length) return null;
  const atlas = directionBoardAtlas(specs);
  const { cols, rows } = atlas.userData as { cols: number; rows: number };
  const parts: THREE.BufferGeometry[] = [];
  placements.forEach((pl, i) => {
    const face = new THREE.PlaneGeometry(3.4, 1.7);
    const uv = face.getAttribute('uv');
    const cx = i % cols;
    const cy = rows - 1 - Math.floor(i / cols);
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (cx + uv.getX(k)) / cols, (cy + uv.getY(k)) / rows);
    face.translate(0, 4.6, 0);
    const back = new THREE.PlaneGeometry(3.4, 1.7).rotateY(Math.PI).translate(0, 4.6, -0.02);
    const buv = back.getAttribute('uv');
    for (let k = 0; k < buv.count; k++) buv.setXY(k, 0.001, 0.001);
    const pole1 = new THREE.CylinderGeometry(0.07, 0.07, 5.5, 6).translate(-1.4, 2.75, -0.06);
    const pole2 = new THREE.CylinderGeometry(0.07, 0.07, 5.5, 6).translate(1.4, 2.75, -0.06);
    for (const g of [pole1, pole2]) {
      const guv = g.getAttribute('uv');
      for (let k = 0; k < guv.count; k++) guv.setXY(k, 0.001, 0.001);
    }
    const m = new THREE.Matrix4().compose(new THREE.Vector3(pl.x, 0, pl.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pl.rot), new THREE.Vector3(1, 1, 1));
    for (const g of [face, back, pole1, pole2]) {
      const ng = g.index ? g.toNonIndexed() : g;
      ng.applyMatrix4(m);
      parts.push(ng);
    }
  });
  const geo = mergeGeometries(parts, false)!;
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.45, metalness: 0.1 }));
  mesh.name = 'direction-boards';
  return mesh;
}

/** True if (x, z) falls inside any footprint in the list (used to keep props off buildings). */
export function insideAny(buildings: BuildingData[], x: number, z: number): boolean {
  for (const b of buildings) if (pointInPolygon(x, z, b.p)) return true;
  return false;
}
