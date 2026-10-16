/**
 * Pedestrians and crowds: people walking along footpaths, sitting on the
 * Marine Drive sea wall, packing Chowpatty beach and the Gateway of India,
 * queueing at bus stops and spilling out of stations. They are instanced
 * low-poly figures with a vertex-shader walk cycle. People step out of the
 * way of the player's car (they are never run over).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash01, rng } from '../map/geometry';
import { sampleMask, type RuntimeMask } from '../map/MapData';
import type { RoadGraph } from '../map/RoadGraph';
import { Kind } from '../map/types';
import { worldUniforms } from '../world/materials';

/** Walkers near the player for each crowd density level. */
export const CROWD_LEVELS = [0, 70, 150, 260, 380];
const CAPACITY = 640;

const SARI = ['#d81b60', '#ff8f00', '#2e7d32', '#fdd835', '#c62828', '#1565c0', '#8e24aa', '#00897b', '#f4511e', '#ad1457'];
const SHIRT = ['#f5f5f0', '#f5f5f0', '#9fb8d9', '#3d5a80', '#c9b79c', '#5d4037', '#2f2f2f', '#e0e0e0', '#7f9c6b', '#b23a48', '#e9c46a'];

export interface Hotspot {
  x: number;
  z: number;
  radius: number;
  count: number;
  /** 'sit' = seated on a wall, 'stand' = milling around. */
  pose: 'sit' | 'stand';
  /** Rotation for seated rows (facing the sea). */
  facing?: number;
  /** Place people even off land (piers, causeways, islets). */
  anywhere?: boolean;
  /** Distance at which this crowd appears (default 260 m). */
  range?: number;
}

interface Ped {
  active: boolean;
  mesh: 0 | 1 | 2;
  slot: number;
  walker: boolean;
  edge: number;
  dir: 1 | -1;
  s: number;
  side: number;
  offset: number;
  speed: number;
  x: number;
  z: number;
  heading: number;
  phase: number;
  dodgeX: number;
  dodgeZ: number;
  color: THREE.Color;
  skin: number;
  hotspot: number;
}

// ------------------------------------------------------------------ geometry
function part(g: THREE.BufferGeometry, color: number, tint: number, skin: number, limb: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const n = geo.getAttribute('position').count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
  geo.setAttribute('aSkin', new THREE.BufferAttribute(new Float32Array(n).fill(skin), 1));
  geo.setAttribute('aLimb', new THREE.BufferAttribute(new Float32Array(n).fill(limb), 1));
  return geo;
}

