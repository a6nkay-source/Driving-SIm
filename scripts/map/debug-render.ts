/**
 * Renders a processed district to a PNG overview (water, parks, sand, roads,
 * flyovers, buildings, shoreline) for checking pipeline output by eye.
 *
 *   npx tsx scripts/map/debug-render.ts south-mumbai out.png [scale]
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { fillPolygon } from '../../src/map/pipeline/landmask.ts';
import type { ChunkData, MapManifest, NetworkData } from '../../src/map/types.ts';
import { encodeRgbPng } from './png.ts';

function decodeRgbPng(buf: Buffer): { w: number; h: number; px: Uint8Array } {
  let o = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
    } else if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) px.set(raw.subarray(y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1)), y * w * 3);
  return { w, h, px };
}

async function main() {
  const id = process.argv[2] ?? 'south-mumbai';
  const out = process.argv[3] ?? 'map-debug.png';
  const scale = Number(process.argv[4] ?? 3);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const dir = resolve(root, 'public/maps', id);
  const manifest = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8')) as MapManifest;
  const net = JSON.parse(await readFile(resolve(dir, 'network.json'), 'utf8')) as NetworkData;
  const mask = decodeRgbPng(await readFile(resolve(dir, 'landmask.png')));
  const { minX, minZ, maxX, maxZ } = manifest.bounds;
  const W = Math.ceil((maxX - minX) / scale);
  const H = Math.ceil((maxZ - minZ) / scale);
  const r = new Uint8Array(W * H);
  const g = new Uint8Array(W * H);
  const b = new Uint8Array(W * H);
  const set = (i: number, c: [number, number, number]) => {
    r[i] = c[0];
    g[i] = c[1];
    b[i] = c[2];
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const mx = Math.min(mask.w - 1, Math.floor(((x + 0.5) * scale) / manifest.landmask.res));
      const my = Math.min(mask.h - 1, Math.floor(((y + 0.5) * scale) / manifest.landmask.res));
      const k = (my * mask.w + mx) * 3;
      const land = mask.px[k] > 127;
      const c: [number, number, number] = !land
        ? [20, 40, 80]
        : mask.px[k + 2] > 127
          ? [200, 180, 120]
          : mask.px[k + 1] > 127
            ? [40, 90, 45]
            : [55, 55, 60];
      set(y * W + x, c);
    }
  }
  for (const f of await readdir(resolve(dir, 'chunks'))) {
    const c = JSON.parse(await readFile(resolve(dir, 'chunks', f), 'utf8')) as ChunkData;
    for (const bd of c.buildings) {
      const col: [number, number, number] =
        bd.s === 1 ? [170, 130, 90] : bd.s === 2 ? [90, 140, 190] : bd.s === 3 ? [210, 170, 190] : [120, 120, 130];
      fillPolygon(bd.p, W, H, scale, minX, minZ, (i) => set(i, col));
    }
    for (let i = 0; i < c.trees.length; i += 3) {
      const x = Math.floor((c.trees[i] - minX) / scale);
      const y = Math.floor((c.trees[i + 1] - minZ) / scale);
      if (x >= 0 && y >= 0 && x < W && y < H) set(y * W + x, [60, 200, 70]);
    }
  }
  const stamp = (x0: number, z0: number, x1: number, z1: number, rad: number, col: [number, number, number]) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len / (scale * 0.5)));
    const rr = Math.max(0, Math.round(rad / scale));
    for (let s = 0; s <= steps; s++) {
      const x = Math.floor((x0 + ((x1 - x0) * s) / steps - minX) / scale);
      const y = Math.floor((z0 + ((z1 - z0) * s) / steps - minZ) / scale);
      for (let dy = -rr; dy <= rr; dy++)
        for (let dx = -rr; dx <= rr; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) set(yy * W + xx, col);
        }
    }
  };
  for (const e of net.edges) {
    const col: [number, number, number] = e.h ? [255, 80, 200] : e.k <= 2 ? [255, 190, 60] : e.k <= 4 ? [230, 230, 230] : [160, 160, 160];
    for (let i = 0; i + 3 < e.p.length; i += 2) stamp(e.p[i], e.p[i + 1], e.p[i + 2], e.p[i + 3], e.w / 2, col);
  }
  for (const line of net.shore) for (let i = 0; i + 3 < line.length; i += 2) stamp(line[i], line[i + 1], line[i + 2], line[i + 3], 0, [0, 255, 255]);
  for (const cluster of net.signals) for (const n of cluster) stamp(net.nodes[n * 2], net.nodes[n * 2 + 1], net.nodes[n * 2], net.nodes[n * 2 + 1], 6, [255, 0, 0]);
  await writeFile(out, encodeRgbPng(W, H, r, g, b));
  console.log(`wrote ${out} (${W}×${H})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
