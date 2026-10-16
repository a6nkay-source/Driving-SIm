/**
 * Procedurally generated canvas textures. Everything is drawn at runtime, so
 * the game ships with no third-party image assets.
 */
import * as THREE from 'three';
import { rng } from '../map/geometry';

const cache = new Map<string, THREE.Texture>();

export const DEVANAGARI_FONT = '"Rajdhani", "Kohinoor Devanagari", "Nirmala UI", "Mangal", "Noto Sans Devanagari", sans-serif';
export const UI_FONT = '"Rajdhani", "Inter", "Segoe UI", Arial, sans-serif';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, opts: { repeat?: boolean; srgb?: boolean; aniso?: number } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso ?? 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

function memo<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined;
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, seed: number, palette: string[], size: [number, number]) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = palette[Math.floor(r() * palette.length)];
    const s = size[0] + r() * (size[1] - size[0]);
    ctx.globalAlpha = 0.25 + r() * 0.6;
    ctx.fillRect(r() * w, r() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

/** Tileable mottled asphalt with aggregate, patch repairs and faint cracks. */
export function asphaltTexture(): THREE.Texture {
  return memo('asphalt', () => {
    const S = 512;
    const [c, ctx] = canvas(S, S);
    ctx.fillStyle = '#353639';
    ctx.fillRect(0, 0, S, S);
    const r = rng(11);
    // Large-scale tone variation.
    for (let i = 0; i < 40; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = 30 + r() * 120;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const tone = r() < 0.5 ? '0,0,0' : '120,118,112';
      g.addColorStop(0, `rgba(${tone},${0.05 + r() * 0.08})`);
      g.addColorStop(1, `rgba(${tone},0)`);
      ctx.fillStyle = g;
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        ctx.save();
        ctx.translate(dx, dy);
        ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        ctx.restore();
      }
    }
    speckle(ctx, S, S, 22000, 3, ['#242527', '#4b4c4e', '#5c5b57', '#303133', '#6a6863'], [0.8, 2.2]);
    // Patch repairs (common on Mumbai roads).
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `rgba(30,30,32,${0.18 + r() * 0.12})`;
      const w = 40 + r() * 90;
      const h = 30 + r() * 70;
      ctx.fillRect(r() * (S - w), r() * (S - h), w, h);
    }
    ctx.strokeStyle = 'rgba(20,20,20,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      let x = r() * S;
      let y = r() * S;
      ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (r() - 0.5) * 30;
        y += (r() - 0.5) * 30;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    return finish(c, { repeat: true });
  });
}

/** Grey-scale noise used for puddles / wetness variation (linear). */
export function puddleTexture(): THREE.Texture {
  return memo('puddle', () => {
    const S = 256;
    const [c, ctx] = canvas(S, S);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    const r = rng(21);
    for (let i = 0; i < 70; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = 8 + r() * 36;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.4)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, rad, rad * (0.5 + r() * 0.5), r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(c, { repeat: true, srgb: false });
  });
}

/**
 * Footpath pavers along u, with the kerb at v=0 painted in alternating black
 * and yellow blocks — a signature of Indian city streets.
 */
