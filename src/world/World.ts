/**
 * Streams the city in 400 m tiles around the car: fetches chunk JSON, builds
 * roads, buildings, shop signs, trees and street lights, registers collision,
 * and unloads tiles that fall out of range. Building work is spread across
 * frames with a time budget so driving stays smooth.
 */
import * as THREE from 'three';
import { pointInPolygon } from '../map/geometry';
import { sampleMask, type LoadedMap } from '../map/MapData';
import type { ChunkData } from '../map/types';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { buildBuildingGeometry, tankMesh } from './BuildingBuilder';
import { createBuildingMaterial, createConcreteMaterial, createMarkingMaterial, createRoadMaterial, createSidewalkMaterial } from './materials';
import { buildLamps, buildShopSigns, buildTrees, placeLamps } from './Props';
import { buildRoadChunk, indexEdgesByChunk, makeRoadContext, type RoadContext } from './RoadBuilder';

interface ChunkState {
  key: string;
  group: THREE.Group;
  /** Small, numerous objects culled with distance (trees, lamps, shop signs, tanks). */
  props: THREE.Object3D[];
  propsVisible: boolean;
}

export interface WorldMaterials {
  building: THREE.MeshStandardMaterial;
  road: THREE.MeshStandardMaterial;
  sidewalk: THREE.MeshStandardMaterial;
  marking: THREE.MeshStandardMaterial;
  deck: THREE.MeshStandardMaterial;
  pillar: THREE.MeshStandardMaterial;
}

let pillarGeo: THREE.BufferGeometry | null = null;

export class World {
  readonly group = new THREE.Group();
  readonly materials: WorldMaterials;
  readonly roadCtx: RoadContext;
  private chunks = new Map<string, ChunkState>();
  private requested = new Set<string>();
  private ready: { key: string; cx: number; cz: number; data: ChunkData | null }[] = [];
  private edgeIndex: Map<string, number[]>;
  private cols: number;
  private rows: number;
  private shadows: boolean;
  private viewDistance: number;
  private disposed = false;
  builtCount = 0;

  constructor(
    private readonly map: LoadedMap,
    private readonly collision: CollisionWorld,
    private readonly seaFace: Set<number>,
    opts: { shadows: boolean; viewDistance: number },
  ) {
    this.group.name = 'world-chunks';
    this.shadows = opts.shadows;
    this.viewDistance = opts.viewDistance;
    const m = map.manifest;
    this.cols = Math.ceil((m.bounds.maxX - m.bounds.minX) / m.chunkSize);
    this.rows = Math.ceil((m.bounds.maxZ - m.bounds.minZ) / m.chunkSize);
    this.roadCtx = makeRoadContext(map.graph, m.chunkSize, m.bounds.minX, m.bounds.minZ, map.network.signals, map.network.crossings);
    this.edgeIndex = indexEdgesByChunk(this.roadCtx);
    this.materials = {
      building: createBuildingMaterial(),
      road: createRoadMaterial(),
      sidewalk: createSidewalkMaterial(),
      marking: createMarkingMaterial(),
      deck: createConcreteMaterial(0xb7b2a8),
      pillar: createConcreteMaterial(0xa9a49a),
    };
  }

