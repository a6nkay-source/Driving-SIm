/**
 * Step 1 of the map pipeline: download raw OpenStreetMap data for a district
 * from the Overpass API and cache it under data/osm/<district>.json.
 *
 *   npm run map:fetch -- mumbai
 *
 * Large districts are fetched as a grid of tiles (sequentially, with pauses,
 * to respect the Overpass usage policy) and merged by element id.
 *
 * Data © OpenStreetMap contributors, available under the Open Database
 * License (ODbL 1.0). See https://www.openstreetmap.org/copyright
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDistrict } from '../../src/map/districts.ts';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const USER_AGENT = 'DriveMumbai-map-import/1.0 (+https://github.com/a6nkay-source/Driving-SIm)';
/** Maximum tile edge in degrees (≈ 3.3 km). */
const TILE_DEG = 0.03;

type BBox = [number, number, number, number];

export function buildQuery(bbox: BBox, withCoast = true): string {
  const [s, w, n, e] = bbox;
  const pad = 0.03;
  const box = `${s},${w},${n},${e}`;
  const coastBox = `${s - pad},${w - pad},${n + pad},${e + pad}`;
  return `[out:json][timeout:240];
(
  way["highway"](${box});
  way["building"](${box});
  relation["building"](${box});
  way["leisure"~"^(park|garden|pitch|stadium|playground|recreation_ground)$"](${box});
  way["landuse"~"^(grass|recreation_ground|village_green|forest|meadow|cemetery)$"](${box});
  way["natural"~"^(water|beach|sand|wood|scrub)$"](${box});
  way["railway"~"^(rail|platform)$"](${box});
  node["highway"~"^(traffic_signals|bus_stop|crossing|stop)$"](${box});
  node["natural"="tree"](${box});
  nwr["name"]["tourism"](${box});
  nwr["name"]["historic"](${box});
  nwr["name"]["railway"="station"](${box});
  nwr["name"]["leisure"="stadium"](${box});
  nwr["name"]["amenity"~"^(place_of_worship|university|college|hospital|theatre|cinema|marketplace|library)$"](${box});
  ${withCoast ? `way["natural"="coastline"](${coastBox});` : ''}
);
out body geom;`;
}

/** Splits a bounding box into tiles no larger than TILE_DEG on a side. */
export function tileBBox(bbox: BBox, size = TILE_DEG): BBox[] {
  const [s, w, n, e] = bbox;
  const rows = Math.max(1, Math.ceil((n - s) / size));
  const cols = Math.max(1, Math.ceil((e - w) / size));
  const out: BBox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push([s + ((n - s) * r) / rows, w + ((e - w) * c) / cols, s + ((n - s) * (r + 1)) / rows, w + ((e - w) * (c + 1)) / cols]);
    }
  }
  return out;
}

async function fetchWithRetry(query: string, attempts = 6): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      console.log(`  → ${endpoint} (attempt ${attempt + 1})`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ data: query }).toString(),
      });
      const text = await res.text();
      if (!res.ok || !text.trimStart().startsWith('{')) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
      }
      const parsed = JSON.parse(text) as { remark?: string };
      if (parsed.remark && /error|timed out/i.test(parsed.remark)) throw new Error(parsed.remark);
      return text;
    } catch (err) {
      lastError = err;
      console.warn(`    failed: ${(err as Error).message}`);
      // Exponential backoff (the public servers ask for it when at capacity).
      if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, Math.min(60_000, 3000 * 1.6 ** attempt)));
    }
  }
  throw lastError;
}

interface Result {
  osm3s?: { timestamp_osm_base?: string };
  elements: { type: string; id: number }[];
}

const tileName = (b: BBox) => `${b.map((v) => v.toFixed(4)).join('_')}.json`;

/**
 * Fetches one tile, splitting it into four quadrants (recursively) when the
 * public servers keep failing on it — dense city blocks can exceed their limits.
 */
async function fetchTile(bbox: BBox, cacheDir: string, withCoast: boolean, depth: number, out: Result[]): Promise<void> {
  const path = resolve(cacheDir, tileName(bbox));
  try {
    out.push(JSON.parse(await readFile(path, 'utf8')) as Result);
    console.log(`  cached ${tileName(bbox)}`);
    return;
  } catch {
    /* not cached yet */
  }
  try {
    console.log(`${'  '.repeat(depth)}tile ${JSON.stringify(bbox.map((v) => +v.toFixed(4)))}`);
    const text = await fetchWithRetry(buildQuery(bbox, withCoast), depth < 2 ? 3 : 10);
    await writeFile(path, text);
    out.push(JSON.parse(text) as Result);
    await new Promise((r) => setTimeout(r, 1500));
  } catch (err) {
    if (depth >= 3) throw err;
    const [s, w, n, e] = bbox;
    const ms = (s + n) / 2;
    const mw = (w + e) / 2;
    console.log(`${'  '.repeat(depth)}splitting tile into quadrants`);
    const quads: BBox[] = [
      [s, w, ms, mw],
      [s, mw, ms, e],
      [ms, w, n, mw],
      [ms, mw, n, e],
    ];
    for (let i = 0; i < quads.length; i++) await fetchTile(quads[i], cacheDir, withCoast && i === 0, depth + 1, out);
  }
}

async function main() {
  const district = getDistrict(process.argv[2]);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const out = resolve(root, 'data/osm', `${district.id}.json`);
  const cacheDir = resolve(root, 'data/osm/tiles', district.id);
  await mkdir(cacheDir, { recursive: true });
  const tiles = tileBBox(district.bbox);
  console.log(`Fetching OSM data for ${district.name} ${JSON.stringify(district.bbox)} in ${tiles.length} tile(s)`);
  const results: Result[] = [];
  for (let i = 0; i < tiles.length; i++) {
    console.log(`Tile ${i + 1}/${tiles.length}`);
    await fetchTile(tiles[i], cacheDir, i === 0, 0, results);
  }
  // The coastline is needed for the whole district (plus a margin) to build the land mask.
  const coastPath = resolve(cacheDir, 'coastline.json');
  let coast: string;
  try {
    coast = await readFile(coastPath, 'utf8');
    console.log('  cached coastline');
  } catch {
    const [s, w, n, e] = district.bbox;
    console.log('Coastline');
    coast = await fetchWithRetry(`[out:json][timeout:180];way["natural"="coastline"](${s - 0.03},${w - 0.03},${n + 0.03},${e + 0.03});out body geom;`, 10);
    await writeFile(coastPath, coast);
  }
  results.push(JSON.parse(coast) as Result);
  const merged = new Map<string, unknown>();
  let timestamp: string | undefined;
  for (const data of results) {
    timestamp ??= data.osm3s?.timestamp_osm_base;
    for (const el of data.elements) merged.set(`${el.type}/${el.id}`, el);
  }
  const result = { version: 0.6, generator: 'drive-mumbai fetch-osm (merged tiles)', osm3s: { timestamp_osm_base: timestamp }, elements: [...merged.values()] };
  const text = JSON.stringify(result);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, text);
  console.log(`Saved ${result.elements.length} elements (${(text.length / 1e6).toFixed(1)} MB) to ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