export function sidewalkTexture(): THREE.Texture {
  return memo('sidewalk', () => {
    const W = 512;
    const H = 256;
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = '#8f8a82';
    ctx.fillRect(0, 0, W, H);
    const r = rng(5);
    const kerb = 26;
    // Interlocking pavers.
    const bw = 32;
    const bh = 22;
    for (let y = kerb; y < H; y += bh) {
      const off = ((y / bh) % 2) * (bw / 2);
      for (let x = -bw; x < W + bw; x += bw) {
        const v = 120 + Math.floor(r() * 40);
        const red = r() < 0.18;
        ctx.fillStyle = red ? `rgb(${v + 30},${v - 25},${v - 35})` : `rgb(${v},${v - 4},${v - 10})`;
        ctx.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
      }
    }
    speckle(ctx, W, H, 6000, 8, ['#4d4a45', '#a39e95', '#6f6a63'], [0.8, 2]);
    // Grime.
    for (let i = 0; i < 25; i++) {
      ctx.fillStyle = `rgba(40,35,30,${0.05 + r() * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(r() * W, kerb + r() * (H - kerb), 10 + r() * 50, 6 + r() * 20, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Painted kerb stones: 4 blocks per texture repeat.
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#e2b52a' : '#1b1b1b';
      ctx.fillRect((i * W) / 4, 0, W / 4, kerb);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, kerb - 3, W, 3);
    speckle(ctx, W, kerb, 1600, 9, ['#555', '#888', '#3a3a3a'], [1, 3]);
    return finish(c, { repeat: true });
  });
}

export function groundTexture(): THREE.Texture {
  return memo('ground', () => {
    const S = 512;
    const [c, ctx] = canvas(S, S);
    ctx.fillStyle = '#76746e';
    ctx.fillRect(0, 0, S, S);
    const r = rng(31);
    for (let i = 0; i < 60; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = 20 + r() * 90;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const tone = r() < 0.5 ? '60,55,48' : '150,142,128';
      g.addColorStop(0, `rgba(${tone},0.25)`);
      g.addColorStop(1, `rgba(${tone},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    speckle(ctx, S, S, 16000, 32, ['#595752', '#97938a', '#6c6a64', '#4c4a46'], [0.8, 2.5]);
    return finish(c, { repeat: true });
  });
}

export function grassTexture(): THREE.Texture {
  return memo('grass', () => {
    const S = 256;
    const [c, ctx] = canvas(S, S);
    ctx.fillStyle = '#4c6b2f';
    ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, S, 14000, 41, ['#3c5a24', '#5f8038', '#6d8c3e', '#465f28', '#7e8a46'], [0.8, 2.5]);
    return finish(c, { repeat: true });
  });
}

export function sandTexture(): THREE.Texture {
  return memo('sand', () => {
    const S = 256;
    const [c, ctx] = canvas(S, S);
    ctx.fillStyle = '#c8b28a';
    ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, S, 12000, 51, ['#b79f76', '#d8c49f', '#a8916a', '#e0d0ad'], [0.6, 1.8]);
    return finish(c, { repeat: true });
  });
}

export function concreteTexture(): THREE.Texture {
  return memo('concrete', () => {
    const S = 256;
    const [c, ctx] = canvas(S, S);
    ctx.fillStyle = '#9a968e';
    ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, S, 9000, 61, ['#7c7870', '#b3afa6', '#686560', '#8a867d'], [0.8, 2.4]);
    const r = rng(62);
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = `rgba(30,30,25,${0.04 + r() * 0.08})`;
      ctx.fillRect(r() * S, 0, 2 + r() * 10, S);
    }
    return finish(c, { repeat: true });
  });
}