  setShadows(on: boolean): void {
    this.shadows = on;
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.casts) mesh.castShadow = on;
    });
  }

  setViewDistance(d: number): void {
    this.viewDistance = d;
  }

  private wanted(x: number, z: number, radius: number): { key: string; cx: number; cz: number; d: number }[] {
    const m = this.map.manifest;
    const size = m.chunkSize;
    const out: { key: string; cx: number; cz: number; d: number }[] = [];
    const r = Math.ceil(radius / size) + 1;
    const ccx = Math.floor((x - m.bounds.minX) / size);
    const ccz = Math.floor((z - m.bounds.minZ) / size);
    for (let cx = ccx - r; cx <= ccx + r; cx++) {
      for (let cz = ccz - r; cz <= ccz + r; cz++) {
        if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) continue;
        // Distance from the focus to the chunk rectangle.
        const x0 = m.bounds.minX + cx * size;
        const z0 = m.bounds.minZ + cz * size;
        const dx = Math.max(x0 - x, 0, x - (x0 + size));
        const dz = Math.max(z0 - z, 0, z - (z0 + size));
        const d = Math.hypot(dx, dz);
        if (d <= radius) out.push({ key: `${cx}_${cz}`, cx, cz, d });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }

  private request(key: string, cx: number, cz: number): void {
    if (this.requested.has(key) || this.chunks.has(key)) return;
    this.requested.add(key);
    void this.map.getChunk(cx, cz).then((data) => {
      if (this.disposed) return;
      this.ready.push({ key, cx, cz, data });
    });
  }

  /** Loads everything within `radius` before the drive starts. */
  async preload(x: number, z: number, radius: number, progress: (f: number) => void): Promise<void> {
    const list = this.wanted(x, z, radius);
    const datas = await Promise.all(
      list.map(async (c, i) => {
        const data = await this.map.getChunk(c.cx, c.cz);
        progress((i + 1) / list.length / 2);
        return { ...c, data };
      }),
    );
    let i = 0;
    for (const c of datas) {
      this.requested.add(c.key);
      this.build(c.key, c.cx, c.cz, c.data);
      i++;
      progress(0.5 + (i / datas.length) * 0.5);
      if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }

  update(x: number, z: number): void {
    const wanted = this.wanted(x, z, this.viewDistance);
    const keep = new Set(wanted.map((w) => w.key));
    for (const w of wanted) this.request(w.key, w.cx, w.cz);
    // Build within a frame budget, nearest first.
    if (this.ready.length) {
      const start = performance.now();
      this.ready.sort((a, b) => {
        const da = Math.hypot(this.chunkCentre(a.cx, a.cz)[0] - x, this.chunkCentre(a.cx, a.cz)[1] - z);
        const db = Math.hypot(this.chunkCentre(b.cx, b.cz)[0] - x, this.chunkCentre(b.cx, b.cz)[1] - z);
        return da - db;
      });
      while (this.ready.length && performance.now() - start < 7) {
        const c = this.ready.shift()!;
        if (!keep.has(c.key)) {
          this.requested.delete(c.key);
          continue;
        }
        this.build(c.key, c.cx, c.cz, c.data);
      }
    }
    // Unload with hysteresis; small props (trees, lamps, signs) only render nearby.
    const far = this.viewDistance + this.map.manifest.chunkSize * 1.2;
    const propRange = Math.min(this.viewDistance * 0.75, 540) + this.map.manifest.chunkSize * 0.45;
    for (const [key, st] of this.chunks) {
      const [cx, cz] = key.split('_').map(Number);
      const [mx, mz] = this.chunkCentre(cx, cz);
      const dist = Math.hypot(mx - x, mz - z);
      if (dist > far + this.map.manifest.chunkSize * 0.7) {
        this.unload(key, st);
        continue;
      }
      const near = dist < propRange;
      if (st.propsVisible !== near) {
        st.propsVisible = near;
        for (const o of st.props) o.visible = near;
      }
    }
  }

  private chunkCentre(cx: number, cz: number): [number, number] {
    const m = this.map.manifest;
    return [m.bounds.minX + (cx + 0.5) * m.chunkSize, m.bounds.minZ + (cz + 0.5) * m.chunkSize];
  }

  private build(key: string, cx: number, cz: number, data: ChunkData | null): void {
    if (this.chunks.has(key)) return;
    const g = new THREE.Group();
    g.name = `chunk-${key}`;
    const mats = this.materials;
    const edgeIds = this.edgeIndex.get(key) ?? [];
    const segs: number[] = [];
    const circles: number[] = [];
    const polys: number[][] = [];

    const road = buildRoadChunk(this.roadCtx, cx, cz, edgeIds);
    const addMesh = (geo: THREE.BufferGeometry | null, mat: THREE.Material, casts = false, receives = true, order = 0) => {
      if (!geo) return null;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = receives;
      mesh.castShadow = casts && this.shadows;
      mesh.userData.casts = casts;
      mesh.renderOrder = order;
      g.add(mesh);
      return mesh;
    };
    addMesh(road.sidewalk, mats.sidewalk, false, true, 0);
    addMesh(road.asphalt, mats.road, false, true, 1);
    addMesh(road.markings, mats.marking, false, true, 2);
    addMesh(road.deckRoad, mats.road, true, true, 1);
    addMesh(road.deck, mats.deck, true, true, 0);
    if (road.pillars.length) {
      pillarGeo ??= new THREE.BoxGeometry(1, 1, 1.4);
      const inst = new THREE.InstancedMesh(pillarGeo, mats.pillar, road.pillars.length);
      inst.name = 'pillars';
      road.pillars.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.castShadow = this.shadows;
      inst.userData.casts = true;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      g.add(inst);
      circles.push(...road.pillarCircles);
    }

    if (data) {
      if (data.buildings.length) {
        const built = buildBuildingGeometry(data.buildings);
        const mesh = addMesh(built.geometry, mats.building, true, true);
        if (mesh) mesh.name = 'buildings';
        segs.push(...built.walls);
        for (const b of data.buildings) polys.push(b.p);
        const tanks = tankMesh(built.tanks);
        if (tanks) {
          tanks.castShadow = this.shadows;
          tanks.userData.casts = true;
          g.add(tanks);
        }
        const shops = buildShopSigns(data.buildings, cx * 1000 + cz);
        if (shops) {
          shops.userData.ownGeometry = true;
          g.add(shops);
        }
      }
      if (data.trees.length) {
        const trees = buildTrees(data.trees, this.shadows);
        for (const t of trees.meshes) {
          t.userData.casts = true;
          g.add(t);
        }
        circles.push(...trees.circles);
      }
    }

    // Street lights.
    const m = this.map.manifest;
    const inChunk = (x: number, z: number) => Math.floor((x - m.bounds.minX) / m.chunkSize) === cx && Math.floor((z - m.bounds.minZ) / m.chunkSize) === cz;
    const buildings = data?.buildings ?? [];
    const blocked = (x: number, z: number) => {
      if (sampleMask(this.map.mask, x, z, 0) < 0.7) return true;
      for (const b of buildings) if (pointInPolygon(x, z, b.p)) return true;
      const near = this.map.graph.nearest(x, z, 12);
      if (near && near.d < this.map.graph.edges[near.edge].w / 2 + 0.35) return true;
      return false;
    };
    const lamps = placeLamps(this.map.graph, edgeIds, inChunk, this.roadCtx.nodeRadius, this.seaFace, blocked);
    const lampObjs = buildLamps(lamps, this.shadows);
    for (const o of lampObjs.meshes) g.add(o);
    circles.push(...lampObjs.circles);

    this.collision.addGroup(key, segs, circles, polys);
    this.group.add(g);
    const props = g.children.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh && o.name !== 'pillars');
    this.chunks.set(key, { key, group: g, props, propsVisible: true });
    this.builtCount++;
  }

  private unload(key: string, st: ChunkState): void {
    this.group.remove(st.group);
    st.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      // Shared prototype geometries (trees, lamps, tanks, pillars) are kept; per-chunk buffers are freed.
      if (!mesh.isMesh) return;
      const inst = mesh as unknown as THREE.InstancedMesh;
      if (inst.isInstancedMesh) {
        if (mesh.userData.ownGeometry) mesh.geometry.dispose();
        inst.dispose();
      } else mesh.geometry.dispose();
    });
    this.collision.removeGroup(key);
    this.chunks.delete(key);
    this.requested.delete(key);
  }

  get loadedChunks(): number {
    return this.chunks.size;
  }

  dispose(): void {
    this.disposed = true;
    for (const [key, st] of [...this.chunks]) this.unload(key, st);
    for (const mat of Object.values(this.materials)) mat.dispose();
  }
}
