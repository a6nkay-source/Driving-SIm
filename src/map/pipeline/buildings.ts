/**
 * OSM building footprints → extrusion-ready building records with estimated
 * heights, visual styles and road-facing shop frontages. Buildings that block
 * a drivable road centreline are dropped so every mapped road stays drivable.
 */
import {
  hash01,
  pointInPolygon,
  polygonCentroid,
  projectOnSegment,
  round1,
  segmentsIntersect,
  signedArea,
  simplify,
} from '../geometry';
import type { Projection } from '../projection';
import { SpatialGrid } from '../SpatialGrid';
import { BuildingStyle, Kind, type BuildingData, type EdgeData, type Landmark } from '../types';
import { SEG_STRIDE, type Bounds } from './network';
import { parseNumber, type OsmRelation, type OsmWay, type Tags } from './osm';

export interface RawBuilding {
  id: number;
  ring: number[];
  tags: Tags;
}

const STONE_TYPES = new Set([
  'cathedral',
  'church',
  'civic',
  'public',
  'government',
  'train_station',
  'university',
  'college',
  'museum',
  'courthouse',
]);
const RELIGIOUS = new Set(['temple', 'mosque', 'church', 'cathedral', 'chapel', 'shrine', 'synagogue']);
const SHED_TYPES = new Set(['shed', 'hut', 'kiosk', 'garage', 'garages', 'roof', 'carport', 'cabin', 'toilets']);

function toRing(geom: { lat: number; lon: number }[], proj: Projection): number[] {
  const ring: number[] = [];
  for (const g of geom) {
    const [x, z] = proj.toLocal(g.lat, g.lon);
    ring.push(x, z);
  }
  // Drop closing duplicate.
  if (ring.length >= 4 && Math.hypot(ring[0] - ring[ring.length - 2], ring[1] - ring[ring.length - 1]) < 0.01) {
    ring.length -= 2;
  }
  return ring;
}

/** Joins open member ways of a multipolygon into closed rings. */
export function joinRings(members: { geometry?: { lat: number; lon: number }[] }[], proj: Projection): number[][] {
  const pieces = members.filter((m) => m.geometry && m.geometry.length >= 2).map((m) => toRingOpen(m.geometry!, proj));
  const rings: number[][] = [];
  while (pieces.length) {
    let cur = pieces.pop()!;
    let guard = 0;
    while (guard++ < 500) {
      const n = cur.length;
      if (n >= 6 && Math.hypot(cur[0] - cur[n - 2], cur[1] - cur[n - 1]) < 0.05) {
        cur.length -= 2;
        rings.push(cur);
        break;
      }
      const ex = cur[n - 2];
      const ez = cur[n - 1];
      let found = -1;
      let reverse = false;
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        if (Math.hypot(p[0] - ex, p[1] - ez) < 0.05) {
          found = i;
          break;
        }
        if (Math.hypot(p[p.length - 2] - ex, p[p.length - 1] - ez) < 0.05) {
          found = i;
          reverse = true;
          break;
        }
      }
      if (found < 0) break;
      let next = pieces.splice(found, 1)[0];
      if (reverse) {
        const r: number[] = [];
        for (let i = next.length - 2; i >= 0; i -= 2) r.push(next[i], next[i + 1]);
        next = r;
      }
      cur = cur.concat(next.slice(2));
    }
  }
  return rings;
}

function toRingOpen(geom: { lat: number; lon: number }[], proj: Projection): number[] {
  const out: number[] = [];
  for (const g of geom) {
    const [x, z] = proj.toLocal(g.lat, g.lon);
    out.push(x, z);
  }
  return out;
}

export function collectBuildings(ways: OsmWay[], relations: OsmRelation[], proj: Projection): RawBuilding[] {
  const out: RawBuilding[] = [];
  for (const w of ways) {
    const t = w.tags;
    if (!t?.building || t.building === 'no') continue;
    if (w.nodes.length < 4 || w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
    out.push({ id: w.id, ring: toRing(w.geometry, proj), tags: t });
  }
  for (const r of relations) {
    const t = r.tags;
    if (!t?.building || t.building === 'no') continue;
    const rings = joinRings(
      r.members.filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === '')),
      proj,
    );
    // Use the largest outer ring; inner courtyards are ignored.
    let best: number[] | null = null;
    let bestA = 0;
    for (const ring of rings) {
      const a = Math.abs(signedArea(ring));
      if (a > bestA) {
        bestA = a;
        best = ring;
      }
    }
    if (best) out.push({ id: r.id, ring: best, tags: t });
  }
  return out;
}

