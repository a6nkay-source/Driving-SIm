/**
 * Traffic signals at junctions mapped as `highway=traffic_signals` in OSM.
 * Approaches into each junction cluster are split into two phases by
 * direction; each phase cycles green → amber → all-red. Signal heads stand on
 * the left of each approach (left-hand traffic).
 */
import * as THREE from 'three';
import { hash01 } from '../map/geometry';
import type { RoadGraph } from '../map/RoadGraph';
import { Kind } from '../map/types';

export const RED = 0;
export const AMBER = 1;
export const GREEN = 2;
export type Light = 0 | 1 | 2;

const G = 16;
const A = 3;
const R = 2;
const CYCLE = 2 * (G + A + R);

interface Approach {
  edge: number;
  towardsB: boolean;
  group: 0 | 1;
  cluster: number;
  /** Distance along the travel direction (from the edge start) of the stop line. */
  stopS: number;
}

export class SignalSystem {
  private approaches = new Map<string, Approach>();
  private clusterOffset: number[] = [];
  private list: Approach[] = [];
  readonly group = new THREE.Group();
  private lights: THREE.InstancedMesh | null = null;
  private lastStates: Int8Array = new Int8Array(0);
  time = 0;

  constructor(
    private readonly graph: RoadGraph,
    clusters: number[][],
    nodeRadius: Float32Array,
  ) {
    this.group.name = 'traffic-signals';
    clusters.forEach((nodes, ci) => {
      this.clusterOffset.push(hash01(ci * 7919) * CYCLE);
      const set = new Set(nodes);
      const found: Approach[] = [];
      let refAngle: number | null = null;
      for (const n of nodes) {
        for (const ei of graph.incident[n]) {
          const e = graph.edges[ei];
          if (e.k > Kind.Residential && e.k !== Kind.Link) continue;
          let towardsB: boolean | null = null;
          if (e.b === n && !set.has(e.a)) towardsB = true;
          else if (e.a === n && !set.has(e.b) && !e.o) towardsB = false;
          if (towardsB === null) continue;
          const len = graph.lengths[ei];
          if (len < 12) continue;
          const stop = Math.max(2, len - nodeRadius[n] - 2.5);
          const p = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
          graph.sample(ei, towardsB ? len - 1 : 1, p);
          const dx = towardsB ? p.tx : -p.tx;
          const dz = towardsB ? p.tz : -p.tz;
          const ang = Math.atan2(dz, dx);
          refAngle ??= ang;
          let diff = Math.abs(ang - refAngle) % Math.PI;
          if (diff > Math.PI / 2) diff = Math.PI - diff;
          found.push({ edge: ei, towardsB, group: diff < Math.PI / 4 ? 0 : 1, cluster: ci, stopS: stop });
        }
      }
      for (const a of found) {
        this.approaches.set(`${a.edge}:${a.towardsB ? 1 : 0}`, a);
        this.list.push(a);
      }
    });
    this.buildVisuals();
  }

  private lightFor(a: Approach, time: number): Light {
    const t = (time + this.clusterOffset[a.cluster]) % CYCLE;
    const start = a.group === 0 ? 0 : G + A + R;
    const local = (t - start + CYCLE) % CYCLE;
    if (local < G) return GREEN;
    if (local < G + A) return AMBER;
    return RED;
  }

  /** Light facing a vehicle travelling along `edge` (towards b when towardsB), or null if unsignalised. */
  state(edge: number, towardsB: boolean): Light | null {
    const a = this.approaches.get(`${edge}:${towardsB ? 1 : 0}`);
    return a ? this.lightFor(a, this.time) : null;
  }

  /** Stop-line distance along the travel direction, measured from where the vehicle entered the edge. */
  stopLine(edge: number, towardsB: boolean): number | null {
    const a = this.approaches.get(`${edge}:${towardsB ? 1 : 0}`);
    return a ? a.stopS : null;
  }

  get count(): number {
    return this.list.length;
  }

  private buildVisuals(): void {
    if (!this.list.length) return;
    const n = this.list.length;
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.11, 4.9, 8).translate(0, 2.45, 0);
    const headGeo = new THREE.BoxGeometry(0.42, 1.2, 0.32).translate(0, 4.25, 0.05);
    const visorGeo = new THREE.BoxGeometry(0.46, 0.04, 0.2).translate(0, 4.83, -0.15);
    const metal = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.6, metalness: 0.5 });
    const head = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 });
    const poles = new THREE.InstancedMesh(poleGeo, metal, n);
    const heads = new THREE.InstancedMesh(headGeo, head, n);
    const visors = new THREE.InstancedMesh(visorGeo, head, n);
    this.lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), n * 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const p = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
    this.list.forEach((a, i) => {
      const e = this.graph.edges[a.edge];
      const len = this.graph.lengths[a.edge];
      const s = a.towardsB ? a.stopS : len - a.stopS;
      this.graph.sample(a.edge, s, p);
      const dx = a.towardsB ? p.tx : -p.tx;
      const dz = a.towardsB ? p.tz : -p.tz;
      const lx = dz;
      const lz = -dx;
      const off = e.w / 2 + 0.9;
      const x = p.x + lx * off;
      const z = p.z + lz * off;
      // Faces oncoming traffic (−travel direction).
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dx, -dz));
      m.compose(new THREE.Vector3(x, p.h, z), q, one);
      poles.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
      visors.setMatrixAt(i, m);
      for (let k = 0; k < 3; k++) {
        const y = p.h + 4.62 - k * 0.37;
        m.compose(new THREE.Vector3(x - dx * 0.22, y, z - dz * 0.22), q, one);
        this.lights!.setMatrixAt(i * 3 + k, m);
      }
    });
    for (const x of [poles, heads, visors, this.lights]) {
      x.computeBoundingSphere();
      x.castShadow = x !== this.lights;
    }
    this.lastStates = new Int8Array(n).fill(-1);
    this.group.add(poles, heads, visors, this.lights);
    this.update(0, true);
  }

  update(time: number, force = false): void {
    this.time = time;
    if (!this.lights) return;
    const c = new THREE.Color();
    let dirty = false;
    this.list.forEach((a, i) => {
      const s = this.lightFor(a, time);
      if (!force && this.lastStates[i] === s) return;
      this.lastStates[i] = s;
      dirty = true;
      for (let k = 0; k < 3; k++) {
        const on = (k === 0 && s === RED) || (k === 1 && s === AMBER) || (k === 2 && s === GREEN);
        if (k === 0) c.setRGB(on ? 5 : 0.12, on ? 0.35 : 0.02, on ? 0.2 : 0.02);
        else if (k === 1) c.setRGB(on ? 5 : 0.12, on ? 2.6 : 0.07, on ? 0.1 : 0.01);
        else c.setRGB(on ? 0.3 : 0.01, on ? 4.5 : 0.08, on ? 1.4 : 0.03);
        this.lights!.setColorAt(i * 3 + k, c);
      }
    });
    if (dirty && this.lights.instanceColor) this.lights.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
}
