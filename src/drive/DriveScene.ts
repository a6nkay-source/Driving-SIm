/**
 * The playable drive: loads a district, builds the world, spawns the player on
 * a road, and runs physics, traffic, navigation, camera, audio and telemetry
 * every frame.
 */
import * as THREE from 'three';
import { toast, type Session } from '../app/state';
import type { AudioEngine } from '../audio/AudioEngine';
import { L, type Line } from '../audio/lines';
import type { Voice } from '../audio/Voice';
import { CAMERA_LABEL, CameraRig } from '../camera/CameraRig';
import { COMMAND_EXAMPLES, type Command } from '../commands/CommandParser';
import { buildPlaces, type NamedPlace } from '../commands/places';
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
import { PedestrianSystem } from '../traffic/Pedestrians';
import { AMBER, RED, SignalSystem } from '../traffic/Signals';
import { DENSITY_LEVELS, TrafficSystem } from '../traffic/TrafficSystem';
import { CarModel } from '../vehicle/CarModel';
import { FLEET, isVehicleId, type PlayerVehicleId } from '../vehicle/fleet';
import { createUtilityModel, type PlayerModel } from '../vehicle/MumbaiVehicles';
import {
  createVehicleState,
  GT_PARAMS,
  resetVehicle,
  stepVehicle,
  worldVelocity,
  type VehicleControls,
  type VehicleEnv,
  type VehicleParams,
  type VehicleState,
} from '../vehicle/VehiclePhysics';
import { Autopilot, type AutopilotStatus } from './Autopilot';
import { buildGround, type GroundObjects } from '../world/Ground';
import { buildLandmarks } from '../world/Landmarks';
import { worldUniforms } from '../world/materials';
import { buildBusStops, buildDirectionBoards, buildRegulatorySigns, placeRegulatorySigns, updateLampMaterials } from '../world/Props';
import { Environment } from '../world/Environment';
import { SkylineLayer } from '../world/Skyline';
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
  vehicle: PlayerVehicleId;
  autopilot: { status: AutopilotStatus; target: number } | null;
  crowd: number;
}

export interface CommandResult {
  ok: boolean;
  reply: string;
}

const STEP = 1 / 120;
const SEA_FACE = /marine drive|sea face|purandare|carter road|bandstand|netaji subhash/i;
/** Destinations that draw big crowds (beaches, stations, shrines, markets). */
const CROWD_SPOTS: Record<string, 'beach' | 'landmark' | 'place'> = {
  chowpatty: 'beach',
  gateway: 'landmark',
  csmt: 'landmark',
  churchgate: 'landmark',
  'mumbai-central': 'landmark',
  'bandra-station': 'landmark',
  siddhivinayak: 'landmark',
  'haji-ali': 'landmark',
  'crawford-market': 'landmark',
  'colaba-causeway': 'landmark',
  'linking-road': 'landmark',
  'hill-road': 'landmark',
  bandstand: 'beach',
  'marine-drive': 'place',
  'kala-ghoda': 'place',
  'shivaji-park': 'place',
  'mount-mary': 'place',
  'flora-fountain': 'place',
  'worli-sea-face': 'place',
  'carter-road': 'place',
};