/** Height estimate in metres. Uses OSM height / levels when present. */
export function estimateHeight(tags: Tags, area: number, id: number): number {
  const h = parseNumber(tags.height);
  if (h && h > 2) return Math.min(260, h);
  const levels = parseNumber(tags['building:levels']);
  if (levels && levels > 0) return Math.min(260, levels * 3.3 + 1.2);
  const r = hash01(id);
  const type = tags.building;
  if (SHED_TYPES.has(type)) return 3 + r * 1.5;
  if (type === 'house' || type === 'detached') return 6 + r * 4;
  if (type === 'school' || type === 'hospital') return 10 + r * 8;
  if (area < 60) return 4 + r * 4;
  if (area < 250) return 9 + r * 10;
  if (area < 1000) return 14 + r * 14;
  if (area < 3000) return 17 + r * 18;
  return 14 + r * 22;
}

export function classifyStyle(tags: Tags, height: number, area: number, id: number, inFort: boolean): BuildingStyle {
  const type = tags.building;
  if (tags.amenity === 'place_of_worship' || RELIGIOUS.has(type)) return BuildingStyle.Religious;
  if (SHED_TYPES.has(type) || height < 4.5) return BuildingStyle.Shed;
  if (height >= 45) return BuildingStyle.GlassTower;
  if (tags.historic || STONE_TYPES.has(type) || tags.tourism === 'museum') return BuildingStyle.Heritage;
  if (inFort && area > 700 && height < 32 && hash01(id * 7) < 0.55) return BuildingStyle.Heritage;
  return BuildingStyle.Concrete;
}

export interface BuildingResult {
  buildings: BuildingData[];
  landmarks: Landmark[];
  grid: SpatialGrid;
  removedForRoads: number;
}

/** Oriented bounding box via the longest edge direction. */
function orientedBox(ring: number[]): { x: number; z: number; rot: number; len: number; wid: number } {
  let bestLen = 0;
  let ang = 0;
  const n = ring.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const l = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]);
    if (l > bestLen) {
      bestLen = l;
      ang = Math.atan2(ring[j + 1] - ring[i + 1], ring[j] - ring[i]);
    }
  }
  const ux = Math.cos(ang);
  const uz = Math.sin(ang);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < n; i += 2) {
    const u = ring[i] * ux + ring[i + 1] * uz;
    const v = -ring[i] * uz + ring[i + 1] * ux;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  return {
    x: cu * ux - cv * uz,
    z: cu * uz + cv * ux,
    // three.js rotation.y that maps local +X onto (ux, uz).
    rot: -ang,
    len: maxU - minU,
    wid: maxV - minV,
  };
}

