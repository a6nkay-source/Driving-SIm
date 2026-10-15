/**
 * Runtime map loading: manifest → road network → land mask → streamed chunks.
 * Falls back to the procedural district when any required file is missing or
 * malformed, so the game always starts.
 */
import { buildDistrict } from './pipeline/index';
import { generateSyntheticOsm } from './fallback';
import { RoadGraph } from './RoadGraph';
import { MAP_FORMAT_VERSION, type ChunkData, type MapIndexEntry, type MapManifest, type NetworkData } from './types';

export interface RuntimeMask {
  width: number;
  height: number;
  res: number;
  minX: number;
  minZ: number;
  /** RGBA bytes: R land, G park, B sand. Row 0 is the northern edge (min Z). */
  rgba: Uint8Array;
}

export interface LoadedMap {
  manifest: MapManifest;
  network: NetworkData;
  graph: RoadGraph;
  mask: RuntimeMask;
  fallback: boolean;
  fallbackReason?: string;
  getChunk(cx: number, cz: number): Promise<ChunkData | null>;
}

export type Progress = (fraction: number, label: string) => void;

const base = () => `${import.meta.env?.BASE_URL ?? '/'}maps/`;

async function fetchJSON<T>(url: string): Promise<T> {
  const file = url.split('/').slice(-2).join('/');
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(`network error loading ${file}`);
  }
  if (!res.ok) throw new Error(`${file} not found (HTTP ${res.status})`);
  const text = await res.text();
  // Static hosts often answer missing files with an HTML page.
  if (/^\s*</.test(text)) throw new Error(`${file} is missing`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${file} is corrupt`);
  }
}

export async function loadMapIndex(): Promise<MapIndexEntry[]> {
  try {
    const list = await fetchJSON<MapIndexEntry[]>(`${base()}index.json`);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function decodeMask(url: string, manifest: MapManifest): Promise<RuntimeMask> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`land mask ${res.status}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bmp, 0, 0);
  const { width, height } = bmp;
  const data = ctx.getImageData(0, 0, width, height).data;
  bmp.close?.();
  const lm = manifest.landmask;
  if (width !== lm.width || height !== lm.height) throw new Error(`land mask is ${width}×${height}, expected ${lm.width}×${lm.height}`);
  return { width: lm.width, height: lm.height, res: lm.res, minX: lm.minX, minZ: lm.minZ, rgba: new Uint8Array(data.buffer) };
}

function validateNetwork(n: NetworkData): void {
  if (!Array.isArray(n.nodes) || !Array.isArray(n.edges) || n.edges.length === 0) throw new Error('road network is empty');
  const nodeCount = n.nodes.length / 2;
  for (const e of n.edges) {
    if (e.a >= nodeCount || e.b >= nodeCount || e.p.length < 4) throw new Error('road network is malformed');
  }
}

export async function loadMap(id: string, onProgress: Progress): Promise<LoadedMap> {
  if (id === 'fallback') return buildFallback(onProgress, 'Procedural district selected');
  const dir = `${base()}${id}/`;
  try {
    onProgress(0.03, 'Reading map manifest');
    const manifest = await fetchJSON<MapManifest>(`${dir}manifest.json`);
    if (manifest.format !== MAP_FORMAT_VERSION) {
      throw new Error(`map format ${manifest.format} (expected ${MAP_FORMAT_VERSION}) — run npm run map:build`);
    }
    onProgress(0.1, 'Loading road network');
    const network = await fetchJSON<NetworkData>(`${dir}network.json`);
    validateNetwork(network);
    onProgress(0.28, 'Decoding coastline and parks');
    const mask = await decodeMask(`${dir}${manifest.landmask.file}`, manifest);
    onProgress(0.34, 'Building road graph');
    const graph = new RoadGraph(network);
    const known = new Set(manifest.chunks.map((c) => `${c.cx}_${c.cz}`));
    const cache = new Map<string, Promise<ChunkData | null>>();
    return {
      manifest,
      network,
      graph,
      mask,
      fallback: false,
      getChunk(cx, cz) {
        const key = `${cx}_${cz}`;
        if (!known.has(key)) return Promise.resolve(null);
        let p = cache.get(key);
        if (!p) {
          p = fetchJSON<ChunkData>(`${dir}chunks/${key}.json`).catch((err) => {
            console.warn(`chunk ${key} failed`, err);
            cache.delete(key);
            return null;
          });
          cache.set(key, p);
        }
        return p;
      },
    };
  } catch (err) {
    console.warn('Map load failed, using procedural fallback:', err);
    return buildFallback(onProgress, (err as Error).message);
  }
}

export function buildFallbackSync(): Omit<LoadedMap, 'fallbackReason'> {
  const { osm, config } = generateSyntheticOsm();
  const build = buildDistrict(osm, config, { maskRes: 4 });
  build.manifest.real = false;
  build.manifest.attribution = 'Procedurally generated (fictional) — not real map data';
  const m = build.mask;
  const rgba = new Uint8Array(m.width * m.height * 4);
  for (let i = 0; i < m.width * m.height; i++) {
    rgba[i * 4] = m.r[i];
    rgba[i * 4 + 1] = m.g[i];
    rgba[i * 4 + 2] = m.b[i];
    rgba[i * 4 + 3] = 255;
  }
  const chunks = new Map(build.chunks.map((c) => [`${c.cx}_${c.cz}`, c]));
  return {
    manifest: build.manifest,
    network: build.network,
    graph: new RoadGraph(build.network),
    mask: { width: m.width, height: m.height, res: m.res, minX: m.minX, minZ: m.minZ, rgba },
    fallback: true,
    getChunk: (cx, cz) => Promise.resolve(chunks.get(`${cx}_${cz}`) ?? null),
  };
}

async function buildFallback(onProgress: Progress, reason: string): Promise<LoadedMap> {
  onProgress(0.2, 'Generating procedural fallback district');
  await new Promise((r) => setTimeout(r, 0));
  return { ...buildFallbackSync(), fallbackReason: reason };
}

/** Bilinear sample of a mask channel (0 = R land, 1 = G park, 2 = B sand) → 0..1. */
export function sampleMask(m: RuntimeMask, x: number, z: number, ch = 0): number {
  const fx = (x - m.minX) / m.res - 0.5;
  const fz = (z - m.minZ) / m.res - 0.5;
  const i = Math.max(0, Math.min(m.width - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(m.height - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - i));
  const tz = Math.max(0, Math.min(1, fz - j));
  const w = m.width;
  const d = m.rgba;
  const a = d[(j * w + i) * 4 + ch];
  const b = d[(j * w + i + 1) * 4 + ch];
  const c = d[((j + 1) * w + i) * 4 + ch];
  const e = d[((j + 1) * w + i + 1) * 4 + ch];
  return ((a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz) / 255;
}