export class DriveScene implements SceneController {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.5, 16000);
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
    vehicle: 'gtr',
    autopilot: null,
    crowd: 0,
  };
  /** Everything a command can drive to. */
  places: NamedPlace[] = [];

  private env!: Environment;
  private world!: World;
  private ground!: GroundObjects;
  private collision!: CollisionWorld;
  private surface!: SurfaceSystem;
  private signals!: SignalSystem;
  private traffic!: TrafficSystem;
  private nav!: Navigator;
  private run: CheckpointRun | null = null;
  private car!: PlayerModel;
  private vehicleId: PlayerVehicleId = 'gtr';
  private params: VehicleParams = GT_PARAMS;
  private skyline: SkylineLayer | null = null;
  private peds!: PedestrianSystem;
  private autopilot!: Autopilot;
  private apOut: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  private apTraffic: DynamicCircle[] = [];
  private apStatus: AutopilotStatus = 'driving';
  private hornPulse = 0;
  private vendorHeard = new Map<string, number>();
  private nextVendorAt = 0;
  private nextBellAt = 20;
  private nextTrainAt = 25;
  private nextShoutAt = 0;
  private busStopAt = -1;
  private busStopTimer = 0;
  private nextPassengerAt = 30;
  private spokenManeuver = '';
  private railPts: number[] = [];
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
    private readonly voice: Voice,
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
    this.world.setStreetLife(this.settings.streetLife);
    this.scene.add(this.world.group);
    // Far skyline: every tall building in the city, hidden tile by tile as the detailed blocks stream in.
    if (map.skyline.length) {
      const skyline = new SkylineLayer(map.skyline, map.manifest);
      this.skyline = skyline;
      this.scene.add(skyline.group);
      this.world.onTileVisibility = (cx, cz, loaded) => skyline.setLoaded(cx, cz, loaded);
    }
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
    this.traffic.onHonk = (x, z, kind) => {
      const [right, fwd] = this.relative(x, z);
      this.audio.honkAt(right, fwd, kind);
    };
    this.scene.add(this.traffic.group);

    // Crowds: footpaths everywhere, packed at beaches, stations, shrines and bus stops.
    progress(0.52, 'Filling the footpaths');
    await tick();
    const spots: { x: number; z: number; kind: string }[] = [];
    for (const d of map.manifest.destinations) if (CROWD_SPOTS[d.id]) spots.push({ x: d.x, z: d.z, kind: CROWD_SPOTS[d.id] });
    for (const p of map.network.pois) if (p.kind === 'station') spots.push({ x: p.x, z: p.z, kind: 'landmark' });
    this.peds = new PedestrianSystem(graph, map.mask, PedestrianSystem.hotspotsFor(graph, map.mask, this.seaFace, spots, map.network.busStops));
    this.peds.setDensity(this.settings.crowdDensity);
    this.peds.onShout = (x, z) => this.shout(x, z);
    this.scene.add(this.peds.group);
    for (const line of map.network.rail) for (let i = 0; i < line.length; i += 2) this.railPts.push(line[i], line[i + 1]);

    const sea = this.ground.group.getObjectByName('sea') as THREE.Mesh | undefined;
    if (sea) this.env.addReflective(sea.material as THREE.MeshStandardMaterial);
    const startVehicle = carStore.get().vehicle;
    this.setVehicle(isVehicleId(startVehicle) ? startVehicle : 'gtr', true);
    this.disposers.push(
      carStore.subscribe(() => {
        const c = carStore.get();
        if (isVehicleId(c.vehicle) && c.vehicle !== this.vehicleId) this.setVehicle(c.vehicle);
        else if (this.car instanceof CarModel) this.car.applyConfig(c);
      }),
    );
    this.nav = new Navigator(graph);
    this.scene.add(this.nav.group);
    this.places = buildPlaces(map);
    this.autopilot = new Autopilot({
      laneOffset: (st) => {
        const e = graph.edges[st.edge];
        if (e.o) return e.l >= 2 ? (e.w / 2 - e.w / e.l / 2) * 0.35 : 0;
        const lanes = Math.max(1, Math.floor(e.l / 2));
        return e.w / 2 / lanes / 2;
      },
      speedLimit: (st) => SPEED_LIMIT[graph.edges[st.edge].k] ?? 9,
      signal: (st) => {
        const stopS = this.signals.stopLine(st.edge, st.towardsB);
        if (stopS === null) return null;
        const light = this.signals.state(st.edge, st.towardsB);
        return { stopS, stop: light === RED || light === AMBER };
      },
      edgeLength: (edge) => graph.lengths[edge],
    });

    // Spawn and stream the city around the start.
    this.applySession(session, true);
    progress(0.55, 'Streaming city blocks');
    await this.world.preload(this.state.x, this.state.z, Math.min(this.settings.viewDistance, 750), (f) => progress(0.55 + f * 0.35, 'Streaming city blocks'));
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
    setTimeout(() => {
      if (this.loaded) this.voice.say(L.welcome(), { priority: 2 });
    }, 1400);
  }

  // ------------------------------------------------------------------ vehicles
  /** Swaps the player's vehicle in place (keeps position, speed resets). */
  setVehicle(id: PlayerVehicleId, initial = false): void {
    const prev = this.car;
    const lights = prev?.isHeadlightsOn() ?? false;
    if (prev) {
      this.scene.remove(prev.root);
      this.env.removeReflective(...prev.reflective);
      prev.dispose();
    }
    const model: PlayerModel = id === 'gtr' ? new CarModel(carStore.get(), { lights: true, shadows: this.settings.shadows }) : createUtilityModel(id);
    model.root.rotation.order = 'YXZ';
    model.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.castShadow) o.castShadow = this.settings.shadows;
    });
    this.env.addReflective(...model.reflective);
    this.scene.add(model.root);
    this.car = model;
    this.vehicleId = id;
    this.params = FLEET[id].params;
    this.rig.setProfile(FLEET[id].camera);
    this.audio.setVehicle(FLEET[id].engine, id);
    model.setHeadlights(lights);
    this.telemetry.vehicle = id;
    if (!initial) {
      // A bigger vehicle may not fit where the last one stood: put it back on the road.
      const s = this.state;
      const speed = s.vx;
      this.respawn(false, true);
      if (speed > 1) this.state.vx = Math.min(speed, (this.params.topSpeed ?? 60) * 0.8);
      this.updateVisuals(0);
      this.voice.say(L.vehicle(id), { priority: 2 });
    }
  }

  /** A world position relative to the player: metres to the right and ahead. */
  private relative(x: number, z: number): [number, number] {
    const s = this.state;
    const dx = x - s.x;
    const dz = z - s.z;
    const sin = Math.sin(s.heading);
    const cos = Math.cos(s.heading);
    return [dx * cos - dz * sin, -dx * sin - dz * cos];
  }

  private shout(x: number, z: number): void {
    if (this.time < this.nextShoutAt) return;
    this.nextShoutAt = this.time + 5 + Math.random() * 4;
    const d = Math.hypot(x - this.state.x, z - this.state.z);
    this.voice.say(L.shout(), { priority: 0, volume: Math.max(0.35, 1 - d / 30), pitch: 0.8 + Math.random() * 0.6, rate: 1.15, who: 'Passer-by' });
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
  respawn(toStart: boolean, quiet = false): void {
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
    if (!toStart && !quiet) toast('Back on the road', 'info', 1600);
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
      if (prev.weather !== s.weather) this.voice.say(s.weather === 'monsoon' ? L.rain() : L.clear(), { priority: 1 });
      else if (prev.timeOfDay !== s.timeOfDay) this.voice.say(s.timeOfDay === 'night' ? L.night() : s.timeOfDay === 'sunset' ? L.sunset() : L.day(), { priority: 1 });
    }
    if (prev.shadows !== s.shadows) {
      this.world.setShadows(s.shadows);
      this.car.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = s.shadows;
      });
    }
    this.world.setViewDistance(s.viewDistance);
    this.world.setStreetLife(s.streetLife);
    this.traffic.setDensity(s.trafficDensity);
    this.peds.setDensity(s.crowdDensity);
    if (prev.camera !== s.camera) this.rig.setMode(s.camera);
    this.vehicleEnv.assist = s.steeringAssist;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.audio.setPaused(p);
    if (p) this.audio.horn(false);
    if (p) this.voice.stop();
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
    let axes: VehicleControls = input.update(dt, this.settings.steeringSensitivity, s.vx);
    if (input.consume('autopilot')) this.toggleAutopilot();
    if (this.autopilot.active) {
      const manual = axes.throttle > 0.05 || axes.brake > 0.05 || Math.abs(axes.steer) > 0.2 || axes.handbrake > 0.05;
      if (manual) {
        this.autopilot.disengage();
        toast('Autopilot off — you have control', 'info', 1800);
      } else if (this.nav.route) {
        this.traffic.circlesNear(s.x, s.z, 60, this.apTraffic);
        axes = this.autopilot.update(dt, s, this.params, this.nav.route, this.nav.routeProgress, this.apTraffic, this.apOut);
        if (this.autopilot.status === 'signal' && this.apStatus !== 'signal' && Math.random() < 0.35) this.voice.say(L.redLight(), { priority: 1 });
        this.apStatus = this.autopilot.status;
      } else {
        // Waiting for a route: hold position.
        this.apOut.throttle = 0;
        this.apOut.steer = 0;
        this.apOut.brake = Math.abs(s.vx) > 0.8 ? 0.6 : 0;
        this.apOut.handbrake = Math.abs(s.vx) > 0.8 ? 0 : 1;
        axes = this.apOut;
      }
    }

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
    this.hornPulse -= dt;
    this.audio.horn(input.isHeld('horn') || this.hornPulse > 0 || (this.autopilot.active && this.autopilot.wantsHorn));

    // Surface grip: sand on Chowpatty, wet roads in the monsoon.
    const sand = sampleMask(this.map.mask, s.x, s.z, 2);
    this.vehicleEnv.grip = (1 - 0.3 * Math.min(1, sand * 1.5)) * (this.env.wet ? 0.84 : 1);

    // ---- Fixed-step physics.
    this.traffic.circlesNear(s.x, s.z, 40, this.dyn);
    this.acc += dt;
    let steps = 0;
    let strongest: ReturnType<CollisionWorld['resolveVehicle']> = null;
    while (this.acc >= STEP && steps < 13) {
      stepVehicle(s, axes, this.params, STEP, this.vehicleEnv);
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
      const c = this.collision.resolveVehicle(s, this.params, elevated, this.dyn, this.time);
      if (c && (!strongest || c.impact > strongest.impact)) strongest = c;
      this.acc -= STEP;
      steps++;
    }
    if (steps >= 13) this.acc = 0;
    if (strongest) this.onContact(strongest);
    if (s.y < -3) this.respawn(false);

    // Stuck helper: throttle held, not moving, for a while.
    if (!this.autopilot.active && axes.throttle > 0.5 && Math.abs(s.vx) < 0.5) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 4) {
      toast('Stuck? Press R to reset onto the road', 'info', 2500);
      this.stuckTime = -6;
    }

    // ---- Systems.
    this.signals.update(this.time);
    const [wvx, wvz] = worldVelocity(s);
    this.traffic.update(dt, { x: s.x, z: s.z, vx: wvx, vz: wvz, heading: s.heading }, this.time);
    this.peds.update(dt, { x: s.x, z: s.z, heading: s.heading, speed: s.vx }, this.time);
    this.nav.update(s.x, s.z, s.heading, s.y, this.time);
    if (this.nav.info?.arrived && !this.telemetry.nav?.arrived) {
      if (this.autopilot.active) this.autopilot.finishSoon(this.nav.routeProgress, Math.abs(s.vx));
      toast(`Arrived at ${this.nav.info.destName}`, 'success', 4000);
      const place = this.places.find((p) => p.label === this.nav.info?.destName);
      const en = this.nav.info.destName;
      this.voice.say(L.arrived(place?.hi ?? en, place?.mr ?? en, en), { priority: 2 });
    }
    if (this.autopilot.active && this.autopilot.status === 'arrived') this.autopilot.disengage();
    this.speakGuidance();
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

    this.updateVisuals(dt, axes);
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
      const railD = this.nearestRail();
      this.telemetry.crowd = Math.min(1, this.peds.count / 160);
      this.audio.setAmbience({
        sea: Math.min(1, water / 3),
        traffic: Math.min(1, this.traffic.activeCount / 90),
        night: this.env.night,
        rain: this.env.wet,
        crowd: this.telemetry.crowd * (this.env.wet ? 0.5 : 1),
        rail: Math.max(0, 1 - railD.d / 220),
      });
      this.streetSounds(railD);
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
    t.autopilot = this.autopilot.active ? { status: this.autopilot.status, target: this.autopilot.targetSpeed } : null;
  }

  // ------------------------------------------------------------------ voices & street sounds
  private nearestRail(): { d: number; x: number; z: number } {
    const s = this.state;
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    const pts = this.railPts;
    for (let i = 0; i < pts.length; i += 2) {
      const dx = pts[i] - s.x;
      const dz = pts[i + 1] - s.z;
      if (Math.abs(dx) > 600 || Math.abs(dz) > 600) continue;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        bx = pts[i];
        bz = pts[i + 1];
      }
    }
    return { d: Math.sqrt(best), x: bx, z: bz };
  }

  /** Hawkers, temple bells, local trains, the bus conductor and rickshaw passengers. */
  private streetSounds(rail: { d: number; x: number; z: number }): void {
    const s = this.state;
    const t = this.time;
    const speed = Math.abs(s.vx);
    // Street vendors call out as you pass.
    if (t > this.nextVendorAt && speed < 14) {
      let best: { key: string; d: number; kind: string } | null = null;
      for (const v of this.world.vendorsNear(s.x, s.z, 32)) {
        const key = `${Math.round(v.x)}:${Math.round(v.z)}`;
        if ((this.vendorHeard.get(key) ?? -1e9) > t - 45) continue;
        const d = Math.hypot(v.x - s.x, v.z - s.z);
        if (!best || d < best.d) best = { key, d, kind: v.kind };
      }
      if (best) {
        this.vendorHeard.set(best.key, t);
        this.nextVendorAt = t + 7 + Math.random() * 6;
        this.voice.say(L.vendor(best.kind), { priority: 0, volume: Math.max(0.3, 1 - best.d / 36), pitch: 0.85 + Math.random() * 0.4, rate: 1.05, who: 'Hawker' });
      }
    }
    // Temple / church bells.
    if (t > this.nextBellAt) {
      const shrines = this.world.shrinesNear(s.x, s.z, 160);
      if (shrines.length) {
        const [x, z] = shrines[Math.floor(Math.random() * shrines.length)];
        const mary = this.map?.manifest.destinations.find((d) => d.id === 'mount-mary');
        const church = !!mary && Math.hypot(mary.x - x, mary.z - z) < 260;
        const [right, fwd] = this.relative(x, z);
        this.audio.bell(right, fwd, church);
        this.nextBellAt = t + 22 + Math.random() * 25;
      } else this.nextBellAt = t + 6;
    }
    // Local trains on the Western and Central lines.
    if (t > this.nextTrainAt) {
      if (rail.d < 320) {
        const [right, fwd] = this.relative(rail.x, rail.z);
        this.audio.trainHorn(right, fwd);
        this.nextTrainAt = t + 35 + Math.random() * 40;
      } else this.nextTrainAt = t + 8;
    }
    // Driving the BEST bus: stop at a bus stop and the conductor takes over.
    if (this.vehicleId === 'bus') {
      const stops = this.map?.network.busStops ?? [];
      let at = -1;
      for (let i = 0; i < stops.length; i++) if (Math.abs(stops[i][0] - s.x) < 18 && Math.abs(stops[i][1] - s.z) < 18 && Math.hypot(stops[i][0] - s.x, stops[i][1] - s.z) < 16) at = i;
      if (at >= 0 && speed < 0.6) {
        this.busStopTimer += 0.5;
        if (this.busStopTimer >= 1 && this.busStopAt !== at) {
          this.busStopAt = at;
          this.audio.busBell(1);
          this.voice.say(L.conductor(), { priority: 1, pitch: 0.9, who: 'Conductor' });
          toast('Bus stop — passengers boarding', 'info', 2000);
        }
      } else {
        if (this.busStopAt >= 0 && this.busStopTimer >= 1 && speed > 1) {
          this.audio.busBell(2);
          this.busStopTimer = 0;
        }
        if (at < 0) this.busStopAt = this.busStopAt >= 0 && speed > 1 ? -1 : this.busStopAt;
      }
    }
    // Driving the auto: people flag you down near stations and crowds.
    if (this.vehicleId === 'auto' && speed < 2 && t > this.nextPassengerAt && this.peds.count > 40) {
      this.nextPassengerAt = t + 40 + Math.random() * 30;
      this.voice.say(L.passenger(), { priority: 1, pitch: 0.9 + Math.random() * 0.3, who: 'Passenger' });
    }
  }

  /** Spoken turn-by-turn guidance when you drive yourself. */
  private speakGuidance(): void {
    const info = this.nav.info;
    if (!info || info.arrived || this.autopilot.active) return;
    const turn = info.turn === 'left' || info.turn === 'right' || info.turn === 'uturn' ? info.turn : null;
    if (!turn || info.stepDistance > 70 || info.stepDistance < 15) return;
    const key = `${info.instruction}:${Math.round(info.distance - info.stepDistance)}`;
    if (key === this.spokenManeuver) return;
    this.spokenManeuver = key;
    this.voice.say(L.turn(turn), { priority: 2 });
  }

  // ------------------------------------------------------------------ autopilot & commands
  private toggleAutopilot(): void {
    if (this.autopilot.active) {
      this.autopilot.disengage();
      toast('Autopilot off', 'info', 1500);
      this.voice.say(L.handBack(), { priority: 2 });
      return;
    }
    const d = this.nav.destination;
    if (!d || this.run) {
      toast(this.run ? 'Autopilot is off during checkpoint runs' : 'Pick a destination first — press T and type “go to Gateway of India”', 'info', 3500);
      return;
    }
    this.engageAutopilot(d.name);
  }

  private engageAutopilot(name: string): void {
    this.autopilot.engage();
    this.stuckTime = 0;
    toast(`Autopilot: driving to ${name} — touch any control to take over`, 'success', 3500);
  }

  /** Runs a parsed command and returns a short reply for the command bar. */
  execute(cmd: Command): CommandResult {
    if (!this.loaded || !this.map) return { ok: false, reply: 'Not driving yet' };
    const s = this.state;
    const say = (line: Line, priority = 2) => this.voice.say(line, { priority });
    switch (cmd.type) {
      case 'goto': {
        if (this.run) return { ok: false, reply: 'Finish or leave the checkpoint run first (Map → Free roam).' };
        const p = cmd.place as NamedPlace;
        this.nav.setDestination({ x: p.x, z: p.z, name: p.label });
        const ok = this.nav.reroute(s.x, s.z, s.heading, s.y, this.time);
        if (!ok) {
          say(L.noRoute());
          return { ok: false, reply: `No road route to ${p.label} from here.` };
        }
        const km = ((this.nav.route?.length ?? 0) / 1000).toFixed(1);
        if (cmd.drive) {
          this.engageAutopilot(p.label);
          say(L.autopilot(p.hi ?? p.label, p.mr ?? p.label, p.label));
          return { ok: true, reply: `Autopilot → ${p.label} (${km} km). Touch any control to take over.` };
        }
        this.autopilot.disengage();
        say(L.route(p.hi ?? p.label, p.mr ?? p.label, p.label));
        return { ok: true, reply: `Route set → ${p.label} (${km} km). Press G for autopilot.` };
      }
      case 'unknownPlace':
        say(L.notFound());
        return { ok: false, reply: `Couldn't find “${cmd.query}” on this map. Try a landmark, station or road name.` };
      case 'stop':
        if (!this.autopilot.active) return { ok: true, reply: 'Autopilot is already off.' };
        this.autopilot.disengage();
        say(L.handBack());
        return { ok: true, reply: 'Autopilot off — you have control.' };
      case 'resume': {
        const d = this.nav.destination;
        if (!d) return { ok: false, reply: 'No destination yet — say “go to …”.' };
        this.engageAutopilot(d.name);
        return { ok: true, reply: `Autopilot → ${d.name}` };
      }
      case 'cancelRoute':
        this.autopilot.disengage();
        this.nav.setDestination(null);
        return { ok: true, reply: 'Route cleared.' };
      case 'spawn': {
        const [wvx, wvz] = worldVelocity(s);
        const n = this.traffic.spawnNear(cmd.kind, cmd.count, { x: s.x, z: s.z, vx: wvx, vz: wvz, heading: s.heading });
        if (!n) return { ok: false, reply: 'No room on the roads here — try somewhere else or raise the traffic level.' };
        say(L.spawned(cmd.kind, n), 1);
        const noun = cmd.kind === 'auto' ? 'rickshaw' : cmd.kind === 'bus1' ? 'bus' : cmd.kind;
        return { ok: true, reply: `Added ${n} ${noun}${n > 1 ? (noun.endsWith('s') ? 'es' : 's') : ''} nearby.` };
      }
      case 'vehicle':
        if (cmd.id === this.vehicleId) return { ok: true, reply: `Already driving the ${FLEET[cmd.id].name}.` };
        carStore.set({ vehicle: cmd.id });
        return { ok: true, reply: `Now driving: ${FLEET[cmd.id].name}` };
      case 'busier':
        settingsStore.set({ trafficDensity: 4, crowdDensity: 4 });
        say(L.busier(), 1);
        return { ok: true, reply: 'Rush hour: maximum traffic and crowds.' };
      case 'calmer':
        settingsStore.set({ trafficDensity: 1, crowdDensity: 1 });
        say(L.calmer(), 1);
        return { ok: true, reply: 'Quiet streets.' };
      case 'traffic':
      case 'crowd': {
        const key = cmd.type === 'traffic' ? 'trafficDensity' : 'crowdDensity';
        const cur = this.settings[key];
        const next = cmd.level === 'up' ? Math.min(4, cur + 1) : cmd.level === 'down' ? Math.max(0, cur - 1) : cmd.level;
        settingsStore.set({ [key]: next } as Partial<Settings>);
        const names = cmd.type === 'traffic' ? ['off', 'light', 'normal', 'heavy', 'rush hour'] : ['off', 'few', 'normal', 'busy', 'festival'];
        if (next === 4) say(L.busier(), 1);
        return { ok: true, reply: `${cmd.type === 'traffic' ? 'Traffic' : 'Crowds'}: ${names[next]}` };
      }
      case 'time':
        settingsStore.set({ timeOfDay: cmd.value });
        return { ok: true, reply: `Time of day: ${cmd.value}` };
      case 'weather':
        settingsStore.set({ weather: cmd.value });
        return { ok: true, reply: cmd.value === 'monsoon' ? 'Monsoon rain' : 'Clear skies' };
      case 'camera': {
        const mode = cmd.mode ?? this.rig.next();
        this.rig.setMode(mode);
        settingsStore.set({ camera: mode });
        return { ok: true, reply: CAMERA_LABEL[mode] };
      }
      case 'horn':
        this.hornPulse = 0.5;
        return { ok: true, reply: 'Pom pom!' };
      case 'lights': {
        const on = cmd.on ?? !this.car.isHeadlightsOn();
        this.car.setHeadlights(on);
        return { ok: true, reply: on ? 'Headlights on' : 'Headlights off' };
      }
      case 'reset':
        this.respawn(false);
        return { ok: true, reply: 'Back on the road.' };
      case 'whereami': {
        const road = this.telemetry.roadName ?? 'an unnamed street';
        let nearest = this.map.manifest.destinations[0];
        let nd = Infinity;
        for (const d of this.map.manifest.destinations) {
          const dd = Math.hypot(d.x - s.x, d.z - s.z);
          if (dd < nd) {
            nd = dd;
            nearest = d;
          }
        }
        const roadMr = this.telemetry.roadNameMr ?? road;
        if (nearest) this.voice.say(L.where(roadMr, nearest.nameMr ?? nearest.name), { priority: 2 });
        return { ok: true, reply: `${road}${nearest ? `, ${Math.round(nd)} m from ${nearest.name}` : ''}` };
      }
      case 'speed': {
        this.autopilot.speedFactor = Math.max(0.5, Math.min(1.6, this.autopilot.speedFactor * (cmd.delta > 0 ? 1.2 : 0.8)));
        say(cmd.delta > 0 ? L.faster() : L.slower(), 1);
        return { ok: true, reply: `Autopilot pace ×${this.autopilot.speedFactor.toFixed(2)}` };
      }
      case 'help':
        return { ok: true, reply: COMMAND_EXAMPLES.map((e) => e.text).join(' · ') };
    }
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

  private updateVisuals(_dt: number, axes: VehicleControls = this.input.axes): void {
    const s = this.state;
    const car = this.car;
    car.root.position.set(s.x, s.y, s.z);
    car.root.rotation.set(s.pitch, s.heading, 0, 'YXZ');
    car.body.rotation.set(s.bodyPitch, 0, s.bodyRoll);
    car.body.position.y = -Math.abs(s.bodyPitch) * 0.4 - s.landed * 0.05;
    car.update(s.wheelRotF, s.wheelRotR, s.steer);
    car.setBrake(s.braking > 0.1 || (s.vx > 0.5 && axes.handbrake > 0) || (Math.abs(s.vx) < 0.5 && axes.handbrake > 0 && this.autopilot?.active));
    car.setReverse(s.gear < 0);
    car.setBeamStrength(car.isHeadlightsOn() ? this.env.night * 0.6 + (this.env.wet ? 0.3 : 0) : 0);
    const cockpit = this.rig.mode === 'cockpit';
    car.setCockpitView(cockpit, carStore.get().tint);
    const near = cockpit ? 0.2 : 0.5;
    if (this.camera.near !== near) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
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
      vehicle: this.vehicleId,
      autopilot: this.autopilot?.active ? this.autopilot.status : null,
      pedestrians: this.peds?.count ?? 0,
      skyline: this.skyline?.count ?? 0,
      trafficCap: DENSITY_LEVELS[this.settings.trafficDensity] ?? 0,
    };
  }

  dispose(): void {
    this.loaded = false;
    this.disposers.forEach((d) => d());
    this.audio.stopDrive();
    this.world?.dispose();
    this.ground?.dispose();
    this.traffic?.dispose();
    this.peds?.dispose();
    this.skyline?.dispose();
    this.voice.stop();
    this.signals?.dispose();
    this.nav?.dispose();
    this.run?.dispose();
    this.env?.dispose();
    this.car?.dispose();
    this.collision?.clear();
    this.scene.clear();

  }
}

/** Autopilot cruising speeds by road class (m/s): motorway … link. */
const SPEED_LIMIT = [22, 17, 14, 12.5, 11, 9, 8.5, 5, 6, 11];

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}
