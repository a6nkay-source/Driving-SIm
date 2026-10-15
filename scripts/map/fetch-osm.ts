/**
 * Step 1 of the map pipeline: download raw OpenStreetMap data for a district
 * from the Overpass API and cache it under data/osm/<district>.json.
 *
 *   npm run map:fetch -- south-mumbai
 *
 * Data © OpenStreetMap contributors, available under the Open Database
 * License (ODbL 1.0). See https://www.openstreetmap.org/copyright
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDistrict } from '../../src/map/districts.ts';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const USER_AGENT = 'DriveMumbai-map-import/1.0 (+https://github.com/a6nkay-source/Driving-SIm)';

export function buildQuery(bbox: [number, number, number, number]): string {
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
  way["natural"="coastline"](${coastBox});
);
out body geom;`;
}

async function fetchWithRetry(query: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      console.log(`→ ${endpoint} (attempt ${attempt + 1})`);
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
      if (parsed.remark && /error/i.test(parsed.remark)) throw new Error(parsed.remark);
      return text;
    } catch (err) {
      lastError = err;
      console.warn(`  failed: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function main() {
  const district = getDistrict(process.argv[2]);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const out = resolve(root, 'data/osm', `${district.id}.json`);
  console.log(`Fetching OSM data for ${district.name} ${JSON.stringify(district.bbox)}`);
  const text = await fetchWithRetry(buildQuery(district.bbox));
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, text);
  const count = (JSON.parse(text) as { elements: unknown[] }).elements.length;
  console.log(`Saved ${count} elements (${(text.length / 1e6).toFixed(1)} MB) to ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
