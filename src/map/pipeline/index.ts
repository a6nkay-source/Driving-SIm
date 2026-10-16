/**
 * Pure (I/O-free) district build: Overpass JSON + district config → manifest,
 * road network, streaming chunks and land mask. scripts/map/build-map.ts does
 * the file writing; unit tests call this directly with synthetic OSM data.
 */
import type { DistrictConfig } from '../districts';
import { polygonCentroid, round1, signedArea } from '../geometry';
import { bboxCenter, createProjection } from '../projection';
import {
  MAP_FORMAT_VERSION,
  type ChunkData,
  type Landmark,
  type MapIndexEntry,
  type MapManifest,
  type NetworkData,
  type Poi,
  type SkylineTower,
} from '../types';
import { collectBuildings, joinRings, processBuildings } from './buildings';
import { buildLandMask, extractShoreline, type LandMask } from './landmask';
import { buildNetwork, clipPolyline, type Bounds } from './network';
import type { OsmNode, OsmRelation, OsmWay, OverpassResult, Tags } from './osm';
import { placeTrees, type ParkArea } from './trees';

export const ATTRIBUTION = '© OpenStreetMap contributors';
export const LICENSE = 'Open Database License (ODbL) 1.0 — https://opendatacommons.org/licenses/odbl/1-0/';

export interface DistrictBuild {
  manifest: MapManifest;
  network: NetworkData;
  chunks: ChunkData[];
  mask: LandMask;
  skyline: SkylineTower[];
  index: MapIndexEntry;
  log: string[];
}

/** Buildings at least this tall are also drawn in the always-loaded far layer. */
export const SKYLINE_MIN_HEIGHT = 14;
/** Below this height far-layer buildings are simplified to their bounding box. */
export const SKYLINE_FULL_HEIGHT = 38;

/** Minimum-area-ish oriented box of a ring (longest-edge orientation), as a 4-point ring. */
function boxRing(ring: number[]): number[] {
  let best = 0;
  let ang = 0;
  const n = ring.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const l = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]);
    if (l > best) {
      best = l;
      ang = Math.atan2(ring[j + 1] - ring[i + 1], ring[j] - ring[i]);
    }
  }
  const ux = Math.cos(ang);
  const uz = Math.sin(ang);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let i = 0; i < n; i += 2) {
    const u = ring[i] * ux + ring[i + 1] * uz;
    const v = -ring[i] * uz + ring[i + 1] * ux;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const pt = (u: number, v: number) => [round1(u * ux - v * uz), round1(u * uz + v * ux)];
  // Counter-clockwise (positive signed area) like every other ring.
  return [...pt(u0, v0), ...pt(u1, v0), ...pt(u1, v1), ...pt(u0, v1)];
}

const PARK_LEISURE = new Set(['park', 'garden', 'playground']);
const OPEN_LEISURE = new Set(['pitch', 'stadium', 'recreation_ground']);
const PARK_LANDUSE = new Set(['grass', 'village_green', 'meadow', 'cemetery']);
const OPEN_LANDUSE = new Set(['recreation_ground']);
const WOOD = new Set(['wood', 'scrub', 'forest']);

function classifyArea(tags: Tags): 'park' | 'open' | 'wood' | 'water' | 'sand' | null {
  if (tags.natural === 'water' || tags.water) return 'water';
  if (tags.natural === 'beach' || tags.natural === 'sand') return 'sand';
  if (WOOD.has(tags.natural ?? '') || tags.landuse === 'forest') return 'wood';
  if (PARK_LEISURE.has(tags.leisure ?? '') || PARK_LANDUSE.has(tags.landuse ?? '')) return 'park';
  if (OPEN_LEISURE.has(tags.leisure ?? '') || OPEN_LANDUSE.has(tags.landuse ?? '')) return 'open';
  return null;
}

