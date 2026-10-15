/**
 * Timed checkpoint challenges: the route between named stops is computed with
 * A*, gates are placed every ~250 m along it, and the player races through
 * them. Best times are kept in localStorage.
 */
import * as THREE from 'three';
import { loadJSON, saveJSON } from '../core/store';
import type { RoadGraph } from '../map/RoadGraph';
import type { Destination } from '../map/types';
import { worldUniforms } from '../world/materials';
import { findRoute, routable, type Route } from './Pathfinder';
import type { ChallengeRoute } from './routes';

export interface Gate {
  x: number;
  z: number;
  y: number;
  dx: number;
  dz: number;
  width: number;
}

export interface CheckpointInfo {
  routeName: string;
  index: number;
  total: number;
  time: number;
  best?: number;
  finished: boolean;
}

const BEST_KEY = 'drive-mumbai:best:v1';

export class CheckpointRun {
  readonly group = new THREE.Group();
  readonly gates: Gate[] = [];
  readonly path: Route;
  private gateMeshes: THREE.Mesh[] = [];
  private mat: THREE.ShaderMaterial;
  index = 0;
  started = false;
  finished = false;
  time = 0;
  best?: number;
  /** Distance along the path of each gate. */
  private gateS: number[] = [];

  static create(graph: RoadGraph, def: ChallengeRoute, destinations: Destination[]): CheckpointRun | null {
    const stops = def.stops.map((id) => destinations.find((d) => d.id === id)).filter(Boolean) as Destination[];
    if (stops.length < 2) return null;
    const legs: Route[] = [];
    for (let i = 0; i + 1 < stops.length; i++) {
      const a = graph.nearest(stops[i].x, stops[i].z, 400, (_e, k) => routable(graph, k) && !!graph.main[k]);
      const b = graph.nearest(stops[i + 1].x, stops[i + 1].z, 400, (_e, k) => routable(graph, k) && !!graph.main[k]);
      if (!a || !b) return null;
      const leg = findRoute(graph, { edge: a.edge, s: a.s }, { edge: b.edge, s: b.s });
      if (!leg) return null;
      legs.push(leg);
    }
    // Concatenate legs into one path.
    const points: number[] = [];
    const cum: number[] = [];
    const heights: number[] = [];
    let offset = 0;
    for (const leg of legs) {
      const start = points.length ? 1 : 0;
      for (let i = start; i < leg.points.length / 2; i++) {
        points.push(leg.points[i * 2], leg.points[i * 2 + 1]);
        cum.push(offset + leg.cum[i]);
        heights.push(leg.heights[i]);
      }
      offset += leg.length;
    }
    const path: Route = { steps: legs.flatMap((l) => l.steps), length: offset, points, cum, heights };
    return new CheckpointRun(def, path, graph);
  }

