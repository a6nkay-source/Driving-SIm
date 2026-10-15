/**
 * Waypoint navigation: snaps a destination to the road network, routes the
 * player with A*, tracks progress, reroutes when the player leaves the route,
 * and produces turn-by-turn instructions with real road names. Also draws the
 * glowing route ribbon on the road and a light beacon at the destination.
 */
import * as THREE from 'three';
import type { RoadGraph } from '../map/RoadGraph';
import { worldUniforms } from '../world/materials';
import { radialTexture } from '../world/textures';
import { findRoute, routable, type Route } from './Pathfinder';

export type Turn = 'left' | 'right' | 'slight-left' | 'slight-right' | 'straight' | 'uturn' | 'arrive';

export interface NavInfo {
  destName: string;
  distance: number;
  stepDistance: number;
  instruction: string;
  turn: Turn;
  arrived: boolean;
}

interface Maneuver {
  at: number;
  turn: Turn;
  road: string;
}

export class Navigator {
  readonly group = new THREE.Group();
  route: Route | null = null;
  private maneuvers: Maneuver[] = [];
  private progress = 0;
  private progressIdx = 0;
  private dest: { x: number; z: number; name: string } | null = null;
  private offRoute = 0;
  private lastReroute = -10;
  private ribbon: THREE.Mesh;
  private ribbonMat: THREE.ShaderMaterial;
  private beacon: THREE.Group;
  private lastRibbonAt = -1;
  arrived = false;
  info: NavInfo | null = null;

