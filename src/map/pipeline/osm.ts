/** Minimal typings for Overpass API JSON (`out body geom`). */
export type Tags = Record<string, string>;

export interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Tags;
}

export interface OsmWay {
  type: 'way';
  id: number;
  nodes: number[];
  geometry: { lat: number; lon: number }[];
  tags?: Tags;
}

export interface OsmRelationMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
  geometry?: { lat: number; lon: number }[];
}

export interface OsmRelation {
  type: 'relation';
  id: number;
  members: OsmRelationMember[];
  tags?: Tags;
}

export type OsmElement = OsmNode | OsmWay | OsmRelation;

export interface OverpassResult {
  osm3s?: { timestamp_osm_base?: string };
  elements: OsmElement[];
}

export const DRIVABLE = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'road',
  'motorway_link',
  'trunk_link',
  'primary_link',
  'secondary_link',
  'tertiary_link',
]);

const EXCLUDED_SERVICE = new Set(['parking_aisle', 'driveway', 'drive-through', 'emergency_access']);

export function isDrivable(tags: Tags | undefined): boolean {
  if (!tags?.highway || !DRIVABLE.has(tags.highway)) return false;
  if (tags.area === 'yes') return false;
  if (tags.tunnel && tags.tunnel !== 'no' && tags.tunnel !== 'building_passage') return false;
  if (tags.highway === 'service' && tags.service && EXCLUDED_SERVICE.has(tags.service)) return false;
  if (tags.access === 'no' && tags.highway === 'service') return false;
  return true;
}

export function isBridge(tags: Tags | undefined): boolean {
  return !!tags?.bridge && tags.bridge !== 'no';
}

export function parseNumber(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /-?\d+(\.\d+)?/.exec(v.replace(',', '.'));
  if (!m) return undefined;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : undefined;
}
