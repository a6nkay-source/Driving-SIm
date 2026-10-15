/**
 * The playable drive: loads a district, builds the world, spawns the player on
 * a road, and runs physics, traffic, navigation, camera, audio and telemetry
 * every frame.
 */
import * as THREE from 'three';
import { toast, type Session } from '../app/state';
import type { AudioEngine } from '../audio/AudioEngine';
import { CAMERA_LABEL, CameraRig } from '../camera/CameraRig';
import { carStore } from '../core/carConfig';
import { settingsStore, type CameraMode, type Settings } from '../core/settings';
import type { Engine, SceneController } from '../engine/Engine';
import type { Input } from '../input/Input';
import { loadMap, sampleMask, type LoadedMap, type Progress } from '../map/MapData';
import { Kind } from '../map/types';
import { CheckpointRun, type CheckpointInfo } from '../nav/Checkpoints';
import { Navigator, type NavInfo } from '../nav/Navigator';
import { ROUTES } from '../nav/routes';
import { CollisionWorld, type DynamicCircle } from '../physics/CollisionWorld';
import { SurfaceSystem } from '../physics/Surface';
import { SignalSystem } from '../traffic/Signals';
import { TrafficSystem } from '../traffic/TrafficSystem';
import { CarModel } from '../vehicle/CarModel';
import { createVehicleState, GT_PARAMS, resetVehicle, stepVehicle, worldVelocity, type VehicleEnv, type VehicleState } from '../vehicle/VehiclePhysics';
import { buildGround, type GroundObjects } from '../world/Ground';
import { buildLandmarks } from '../world/Landmarks';
import { worldUniforms } from '../world/materials';
import { buildBusStops, buildDirectionBoards, buildRegulatorySigns, placeRegulatorySigns, updateLampMaterials } from '../world/Props';
import { Environment } from '../world/Environment';
import { World } from '../world/World';

export interface Telemetry {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  rpm: number;
  gear: number;
  throttle: number;
  brake: number;
  odometer: number;
  elapsed: number;
  roadName?: string;
  roadNameMr?: string;
  headlights: boolean;
  camera: CameraMode;
  onDeck: boolean;
  nav: NavInfo | null;
  checkpoint: CheckpointInfo | null;
}

const STEP = 1 / 120;
const SEA_FACE = /marine drive|sea face|purandare|carter road|bandstand|netaji subhash/i;

