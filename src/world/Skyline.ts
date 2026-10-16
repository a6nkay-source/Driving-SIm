/**
 * The always-loaded far layer: every building 14 m and taller across the whole
 * district (towers with their real footprint, mid-rises as boxes) in a single
 * draw call, so the skyline — Malabar Hill from Marine Drive, Worli and Lower
 * Parel from the Sea Link — is visible from kilometres away. A vertex shader
 * hides each building as soon as its detailed streaming tile is built, and red
 * aviation lights blink on the tall towers.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildingData, MapManifest, SkylineTower } from '../map/types';
import { buildBuildingGeometry } from './BuildingBuilder';
import { createBuildingMaterial, worldUniforms } from './materials';

export class SkylineLayer {
  readonly group = new THREE.Group();
  private loaded: Uint8Array;
  private loadedTex: THREE.DataTexture;
  private cols: number;
  private rows: number;
  private mesh: THREE.Mesh | null = null;
  private beacons: THREE.InstancedMesh | null = null;
  readonly count: number;

  constructor(towers: SkylineTower[], manifest: MapManifest) {
    this.group.name = 'skyline';
    const b = manifest.bounds;
    this.cols = Math.ceil((b.maxX - b.minX) / manifest.chunkSize);
    this.rows = Math.ceil((b.maxZ - b.minZ) / manifest.chunkSize);
    this.loaded = new Uint8Array(this.cols * this.rows * 4);
    this.loadedTex = new THREE.DataTexture(this.loaded, this.cols, this.rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.loadedTex.magFilter = THREE.NearestFilter;
    this.loadedTex.minFilter = THREE.NearestFilter;
    this.loadedTex.generateMipmaps = false;
    this.loadedTex.needsUpdate = true;
    this.count = towers.length;
    if (!towers.length) return;

    const byChunk = new Map<string, BuildingData[]>();
    for (const t of towers) {
      if (!byChunk.has(t.c)) byChunk.set(t.c, []);
      byChunk.get(t.c)!.push({ id: t.id, p: t.p, h: t.h, m: 0, s: t.s });
    }
    const parts: THREE.BufferGeometry[] = [];
    const beaconPos: number[] = [];
    for (const [key, list] of byChunk) {
      const [cx, cz] = key.split('_').map(Number);
      const built = buildBuildingGeometry(list, { parapets: false, tanks: false });
      const n = built.geometry.getAttribute('position').count;
      const chunk = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        chunk[i * 2] = cx;
        chunk[i * 2 + 1] = cz;
      }
      built.geometry.setAttribute('aChunk', new THREE.BufferAttribute(chunk, 2));
      parts.push(built.geometry);
      beaconPos.push(...built.beacons);
    }
    const geo = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!geo) return;
    geo.computeBoundingSphere();
    const mat = createBuildingMaterial({ loaded: this.loadedTex, grid: new THREE.Vector2(this.cols, this.rows) });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'skyline-far';
    this.group.add(this.mesh);

    if (beaconPos.length) {
      const n = beaconPos.length / 3;
      const bm = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.25, 0.15), fog: false });
      bm.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = worldUniforms.uTime;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vBlink;')
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            float ph = fract(float(gl_InstanceID) * 0.61803);
            vBlink = step(0.55, fract(uTime * 0.7 + ph));`,
          );
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vBlink;')
          .replace('#include <opaque_fragment>', 'outgoingLight *= 0.06 + vBlink;\n#include <opaque_fragment>');
      };
      this.beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 8, 6), bm, n);
      const m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        m.makeTranslation(beaconPos[i * 3], beaconPos[i * 3 + 1], beaconPos[i * 3 + 2]);
        this.beacons.setMatrixAt(i, m);
      }
      this.beacons.frustumCulled = false;
      this.beacons.name = 'aviation-lights';
      this.group.add(this.beacons);
    }
  }

  /** Called by the streaming world as detailed tiles are built and unloaded. */
  setLoaded(cx: number, cz: number, loaded: boolean): void {
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return;
    this.loaded[(cz * this.cols + cx) * 4] = loaded ? 255 : 0;
    this.loadedTex.needsUpdate = true;
  }

  dispose(): void {
    this.mesh?.geometry.dispose();
    (this.mesh?.material as THREE.Material | undefined)?.dispose();
    this.beacons?.geometry.dispose();
    this.beacons?.dispose();
    this.loadedTex.dispose();
  }
}