export function buildDistrict(osm: OverpassResult, cfg: DistrictConfig, opts: { maskRes?: number } = {}): DistrictBuild {
  const log: string[] = [];
  const [clat, clon] = bboxCenter(cfg.bbox);
  const proj = createProjection(clat, clon);
  const [s, w, n, e] = cfg.bbox;
  const [minX, minZ] = proj.toLocal(n, w);
  const [maxX, maxZ] = proj.toLocal(s, e);
  const bounds: Bounds = { minX, minZ, maxX, maxZ };

  const nodes: OsmNode[] = [];
  const ways: OsmWay[] = [];
  const relations: OsmRelation[] = [];
  for (const el of osm.elements) {
    if (el.type === 'node') nodes.push(el);
    else if (el.type === 'way') ways.push(el);
    else relations.push(el);
  }

  // Roads.
  const net = buildNetwork(ways, nodes, proj, bounds);
  log.push(
    `roads: ${net.stats.edges} edges, ${net.stats.nodes} nodes, ${net.stats.roadKm} km, ` +
      `${net.stats.bridges} elevated edges (${net.stats.elevatedKm} km), ${net.signals.length} signalised junctions`,
  );

  const seaFace = new Set<number>();
  net.edges.forEach((edge, i) => {
    const name = edge.n !== undefined ? net.names[edge.n].en : '';
    if (/marine drive|sea face|purandare|carter road|bandstand|netaji subhash/i.test(name)) seaFace.add(i);
  });

  // Buildings + landmarks.
  const raw = collectBuildings(ways, relations, proj);
  const bres = processBuildings(raw, net.edges, net.grid, bounds, proj, seaFace);
  log.push(`buildings: ${bres.buildings.length} kept, ${bres.removedForRoads} removed for blocking roads`);
  const landmarks: Landmark[] = [...bres.landmarks];

  // Areas.
  const coastlines: number[][] = [];
  const water: number[][] = [];
  const parks: ParkArea[] = [];
  const parkRings: number[][] = [];
  const sand: number[][] = [];
  const rail: number[][] = [];
  const toFlat = (g: { lat: number; lon: number }[]) => {
    const out: number[] = [];
    for (const p of g) {
      const [x, z] = proj.toLocal(p.lat, p.lon);
      out.push(x, z);
    }
    return out;
  };
  const addArea = (ring: number[], tags: Tags) => {
    if (ring.length < 6) return;
    const kind = classifyArea(tags);
    if (!kind) return;
    if (signedArea(ring) < 0) {
      const r: number[] = [];
      for (let i = ring.length - 2; i >= 0; i -= 2) r.push(ring[i], ring[i + 1]);
      ring = r;
    }
    if (kind === 'water') water.push(ring);
    else if (kind === 'sand') sand.push(ring);
    else {
      parkRings.push(ring);
      parks.push({ ring, density: kind === 'wood' ? 'dense' : kind === 'park' ? 'park' : 'edge' });
    }
  };
  for (const way of ways) {
    const t = way.tags ?? {};
    if (t.natural === 'coastline') {
      coastlines.push(toFlat(way.geometry));
      continue;
    }
    if (t.railway === 'rail' && !t.tunnel) {
      const flat = toFlat(way.geometry);
      let id = -1;
      for (const r of clipPolyline(
        way.nodes.map(() => id--),
        flat,
        bounds,
        () => 0,
      )) {
        rail.push(r.pts.map(round1));
      }
      continue;
    }
    if (t.building || t.highway) continue;
    if (way.nodes.length >= 4 && way.nodes[0] === way.nodes[way.nodes.length - 1]) {
      const ring = toFlat(way.geometry);
      ring.length -= 2;
      addArea(ring, t);
    }
  }
  for (const rel of relations) {
    const t = rel.tags ?? {};
    if (t.building || !classifyArea(t)) continue;
    for (const ring of joinRings(
      rel.members.filter((m) => m.type === 'way' && m.role !== 'inner'),
      proj,
    )) {
      addArea(ring, t);
    }
  }

  const mask = buildLandMask({
    bounds,
    res: opts.maskRes ?? cfg.maskRes ?? 3,
    coastlines,
    water,
    parks: parkRings,
    sand,
    roads: net.edges,
  });
  const shore = extractShoreline(mask);
  let waterCells = 0;
  for (let i = 0; i < mask.r.length; i++) if (mask.r[i] < 128) waterCells++;
  log.push(
    `land mask: ${mask.width}×${mask.height} @ ${mask.res} m, ${((waterCells / mask.r.length) * 100).toFixed(1)}% water, ` +
      `${coastlines.length} coastline ways, ${shore.length} shoreline polylines`,
  );

  // Landmarks found by name.
  for (const way of ways) {
    const name = way.tags?.name ?? '';
    if (/flora fountain/i.test(name)) {
      const ring = toFlat(way.geometry);
      const [x, z] = polygonCentroid(ring);
      landmarks.push({ type: 'fountain', name: 'Flora Fountain', x: round1(x), z: round1(z), rot: 0, len: 6, wid: 6, height: 10 });
    }
  }

  // Trees.
  const osmTrees: [number, number][] = [];
  for (const node of nodes) {
    if (node.tags?.natural === 'tree') osmTrees.push(proj.toLocal(node.lat, node.lon));
  }
  const trees = placeTrees({
    edges: net.edges,
    roadGrid: net.grid,
    buildings: bres.buildings,
    buildingGrid: bres.grid,
    mask,
    osmTrees,
    parks,
    shore,
  });
  log.push(`trees: ${trees.length / 3}`);

  // POIs for map labels.
  const pois: Poi[] = [];
  const seenNames = new Set<string>();
  for (const el of osm.elements) {
    const t = el.tags;
    if (!t?.name || t.highway || seenNames.has(t.name)) continue;
    let kind: string | null = null;
    if (t.railway === 'station') kind = 'station';
    else if (t.tourism === 'attraction' || t.tourism === 'museum' || t.historic === 'monument') kind = 'landmark';
    else if (t.leisure === 'stadium') kind = 'stadium';
    else if (t.leisure === 'park' || t.landuse === 'recreation_ground') kind = 'park';
    else if (t.tourism === 'hotel' && (t['building:levels'] || el.type !== 'node')) kind = 'hotel';
    else if (t.amenity === 'cinema' || t.amenity === 'theatre') kind = 'culture';
    if (!kind) continue;
    let x: number;
    let z: number;
    if (el.type === 'node') [x, z] = proj.toLocal(el.lat, el.lon);
    else if (el.type === 'way') [x, z] = polygonCentroid(toFlat(el.geometry));
    else continue;
    if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
    seenNames.add(t.name);
    pois.push({ name: t.name, ...(t['name:mr'] ? { nameMr: t['name:mr'] } : {}), kind, x: round1(x), z: round1(z) });
  }

  // Chunks.
  const size = cfg.chunkSize;
  const chunkMap = new Map<string, ChunkData>();
  const chunkFor = (x: number, z: number) => {
    const cx = Math.floor((x - minX) / size);
    const cz = Math.floor((z - minZ) / size);
    const key = `${cx}_${cz}`;
    let c = chunkMap.get(key);
    if (!c) chunkMap.set(key, (c = { cx, cz, buildings: [], trees: [] }));
    return c;
  };
  const skyline: SkylineTower[] = [];
  for (const b of bres.buildings) {
    const [cx, cz] = polygonCentroid(b.p);
    const chunk = chunkFor(cx, cz);
    chunk.buildings.push(b);
    if (b.h >= SKYLINE_MIN_HEIGHT) {
      let ring = b.h >= SKYLINE_FULL_HEIGHT ? b.p : boxRing(b.p);
      if (signedArea(ring) < 0) {
        const r: number[] = [];
        for (let i = ring.length - 2; i >= 0; i -= 2) r.push(ring[i], ring[i + 1]);
        ring = r;
      }
      skyline.push({ c: `${chunk.cx}_${chunk.cz}`, p: ring, h: b.h, s: b.s, id: b.id });
    }
  }
  const towers = skyline.filter((t) => t.h >= SKYLINE_FULL_HEIGHT).length;
  log.push(`far layer: ${skyline.length} buildings ≥ ${SKYLINE_MIN_HEIGHT} m, ${towers} towers ≥ ${SKYLINE_FULL_HEIGHT} m (tallest ${Math.round(Math.max(0, ...skyline.map((t) => t.h)))} m)`);
  for (let i = 0; i < trees.length; i += 3) chunkFor(trees[i], trees[i + 1]).trees.push(trees[i], trees[i + 1], trees[i + 2]);
  const chunks = [...chunkMap.values()].sort((a, b) => a.cz - b.cz || a.cx - b.cx);

  const network: NetworkData = {
    nodes: net.nodes,
    edges: net.edges,
    names: net.names,
    signals: net.signals,
    crossings: net.crossings,
    busStops: net.busStops,
    shore,
    rail,
    pois,
    landmarks,
  };

  const [sx, sz] = proj.toLocal(cfg.spawn.lat, cfg.spawn.lon);
  const manifest: MapManifest = {
    format: MAP_FORMAT_VERSION,
    id: cfg.id,
    name: cfg.name,
    blurb: cfg.blurb,
    real: true,
    attribution: ATTRIBUTION,
    license: LICENSE,
    osmTimestamp: osm.osm3s?.timestamp_osm_base,
    generatedAt: new Date().toISOString(),
    origin: { lat: clat, lon: clon },
    bbox: cfg.bbox,
    bounds: { minX: round1(minX), minZ: round1(minZ), maxX: round1(maxX), maxZ: round1(maxZ) },
    chunkSize: size,
    chunks: chunks.map((c) => ({
      cx: c.cx,
      cz: c.cz,
      file: `chunks/${c.cx}_${c.cz}.json`,
      buildings: c.buildings.length,
      trees: c.trees.length / 3,
    })),
    landmask: { file: 'landmask.png', res: mask.res, width: mask.width, height: mask.height, minX: mask.minX, minZ: mask.minZ },
    spawn: { x: round1(sx), z: round1(sz), label: cfg.spawn.label },
    destinations: cfg.destinations.map((d) => {
      const [x, z] = proj.toLocal(d.lat, d.lon);
      return {
        id: d.id,
        name: d.name,
        ...(d.nameMr ? { nameMr: d.nameMr } : {}),
        ...(d.nameHi ? { nameHi: d.nameHi } : {}),
        ...(d.aliases ? { aliases: d.aliases } : {}),
        x: round1(x),
        z: round1(z),
      };
    }),
    traffic: {
      car: cfg.traffic.car,
      taxi: cfg.traffic.taxi,
      bus: cfg.traffic.bus,
      auto: cfg.traffic.auto,
      bike: cfg.traffic.bike,
      truck: cfg.traffic.truck,
      ...(cfg.traffic.autoNorthOfLat !== undefined ? { autoNorthOfZ: round1(proj.toLocal(cfg.traffic.autoNorthOfLat, clon)[1]) } : {}),
    },
    skyline: { file: 'skyline.json', count: skyline.length },
    stats: {
      roadKm: net.stats.roadKm,
      edges: net.stats.edges,
      junctions: net.stats.nodes,
      elevatedKm: net.stats.elevatedKm,
      buildings: bres.buildings.length,
      trees: trees.length / 3,
      signals: net.signals.length,
      crossings: net.crossings.length,
      busStops: net.busStops.length,
      areaKm2: Math.round(((maxX - minX) * (maxZ - minZ)) / 1e4) / 100,
    },
  };

  return {
    manifest,
    network,
    chunks,
    mask,
    skyline,
    log,
    index: {
      id: cfg.id,
      name: cfg.name,
      blurb: cfg.blurb,
      real: true,
      roadKm: net.stats.roadKm,
      buildings: bres.buildings.length,
    },
  };
}
