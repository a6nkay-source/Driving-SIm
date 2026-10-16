/**
 * Procedural fallback district. It is generated as *synthetic OSM data* and fed
 * through the exact same import pipeline as the real map, so the game can always
 * run (offline, missing files, corrupt data) and the unit tests exercise the real
 * pipeline. It is clearly labelled as fictional in-game.
 */
import type { DistrictConfig } from './districts';
import { rng } from './geometry';
import type { OsmElement, OverpassResult, Tags } from './pipeline/osm';
import { createProjection } from './projection';

const ORIGIN = { lat: 18.93, lon: 72.82 };

export function coastX(z: number): number {
  return -700 + 220 * Math.cos(z / 600);
}

const fallbackProj = createProjection(ORIGIN.lat, ORIGIN.lon);
const place = (id: string, name: string, x: number, z: number) => {
  const [lat, lon] = fallbackProj.toLatLon(x, z);
  return { id, name, lat, lon };
};

export const FALLBACK_CONFIG: DistrictConfig = {
  id: 'fallback',
  name: 'Fallback District (procedural)',
  blurb: 'A fictional seaside grid generated on the fly. It is NOT a real map — it is used when map data cannot load.',
  bbox: [ORIGIN.lat - 0.0092, ORIGIN.lon - 0.0098, ORIGIN.lat + 0.0092, ORIGIN.lon + 0.0098],
  chunkSize: 400,
  spawn: (() => {
    const p = place('spawn', 'Sea Face Boulevard', coastX(0) + 45, 60);
    return { lat: p.lat, lon: p.lon, label: 'Sea Face Boulevard' };
  })(),
  destinations: [
    place('promenade-north', 'Promenade North', coastX(-750) + 45, -750),
    place('promenade-south', 'Promenade South', coastX(750) + 45, 750),
    place('market-square', 'Market Street × Central Avenue', 270, 0),
    place('central-maidan', 'Central Maidan', 25, -225),
    place('harbour-garden', 'Harbour Garden', 555, 375),
    place('east-gate', 'East Gate', 920, -600),
  ],
  traffic: { car: 0.45, taxi: 0.25, bus: 0.08, auto: 0.1, bike: 0.15, truck: 0.05 },
};