export function processBuildings(
  raw: RawBuilding[],
  edges: EdgeData[],
  roadGrid: SpatialGrid,
  bounds: Bounds,
  proj: Projection,
  /** Edges of sea-facing boulevards (Marine Drive, Chowpatty Sea Face) for Art Deco styling. */
  seaFaceEdges: Set<number>,
): BuildingResult {
  const buildings: BuildingData[] = [];
  const landmarks: Landmark[] = [];
  let removedForRoads = 0;
  const tmp = { x: 0, z: 0, t: 0, d: 0 };
  const seen = new Set<number>();
  // Fort precinct (approximate) — heritage stone styling is more likely here.
  const [fx0, fz0] = proj.toLocal(18.942, 72.828);
  const [fx1, fz1] = proj.toLocal(18.926, 72.8385);

  for (const b of raw) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    let ring = simplify([...b.ring, b.ring[0], b.ring[1]], 0.25);
    ring.length -= 2;
    if (ring.length < 6) continue;
    let area = signedArea(ring);
    if (Math.abs(area) < 12) continue;
    if (area < 0) {
      const r: number[] = [];
      for (let i = ring.length - 2; i >= 0; i -= 2) r.push(ring[i], ring[i + 1]);
      ring = r;
      area = -area;
    }
    const [cx, cz] = polygonCentroid(ring);
    if (cx < bounds.minX || cx > bounds.maxX || cz < bounds.minZ || cz > bounds.maxZ) continue;

    const name = b.tags.name ?? '';
    if (/gateway of india/i.test(name)) {
      const box = orientedBox(ring);
      landmarks.push({ type: 'gateway', name: 'Gateway of India', ...box, height: 26 });
      continue;
    }

    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]);
      maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]);
      maxZ = Math.max(maxZ, ring[i + 1]);
    }

    // Reject buildings that sit on a drivable road centreline.
    let blocked = false;
    roadGrid.query(minX, minZ, maxX, maxZ, (id) => {
      const e = edges[Math.floor(id / SEG_STRIDE)];
      if (e.h) return;
      const si = id % SEG_STRIDE;
      const ax = e.p[si * 2];
      const az = e.p[si * 2 + 1];
      const bx = e.p[si * 2 + 2];
      const bz = e.p[si * 2 + 3];
      if (pointInPolygon(ax, az, ring) || pointInPolygon(bx, bz, ring)) {
        blocked = true;
        return true;
      }
      for (let i = 0; i < ring.length; i += 2) {
        const j = (i + 2) % ring.length;
        if (segmentsIntersect(ax, az, bx, bz, ring[i], ring[i + 1], ring[j], ring[j + 1])) {
          blocked = true;
          return true;
        }
      }
    });
    if (blocked) {
      removedForRoads++;
      continue;
    }

    const height = estimateHeight(b.tags, area, b.id);
    const minHeight = Math.max(0, parseNumber(b.tags.min_height) ?? (parseNumber(b.tags['building:min_level']) ?? 0) * 3.3);
    const inFort = cx > fx0 && cx < fx1 && cz > fz0 && cz < fz1;
    let style = classifyStyle(b.tags, height, area, b.id, inFort);

    // Frontage: footprint edges that face a road within a few metres.
    const frontage: number[] = [];
    if ((style === BuildingStyle.Concrete || style === BuildingStyle.Heritage) && height >= 6) {
      for (let i = 0; i < ring.length; i += 2) {
        const j = (i + 2) % ring.length;
        const ex = ring[j] - ring[i];
        const ez = ring[j + 1] - ring[i + 1];
        const len = Math.hypot(ex, ez);
        if (len < 4) continue;
        const nx = ez / len;
        const nz = -ex / len;
        const mx = (ring[i] + ring[j]) / 2;
        const mz = (ring[i + 1] + ring[j + 1]) / 2;
        let faces = false;
        roadGrid.queryRadius(mx, mz, 22, (id) => {
          const e = edges[Math.floor(id / SEG_STRIDE)];
          if (e.k > Kind.Residential || e.k === Kind.Motorway || e.h) return;
          const si = id % SEG_STRIDE;
          projectOnSegment(mx, mz, e.p[si * 2], e.p[si * 2 + 1], e.p[si * 2 + 2], e.p[si * 2 + 3], tmp);
          if (tmp.d - e.w / 2 > 11 || tmp.d < 0.1) return;
          const dot = ((tmp.x - mx) * nx + (tmp.z - mz) * nz) / tmp.d;
          if (dot > 0.6) {
            faces = true;
            return true;
          }
        });
        if (faces) frontage.push(i / 2);
      }
    }
    // Sea-facing Marine Drive row: Art Deco palette.
    if (style === BuildingStyle.Concrete && height < 40) {
      let marine = false;
      roadGrid.queryRadius(cx, cz, 70, (id) => {
        if (seaFaceEdges.has(Math.floor(id / SEG_STRIDE))) {
          marine = true;
          return true;
        }
      });
      if (marine) style = BuildingStyle.ArtDeco;
    }

    const rec: BuildingData = {
      id: b.id,
      p: ring.map(round1),
      h: round1(Math.max(minHeight + 2.5, height)),
      m: round1(minHeight),
      s: style,
    };
    if (frontage.length) rec.f = frontage;
    buildings.push(rec);
  }

  const grid = new SpatialGrid(40, buildings.length + 16);
  buildings.forEach((b, i) => {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < b.p.length; k += 2) {
      minX = Math.min(minX, b.p[k]);
      maxX = Math.max(maxX, b.p[k]);
      minZ = Math.min(minZ, b.p[k + 1]);
      maxZ = Math.max(maxZ, b.p[k + 1]);
    }
    grid.insert(i, minX, minZ, maxX, maxZ);
  });
  return { buildings, landmarks, grid, removedForRoads };
}

/** Distance from a point to the nearest building wall, or -1 if inside a building. */
export function buildingClearance(x: number, z: number, buildings: BuildingData[], grid: SpatialGrid, r: number): number {
  let best = Infinity;
  const tmp = { x: 0, z: 0, t: 0, d: 0 };
  grid.queryRadius(x, z, r, (i) => {
    const p = buildings[i].p;
    if (pointInPolygon(x, z, p)) {
      best = -1;
      return true;
    }
    for (let k = 0; k < p.length; k += 2) {
      const j = (k + 2) % p.length;
      projectOnSegment(x, z, p[k], p[k + 1], p[j], p[j + 1], tmp);
      if (tmp.d < best) best = tmp.d;
    }
  });
  return best;
}
