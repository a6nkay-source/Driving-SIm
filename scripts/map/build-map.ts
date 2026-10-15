/**
 * Step 2 of the map pipeline: convert cached OSM data (data/osm/<district>.json)
 * into the streaming map format under public/maps/<district>/.
 *
 *   npm run map:build -- south-mumbai
 *
 * Output (all derived from OpenStreetMap, © OpenStreetMap contributors, ODbL):
 *   manifest.json      metadata, bounds, chunk list, spawn, destinations
 *   network.json       road graph, signals, crossings, shoreline, POIs, landmarks
 *   landmask.png       RGB raster: land / park / sand
 *   chunks/<x>_<z>.json buildings + trees per 400 m tile
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DISTRICTS, getDistrict } from '../../src/map/districts.ts';
import { buildDistrict } from '../../src/map/pipeline/index.ts';
import type { OverpassResult } from '../../src/map/pipeline/osm.ts';
import type { MapIndexEntry } from '../../src/map/types.ts';
import { encodeRgbPng } from './png.ts';

async function main() {
  const district = getDistrict(process.argv[2]);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const rawPath = resolve(root, 'data/osm', `${district.id}.json`);
  const outDir = resolve(root, 'public/maps', district.id);
  console.log(`Building ${district.name} from ${rawPath}`);
  const osm = JSON.parse(await readFile(rawPath, 'utf8')) as OverpassResult;
  const t0 = performance.now();
  const build = buildDistrict(osm, district);
  for (const line of build.log) console.log(`  ${line}`);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(resolve(outDir, 'chunks'), { recursive: true });
  await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify(build.manifest, null, 1));
  await writeFile(resolve(outDir, 'network.json'), JSON.stringify(build.network));
  const m = build.mask;
  await writeFile(resolve(outDir, 'landmask.png'), encodeRgbPng(m.width, m.height, m.r, m.g, m.b));
  for (const c of build.chunks) {
    await writeFile(resolve(outDir, 'chunks', `${c.cx}_${c.cz}.json`), JSON.stringify(c));
  }
  await writeFile(
    resolve(outDir, 'ATTRIBUTION.txt'),
    [
      `Map data for ${district.name} is derived from OpenStreetMap.`,
      '© OpenStreetMap contributors — https://www.openstreetmap.org/copyright',
      'Available under the Open Database License (ODbL) 1.0: https://opendatacommons.org/licenses/odbl/1-0/',
      'The files in this directory form a Derivative Database and are likewise made available under the ODbL 1.0.',
      `OSM snapshot: ${build.manifest.osmTimestamp ?? 'unknown'}; generated ${build.manifest.generatedAt}.`,
      '',
    ].join('\n'),
  );

  // Update the district index used by the game's map menu.
  const indexPath = resolve(root, 'public/maps/index.json');
  let index: MapIndexEntry[];
  try {
    index = JSON.parse(await readFile(indexPath, 'utf8')) as MapIndexEntry[];
  } catch {
    index = [];
  }
  index = index.filter((d) => d.id !== district.id && DISTRICTS[d.id]);
  index.push(build.index);
  index.sort((a, b) => Object.keys(DISTRICTS).indexOf(a.id) - Object.keys(DISTRICTS).indexOf(b.id));
  await writeFile(indexPath, JSON.stringify(index, null, 1));
  console.log(`Done in ${((performance.now() - t0) / 1000).toFixed(1)} s → ${outDir}`);
  console.log(`  stats: ${JSON.stringify(build.manifest.stats)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