export class DriveScene implements SceneController {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.3, 2000);
  map: LoadedMap | null = null;
  telemetry: Telemetry = {
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 0,
    rpm: 900,
    gear: 1,
    throttle: 0,
    brake: 0,
    odometer: 0,
    elapsed: 0,
    headlights: false,
    camera: 'chase',
    onDeck: false,
    nav: null,
    checkpoint: null,
  };

  private env!: Environment;
  private world!: World;
  private ground!: GroundObjects;
  private collision!: CollisionWorld;
  private surface!: SurfaceSystem;
  private signals!: SignalSystem;
  private traffic!: TrafficSystem;
  private nav!: Navigator;
  private run: CheckpointRun | null = null;
  private car!: CarModel;
  private state: VehicleState = createVehicleState();
  private rig: CameraRig;
  private settings: Settings;
  private session: Session | null = null;
  private paused = false;
  private time = 0;
  private acc = 0;
  private dyn: DynamicCircle[] = [];
  private seaFace = new Set<number>();
  private vehicleEnv: VehicleEnv;
  private roadTimer = 0;
  private boundsToastAt = -10;
  private redLightAt = -10;
  private lastEdge = -1;
  private lastEdgeS = 0;
  private prevX = 0;
  private prevZ = 0;
  private stuckTime = 0;
  private trafficPts: [number, number][] = [];
  private disposers: (() => void)[] = [];
  private loaded = false;
  private ambienceTimer = 0;
  private lodTimer = 0;
  private tetrapods: THREE.Object3D[] = [];

  constructor(
    private readonly engine: Engine,
    private readonly input: Input,
    private readonly audio: AudioEngine,
    settings: Settings,
  ) {
    this.settings = settings;
    this.rig = new CameraRig(this.camera);
    this.rig.setMode(settings.camera);
    this.vehicleEnv = {
      grip: 1,
      assist: settings.steeringAssist,
      heightAt: (x, z, y) => (this.surface ? this.surface.heightAt(x, z, y) : 0),
    };
  }

  async load(session: Session, progress: Progress): Promise<void> {
    this.session = session;
    const map = await loadMap(session.district, (f, l) => progress(f * 0.45, l));
    this.map = map;
    const graph = map.graph;
    graph.edges.forEach((e, i) => {
      if (e.n !== undefined && SEA_FACE.test(map.network.names[e.n].en)) this.seaFace.add(i);
    });
    progress(0.46, 'Raising flyovers and sea walls');
    await tick();
    this.collision = new CollisionWorld(map.mask, map.manifest.bounds);
    this.surface = new SurfaceSystem(graph.edges);
    this.env = new Environment(this.scene, this.engine.renderer);
    this.env.apply(this.settings.timeOfDay, this.settings.weather, this.settings.quality, this.settings.shadows);
    this.world = new World(map, this.collision, this.seaFace, { shadows: this.settings.shadows, viewDistance: this.settings.viewDistance });
    this.scene.add(this.world.group);
    this.ground = buildGround(map, this.world.materials.building, this.seaFace);
    this.scene.add(this.ground.group);
    this.tetrapods = this.ground.group.children.filter((o) => o.name === 'tetrapods');

    progress(0.5, 'Placing landmarks, signs and bus stops');
    await tick();
    const lm = buildLandmarks(map.network.landmarks);
    this.scene.add(lm.group);
    const nodeRadius = this.world.roadCtx.nodeRadius;
    const street: number[] = [...lm.circles];
    const bus = buildBusStops(map.network.busStops);
    if (bus.mesh) this.scene.add(bus.mesh);
    if (bus.sign) this.scene.add(bus.sign);
    street.push(...bus.circles);
    const signs = placeRegulatorySigns(graph, this.world.roadCtx.signalNodes, nodeRadius);
    for (const m of buildRegulatorySigns(signs)) this.scene.add(m);
    for (const s of signs) street.push(s.x, s.z, 0.12);
    const boards = buildDirectionBoards(graph, map.network.signals, nodeRadius);
    if (boards) this.scene.add(boards);
    this.signals = new SignalSystem(graph, map.network.signals, nodeRadius);
    this.scene.add(this.signals.group);
    this.collision.addGroup('static', lm.segments, street, lm.polygons);

    this.traffic = new TrafficSystem(graph, this.signals, nodeRadius, map.manifest.traffic);
    this.traffic.setDensity(this.settings.trafficDensity);
    this.scene.add(this.traffic.group);

    this.car = new CarModel(carStore.get(), { lights: true, shadows: this.settings.shadows });
    this.car.root.rotation.order = 'YXZ';
    const cm = this.car.mats;
    this.env.addReflective(cm.paint, cm.glass, cm.chrome, cm.headLens, cm.rim);
    const sea = this.ground.group.getObjectByName('sea') as THREE.Mesh | undefined;
    if (sea) this.env.addReflective(sea.material as THREE.MeshStandardMaterial);
    this.scene.add(this.car.root);
    this.disposers.push(carStore.subscribe(() => this.car.applyConfig(carStore.get())));
    this.nav = new Navigator(graph);
    this.scene.add(this.nav.group);

    // Spawn and stream the city around the start.
    this.applySession(session, true);
    progress(0.55, 'Streaming city blocks');
    await this.world.preload(this.state.x, this.state.z, Math.min(this.settings.viewDistance, 750), (f) => progress(0.55 + f * 0.35, 'Streaming city blocks'));
    this.camera.far = Math.max(900, this.settings.viewDistance * 1.5);
    this.camera.updateProjectionMatrix();
    this.collision.setSafePoint(this.state.x, this.state.z, this.state.heading, 0);
    this.rig.reset();
    this.updateVisuals(0);
    this.rig.update(0, this.cameraTarget(), (ax, az, bx, bz) => this.collision.raycast(ax, az, bx, bz), (x, z, y) => this.surface.heightAt(x, z, y));
    this.env.update(0, this.car.root.position, this.camera);

    progress(0.93, 'Compiling shaders');
    await tick();
    try {
      this.engine.renderer.compile(this.scene, this.camera);
    } catch (err) {
      console.warn('Shader pre-compile failed (will compile lazily)', err);
    }
    if (this.env.night > 0.35) this.car.setHeadlights(true);
    progress(1, 'Ready');
    this.audio.startDrive();
    this.loaded = true;
  }

  // ------------------------------------------------------------------ session / spawn
  applySession(session: Session, initial = false): void {
    if (!this.map) return;
    this.session = session;
    const m = this.map.manifest;
    this.run?.dispose();
    if (this.run) this.scene.remove(this.run.group);
    this.run = null;
    if (session.mode === 'checkpoints') {
      const def = ROUTES.find((r) => r.id === session.route && r.district === m.id) ?? ROUTES.find((r) => r.district === m.id);
      if (def) {
        this.run = CheckpointRun.create(this.map.graph, def, m.destinations);
        if (this.run) {
          this.scene.add(this.run.group);
          const p = this.run.startPose();
          this.place(p.x, p.z, p.heading, p.y);
          this.nav.setDestination(null);
          if (!initial) toast(`${def.name}: drive through the gates`, 'info', 4000);
          return;
        }
      }
      toast('That checkpoint route is not available here — free roam instead', 'warn');
    }
    if (session.customDestination) this.nav.setDestination({ ...session.customDestination, name: 'Map waypoint' });
    else {
      const d = m.destinations.find((x) => x.id === session.destination);
      this.nav.setDestination(d ? { x: d.x, z: d.z, name: d.name } : null);
    }
    if (initial) this.respawn(true);
    else this.nav.reroute(this.state.x, this.state.z, this.state.heading, this.state.y, this.time);
  }

  /** Puts the car on the nearest suitable road, in the left lane, facing a legal direction. */
  respawn(toStart: boolean): void {
    if (!this.map) return;
    const graph = this.map.graph;
    let x = this.state.x;
    let z = this.state.z;
    let preferHeading: number | null = this.state.heading;
    if (toStart) {
      if (this.run) {
        const p = this.run.startPose();
        this.run.reset();
        this.place(p.x, p.z, p.heading, p.y);
        return;
      }
      const s = this.session;
      const m = this.map.manifest;
      const d = s && s.start !== 'spawn' ? m.destinations.find((dd) => dd.id === s.start) : null;
      x = d ? d.x : m.spawn.x;
      z = d ? d.z : m.spawn.z;
      preferHeading = null;
    }
    const near =
      graph.nearest(x, z, 260, (e, i) => !!graph.main[i] && e.k <= Kind.Tertiary && !e.h, toStart ? undefined : this.state.y) ??
      graph.nearest(x, z, 2000, (_e, i) => !!graph.main[i]) ??
      graph.nearest(x, z, 1e5);
    if (!near) return;
    const e = graph.edges[near.edge];
    let towardsB = true;
    if (!e.o) {
      if (preferHeading !== null) {
        const fx = -Math.sin(preferHeading);
        const fz = -Math.cos(preferHeading);
        towardsB = fx * near.tx + fz * near.tz >= 0;
      } else towardsB = true;
    }
    const dx = towardsB ? near.tx : -near.tx;
    const dz = towardsB ? near.tz : -near.tz;
    const lanes = e.o ? Math.max(1, e.l) : Math.max(1, Math.floor(e.l / 2));
    const laneW = e.o ? e.w / lanes : e.w / 2 / lanes;
    const off = e.w / 2 - laneW * 0.5;
    this.place(near.x + dz * off, near.z - dx * off, Math.atan2(-dx, -dz), near.h);
    if (!toStart) toast('Car reset onto the road', 'info', 1600);
  }

  private place(x: number, z: number, heading: number, y: number): void {
    resetVehicle(this.state, x, z, heading, y);
    this.prevX = x;
    this.prevZ = z;
    this.collision?.setSafePoint(x, z, heading, this.time);
    this.rig.reset();
    this.stuckTime = 0;
  }

  // ------------------------------------------------------------------ settings
  applySettings(s: Settings): void {
    const prev = this.settings;
    this.settings = s;
    if (!this.loaded) return;
    if (prev.timeOfDay !== s.timeOfDay || prev.weather !== s.weather || prev.quality !== s.quality || prev.shadows !== s.shadows) {
      this.env.apply(s.timeOfDay, s.weather, s.quality, s.shadows);
      if (s.timeOfDay === 'night' && !this.car.isHeadlightsOn()) this.car.setHeadlights(true);
    }
    if (prev.shadows !== s.shadows) {
      this.world.setShadows(s.shadows);
      this.car.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = s.shadows;
      });
    }
    this.world.setViewDistance(s.viewDistance);
    this.camera.far = Math.max(900, s.viewDistance * 1.5);
    this.camera.updateProjectionMatrix();
    this.traffic.setDensity(s.trafficDensity);
    if (prev.camera !== s.camera) this.rig.setMode(s.camera);
    this.vehicleEnv.assist = s.steeringAssist;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.audio.setPaused(p);
    if (p) this.audio.horn(false);
  }

  // ------------------------------------------------------------------ frame
  update(dt: number): void {
    if (!this.loaded || !this.map) return;
    if (this.paused) {
      this.env.update(dt, this.car.root.position, this.camera);
      return;
    }
    this.time += dt;
    this.telemetry.elapsed += dt;
    worldUniforms.uTime.value = this.time;
    const s = this.state;
    const input = this.input;
    const axes = input.update(dt, this.settings.steeringSensitivity, s.vx);

    if (input.consume('camera')) {
      const mode = this.rig.next();
      toast(CAMERA_LABEL[mode], 'info', 1200);
      settingsStore.set({ camera: mode });
    }
    if (input.consume('lights')) {
      this.car.setHeadlights(!this.car.isHeadlightsOn());
      toast(this.car.isHeadlightsOn() ? 'Headlights on' : 'Headlights off', 'info', 1200);
    }
    if (input.consume('mute')) {
      const muted = !settingsStore.get().muted;
      settingsStore.set({ muted });
      toast(muted ? 'Audio muted' : 'Audio on', 'info', 1200);
    }
    if (input.consume('reset')) this.respawn(false);
    this.audio.horn(input.isHeld('horn'));

    // Surface grip: sand on Chowpatty, wet roads in the monsoon.
    const sand = sampleMask(this.map.mask, s.x, s.z, 2);
    this.vehicleEnv.grip = (1 - 0.3 * Math.min(1, sand * 1.5)) * (this.env.wet ? 0.84 : 1);

    // ---- Fixed-step physics.
    this.traffic.circlesNear(s.x, s.z, 40, this.dyn);
    this.acc += dt;
    let steps = 0;
    let strongest: ReturnType<CollisionWorld['resolveVehicle']> = null;
    while (this.acc >= STEP && steps < 13) {
      stepVehicle(s, axes, GT_PARAMS, STEP, this.vehicleEnv);
      const elevated = s.y > 1.6;
      const push = this.surface.constrain(s);
      if (push) {
        // Parapet: remove outward velocity.
        const [wx, wz] = worldVelocity(s);
        const vn = -(wx * push.nx + wz * push.nz);
        if (vn > 0) {
          const nwx = wx + push.nx * vn * 1.2;
          const nwz = wz + push.nz * vn * 1.2;
          const sin = Math.sin(s.heading);
          const cos = Math.cos(s.heading);
          s.vx = -sin * nwx - cos * nwz;
          s.vy = -cos * nwx + sin * nwz;
          if (vn > 3) strongest = { impact: vn, nx: push.nx, nz: push.nz, kind: 'wall' };
        }
      }
      const c = this.collision.resolveVehicle(s, GT_PARAMS, elevated, this.dyn, this.time);
      if (c && (!strongest || c.impact > strongest.impact)) strongest = c;
      this.acc -= STEP;
      steps++;
    }
    if (steps >= 13) this.acc = 0;
    if (strongest) this.onContact(strongest);
    if (s.y < -3) this.respawn(false);

    // Stuck helper: throttle held, not moving, for a while.
    if (axes.throttle > 0.5 && Math.abs(s.vx) < 0.5) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 4) {
      toast('Stuck? Press R to reset onto the road', 'info', 2500);
      this.stuckTime = -6;
    }

    // ---- Systems.
    this.signals.update(this.time);
    const [wvx, wvz] = worldVelocity(s);
    this.traffic.update(dt, { x: s.x, z: s.z, vx: wvx, vz: wvz, heading: s.heading }, this.time);
    this.nav.update(s.x, s.z, s.heading, s.y, this.time);
    if (this.nav.info?.arrived && !this.telemetry.nav?.arrived) {
      toast(`Arrived at ${this.nav.info.destName}`, 'success', 4000);
    }
    if (this.run) {
      const r = this.run.update(dt, s.x, s.z, this.prevX, this.prevZ);
      if (r === 'gate') {
        this.audio.ui('click');
        toast(`Checkpoint ${this.run.index}/${this.run.gates.length}`, 'success', 1200);
      } else if (r === 'finish') {
        this.audio.ui('click');
        toast(`${this.run.def.name} finished in ${formatTime(this.run.time)}${this.run.best === this.run.time ? ' — new best!' : ''}`, 'success', 6000);
      }
    }
    this.checkRedLight();
    this.prevX = s.x;
    this.prevZ = s.z;

    this.updateVisuals(dt);
    this.world.update(s.x, s.z);
    this.lodTimer -= dt;
    if (this.lodTimer <= 0) {
      this.lodTimer = 0.5;
      for (const t of this.tetrapods) {
        const m = t as THREE.InstancedMesh;
        const c = m.boundingSphere?.center;
        t.visible = !c || Math.hypot(c.x - s.x, c.z - s.z) < 650;
      }
    }
    updateLampMaterials(this.env.night);
    this.rig.update(dt, this.cameraTarget(), (ax, az, bx, bz) => this.collision.raycast(ax, az, bx, bz), (x, z, y) => this.surface.heightAt(x, z, y));
    this.env.update(dt, this.car.root.position, this.camera);

    // ---- Audio.
    this.audio.updateEngine({ rpm: s.rpm, throttle: s.drive, boost: s.boost, speed: s.vx, squeal: s.squeal, gear: s.gear, onDeck: s.y > 1.6 });
    this.ambienceTimer -= dt;
    if (this.ambienceTimer <= 0) {
      this.ambienceTimer = 0.5;
      let water = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        water += 1 - sampleMask(this.map.mask, s.x + Math.cos(a) * 70, s.z + Math.sin(a) * 70, 0);
      }
      this.audio.setAmbience({
        sea: Math.min(1, water / 3),
        traffic: Math.min(1, this.traffic.activeCount / 60),
        night: this.env.night,
        rain: this.env.wet,
      });
    }

    // ---- Telemetry.
    this.roadTimer -= dt;
    const t = this.telemetry;
    if (this.roadTimer <= 0) {
      this.roadTimer = 0.3;
      const near = this.map.graph.nearest(s.x, s.z, 18, undefined, s.y);
      t.roadName = near ? this.map.graph.name(near.edge) : undefined;
      t.roadNameMr = near ? this.map.graph.nameMr(near.edge) : undefined;
    }
    t.x = s.x;
    t.y = s.y;
    t.z = s.z;
    t.heading = s.heading;
    t.speed = s.vx;
    t.rpm = s.rpm;
    t.gear = s.gear;
    t.throttle = axes.throttle;
    t.brake = axes.brake;
    t.odometer = s.odometer;
    t.headlights = this.car.isHeadlightsOn();
    t.camera = this.rig.mode;
    t.onDeck = s.y > 1.6;
    t.nav = this.nav.info;
    t.checkpoint = this.run ? this.run.info() : null;
  }

  private onContact(c: NonNullable<ReturnType<CollisionWorld['resolveVehicle']>>): void {
    if (c.impact > 1.5) {
      this.audio.collision(Math.min(1, c.impact / 18));
      this.rig.impact(Math.min(1, c.impact / 20));
    }
    if (c.kind === 'vehicle' && c.vehicle !== undefined) this.traffic.bump(c.vehicle);
    if (c.kind === 'bounds' && this.time - this.boundsToastAt > 5) {
      this.boundsToastAt = this.time;
      toast('Edge of the mapped district — turn back', 'warn', 2500);
    }
  }

  private checkRedLight(): void {
    if (!this.map) return;
    const s = this.state;
    const near = this.map.graph.nearest(s.x, s.z, 12, undefined, s.y);
    if (!near) return;
    if (near.edge === this.lastEdge && Math.abs(s.vx) > 5) {
      const towardsB = near.s > this.lastEdgeS;
      const stop = this.signals.stopLine(near.edge, towardsB);
      const light = this.signals.state(near.edge, towardsB);
      if (stop !== null && light === 0) {
        const len = this.map.graph.lengths[near.edge];
        const prev = towardsB ? this.lastEdgeS : len - this.lastEdgeS;
        const cur = towardsB ? near.s : len - near.s;
        if (prev < stop && cur >= stop && this.time - this.redLightAt > 6) {
          this.redLightAt = this.time;
          toast('You jumped a red light!', 'warn', 2200);
        }
      }
    }
    this.lastEdge = near.edge;
    this.lastEdgeS = near.s;
  }

  private cameraTarget() {
    const s = this.state;
    const [vx, vz] = worldVelocity(s);
    return { x: s.x, y: s.y, z: s.z, heading: s.heading, pitch: s.pitch + s.bodyPitch, roll: s.bodyRoll, vx, vz, forwardSpeed: s.vx, steer: s.steer };
  }

  private updateVisuals(_dt: number): void {
    const s = this.state;
    const car = this.car;
    car.root.position.set(s.x, s.y, s.z);
    car.root.rotation.set(s.pitch, s.heading, 0, 'YXZ');
    car.body.rotation.set(s.bodyPitch, 0, s.bodyRoll);
    car.body.position.y = -Math.abs(s.bodyPitch) * 0.4 - s.landed * 0.05;
    car.update(s.wheelRotF, s.wheelRotR, s.steer);
    car.setBrake(s.braking > 0.1 || (s.vx > 0.5 && this.input.axes.handbrake > 0));
    car.setReverse(s.gear < 0);
    car.setBeamStrength(car.isHeadlightsOn() ? this.env.night * 0.6 + (this.env.wet ? 0.3 : 0) : 0);
    const cockpit = this.rig.mode === 'cockpit';
    car.mats.glass.opacity = cockpit ? 0.06 : 0.55 + carStore.get().tint * 0.4;
    car.mats.glass.envMapIntensity = cockpit ? 0.08 : 1.6;
  }

  routePoints(): number[] | null {
    if (this.run) return this.run.finished ? null : this.run.remainingPoints();
    return this.nav?.remainingPoints() ?? null;
  }

  targetPoint(): { x: number; z: number; kind: 'destination' | 'checkpoint' } | null {
    if (this.run) {
      const g = this.run.nextGate;
      return g && !this.run.finished ? { x: g.x, z: g.z, kind: 'checkpoint' } : null;
    }
    const d = this.nav?.destination;
    return d ? { x: d.x, z: d.z, kind: 'destination' } : null;
  }

  trafficPoints(): [number, number][] {
    return this.traffic ? this.traffic.points(this.trafficPts) : [];
  }

  bloom() {
    return this.env ? this.env.bloom() : { strength: 0.3, radius: 0.5, threshold: 0.9 };
  }

  /** Debug snapshot for automated checks (read-only). */
  debugState() {
    return {
      x: this.state.x,
      z: this.state.z,
      y: this.state.y,
      speedKmh: this.state.vx * 3.6,
      gear: this.state.gear,
      chunks: this.world?.loadedChunks ?? 0,
      colliders: this.collision?.segmentCount ?? 0,
      traffic: this.traffic?.activeCount ?? 0,
      signals: this.signals?.count ?? 0,
      camera: this.rig.mode,
      headlights: this.car?.isHeadlightsOn() ?? false,
      route: !!this.nav?.route,
      district: this.map?.manifest.id,
      fallback: this.map?.fallback ?? false,
    };
  }

  dispose(): void {
    this.loaded = false;
    this.disposers.forEach((d) => d());
    this.audio.stopDrive();
    this.world?.dispose();
    this.ground?.dispose();
    this.traffic?.dispose();
    this.signals?.dispose();
    this.nav?.dispose();
    this.run?.dispose();
    this.env?.dispose();
    this.car?.dispose();
    this.collision?.clear();
    this.scene.clear();

  }
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}