/** Soft radial falloff used for street-light pools, halos and flares (linear). */
export function radialTexture(): THREE.Texture {
  return memo('radial', () => {
    const S = 128;
    const [c, ctx] = canvas(S, S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return finish(c, { srgb: false });
  });
}

/** Vertical gradient for fake volumetric headlight beams (linear). */
export function beamTexture(): THREE.Texture {
  return memo('beam', () => {
    const [c, ctx] = canvas(64, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 256);
    return finish(c, { srgb: false });
  });
}

export function honeycombTexture(): THREE.Texture {
  return memo('honeycomb', () => {
    const S = 256;
    const [c, ctx] = canvas(S, S);
    ctx.fillStyle = '#050506';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = '#2b2d31';
    ctx.lineWidth = 3;
    const r = 12;
    const h = Math.sqrt(3) * r;
    for (let row = -1; row < S / h + 1; row++) {
      for (let col = -1; col < S / (r * 3) + 1; col++) {
        const cx = col * r * 3 + (row % 2 ? r * 1.5 : 0);
        const cy = row * (h / 2);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k;
          ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    return finish(c, { repeat: true });
  });
}

/** Indian high-security registration plate: white, black text, blue "IND" strip. */
export function numberPlateTexture(text: string, commercial = false): THREE.Texture {
  return memo(`plate:${text}:${commercial}`, () => {
    const W = 512;
    const H = 112;
    const [c, ctx] = canvas(W, H);
    // Commercial (taxi, auto, bus) plates are yellow with black text.
    ctx.fillStyle = commercial ? '#f2c418' : '#f4f4f0';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 6;
    ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.fillStyle = '#1d3f9a';
    ctx.fillRect(14, 16, 44, H - 32);
    ctx.fillStyle = '#fff';
    ctx.font = `700 18px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('IND', 36, H - 26);
    ctx.fillStyle = '#e8b53a';
    ctx.beginPath();
    ctx.arc(36, 38, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0d0d0d';
    ctx.font = `700 64px ${UI_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text.toUpperCase(), (W + 60) / 2, H / 2 + 3);
    return finish(c);
  });
}

const SHOP_NAMES: [string, string?][] = [
  ['Mumbai Chai Point', 'मुंबई चहा'],
  ['Irani Café', 'इराणी कॅफे'],
  ['Sharma Sweets', 'शर्मा मिठाई'],
  ['Vada Pav Centre', 'वडा पाव'],
  ['Laxmi Medical', 'लक्ष्मी मेडिकल'],
  ['Ganesh Xerox', 'गणेश झेरॉक्स'],
  ['Shree Kirana Stores', 'श्री किराणा'],
  ['Bombay Silk House'],
  ['New Mobile Repair'],
  ['Saraswati Book Depot', 'सरस्वती बुक डेपो'],
  ['Pav Bhaji Corner', 'पाव भाजी'],
  ['Konkan Seafood', 'कोकण'],
  ['Royal Tailors'],
  ['Sai Optics', 'साई ऑप्टिक्स'],
  ['Kala Ghoda Books'],
  ['Marine Lines Bakery'],
  ['Jai Hind Electricals', 'जय हिंद'],
  ['Kolhapuri Chappals', 'कोल्हापुरी'],
  ['Bhel Puri House', 'भेळ पुरी'],
  ['City Pharmacy'],
  ['Colaba Café'],
  ['Mahalaxmi Jewellers', 'महालक्ष्मी ज्वेलर्स'],
  ['Fresh Juice Centre', 'ज्यूस सेंटर'],
  ['Om Sai Hardware', 'ॐ साई'],
  ['Udupi Restaurant'],
  ['Hotel Pradeep', 'हॉटेल प्रदीप'],
  ['Banarasi Paan', 'पान'],
  ['Fort Watch Co.'],
  ['Shiv Sagar', 'शिवसागर'],
  ['Radio House'],
  ['Mahim Halwa', 'माहीम हलवा'],
  ['Cutting Chai', 'कटिंग चहा'],
];
const SIGN_COLORS = ['#c0392b', '#f1c40f', '#1f4e8c', '#1e7d4b', '#e67e22', '#7b2d8b', '#0d0d0d', '#b8860b', '#ffffff', '#00897b'];

export const SHOP_ATLAS = { cols: 4, rows: 8 };

/** 32 shop sign boards in one atlas (4 × 8 cells, 2:1 aspect). */
export function shopSignAtlas(): THREE.Texture {
  return memo('shops', () => {
    const CW = 384;
    const CH = 128;
    const { cols, rows } = SHOP_ATLAS;
    const [c, ctx] = canvas(CW * cols, CH * rows);
    const r = rng(77);
    SHOP_NAMES.forEach(([en, mr], i) => {
      const x = (i % cols) * CW;
      const y = Math.floor(i / cols) * CH;
      const bg = SIGN_COLORS[Math.floor(r() * SIGN_COLORS.length)];
      const light = bg === '#ffffff' || bg === '#f1c40f';
      ctx.fillStyle = bg;
      ctx.fillRect(x + 2, y + 2, CW - 4, CH - 4);
      ctx.strokeStyle = light ? '#333' : 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 4;
      ctx.strokeRect(x + 8, y + 8, CW - 16, CH - 16);
      ctx.fillStyle = light ? '#b01c1c' : r() < 0.5 ? '#ffffff' : '#ffd54a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (mr) {
        ctx.font = `700 40px ${DEVANAGARI_FONT}`;
        ctx.fillText(mr, x + CW / 2, y + CH * 0.36, CW - 30);
        ctx.font = `700 30px ${UI_FONT}`;
        ctx.fillText(en.toUpperCase(), x + CW / 2, y + CH * 0.74, CW - 30);
      } else {
        ctx.font = `700 46px ${UI_FONT}`;
        ctx.fillText(en.toUpperCase(), x + CW / 2, y + CH / 2 + 2, CW - 30);
      }
    });
    return finish(c);
  });
}

export interface SignSpec {
  /** Text lines for a blue direction board: [arrow, english, marathi?]. */
  lines: { arrow: '↑' | '←' | '→'; en: string; mr?: string }[];
}

/** Atlas of standard Indian regulatory signs: 0 speed 50, 1 no parking, 2 STOP, 3 no horn, 4 bus stop. */
export function regulatorySignAtlas(): THREE.Texture {
  return memo('regsigns', () => {
    const S = 256;
    const [c, ctx] = canvas(S * 5, S);
    const centre = (i: number) => i * S + S / 2;
    const ring = (i: number) => {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(centre(i), S / 2, S * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d0121b';
      ctx.lineWidth = S * 0.09;
      ctx.beginPath();
      ctx.arc(centre(i), S / 2, S * 0.41, 0, Math.PI * 2);
      ctx.stroke();
    };
    ring(0);
    ctx.fillStyle = '#111';
    ctx.font = `700 ${S * 0.42}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('50', centre(0), S / 2 + 6);
    // No parking: blue disc, red ring, slash.
    ctx.fillStyle = '#1d4fa8';
    ctx.beginPath();
    ctx.arc(centre(1), S / 2, S * 0.44, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d0121b';
    ctx.lineWidth = S * 0.08;
    ctx.beginPath();
    ctx.arc(centre(1), S / 2, S * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${S * 0.42}px ${UI_FONT}`;
    ctx.fillText('P', centre(1), S / 2 + 6);
    ctx.beginPath();
    ctx.moveTo(centre(1) - S * 0.28, S * 0.22);
    ctx.lineTo(centre(1) + S * 0.28, S * 0.78);
    ctx.stroke();
    // STOP octagon.
    ctx.fillStyle = '#c8101a';
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k * Math.PI) / 4;
      ctx.lineTo(centre(2) + Math.cos(a) * S * 0.46, S / 2 + Math.sin(a) * S * 0.46);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${S * 0.26}px ${UI_FONT}`;
    ctx.fillText('STOP', centre(2), S / 2 + 4);
    // No horn.
    ring(3);
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(centre(3) - 50, S / 2 - 14);
    ctx.lineTo(centre(3) - 20, S / 2 - 14);
    ctx.lineTo(centre(3) + 34, S / 2 - 44);
    ctx.lineTo(centre(3) + 34, S / 2 + 44);
    ctx.lineTo(centre(3) - 20, S / 2 + 14);
    ctx.lineTo(centre(3) - 50, S / 2 + 14);
    ctx.fill();
    ctx.strokeStyle = '#d0121b';
    ctx.lineWidth = S * 0.07;
    ctx.beginPath();
    ctx.moveTo(centre(3) - S * 0.29, S * 0.21);
    ctx.lineTo(centre(3) + S * 0.29, S * 0.79);
    ctx.stroke();
    // Bus stop board.
    ctx.fillStyle = '#1d4fa8';
    ctx.fillRect(4 * S + 12, 30, S - 24, S - 60);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${S * 0.16}px ${UI_FONT}`;
    ctx.fillText('BUS STOP', centre(4), S * 0.4);
    ctx.font = `700 ${S * 0.15}px ${DEVANAGARI_FONT}`;
    ctx.fillText('बस थांबा', centre(4), S * 0.64);
    return finish(c);
  });
}

/**
 * Atlas of blue direction boards with real road names, built per map.
 * Returns the texture and the number of cells (each cell is 2:1).
 */
export function directionBoardAtlas(specs: SignSpec[]): THREE.Texture {
  const CW = 512;
  const CH = 256;
  const cols = 4;
  const rows = Math.max(1, Math.ceil(specs.length / cols));
  const [c, ctx] = canvas(CW * cols, CH * rows);
  specs.forEach((spec, i) => {
    const x = (i % cols) * CW;
    const y = Math.floor(i / cols) * CH;
    ctx.fillStyle = '#16449b';
    ctx.fillRect(x + 3, y + 3, CW - 6, CH - 6);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 6;
    ctx.strokeRect(x + 12, y + 12, CW - 24, CH - 24);
    const lines = spec.lines.slice(0, 3);
    const lh = (CH - 40) / Math.max(1, lines.length);
    lines.forEach((l, k) => {
      const cy = y + 20 + lh * (k + 0.5);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.min(64, lh * 0.8)}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(l.arrow, x + 52, cy);
      ctx.textAlign = 'left';
      if (l.mr) {
        ctx.font = `600 ${Math.min(30, lh * 0.36)}px ${DEVANAGARI_FONT}`;
        ctx.fillText(l.mr, x + 92, cy - lh * 0.2, CW - 120);
        ctx.font = `700 ${Math.min(34, lh * 0.4)}px ${UI_FONT}`;
        ctx.fillText(l.en, x + 92, cy + lh * 0.2, CW - 120);
      } else {
        ctx.font = `700 ${Math.min(40, lh * 0.5)}px ${UI_FONT}`;
        ctx.fillText(l.en, x + 92, cy, CW - 120);
      }
    });
  });
  const t = finish(c);
  t.userData = { cols, rows };
  return t;
}

export function disposeTextureCache(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