  constructor(private readonly graph: RoadGraph) {
    this.group.name = 'navigation';
    this.ribbonMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -32,
      uniforms: { uTime: worldUniforms.uTime, uColor: { value: new THREE.Color(1.0, 0.62, 0.15) } },
      vertexShader: `
        attribute float aDist;
        attribute float aSide;
        varying float vDist;
        varying float vSide;
        void main() {
          vDist = aDist;
          vSide = aSide;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        varying float vDist;
        varying float vSide;
        void main() {
          // Chevrons flowing along the route.
          float f = fract(vDist / 6.0 - uTime * 0.9 + abs(vSide) * 0.35);
          float chev = smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.22, 0.32, f));
          float edge = 1.0 - smoothstep(0.75, 1.0, abs(vSide));
          float fade = 1.0 - smoothstep(260.0, 420.0, vDist);
          float a = (0.18 + 0.6 * chev) * edge * fade;
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
    this.ribbon = new THREE.Mesh(new THREE.BufferGeometry(), this.ribbonMat);
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 3;
    this.group.add(this.ribbon);

    this.beacon = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 160, 24, 1, true).translate(0, 80, 0),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uTime: worldUniforms.uTime },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform float uTime; varying vec2 vUv;
          void main(){ float a = (1.0 - vUv.y) * (0.35 + 0.15 * sin(uTime * 3.0 + vUv.y * 20.0));
          gl_FragColor = vec4(vec3(1.0, 0.65, 0.2) * a, a); }`,
      }),
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5, 6.2, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffa640, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.position.y = 0.15;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), color: 0xffb250, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.y = 6;
    glow.scale.setScalar(18);
    this.beacon.add(beam, ring, glow);
    this.beacon.visible = false;
    this.group.add(this.beacon);
  }

  get destination(): { x: number; z: number; name: string } | null {
    return this.dest;
  }

  setDestination(dest: { x: number; z: number; name: string } | null): void {
    this.dest = dest;
    this.route = null;
    this.info = null;
    this.arrived = false;
    this.beacon.visible = !!dest;
    this.ribbon.visible = !!dest;
    if (dest) {
      const near = this.graph.nearest(dest.x, dest.z, 400, (_e, i) => routable(this.graph, i) && !!this.graph.main[i]);
      if (near) {
        this.dest = { ...dest, x: near.x, z: near.z };
        this.beacon.position.set(near.x, near.h, near.z);
      } else this.beacon.position.set(dest.x, 0, dest.z);
    }
  }

  reroute(x: number, z: number, heading: number, y: number, time: number): boolean {
    if (!this.dest) return false;
    this.lastReroute = time;
    const start = this.graph.nearest(x, z, 80, (_e, i) => routable(this.graph, i) && !!this.graph.main[i], y);
    const goal = this.graph.nearest(this.dest.x, this.dest.z, 400, (_e, i) => routable(this.graph, i) && !!this.graph.main[i]);
    if (!start || !goal) {
      this.route = null;
      return false;
    }
    const route = findRoute(this.graph, { edge: start.edge, s: start.s }, { edge: goal.edge, s: goal.s }, { dx: -Math.sin(heading), dz: -Math.cos(heading) });
    this.route = route;
    this.progress = 0;
    this.progressIdx = 0;
    this.offRoute = 0;
    this.maneuvers = route ? this.buildManeuvers(route) : [];
    this.lastRibbonAt = -1;
    return !!route;
  }

  private buildManeuvers(route: Route): Maneuver[] {
    const out: Maneuver[] = [];
    let at = 0;
    const p = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
    for (let i = 0; i < route.steps.length; i++) {
      const st = route.steps[i];
      at += Math.abs(st.to - st.from);
      const next = route.steps[i + 1];
      if (!next) break;
      this.graph.sample(st.edge, st.to, p);
      const ax = st.towardsB ? p.tx : -p.tx;
      const az = st.towardsB ? p.tz : -p.tz;
      this.graph.sample(next.edge, next.from, p);
      const bx = next.towardsB ? p.tx : -p.tx;
      const bz = next.towardsB ? p.tz : -p.tz;
      const cross = ax * bz - az * bx;
      const dot = ax * bx + az * bz;
      const ang = Math.atan2(cross, dot);
      const deg = Math.abs((ang * 180) / Math.PI);
      const name = this.graph.name(next.edge) ?? '';
      const prevName = this.graph.name(st.edge) ?? '';
      let turn: Turn;
      // In this frame (x east, z south), a positive cross product is a right turn.
      if (deg < 22) turn = 'straight';
      else if (deg < 50) turn = ang > 0 ? 'slight-right' : 'slight-left';
      else if (deg < 150) turn = ang > 0 ? 'right' : 'left';
      else turn = 'uturn';
      if (turn === 'straight' && (name === prevName || !name)) continue;
      out.push({ at, turn, road: name });
    }
    out.push({ at: route.length, turn: 'arrive', road: this.dest?.name ?? '' });
    return out;
  }

  update(x: number, z: number, heading: number, y: number, time: number): void {
    if (!this.dest) {
      this.info = null;
      return;
    }
    if (!this.route) {
      if (time - this.lastReroute > 1.5) this.reroute(x, z, heading, y, time);
      if (!this.route) return;
    }
    const r = this.route;
    // Project onto the route near the last known progress.
    let bestD = Infinity;
    let bestS = this.progress;
    let bestI = this.progressIdx;
    const from = Math.max(0, this.progressIdx - 2);
    const to = Math.min(r.points.length / 2 - 1, this.progressIdx + 40);
    for (let i = from; i < to; i++) {
      const ax = r.points[i * 2];
      const az = r.points[i * 2 + 1];
      const bx = r.points[i * 2 + 2];
      const bz = r.points[i * 2 + 3];
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < bestD) {
        bestD = d;
        bestS = r.cum[i] + (r.cum[i + 1] - r.cum[i]) * t;
        bestI = i;
      }
    }
    this.progress = bestS;
    this.progressIdx = bestI;
    if (bestD > 28) this.offRoute += 1 / 60;
    else this.offRoute = 0;
    if (this.offRoute > 1.2 && time - this.lastReroute > 2) this.reroute(x, z, heading, y, time);

    const remaining = Math.max(0, r.length - this.progress);
    const directDist = Math.hypot(this.dest.x - x, this.dest.z - z);
    if (!this.arrived && (remaining < 22 || directDist < 18)) this.arrived = true;
    const m = this.maneuvers.find((mm) => mm.at > this.progress + 2) ?? this.maneuvers[this.maneuvers.length - 1];
    const stepDistance = Math.max(0, (m?.at ?? r.length) - this.progress);
    const verb: Record<Turn, string> = {
      left: 'Turn left',
      right: 'Turn right',
      'slight-left': 'Bear left',
      'slight-right': 'Bear right',
      straight: 'Continue',
      uturn: 'Make a U-turn',
      arrive: 'Arrive at',
    };
    const instruction = m ? (m.turn === 'arrive' ? `${verb.arrive} ${this.dest.name}` : `${verb[m.turn]}${m.road ? ` onto ${m.road}` : ''}`) : 'Follow the route';
    this.info = { destName: this.dest.name, distance: this.arrived ? 0 : remaining, stepDistance, instruction: this.arrived ? `You have arrived at ${this.dest.name}` : instruction, turn: this.arrived ? 'arrive' : (m?.turn ?? 'straight'), arrived: this.arrived };

    if (Math.abs(this.progress - this.lastRibbonAt) > 12 || this.lastRibbonAt < 0) {
      this.lastRibbonAt = this.progress;
      this.buildRibbon(this.progress, 420);
    }
  }

  /** Route points from the current progress (for the minimap). */
  remainingPoints(max = 1500): number[] | null {
    const r = this.route;
    if (!r) return null;
    const out: number[] = [];
    for (let i = Math.max(0, this.progressIdx); i < r.points.length / 2; i++) {
      if (r.cum[i] - this.progress > max) break;
      out.push(r.points[i * 2], r.points[i * 2 + 1]);
    }
    return out;
  }

  private buildRibbon(start: number, length: number): void {
    const r = this.route;
    if (!r) return;
    const pos: number[] = [];
    const dist: number[] = [];
    const side: number[] = [];
    const idx: number[] = [];
    const hw = 1.25;
    const pts: [number, number, number, number][] = [];
    for (let i = 0; i < r.points.length / 2; i++) {
      const d = r.cum[i] - start;
      if (d < -5) continue;
      if (d > length) break;
      pts.push([r.points[i * 2], r.points[i * 2 + 1], d, r.heights[i]]);
    }
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[Math.min(pts.length - 1, i + 1)];
      let tx = p1[0] - p0[0];
      let tz = p1[1] - p0[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      const nx = tz;
      const nz = -tx;
      const [x, z, d, deck] = pts[i];
      const h = deck + 0.12;
      pos.push(x + nx * hw, h, z + nz * hw, x - nx * hw, h, z - nz * hw);
      dist.push(d, d);
      side.push(1, -1);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    g.setIndex(idx);
    this.ribbon.geometry.dispose();
    this.ribbon.geometry = g;
  }

  dispose(): void {
    this.ribbon.geometry.dispose();
    this.ribbonMat.dispose();
    this.beacon.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}