function personGeometry(kind: 'man' | 'woman' | 'sitting'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const head = new THREE.IcosahedronGeometry(0.11, 0).translate(0, 1.6, 0);
  parts.push(part(head, 0xffffff, 0, 1, 0));
  parts.push(part(new THREE.SphereGeometry(0.115, 6, 3, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, 1.62, 0.01), 0x16110e, 0, 0, 0));
  if (kind === 'sitting') {
    parts.push(part(new THREE.BoxGeometry(0.36, 0.52, 0.22).translate(0, 1.0, 0.05), 0xffffff, 1, 0, 0));
    parts.push(part(new THREE.BoxGeometry(0.32, 0.14, 0.46).translate(0, 0.66, -0.17), 0x2c3a52, 0, 0, 0));
    parts.push(part(new THREE.BoxGeometry(0.13, 0.5, 0.13).translate(-0.09, 0.38, -0.38), 0x2c3a52, 0, 0, 0));
    parts.push(part(new THREE.BoxGeometry(0.13, 0.5, 0.13).translate(0.09, 0.38, -0.38), 0x2c3a52, 0, 0, 0));
    parts.push(part(new THREE.BoxGeometry(0.09, 0.42, 0.09).translate(-0.23, 1.0, -0.04), 0xffffff, 0, 1, 0));
    parts.push(part(new THREE.BoxGeometry(0.09, 0.42, 0.09).translate(0.23, 1.0, -0.04), 0xffffff, 0, 1, 0));
  } else if (kind === 'woman') {
    // Sari: a flared drape to the ankles, a pallu over the shoulder.
    parts.push(part(new THREE.CylinderGeometry(0.17, 0.27, 0.95, 8).translate(0, 0.5, 0), 0xffffff, 1, 0, 0));
    parts.push(part(new THREE.BoxGeometry(0.34, 0.5, 0.2).translate(0, 1.23, 0), 0xffffff, 1, 0, 0));
    parts.push(part(new THREE.BoxGeometry(0.06, 0.55, 0.22).translate(-0.16, 1.2, 0.02).rotateZ(0.25), 0xffffff, 1, 0, 0));
    parts.push(part(new THREE.BoxGeometry(0.08, 0.5, 0.08).translate(-0.22, 1.2, 0), 0xffffff, 0, 1, 3));
    parts.push(part(new THREE.BoxGeometry(0.08, 0.5, 0.08).translate(0.22, 1.2, 0), 0xffffff, 0, 1, 4));
    parts.push(part(new THREE.SphereGeometry(0.07, 5, 4).translate(0, 1.56, 0.1), 0x16110e, 0, 0, 0));
  } else {
    parts.push(part(new THREE.BoxGeometry(0.38, 0.56, 0.22).translate(0, 1.2, 0), 0xffffff, 1, 0, 0));
    parts.push(part(new THREE.BoxGeometry(0.15, 0.88, 0.15).translate(-0.1, 0.46, 0), 0x2c3a52, 0, 0, 1));
    parts.push(part(new THREE.BoxGeometry(0.15, 0.88, 0.15).translate(0.1, 0.46, 0), 0x2c3a52, 0, 0, 2));
    parts.push(part(new THREE.BoxGeometry(0.09, 0.52, 0.09).translate(-0.25, 1.2, 0), 0xffffff, 1, 0, 3));
    parts.push(part(new THREE.BoxGeometry(0.09, 0.52, 0.09).translate(0.25, 1.2, 0), 0xffffff, 1, 0, 4));
  }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

function crowdMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        attribute float aTint;
        attribute float aSkin;
        attribute float aLimb;
        attribute vec3 iAnim;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // Walk cycle: legs and arms swing about the hip / shoulder.
        float swing = sin(uTime * iAnim.y + iAnim.x) * iAnim.z;
        if (aLimb > 0.5) {
          float sgn = (aLimb < 1.5 || aLimb > 3.5) ? 1.0 : -1.0;
          float pivot = aLimb < 2.5 ? 0.9 : 1.42;
          float ang = swing * sgn * (aLimb < 2.5 ? 0.55 : 0.4);
          float yy = transformed.y - pivot;
          float zz = transformed.z;
          transformed.y = pivot + yy * cos(ang) - zz * sin(ang);
          transformed.z = yy * sin(ang) + zz * cos(ang);
        }
        transformed.y += abs(swing) * 0.03 * iAnim.z;`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        #if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )
          vec3 skinTone = mix(vec3(0.42, 0.25, 0.16), vec3(0.2, 0.11, 0.07), fract(iAnim.x * 0.37));
          vColor.rgb = mix(mix(color.rgb, skinTone, aSkin), instanceColor.rgb, aTint);
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'crowd-walk';
  return mat;
}

export class PedestrianSystem {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private anim: THREE.InstancedBufferAttribute[] = [];
  private free: number[][] = [[], [], []];
  private peds: Ped[] = [];
  private walkEdges = new Set<number>();
  private target = 0;
  private spawnTimer = 0;
  private hotspotActive: boolean[] = [];
  private shoutCooldown = 0;
  private tmp = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
  /** Called when someone has to jump out of the player's way. */
  onShout: ((x: number, z: number) => void) | null = null;

  constructor(
    private readonly graph: RoadGraph,
    private readonly mask: RuntimeMask,
    private readonly hotspots: Hotspot[],
  ) {
    this.group.name = 'pedestrians';
    const mat = crowdMaterial();
    (['man', 'woman', 'sitting'] as const).forEach((k, i) => {
      const geo = personGeometry(k);
      const a = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iAnim', a);
      const mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.push(mesh);
      this.anim.push(a);
      this.free[i] = Array.from({ length: CAPACITY }, (_, n) => CAPACITY - 1 - n);
      this.group.add(mesh);
    });
    graph.edges.forEach((e, i) => {
      if (e.h || e.k > Kind.Residential || e.k === Kind.Motorway || e.k === Kind.Link || graph.lengths[i] < 20) return;
      this.walkEdges.add(i);
    });
    this.hotspotActive = hotspots.map(() => false);
  }

  setDensity(level: number): void {
    this.target = CROWD_LEVELS[Math.max(0, Math.min(CROWD_LEVELS.length - 1, level))];
  }

  get count(): number {
    let n = 0;
    for (const p of this.peds) if (p.active) n++;
    return n;
  }

  private sidewalkOffset(edge: number): number {
    const e = this.graph.edges[edge];
    const sw = e.k <= Kind.Secondary ? 3.2 : 2.4;
    return e.w / 2 + sw * (0.35 + Math.random() * 0.45);
  }

  private alloc(mesh: 0 | 1 | 2): Ped | null {
    const slot = this.free[mesh].pop();
    if (slot === undefined) return null;
    let p = this.peds.find((x) => !x.active);
    if (!p) {
      p = {
        active: false,
        mesh,
        slot,
        walker: true,
        edge: 0,
        dir: 1,
        s: 0,
        side: 1,
        offset: 0,
        speed: 1.3,
        x: 0,
        z: 0,
        heading: 0,
        phase: 0,
        dodgeX: 0,
        dodgeZ: 0,
        color: new THREE.Color(),
        skin: 0,
        hotspot: -1,
      };
      this.peds.push(p);
    }
    p.active = true;
    p.mesh = mesh;
    p.slot = slot;
    p.dodgeX = 0;
    p.dodgeZ = 0;
    p.phase = Math.random() * 100;
    const woman = mesh === 1;
    p.color.set(woman ? SARI[Math.floor(Math.random() * SARI.length)] : SHIRT[Math.floor(Math.random() * SHIRT.length)]);
    return p;
  }

  private release(p: Ped): void {
    p.active = false;
    this.free[p.mesh].push(p.slot);
    this.meshes[p.mesh].setMatrixAt(p.slot, new THREE.Matrix4().makeScale(0, 0, 0));
  }

  private spawnWalker(px: number, pz: number, minD: number, maxD: number): void {
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const d = minD + Math.random() * (maxD - minD);
      const near = this.graph.nearest(px + Math.cos(a) * d, pz + Math.sin(a) * d, 40, (e, i) => !e.h && e.k <= Kind.Residential && e.k !== Kind.Motorway && e.k !== Kind.Link && this.graph.lengths[i] >= 20);
      if (!near) continue;
      const p = this.alloc(Math.random() < 0.42 ? 1 : 0);
      if (!p) return;
      p.walker = true;
      p.hotspot = -1;
      p.edge = near.edge;
      p.dir = Math.random() < 0.5 ? 1 : -1;
      p.s = near.s;
      p.side = Math.random() < 0.5 ? 1 : -1;
      p.offset = this.sidewalkOffset(near.edge);
      p.speed = 1.0 + Math.random() * 0.6;
      this.place(p);
      if (sampleMask(this.mask, p.x, p.z, 0) < 0.6) {
        this.release(p);
        continue;
      }
      return;
    }
  }

  private place(p: Ped): void {
    const t = this.graph.sample(p.edge, p.s, this.tmp);
    const dx = t.tx * p.dir;
    const dz = t.tz * p.dir;
    // Left of the walking direction is (dz, -dx).
    p.x = t.x + dz * p.offset * p.side;
    p.z = t.z - dx * p.offset * p.side;
    p.heading = Math.atan2(-dx, -dz);
  }

  private activateHotspot(i: number): void {
    const h = this.hotspots[i];
    const r = rng(Math.floor(h.x * 13 + h.z * 7));
    for (let k = 0; k < h.count; k++) {
      const sit = h.pose === 'sit';
      const p = this.alloc(sit ? 2 : r() < 0.45 ? 1 : 0);
      if (!p) return;
      p.walker = false;
      p.hotspot = i;
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * h.radius;
      if (sit && h.facing !== undefined) {
        // Seated in a row along the wall.
        // Local +X of a figure facing `facing` runs along the wall.
        const along = (r() - 0.5) * h.radius * 2;
        p.x = h.x + Math.cos(h.facing) * along;
        p.z = h.z - Math.sin(h.facing) * along;
        p.heading = h.facing;
      } else {
        p.x = h.x + Math.cos(a) * d;
        p.z = h.z + Math.sin(a) * d;
        p.heading = r() * Math.PI * 2;
      }
      if (!sit && !h.anywhere && sampleMask(this.mask, p.x, p.z, 0) < 0.55) {
        this.release(p);
        continue;
      }
      const near = h.anywhere ? null : this.graph.nearest(p.x, p.z, 12);
      if (!sit && near && near.d < this.graph.edges[near.edge].w / 2 + 0.6) {
        this.release(p);
        continue;
      }
      p.speed = 0;
    }
    this.hotspotActive[i] = true;
  }

  private deactivateHotspot(i: number): void {
    for (const p of this.peds) if (p.active && p.hotspot === i) this.release(p);
    this.hotspotActive[i] = false;
  }

  update(dt: number, player: { x: number; z: number; heading: number; speed: number }, time: number): void {
    const px = player.x;
    const pz = player.z;
    // Hotspots stream in and out with distance.
    this.hotspots.forEach((h, i) => {
      const d = Math.hypot(h.x - px, h.z - pz);
      const range = h.range ?? 260;
      if (!this.hotspotActive[i] && d < range && this.target > 0) this.activateHotspot(i);
      else if (this.hotspotActive[i] && (d > range + 60 || this.target === 0)) this.deactivateHotspot(i);
    });
    let walkers = 0;
    for (const p of this.peds) {
      if (!p.active || !p.walker) continue;
      if (Math.hypot(p.x - px, p.z - pz) > 230) this.release(p);
      else walkers++;
    }
    this.spawnTimer -= dt;
    if (walkers < this.target && this.spawnTimer <= 0) {
      const initial = walkers < this.target * 0.4;
      for (let i = 0; i < Math.min(16, this.target - walkers); i++) this.spawnWalker(px, pz, initial ? 15 : 120, 200);
      this.spawnTimer = 0.2;
    }

    const fx = -Math.sin(player.heading);
    const fz = -Math.cos(player.heading);
    this.shoutCooldown -= dt;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const counts = [0, 0, 0];
    for (const p of this.peds) {
      if (!p.active) continue;
      if (p.walker) {
        p.s += p.speed * p.dir * dt;
        const len = this.graph.lengths[p.edge];
        if (p.s < 0 || p.s > len) {
          // Continue onto another footpath from the junction, or turn back.
          const e = this.graph.edges[p.edge];
          const node = p.s < 0 ? e.a : e.b;
          const options = this.graph.incident[node].filter((o) => o !== p.edge && this.walkEdges.has(o));
          if (options.length) {
            const next = options[Math.floor(Math.random() * options.length)];
            const ne = this.graph.edges[next];
            p.edge = next;
            p.dir = ne.a === node ? 1 : -1;
            p.s = p.dir > 0 ? 0.5 : this.graph.lengths[next] - 0.5;
            p.offset = this.sidewalkOffset(next);
          } else {
            p.dir = (p.dir * -1) as 1 | -1;
            p.s = Math.max(0, Math.min(len, p.s));
            p.side *= -1;
          }
        }
        this.place(p);
      }
      // Step aside when the car comes at you.
      const rx = p.x + p.dodgeX - px;
      const rz = p.z + p.dodgeZ - pz;
      const along = rx * fx + rz * fz;
      const lat = rx * fz - rz * fx;
      const dist = Math.hypot(rx, rz);
      if (player.speed > 1.5 && along > -2 && along < 6 + player.speed * 0.6 && Math.abs(lat) < 2.2) {
        const push = (2.4 - Math.abs(lat)) * Math.sign(lat || 1);
        p.dodgeX += fz * push * Math.min(1, dt * 10);
        p.dodgeZ += -fx * push * Math.min(1, dt * 10);
        if (this.shoutCooldown <= 0 && player.speed > 5) {
          this.onShout?.(p.x, p.z);
          this.shoutCooldown = 5;
        }
      } else if (dist < 1.6) {
        p.dodgeX += (rx / (dist || 1)) * (1.6 - dist);
        p.dodgeZ += (rz / (dist || 1)) * (1.6 - dist);
      } else {
        p.dodgeX *= 1 - Math.min(1, dt * 0.6);
        p.dodgeZ *= 1 - Math.min(1, dt * 0.6);
      }
      const mesh = this.meshes[p.mesh];
      q.setFromAxisAngle(up, p.heading);
      const y = p.mesh === 2 ? 0.0 : 0.04;
      m.compose(new THREE.Vector3(p.x + p.dodgeX, y, p.z + p.dodgeZ), q, one);
      mesh.setMatrixAt(p.slot, m);
      mesh.setColorAt(p.slot, p.color);
      const moving = p.walker ? 1 : 0;
      this.anim[p.mesh].setXYZ(p.slot, p.phase, 5.5 * p.speed, moving ? 1 : 0.05 * (1 + Math.sin(time * 0.3 + p.phase)));
      counts[p.mesh] = Math.max(counts[p.mesh], p.slot + 1);
    }
    this.meshes.forEach((mesh, i) => {
      mesh.count = counts[i];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.anim[i].needsUpdate = true;
    });
  }

  /** Seeded crowd hotspots for a district: promenades, beaches, landmarks, stations, bus stops. */
  static hotspotsFor(
    graph: RoadGraph,
    mask: RuntimeMask,
    seaFace: Set<number>,
    places: { x: number; z: number; kind: string }[],
    busStops: [number, number, number][],
  ): Hotspot[] {
    const out: Hotspot[] = [];
    // People sitting on the sea wall along the sea-face promenades, facing the sea.
    const p = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
    for (const ei of seaFace) {
      const e = graph.edges[ei];
      const len = graph.lengths[ei];
      for (let s = 20; s < len - 20; s += 45) {
        graph.sample(ei, s, p);
        // Find the sea side: whichever side has water within 40 m.
        for (const side of [1, -1]) {
          const lx = p.tz * side;
          const lz = -p.tx * side;
          let wall = -1;
          for (let d = e.w / 2 + 2; d < 45; d += 2) {
            if (sampleMask(mask, p.x + lx * d, p.z + lz * d, 0) < 0.5) {
              wall = d - 1.2;
              break;
            }
          }
          if (wall < 0) continue;
          if (hash01(Math.floor(s) + ei * 31) < 0.45) continue;
          out.push({
            x: p.x + lx * wall,
            z: p.z + lz * wall,
            radius: 14,
            count: 5 + Math.floor(hash01(ei + s) * 6),
            pose: 'sit',
            facing: Math.atan2(-lx, -lz),
          });
        }
      }
    }
    for (const place of places) {
      const big = place.kind === 'beach' || place.kind === 'landmark';
      out.push({ x: place.x, z: place.z, radius: big ? 45 : 28, count: big ? 60 : 30, pose: 'stand' });
    }
    busStops.forEach(([x, z], i) => {
      if (hash01(i * 17) < 0.6) out.push({ x, z, radius: 2.5, count: 3 + Math.floor(hash01(i) * 4), pose: 'stand' });
    });
    return out;
  }

  clear(): void {
    for (const p of this.peds) if (p.active) this.release(p);
    this.hotspotActive = this.hotspots.map(() => false);
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
  }
}
