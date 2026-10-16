/**
 * Processed map format shared by the import pipeline (scripts/map) and the
 * game runtime. All coordinates are metres in a local tangent plane centred on
 * the district: +X = east, +Z = south (so north is -Z, matching three.js).
 */
export const MAP_FORMAT_VERSION = 3;

export const ROAD_KINDS = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'link',
] as const;
export type RoadKind = (typeof ROAD_KINDS)[number];

export const Kind = {
  Motorway: 0,
  Trunk: 1,
  Primary: 2,
  Secondary: 3,
  Tertiary: 4,
  Unclassified: 5,
  Residential: 6,
  LivingStreet: 7,
  Service: 8,
  Link: 9,
} as const;

/** Building visual styles chosen by the pipeline from OSM tags and location. */
export const BuildingStyle = {
  Concrete: 0,
  Heritage: 1,
  GlassTower: 2,
  ArtDeco: 3,
  Shed: 4,
  Religious: 5,
} as const;
export type BuildingStyle = (typeof BuildingStyle)[keyof typeof BuildingStyle];

export interface Destination {
  id: string;
  name: string;
  nameMr?: string;
  nameHi?: string;
  /** Alternative spoken / typed names (e.g. "Victoria Terminus", "VT"). */
  aliases?: string[];
  x: number;
  z: number;
}

export interface TrafficMix {
  car: number;
  taxi: number;
  bus: number;
  auto: number;
  bike: number;
  truck: number;
  /** Auto-rickshaws only spawn north of this local Z (they are banned in the island city). */
  autoNorthOfZ?: number;
}

export interface ChunkInfo {
  cx: number;
  cz: number;
  file: string;
  buildings: number;
  trees: number;
}

export interface MapManifest {
  format: number;
  id: string;
  name: string;
  blurb: string;
  /** False for the procedural fallback district. */
  real: boolean;
  attribution: string;
  license: string;
  osmTimestamp?: string;
  generatedAt: string;
  origin: { lat: number; lon: number };
  bbox: [number, number, number, number];
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  chunkSize: number;
  chunks: ChunkInfo[];
  landmask: { file: string; res: number; width: number; height: number; minX: number; minZ: number };
  spawn: { x: number; z: number; label: string };
  destinations: Destination[];
  traffic: TrafficMix;
  /** Tall buildings for the distant skyline (always loaded). */
  skyline?: { file: string; count: number };
  stats: Record<string, number>;
}

export interface EdgeData {
  /** Start / end graph node indices. */
  a: number;
  b: number;
  /** Flat polyline [x0, z0, x1, z1, ...] including both endpoints. */
  p: number[];
  /** Per-point deck elevation in metres; only present for elevated flyovers. */
  h?: number[];
  /** Road kind index into ROAD_KINDS. */
  k: number;
  /** Carriageway width in metres. */
  w: number;
  /** Total lane count. */
  l: number;
  /** 1 when traffic may only travel a → b. */
  o: 0 | 1;
  /** Index into NetworkData.names. */
  n?: number;
}

export interface Poi {
  name: string;
  nameMr?: string;
  kind: string;
  x: number;
  z: number;
}

export interface Landmark {
  type: 'gateway' | 'fountain';
  name: string;
  x: number;
  z: number;
  /** Rotation about Y (radians) of the long axis. */
  rot: number;
  /** Footprint size along / across the long axis. */
  len: number;
  wid: number;
  height: number;
}

export interface NetworkData {
  /** Flat [x0, z0, x1, z1, ...] graph node positions (junctions and dead ends). */
  nodes: number[];
  edges: EdgeData[];
  names: { en: string; mr?: string }[];
  /** Signal-controlled junctions: each entry lists graph node indices of one junction cluster. */
  signals: number[][];
  /** Zebra crossings: [edgeIndex, distanceAlongEdge]. */
  crossings: [number, number][];
  /** Bus stops: [x, z, headingRadians]. */
  busStops: [number, number, number][];
  /** Shoreline polylines extracted from the land mask (flat x,z arrays, land on the left). */
  shore: number[][];
  /** Railway lines (flat x,z arrays). */
  rail: number[][];
  pois: Poi[];
  landmarks: Landmark[];
}

export interface BuildingData {
  /** OSM id (way or relation). */
  id: number;
  /** Outer ring, flat [x,z,...], counter-clockwise when viewed from above, not closed. */
  p: number[];
  /** Roof height (m). */
  h: number;
  /** Base height (m) — usually 0. */
  m: number;
  s: BuildingStyle;
  /** Indices of footprint edges that face a road (used for shop fronts). */
  f?: number[];
}

/** A tall building drawn in the far-distance skyline layer. */
export interface SkylineTower {
  /** Chunk key "cx_cz" whose tile contains the full-detail version. */
  c: string;
  p: number[];
  h: number;
  s: BuildingStyle;
  id: number;
}

export interface ChunkData {
  cx: number;
  cz: number;
  buildings: BuildingData[];
  /** Trees: flat [x, z, type, ...]; type 0 rain tree, 1 palm, 2 gulmohar, 3 ashoka. */
  trees: number[];
}

export interface MapIndexEntry {
  id: string;
  name: string;
  blurb: string;
  real: boolean;
  roadKm: number;
  buildings: number;
}
