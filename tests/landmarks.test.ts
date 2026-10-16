import { describe, expect, it } from 'vitest';
import { generateSyntheticOsm } from '../src/map/fallback';
import { polygonCentroid } from '../src/map/geometry';
import { buildDistrict } from '../src/map/pipeline/index';
import type { OsmWay } from '../src/map/pipeline/osm';
import { createProjection } from '../src/map/projection';
import type { Landmark } from '../src/map/types';

/**
 * The synthetic district plus the OSM shapes of two Mumbai landmarks: a
 * heritage station block named like CSMT (tagged as a building:part, as in
 * OSM) and the Haji Ali dargah with a stray building on its islet and a
 * causeway to the shore.
 */
function districtWithLandmarks() {
  const { osm, config } = generateSyntheticOsm();
  const [lat0, lon0] = [(config.bbox[0] + config.bbox[2]) / 2, (config.bbox[1] + config.bbox[3]) / 2];
  const proj = createProjection(lat0, lon0);
  let id = 9_000_000;
  const way = (pts: [number, number][], tags: Record<string, string>, closed = true): OsmWay => {
    const ring = closed ? [...pts, pts[0]] : pts;
    const geometry = ring.map(([x, z]) => {
      const [lat, lon] = proj.toLatLon(x, z);
      return { lat, lon };
    });
    const nodes = ring.map((_, i) => (closed && i === ring.length - 1 ? id + 1 : id + 1 + i));
    id += ring.length + 1;
    return { type: 'way', id: id, nodes, geometry, tags };
  };
  const rect = (cx: number, cz: number, w: number, d: number): [number, number][] => [
    [cx - w / 2, cz - d / 2],
    [cx + w / 2, cz - d / 2],
    [cx + w / 2, cz + d / 2],
    [cx - w / 2, cz + d / 2],
  ];
  osm.elements.push(
    way(rect(-200, -300, 100, 70), { 'building:part': 'train_station', heritage: '1', loc_name: 'Chhatrapati Shivaji Terminus' }),
    way(rect(-90, -300, 90, 80), { building: 'yes', name: 'Chhatrapati Shivaji Maharaj Terminus' }),
    way(rect(200, 300, 60, 80), { building: 'yes', amenity: 'place_of_worship', religion: 'muslim', name: 'haji ali' }),
    way(rect(210, 290, 12, 12), { building: 'apartments', 'building:levels': '8' }),
    way(
      [
        [200, 345],
        [205, 420],
        [215, 520],
      ],
      { highway: 'cycleway', name: 'Haji Ali Causeway' },
      false,
    ),
  );
  return buildDistrict(osm, config, { maskRes: 4 });
}

const build = districtWithLandmarks();
const find = (type: Landmark['type']) => build.network.landmarks.find((l) => l.type === type);

const inside = (l: Landmark, x: number, z: number) => {
  const c = Math.cos(l.rot);
  const s = Math.sin(l.rot);
  const dx = x - l.x;
  const dz = z - l.z;
  return Math.abs(dx * c - dz * s) < l.len / 2 && Math.abs(dx * s + dz * c) < l.wid / 2;
};

describe('landmark import', () => {
  it('turns the CSMT footprints into the station landmark, placed on the heritage block', () => {
    const csmt = find('csmt');
    expect(csmt).toBeDefined();
    // Centred on the World Heritage part (a building:part in OSM), not the annexe.
    expect(Math.hypot(csmt!.x + 200, csmt!.z + 300)).toBeLessThan(6);
    expect(Math.max(csmt!.len, csmt!.wid)).toBeGreaterThan(90);
  });

  it('turns the Haji Ali dargah into a landmark with its causeway, facing the shore', () => {
    const haji = find('hajiali');
    expect(haji).toBeDefined();
    expect(haji!.path).toBeDefined();
    const p = haji!.path!;
    expect(p.length).toBeGreaterThanOrEqual(6);
    // The path runs from the far (shore) end towards the dargah.
    const d0 = Math.hypot(p[0] - haji!.x, p[1] - haji!.z);
    const d1 = Math.hypot(p[p.length - 2] - haji!.x, p[p.length - 1] - haji!.z);
    expect(d0).toBeGreaterThan(d1);
    // The model's front (+Z) points along the causeway.
    const fx = Math.sin(haji!.rot);
    const fz = Math.cos(haji!.rot);
    expect(fx * (p[0] - haji!.x) + fz * (p[1] - haji!.z)).toBeGreaterThan(0);
  });

  it('keeps OSM buildings and trees out of the landmark footprints', () => {
    const haji = find('hajiali')!;
    const csmt = find('csmt')!;
    for (const chunk of build.chunks) {
      for (const b of chunk.buildings) {
        const [x, z] = polygonCentroid(b.p);
        expect(inside(haji, x, z), `building ${b.id} on the dargah islet`).toBe(false);
        expect(inside(csmt, x, z), `building ${b.id} inside CSMT`).toBe(false);
      }
      for (let i = 0; i < chunk.trees.length; i += 3) {
        expect(inside(csmt, chunk.trees[i], chunk.trees[i + 1])).toBe(false);
      }
    }
  });
});