export function generateSyntheticOsm(seed = 7): { osm: OverpassResult; config: DistrictConfig } {
  const proj = createProjection(ORIGIN.lat, ORIGIN.lon);
  const rand = rng(seed);
  const elements: OsmElement[] = [];
  let nextId = 1;
  const nodePos = new Map<number, [number, number]>();
  const node = (x: number, z: number, tags?: Tags) => {
    const id = nextId++;
    nodePos.set(id, [x, z]);
    const [lat, lon] = proj.toLatLon(x, z);
    elements.push({ type: 'node', id, lat, lon, ...(tags ? { tags } : {}) });
    return id;
  };
  const way = (ids: number[], tags: Tags) => {
    elements.push({
      type: 'way',
      id: nextId++,
      nodes: ids,
      geometry: ids.map((i) => {
        const [x, z] = nodePos.get(i)!;
        const [lat, lon] = proj.toLatLon(x, z);
        return { lat, lon };
      }),
      tags,
    });
  };

  const xs = Array.from({ length: 11 }, (_, i) => -380 + 130 * i);
  const zs = Array.from({ length: 13 }, (_, j) => -900 + 150 * j);
  const blvd = (z: number) => coastX(z) + 45;

  // Coastline north → south keeps land (east) on the left.
  const coast: number[] = [];
  for (let z = -1150; z <= 1150; z += 25) coast.push(node(coastX(z), z));
  way(coast, { natural: 'coastline' });

  // Grid intersections.
  const grid = new Map<string, number>();
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < zs.length; j++) {
      const major = (i === 5 || j === 6) && (i % 3 === 0 || j % 4 === 0 || i === 5 || j === 6);
      grid.set(`${i},${j}`, node(xs[i], zs[j], major ? { highway: 'traffic_signals' } : undefined));
    }
  }
  // Boulevard with junction nodes at each cross street.
  const blvdNodes: number[] = [];
  const blvdJunction = new Map<number, number>();
  for (let j = 0; j < zs.length; j++) {
    const id = node(blvd(zs[j]), zs[j], j % 3 === 0 ? { highway: 'traffic_signals' } : undefined);
    blvdJunction.set(j, id);
    blvdNodes.push(id);
    if (j < zs.length - 1) {
      for (let k = 1; k < 6; k++) {
        const z = zs[j] + (150 * k) / 6;
        blvdNodes.push(node(blvd(z), z, k === 3 && j % 2 === 0 ? { highway: 'bus_stop' } : undefined));
      }
    }
  }
  // Extend the boulevard to the bounds.
  const north = [node(blvd(-1050), -1050), node(blvd(-975), -975)];
  const south = [node(blvd(975), 975), node(blvd(1050), 1050)];
  way([...north, ...blvdNodes, ...south], {
    highway: 'primary',
    name: 'Sea Face Boulevard',
    lanes: '4',
  });

  // Cross streets (east–west).
  for (let j = 0; j < zs.length; j++) {
    const ids = [blvdJunction.get(j)!, ...xs.map((_, i) => grid.get(`${i},${j}`)!), node(1050, zs[j])];
    const tags: Tags =
      j === 6
        ? { highway: 'primary', name: 'Central Avenue', lanes: '4' }
        : j % 4 === 0
          ? { highway: 'secondary', name: `Cross Road ${j + 1}` }
          : { highway: 'residential', name: `Lane ${j + 1}` };
    way(ids, tags);
  }
  // North–south streets.
  for (let i = 0; i < xs.length; i++) {
    const ids = [node(xs[i], -1050), ...zs.map((_, j) => grid.get(`${i},${j}`)!), node(xs[i], 1050)];
    const tags: Tags =
      i === 5
        ? { highway: 'primary', name: 'Market Street', lanes: '4' }
        : i % 3 === 0
          ? { highway: 'secondary', name: `${i + 1}th Street` }
          : { highway: 'residential', name: `${i + 1}th Street`, oneway: i % 2 === 0 ? 'yes' : '-1' };
    way(ids, tags);
  }

  // Buildings in each block, with two parks.
  const rect = (x0: number, z0: number, x1: number, z1: number, tags: Tags) => {
    const ids = [node(x0, z0), node(x1, z0), node(x1, z1), node(x0, z1)];
    way([...ids, ids[0]], tags);
  };
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const x0 = xs[i] + 12;
      const x1 = xs[i + 1] - 12;
      const z0 = zs[j] + 12;
      const z1 = zs[j + 1] - 12;
      if ((i === 3 && j === 4) || (i === 7 && j === 8)) {
        rect(x0 - 4, z0 - 4, x1 + 4, z1 + 4, { leisure: 'park', name: i === 3 ? 'Central Maidan' : 'Harbour Garden' });
        continue;
      }
      const lotsX = 2 + Math.floor(rand() * 2);
      const lotsZ = 2 + Math.floor(rand() * 2);
      const dx = (x1 - x0) / lotsX;
      const dz = (z1 - z0) / lotsZ;
      for (let a = 0; a < lotsX; a++) {
        for (let b = 0; b < lotsZ; b++) {
          if (rand() < 0.12) continue;
          const inset = 1.5 + rand() * 2;
          const tall = i === 5 || i === 4 || j === 6 || j === 5;
          const levels = Math.round(tall ? 6 + rand() * 18 : 3 + rand() * 6);
          rect(x0 + a * dx + inset, z0 + b * dz + inset, x0 + (a + 1) * dx - inset, z0 + (b + 1) * dz - inset, {
            building: rand() < 0.3 ? 'commercial' : 'apartments',
            'building:levels': String(levels),
          });
        }
      }
    }
  }
  // Sea-facing row between the boulevard and the first street.
  for (let j = 0; j < zs.length - 1; j++) {
    const west = Math.max(blvd(zs[j]), blvd(zs[j + 1])) + 14;
    const east = xs[0] - 12;
    if (east - west < 14) continue;
    rect(west, zs[j] + 14, east, zs[j] + 70, { building: 'apartments', 'building:levels': '5' });
    rect(west, zs[j] + 80, east, zs[j + 1] - 14, { building: 'apartments', 'building:levels': '6' });
  }
  // A strip of beach just above the sea wall.
  const beach: number[] = [];
  for (let z = 420; z <= 860; z += 40) beach.push(node(coastX(z) + 2, z));
  for (let z = 860; z >= 420; z -= 40) beach.push(node(blvd(z) - 10, z));
  way([...beach, beach[0]], { natural: 'beach' });

  return {
    osm: { osm3s: { timestamp_osm_base: 'procedural' }, elements },
    config: FALLBACK_CONFIG,
  };
}
