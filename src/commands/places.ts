/**
 * Everything a command can name as a destination: the curated landmarks
 * (with Hindi / Marathi names and nicknames like "VT"), points of interest
 * from OpenStreetMap, and named roads — including the colloquial names
 * Mumbaikars actually use ("Pedder Road", "Napean Sea Road", "SV Road").
 */
import type { LoadedMap } from '../map/MapData';
import type { Place } from './CommandParser';

export interface NamedPlace extends Place {
  hi?: string;
  mr?: string;
}

/** Everyday names → the official OSM road name (substring match). */
export const ROAD_ALIASES: [string, string][] = [
  ['pedder road', 'gopalrao deshmukh marg'],
  ['peddar road', 'gopalrao deshmukh marg'],
  ['warden road', 'bhula bhai desai'],
  ['napean sea road', 'napean sea road'],
  ['marine drive', 'netaji subhash'],
  ['sv road', 'swami vivekanand'],
  ['s v road', 'swami vivekanand'],
  ['linking road', 'linking road'],
  ['tulsi pipe road', 'senapati bapat'],
  ['lady jamshedji road', 'lady jamshedji'],
  ['cadell road', 'veer savarkar'],
  ['annie besant road', 'annie besant'],
  ['dr ab road', 'annie besant'],
  ['hughes road', 'n s patkar'],
  ['grant road', 'grant road'],
  ['charni road', 'charni road'],
  ['coastal road', 'coastal road'],
  ['sea link', 'sea link'],
  ['eastern freeway', 'eastern freeway'],
  ['western express highway', 'western express'],
  ['carter road', 'carter road'],
  ['hill road', 'hill road'],
  ['colaba causeway', 'shahid bhagat singh'],
  ['fashion street', 'mahatma gandhi road'],
  ['dn road', 'dadabhai naoroji'],
  ['d n road', 'dadabhai naoroji'],
];

export function buildPlaces(map: LoadedMap): NamedPlace[] {
  const out: NamedPlace[] = [];
  for (const d of map.manifest.destinations) {
    out.push({
      id: d.id,
      label: d.name,
      names: [d.name, d.nameMr, d.nameHi, ...(d.aliases ?? [])].filter((x): x is string => !!x),
      x: d.x,
      z: d.z,
      kind: 'destination',
      hi: d.nameHi,
      mr: d.nameMr,
    });
  }
  map.network.pois.forEach((p, i) => {
    out.push({ id: `poi:${i}`, label: p.name, names: [p.name, p.nameMr].filter((x): x is string => !!x), x: p.x, z: p.z, kind: 'poi', mr: p.nameMr });
  });

  // Roads: one entry per name, placed at the middle of its longest main-network edge.
  const g = map.graph;
  const best = new Map<number, { edge: number; len: number }>();
  g.edges.forEach((e, i) => {
    if (e.n === undefined || !g.main[i]) return;
    const cur = best.get(e.n);
    const len = g.lengths[i];
    if (!cur || len > cur.len) best.set(e.n, { edge: i, len });
  });
  const pt = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
  const roadByName = new Map<string, NamedPlace>();
  for (const [n, { edge, len }] of best) {
    const nm = map.network.names[n];
    if (!nm?.en) continue;
    g.sample(edge, len / 2, pt);
    const place: NamedPlace = { id: `road:${n}`, label: nm.en, names: [nm.en, nm.mr].filter((x): x is string => !!x), x: pt.x, z: pt.z, kind: 'road', mr: nm.mr };
    roadByName.set(nm.en.toLowerCase(), place);
    out.push(place);
  }
  for (const [alias, official] of ROAD_ALIASES) {
    for (const [name, place] of roadByName) {
      if (name.includes(official)) {
        place.names.push(alias);
        break;
      }
    }
  }
  return out;
}
