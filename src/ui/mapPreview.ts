/**
 * Vector map rendering shared by the Map screen and the in-game minimap. Road
 * classes are pre-built as Path2D objects in world metres, so drawing at any
 * zoom/rotation is just a canvas transform.
 */
import { buildFallbackSync, loadMap, type LoadedMap, type RuntimeMask } from '../map/MapData';
import { Kind, type MapManifest, type NetworkData } from '../map/types';

export interface MapPreview {
  id: string;
  manifest: MapManifest;
  network: NetworkData;
  land: HTMLCanvasElement;
  paths: { major: Path2D; secondary: Path2D; minor: Path2D; service: Path2D; deck: Path2D; rail: Path2D };
  widths: { major: number; secondary: number; minor: number; service: number; deck: number };
}

const cache = new Map<string, Promise<MapPreview>>();

export function landCanvas(mask: RuntimeMask): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = mask.width;
  c.height = mask.height;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(mask.width, mask.height);
  const d = img.data;
  const m = mask.rgba;
  for (let i = 0; i < mask.width * mask.height; i++) {
    const land = m[i * 4] / 255;
    const park = m[i * 4 + 1] / 255;
    const sand = m[i * 4 + 2] / 255;
    // land #121c2b, park #17321f, sand #3b3423 over transparent water
    let r = 18;
    let g = 28;
    let b = 43;
    r += (23 - r) * park + (59 - r) * sand;
    g += (50 - g) * park + (52 - g) * sand;
    b += (31 - b) * park + (35 - b) * sand;
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = Math.max(0, Math.min(255, (land - 0.45) * 2550));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function buildPaths(net: NetworkData): MapPreview['paths'] {
  const paths = {
    major: new Path2D(),
    secondary: new Path2D(),
    minor: new Path2D(),
    service: new Path2D(),
    deck: new Path2D(),
    rail: new Path2D(),
  };
  for (const e of net.edges) {
    const target = e.h ? paths.deck : e.k <= Kind.Primary ? paths.major : e.k <= Kind.Tertiary ? paths.secondary : e.k <= Kind.LivingStreet ? paths.minor : paths.service;
    target.moveTo(e.p[0], e.p[1]);
    for (let i = 2; i < e.p.length; i += 2) target.lineTo(e.p[i], e.p[i + 1]);
  }
  for (const r of net.rail) {
    paths.rail.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) paths.rail.lineTo(r[i], r[i + 1]);
  }
  return paths;
}

function fromLoaded(id: string, m: Pick<LoadedMap, 'manifest' | 'network' | 'mask'>): MapPreview {
  return {
    id,
    manifest: m.manifest,
    network: m.network,
    land: landCanvas(m.mask),
    paths: buildPaths(m.network),
    widths: { major: 12, secondary: 9, minor: 6, service: 4, deck: 10 },
  };
}

export function loadPreview(id: string, existing?: LoadedMap | null): Promise<MapPreview> {
  if (existing && existing.manifest.id === id) {
    const key = `${id}:live`;
    let p = cache.get(key);
    if (!p) {
      p = Promise.resolve(fromLoaded(id, existing));
      cache.set(key, p);
    }
    return p;
  }
  let p = cache.get(id);
  if (!p) {
    p = (id === 'fallback' ? Promise.resolve(buildFallbackSync()) : loadMap(id, () => undefined)).then((m) => fromLoaded(m.manifest.id, m));
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  return p;
}

export interface DrawOptions {
  /** World point at the canvas centre. */
  cx: number;
  cz: number;
  /** Pixels per metre. */
  scale: number;
  /** Map rotation (radians); the minimap rotates so the car points up. */
  rotation?: number;
  minimal?: boolean;
}

/** Draws in CSS pixels: the caller sets the device-pixel-ratio transform first. */
export function drawMap(ctx: CanvasRenderingContext2D, w: number, h: number, map: MapPreview, o: DrawOptions): void {
  ctx.save();
  ctx.fillStyle = '#081627';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  if (o.rotation) ctx.rotate(o.rotation);
  ctx.scale(o.scale, o.scale);
  ctx.translate(-o.cx, -o.cz);
  const lm = map.manifest.landmask;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(map.land, lm.minX, lm.minZ, lm.width * lm.res, lm.height * lm.res);
  const px = 1 / o.scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const stroke = (p: Path2D, color: string, width: number, minPx: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(width, minPx * px);
    ctx.stroke(p);
  };
  if (!o.minimal) {
    ctx.setLineDash([6 * px, 6 * px]);
    stroke(map.paths.rail, 'rgba(160,140,200,0.35)', 2, 1);
    ctx.setLineDash([]);
  }
  stroke(map.paths.service, '#2b3443', map.widths.service, 0.6);
  stroke(map.paths.minor, '#46505f', map.widths.minor, 0.9);
  stroke(map.paths.secondary, '#8e97a6', map.widths.secondary, 1.3);
  stroke(map.paths.major, '#d9a04a', map.widths.major, 1.8);
  stroke(map.paths.deck, '#b994ff', map.widths.deck, 1.8);
  ctx.restore();
}

/** World → canvas pixel transform matching drawMap. */
export function worldToScreen(x: number, z: number, w: number, h: number, o: DrawOptions): [number, number] {
  let dx = (x - o.cx) * o.scale;
  let dz = (z - o.cz) * o.scale;
  if (o.rotation) {
    const c = Math.cos(o.rotation);
    const s = Math.sin(o.rotation);
    [dx, dz] = [dx * c - dz * s, dx * s + dz * c];
  }
  return [w / 2 + dx, h / 2 + dz];
}

export function screenToWorld(sx: number, sy: number, w: number, h: number, o: DrawOptions): [number, number] {
  let dx = (sx - w / 2) / o.scale;
  let dz = (sy - h / 2) / o.scale;
  if (o.rotation) {
    const c = Math.cos(-o.rotation);
    const s = Math.sin(-o.rotation);
    [dx, dz] = [dx * c - dz * s, dx * s + dz * c];
  }
  return [o.cx + dx, o.cz + dz];
}