  private constructor(
    readonly def: ChallengeRoute,
    path: Route,
    graph: RoadGraph,
  ) {
    this.path = path;
    this.group.name = 'checkpoints';
    const bests = loadJSON<Record<string, number>>(BEST_KEY, {});
    this.best = bests[def.id];
    // Gates: start, every ~250 m, finish.
    const spacing = 250;
    const marks: number[] = [Math.min(15, path.length * 0.05)];
    for (let s = spacing; s < path.length - spacing * 0.5; s += spacing) marks.push(s);
    marks.push(path.length - 3);
    for (const s of marks) {
      const g = this.gateAt(s, graph);
      this.gates.push(g);
      this.gateS.push(s);
    }
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: worldUniforms.uTime },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float band = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
          float pulse = 0.65 + 0.35 * sin(uTime * 4.0 - vUv.x * 30.0);
          gl_FragColor = vec4(vec3(1.0, 0.65, 0.18) * band * pulse, band * pulse * 0.9);
        }`,
    });
    this.gates.forEach((g) => {
      const r = g.width / 2;
      const geo = new THREE.TorusGeometry(r, 0.35, 8, 48, Math.PI);
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.position.set(g.x, g.y, g.z);
      // Arch plane perpendicular to the travel direction.
      mesh.rotation.y = Math.atan2(g.dx, g.dz);
      mesh.renderOrder = 4;
      this.gateMeshes.push(mesh);
      this.group.add(mesh);
    });
    this.refreshVisibility();
  }

  private gateAt(s: number, graph: RoadGraph): Gate {
    const r = this.path;
    let i = 0;
    while (i < r.cum.length - 2 && r.cum[i + 1] < s) i++;
    const t = (s - r.cum[i]) / Math.max(1e-6, r.cum[i + 1] - r.cum[i]);
    const x = r.points[i * 2] + (r.points[i * 2 + 2] - r.points[i * 2]) * t;
    const z = r.points[i * 2 + 1] + (r.points[i * 2 + 3] - r.points[i * 2 + 1]) * t;
    const y = r.heights[i] + (r.heights[i + 1] - r.heights[i]) * t;
    let dx = r.points[i * 2 + 2] - r.points[i * 2];
    let dz = r.points[i * 2 + 3] - r.points[i * 2 + 1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const near = graph.nearest(x, z, 20, undefined, y);
    const width = Math.max(9, Math.min(18, (near ? graph.edges[near.edge].w : 8) + 4));
    return { x, z, y, dx, dz, width };
  }

  /** Restarts the run from the first gate. */
  reset(): void {
    this.index = 0;
    this.time = 0;
    this.started = false;
    this.finished = false;
    this.refreshVisibility();
  }

  /** Start position: a little before the first gate, facing along the path. */
  startPose(): { x: number; z: number; y: number; heading: number } {
    const g = this.gates[0];
    return { x: g.x - g.dx * 12, z: g.z - g.dz * 12, y: g.y, heading: Math.atan2(-g.dx, -g.dz) };
  }

  private refreshVisibility(): void {
    this.gateMeshes.forEach((m, i) => {
      m.visible = i >= this.index && i <= this.index + 2;
      m.scale.setScalar(i === this.index ? 1 : 0.85);
    });
  }

  /** Returns 'gate' / 'finish' when a gate is passed this frame. */
  update(dt: number, px: number, pz: number, prevX: number, prevZ: number): 'gate' | 'finish' | null {
    if (this.finished) return null;
    if (this.started) this.time += dt;
    const g = this.gates[this.index];
    // Crossed the gate plane between the previous and current position?
    const d0 = (prevX - g.x) * g.dx + (prevZ - g.z) * g.dz;
    const d1 = (px - g.x) * g.dx + (pz - g.z) * g.dz;
    const lat = Math.abs((px - g.x) * g.dz - (pz - g.z) * g.dx);
    if (d0 <= 0 && d1 > 0 && lat < g.width / 2 + 3) {
      if (!this.started) this.started = true;
      this.index++;
      if (this.index >= this.gates.length) {
        this.finished = true;
        if (this.best === undefined || this.time < this.best) {
          this.best = this.time;
          const bests = loadJSON<Record<string, number>>(BEST_KEY, {});
          bests[this.def.id] = this.time;
          saveJSON(BEST_KEY, bests);
        }
        this.refreshVisibility();
        return 'finish';
      }
      this.refreshVisibility();
      return 'gate';
    }
    return null;
  }

  /** Path points from the current gate to the finish (minimap / ribbon). */
  remainingPoints(): number[] {
    const s0 = this.gateS[Math.max(0, this.index - 1)] ?? 0;
    const out: number[] = [];
    for (let i = 0; i < this.path.points.length / 2; i++) if (this.path.cum[i] >= s0 - 5) out.push(this.path.points[i * 2], this.path.points[i * 2 + 1]);
    return out;
  }

  get nextGate(): Gate | null {
    return this.gates[this.index] ?? null;
  }

  info(): CheckpointInfo {
    return { routeName: this.def.name, index: Math.min(this.index, this.gates.length - 1), total: this.gates.length, time: this.time, best: this.best, finished: this.finished };
  }

  dispose(): void {
    for (const m of this.gateMeshes) m.geometry.dispose();
    this.mat.dispose();
  }
}
