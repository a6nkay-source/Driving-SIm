/**
 * Hand-built models of two Mumbai icons, placed on their OpenStreetMap
 * footprints:
 *
 *  - Chhatrapati Shivaji Maharaj Terminus (Victoria Terminus, 1888): Victorian
 *    Gothic in buff sandstone with grey basalt dressings — a U-shaped block
 *    around a forecourt, gabled wings with corner turrets and spires, and the
 *    great ribbed central dome topped by the statue of Progress. Floodlit at night.
 *  - Haji Ali Dargah (1431): the white marble mosque and tomb on its rocky islet
 *    in the Arabian Sea — onion dome, corner kiosks, the tall minaret — joined
 *    to the shore by its narrow causeway, lamp-lit at night.
 *
 * Both are stylised, not survey-accurate reconstructions. Models are built
 * with the façade along local X and the front facing local +Z.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { worldUniforms } from './materials';

type V3 = [number, number, number];

// ------------------------------------------------------------------ helpers
function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** A box whose UVs are in "tiles" (metres / tile size) so façade textures keep their scale. */
function tiledBox(w: number, h: number, d: number, tileW: number, tileH: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // Face order: +x, −x, +y, −y, +z, −z; four vertices each.
  const sizes: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * sizes[f][0]) / tileW, (uv.getY(k) * sizes[f][1]) / tileH);
    }
  }
  return g;
}

/** Collects geometry per material and merges each set into one mesh. */
class Batch {
  private sets = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(mat: THREE.Material, geo: THREE.BufferGeometry, pos: V3 = [0, 0, 0], rotY = 0): void {
    if (rotY) geo.rotateY(rotY);
    geo.translate(pos[0], pos[1], pos[2]);
    if (!this.sets.has(mat)) this.sets.set(mat, []);
    this.sets.get(mat)!.push(geo);
  }

  build(group: THREE.Group, shadows = true): void {
    for (const [mat, list] of this.sets) {
      const norm = list.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        if (!n.getAttribute('uv')) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.getAttribute('position').count * 2), 2));
        if (!n.getAttribute('normal')) n.computeVertexNormals();
        for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
        return n;
      });
      const merged = mergeGeometries(norm, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

/** Night floodlighting: lit surfaces glow with their own colour after dark. */
function floodlit<T extends THREE.MeshStandardMaterial>(mat: T, strength: number, tint = new THREE.Color(1, 0.92, 0.78)): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = worldUniforms.uNight;
    shader.uniforms.uFlood = { value: tint.multiplyScalar(strength) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform vec3 uFlood;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uFlood * uNight;');
  };
  mat.customProgramCacheKey = () => `floodlit-${strength}`;
  return mat;
}

/** A gable: a triangular prism, ridge along local Z (depth), facing ±Z. */
function gable(width: number, height: number, depth: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(width / 2, 0);
  s.lineTo(0, height);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
}

/** A pitched roof along local X: triangular prism. */
function pitchedRoof(length: number, width: number, height: number): THREE.BufferGeometry {
  return gable(width, height, length).rotateY(Math.PI / 2);
}

function lathe(profile: [number, number][], segments: number): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

/** Floating name label (fixed on-screen size), faded with distance by the scene. */
export function labelSprite(title: string, subtitle: string): THREE.Sprite {
  const W = 1024;
  const H = 220;
  const tex = canvasTexture(W, H, (ctx) => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(6, 10, 20, 0.72)';
    const r = 40;
    ctx.beginPath();
    ctx.roundRect(8, 8, W - 16, H - 16, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 178, 63, 0.9)';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 70px "Rajdhani", "Inter", "Segoe UI", sans-serif';
    ctx.fillText(title, W / 2, 98);
    ctx.fillStyle = '#ffd38a';
    ctx.font = '600 58px "Rajdhani", "Kohinoor Devanagari", "Nirmala UI", sans-serif';
    ctx.fillText(subtitle, W / 2, 172);
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: false, fog: false }));
  s.scale.set(0.3, (0.3 * H) / W, 1);
  s.renderOrder = 20;
  return s;
}

// ------------------------------------------------------------------ CSMT
function gothicFacade(): THREE.CanvasTexture {
  // One tile = 7 m × 6 m: a storey with a pair of pointed-arch windows.
  return canvasTexture(256, 220, (ctx) => {
    ctx.fillStyle = '#cdb489';
    ctx.fillRect(0, 0, 256, 220);
    // Stone courses.
    ctx.strokeStyle = 'rgba(120, 95, 60, 0.25)';
    ctx.lineWidth = 1;
    for (let y = 8; y < 220; y += 14) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
    }
    // Grey-blue basalt string course and white band.
    ctx.fillStyle = '#6f747a';
    ctx.fillRect(0, 196, 256, 24);
    ctx.fillStyle = '#ece6d6';
    ctx.fillRect(0, 186, 256, 10);
    for (const cx of [68, 188]) {
      // White stone surround, then the dark window with a pointed (Gothic) head.
      const draw = (inset: number, color: string) => {
        const w = 62 - inset * 2;
        const top = 52 + inset;
        const bottom = 170 - inset * 0.3;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, bottom);
        ctx.lineTo(cx - w / 2, top + w * 0.5);
        ctx.quadraticCurveTo(cx - w / 2, top, cx, top - w * 0.35);
        ctx.quadraticCurveTo(cx + w / 2, top, cx + w / 2, top + w * 0.5);
        ctx.lineTo(cx + w / 2, bottom);
        ctx.closePath();
        ctx.fill();
      };
      draw(0, '#efe9da');
      draw(7, '#1c2026');
      // Mullion and a lighter pane reflection.
      ctx.fillStyle = '#efe9da';
      ctx.fillRect(cx - 2, 60, 4, 110);
      ctx.fillStyle = 'rgba(140, 170, 200, 0.18)';
      ctx.fillRect(cx - 22, 90, 18, 70);
      // Sill.
      ctx.fillStyle = '#6f747a';
      ctx.fillRect(cx - 36, 170, 72, 8);
    }
    // Small polychrome roundel between the windows.
    ctx.fillStyle = '#8a4a35';
    ctx.beginPath();
    ctx.arc(128, 40, 9, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function buildCsmt(len: number, wid: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'csmt';
  const L = Math.max(80, Math.min(130, len));
  const W = Math.max(56, Math.min(90, wid));
  const facadeTex = gothicFacade();
  const stone = floodlit(new THREE.MeshStandardMaterial({ map: facadeTex, roughness: 0.86, metalness: 0 }), 0.55);
  const plain = floodlit(new THREE.MeshStandardMaterial({ color: 0xcdb489, roughness: 0.88 }), 0.55);
  const dressing = floodlit(new THREE.MeshStandardMaterial({ color: 0xece6d6, roughness: 0.75 }), 0.5);
  const basalt = new THREE.MeshStandardMaterial({ color: 0x5f646a, roughness: 0.82 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x7c4636, roughness: 0.78 });
  const dome = floodlit(new THREE.MeshStandardMaterial({ color: 0x8e938f, roughness: 0.6, metalness: 0.15, flatShading: true }), 0.6, new THREE.Color(0.9, 0.95, 1));
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a046, roughness: 0.32, metalness: 0.9, emissive: 0x3a2a08 });
  const B = new Batch();
  const storey = 6;
  const H = storey * 3 + 1;
  const backD = 20;
  const wingW = 20;
  const backZ = -W / 2 + backD / 2;

  // Back range across the full width, and two wings running to the front.
  B.add(basalt, new THREE.BoxGeometry(L + 1, 1.2, backD + 1), [0, 0.6, backZ]);
  B.add(stone, tiledBox(L, H, backD, 7, storey), [0, 1.2 + H / 2, backZ]);
  B.add(roof, pitchedRoof(L, backD, 6.5), [0, 1.2 + H, backZ]);
  const wingLen = W - backD;
  for (const s of [-1, 1]) {
    const x = s * (L / 2 - wingW / 2);
    const z = -W / 2 + backD + wingLen / 2;
    B.add(basalt, new THREE.BoxGeometry(wingW + 1, 1.2, wingLen + 1), [x, 0.6, z]);
    B.add(stone, tiledBox(wingW, H - 1, wingLen, 7, storey), [x, 1.2 + (H - 1) / 2, z]);
    B.add(roof, gable(wingW, 6.5, wingLen), [x, 1.2 + H - 1, z]);
    // Gabled pavilion at the end of each wing facing the forecourt.
    const fz = W / 2 - 2;
    B.add(stone, tiledBox(wingW + 2, H + 3, 6, 7, storey), [x, 1.2 + (H + 3) / 2, fz]);
    B.add(dressing, gable(wingW + 2, 9, 6.4), [x, 1.2 + H + 3, fz]);
    // Corner turrets with spires on each pavilion.
    for (const t of [-1, 1]) {
      const tx = x + t * (wingW / 2 + 1);
      B.add(plain, new THREE.CylinderGeometry(1.9, 2.1, H + 8, 8), [tx, 1.2 + (H + 8) / 2, fz + 2.6]);
      B.add(roof, new THREE.ConeGeometry(2.3, 7, 8), [tx, 1.2 + H + 8 + 3.5, fz + 2.6]);
      B.add(gold, new THREE.ConeGeometry(0.25, 1.6, 6), [tx, 1.2 + H + 15.8, fz + 2.6]);
    }
  }
  // Outer corner towers of the back range.
  for (const s of [-1, 1]) {
    const tx = s * (L / 2 + 0.5);
    for (const tz of [-W / 2, -W / 2 + backD]) {
      B.add(plain, new THREE.CylinderGeometry(2.2, 2.4, H + 10, 8), [tx, 1.2 + (H + 10) / 2, tz]);
      B.add(roof, new THREE.ConeGeometry(2.7, 8, 8), [tx, 1.2 + H + 10 + 4, tz]);
    }
  }
  // Gables along the back range's courtyard face.
  for (let i = -2; i <= 2; i++) {
    if (i === 0) continue;
    const gx = (i / 2.6) * (L / 2 - wingW);
    B.add(dressing, gable(9, 7, 2), [gx, 1.2 + H, backZ + backD / 2]);
  }
  // Pinnacles along the roof lines.
  for (let i = 0; i <= 14; i++) {
    const px = -L / 2 + (i / 14) * L;
    B.add(dressing, new THREE.ConeGeometry(0.35, 2.4, 6), [px, 1.2 + H + 1.2, backZ + backD / 2 + 0.3]);
  }

  // Central tower: square base, octagonal drum, ribbed Gothic dome, lantern and statue.
  const tz = backZ + backD / 2 - 4;
  B.add(stone, tiledBox(24, 30, 24, 7, storey), [0, 1.2 + 15, tz]);
  B.add(dressing, gable(24, 10, 3), [0, 1.2 + 30, tz + 11]);
  // Great rose window in the gable.
  B.add(basalt, new THREE.CylinderGeometry(3.4, 3.4, 0.6, 24).rotateX(Math.PI / 2), [0, 1.2 + 27, tz + 12.1]);
  B.add(dressing, new THREE.TorusGeometry(3.6, 0.4, 6, 24), [0, 1.2 + 27, tz + 12.3]);
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) {
      B.add(plain, new THREE.CylinderGeometry(1.6, 1.8, 14, 8), [s * 11.5, 1.2 + 30 + 7, tz + t * 11.5]);
      B.add(roof, new THREE.ConeGeometry(2, 6, 8), [s * 11.5, 1.2 + 44 + 3, tz + t * 11.5]);
    }
  }
  B.add(stone, tiledBox(17, 8, 17, 7, storey), [0, 1.2 + 30 + 4, tz]);
  B.add(plain, new THREE.CylinderGeometry(8.6, 9.2, 6, 8), [0, 1.2 + 38 + 3, tz]);
  B.add(
    dome,
    lathe(
      [
        [9.4, 0],
        [9.6, 2],
        [9.2, 4.6],
        [8.2, 7.2],
        [6.6, 9.6],
        [4.4, 11.6],
        [2.1, 13],
        [0.7, 13.6],
        [0.01, 13.8],
      ],
      8,
    ),
    [0, 1.2 + 44, tz],
  );
  // Ribs on the dome's eight edges.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rib = new THREE.TorusGeometry(9.3, 0.28, 4, 16, Math.PI / 2.2).rotateZ(Math.PI * 0.05);
    rib.rotateY(a);
    B.add(dressing, rib, [0, 1.2 + 44, tz]);
  }
  B.add(plain, new THREE.CylinderGeometry(1.3, 1.6, 3, 8), [0, 1.2 + 58.6, tz]);
  B.add(gold, new THREE.CylinderGeometry(0.45, 0.7, 4.2, 8), [0, 1.2 + 62.2, tz]);
  B.add(gold, new THREE.SphereGeometry(0.55, 10, 8), [0, 1.2 + 64.6, tz]);
  // The statue's raised torch.
  B.add(gold, new THREE.CylinderGeometry(0.12, 0.12, 2.2, 6).rotateZ(0.4), [0.5, 1.2 + 65.4, tz]);

  // Forecourt paving and a low railing with gate piers along the front.
  B.add(new THREE.MeshStandardMaterial({ color: 0x9c968c, roughness: 0.92 }), new THREE.BoxGeometry(L - wingW * 2, 0.08, wingLen), [0, 0.04, -W / 2 + backD + wingLen / 2]);
  for (const s of [-1, 1]) {
    B.add(basalt, new THREE.BoxGeometry(L / 2 - wingW - 6, 1.1, 0.5), [s * ((L / 2 - wingW - 6) / 2 + 6), 0.55, W / 2 - 0.5]);
    B.add(dressing, new THREE.BoxGeometry(1.4, 3.2, 1.4), [s * 6, 1.6, W / 2 - 0.5]);
    B.add(gold, new THREE.SphereGeometry(0.5, 8, 6), [s * 6, 3.6, W / 2 - 0.5]);
  }
  B.build(group);
  return group;
}

// ------------------------------------------------------------------ Haji Ali
function mughalFacade(): THREE.CanvasTexture {
  // One tile = 4 m × 5 m: a white marble bay with a cusped arch recess.
  return canvasTexture(128, 160, (ctx) => {
    ctx.fillStyle = '#f3f1ea';
    ctx.fillRect(0, 0, 128, 160);
    ctx.fillStyle = '#c9cfd6';
    ctx.beginPath();
    ctx.moveTo(26, 150);
    ctx.lineTo(26, 70);
    ctx.quadraticCurveTo(26, 34, 64, 22);
    ctx.quadraticCurveTo(102, 34, 102, 70);
    ctx.lineTo(102, 150);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7f8a96';
    ctx.beginPath();
    ctx.moveTo(36, 150);
    ctx.lineTo(36, 76);
    ctx.quadraticCurveTo(36, 46, 64, 36);
    ctx.quadraticCurveTo(92, 46, 92, 76);
    ctx.lineTo(92, 150);
    ctx.closePath();
    ctx.fill();
    // Jali screen pattern in the lower half.
    ctx.strokeStyle = 'rgba(243, 241, 234, 0.6)';
    ctx.lineWidth = 2;
    for (let x = 40; x < 92; x += 8) {
      ctx.beginPath();
      ctx.moveTo(x, 96);
      ctx.lineTo(x, 148);
      ctx.stroke();
    }
    for (let y = 100; y < 150; y += 8) {
      ctx.beginPath();
      ctx.moveTo(38, y);
      ctx.lineTo(90, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#e4e0d4';
    ctx.fillRect(0, 0, 128, 8);
    ctx.fillRect(0, 152, 128, 8);
  });
}

function onionDome(r: number, h: number): THREE.BufferGeometry {
  const p: [number, number][] = [
    [r * 0.87, 0],
    [r * 0.96, h * 0.12],
    [r, h * 0.27],
    [r * 0.95, h * 0.42],
    [r * 0.82, h * 0.56],
    [r * 0.6, h * 0.68],
    [r * 0.35, h * 0.79],
    [r * 0.16, h * 0.87],
    [r * 0.07, h * 0.94],
    [0.01, h],
  ];
  return lathe(p, 28);
}

export function buildHajiAli(len: number, wid: number, path: number[] | undefined, center: { x: number; z: number; rot: number }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'haji-ali';
  const L = Math.max(50, Math.min(80, len));
  const W = Math.max(60, Math.min(95, wid));
  const marbleTex = mughalFacade();
  const marble = floodlit(new THREE.MeshStandardMaterial({ map: marbleTex, roughness: 0.45, metalness: 0 }), 0.75, new THREE.Color(0.95, 0.97, 1));
  const white = floodlit(new THREE.MeshStandardMaterial({ color: 0xf6f4ee, roughness: 0.4 }), 0.75, new THREE.Color(0.95, 0.97, 1));
  const paving = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.85 });
  const rock = new THREE.MeshStandardMaterial({ color: 0x4e4740, roughness: 0.95, flatShading: true });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.9, emissive: 0x2a1d04 });
  const green = new THREE.MeshStandardMaterial({ color: 0x1f7a3a, roughness: 0.7, side: THREE.DoubleSide });
  const B = new Batch();

  // The islet: a rocky base rising from the sea with a paved top.
  const islet = new THREE.Shape();
  const rx = L / 2 + 6;
  const rz = W / 2 + 6;
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const k = 1 + 0.06 * Math.sin(a * 3) + 0.04 * Math.cos(a * 5);
    const x = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.55) * rx * k;
    const z = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.55) * rz * k;
    if (i === 0) islet.moveTo(x, z);
    else islet.lineTo(x, z);
  }
  const base = new THREE.ExtrudeGeometry(islet, { depth: 2.2, bevelEnabled: true, bevelSize: 2.5, bevelThickness: 0.8, bevelSegments: 2 });
  // Shape XY → ground XZ (both pieces rotated the same way so they line up).
  base.rotateX(-Math.PI / 2);
  B.add(rock, base, [0, -2.95, 0]);
  const top = new THREE.ShapeGeometry(islet).rotateX(-Math.PI / 2);
  B.add(paving, top, [0, 0.07, 0]);
  // Boulders around the islet.
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 + (i % 3) * 0.05;
    const s = 1.2 + ((i * 37) % 10) / 6;
    const g = new THREE.DodecahedronGeometry(s, 0);
    B.add(rock, g, [Math.cos(a) * (rx + 3.5), -0.9 + s * 0.3, Math.sin(a) * (rz + 3.5)]);
  }

  // Main hall: white marble arcade, set back from the front.
  const hallW = Math.min(32, L * 0.55);
  const hallD = Math.min(26, W * 0.32);
  const hallZ = -W * 0.08;
  const hallH = 9;
  B.add(marble, tiledBox(hallW, hallH, hallD, 4, 5), [0, hallH / 2 + 0.07, hallZ]);
  B.add(white, new THREE.BoxGeometry(hallW + 1.2, 0.8, hallD + 1.2), [0, hallH + 0.47, hallZ]);
  // Parapet merlons.
  for (let i = 0; i <= 16; i++) {
    const x = -hallW / 2 + (i / 16) * hallW;
    for (const zz of [hallZ - hallD / 2 - 0.3, hallZ + hallD / 2 + 0.3]) B.add(white, new THREE.ConeGeometry(0.35, 1.2, 4), [x, hallH + 1.45, zz]);
  }
  // Drum and the great onion dome with its golden finial.
  B.add(white, new THREE.CylinderGeometry(6.6, 6.9, 3.2, 28), [0, hallH + 0.87 + 1.6, hallZ]);
  B.add(white, onionDome(7.6, 11.5), [0, hallH + 0.87 + 3.2, hallZ]);
  B.add(gold, new THREE.CylinderGeometry(0.12, 0.25, 2.6, 8), [0, hallH + 0.87 + 3.2 + 11.5 + 1.2, hallZ]);
  B.add(gold, new THREE.SphereGeometry(0.42, 10, 8), [0, hallH + 0.87 + 3.2 + 11.5 + 0.6, hallZ]);
  // Corner kiosks (chhatris): four pillars and a small dome.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * (hallW / 2 - 1.6);
      const cz = hallZ + sz * (hallD / 2 - 1.6);
      for (const px of [-1, 1]) for (const pz of [-1, 1]) B.add(white, new THREE.CylinderGeometry(0.16, 0.16, 2.4, 6), [cx + px * 1.1, hallH + 2.07, cz + pz * 1.1]);
      B.add(white, new THREE.BoxGeometry(2.9, 0.3, 2.9), [cx, hallH + 3.4, cz]);
      B.add(white, onionDome(1.5, 2.4), [cx, hallH + 3.55, cz]);
      B.add(gold, new THREE.ConeGeometry(0.1, 0.8, 6), [cx, hallH + 6.3, cz]);
    }
  }
  // The minaret.
  const mx = -hallW / 2 - 6;
  const mz = hallZ - hallD / 2 + 2;
  B.add(white, new THREE.CylinderGeometry(1.7, 2.3, 4, 12), [mx, 2.07, mz]);
  B.add(white, new THREE.CylinderGeometry(1.25, 1.6, 20, 12), [mx, 14.07, mz]);
  for (const y of [10, 17, 23.5]) {
    B.add(white, new THREE.CylinderGeometry(2.0, 1.4, 0.6, 12), [mx, y, mz]);
    B.add(white, new THREE.TorusGeometry(1.9, 0.08, 4, 16).rotateX(Math.PI / 2), [mx, y + 0.9, mz]);
  }
  B.add(white, new THREE.CylinderGeometry(1.0, 1.15, 3, 12), [mx, 25.6, mz]);
  B.add(white, onionDome(1.5, 2.6), [mx, 27.1, mz]);
  B.add(gold, new THREE.ConeGeometry(0.12, 1.4, 6), [mx, 30.4, mz]);

  // Entrance gateway facing the causeway, with two small domes.
  const gz = W / 2 + 2;
  const gateShape = new THREE.Shape();
  gateShape.moveTo(-7, 0);
  gateShape.lineTo(7, 0);
  gateShape.lineTo(7, 9);
  gateShape.lineTo(-7, 9);
  gateShape.closePath();
  const arch = new THREE.Path();
  arch.moveTo(-2.6, 0.01);
  arch.lineTo(2.6, 0.01);
  arch.lineTo(2.6, 4.6);
  arch.quadraticCurveTo(2.6, 7.1, 0, 7.9);
  arch.quadraticCurveTo(-2.6, 7.1, -2.6, 4.6);
  arch.lineTo(-2.6, 0.01);
  gateShape.holes.push(arch);
  B.add(white, new THREE.ExtrudeGeometry(gateShape, { depth: 3.4, bevelEnabled: false, curveSegments: 10 }).translate(0, 0.07, -1.7), [0, 0, gz]);
  for (const s of [-1, 1]) {
    B.add(white, new THREE.CylinderGeometry(0.9, 0.9, 1.2, 12), [s * 5, 9.67, gz]);
    B.add(white, onionDome(1.2, 2), [s * 5, 10.27, gz]);
  }
  // A green flag on the gateway.
  B.add(white, new THREE.CylinderGeometry(0.06, 0.06, 5, 6), [0, 11.6, gz]);
  B.add(green, new THREE.PlaneGeometry(2.2, 1.3), [1.15, 13.4, gz]);

  // Low white walls around the courtyard.
  for (const s of [-1, 1]) {
    B.add(white, new THREE.BoxGeometry(0.5, 1.4, W - 6), [s * (L / 2 - 1), 0.77, 0]);
  }
  B.add(white, new THREE.BoxGeometry(L - 2, 1.4, 0.5), [0, 0.77, -W / 2 + 1]);
  B.build(group);

  // ---- The causeway: a narrow walkway from the shore across the shallows.
  if (path && path.length >= 4) {
    const C = new Batch();
    const walk = new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.92 });
    const wall = new THREE.MeshStandardMaterial({ color: 0xd8d3c6, roughness: 0.85 });
    const lampMat = floodlit(new THREE.MeshStandardMaterial({ color: 0xfff1d0, roughness: 0.4 }), 4, new THREE.Color(1, 0.8, 0.5));
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.6 });
    // Path points are world coordinates: convert to the dargah group's local frame.
    const c = Math.cos(center.rot);
    const s = Math.sin(center.rot);
    const local = (x: number, z: number): [number, number] => {
      const dx = x - center.x;
      const dz = z - center.z;
      return [dx * c - dz * s, dx * s + dz * c];
    };
    const width = 5;
    let lampAcc = 0;
    for (let i = 0; i < path.length - 2; i += 2) {
      const [ax, az] = local(path[i], path[i + 1]);
      let [bx, bz] = local(path[i + 2], path[i + 3]);
      // Stop at the islet's edge.
      if (i + 4 >= path.length) {
        const dx = bx - ax;
        const dz = bz - az;
        const l = Math.hypot(dx, dz) || 1;
        const cut = Math.max(0, l - 4);
        bx = ax + (dx / l) * cut;
        bz = az + (dz / l) * cut;
      }
      const dx = bx - ax;
      const dz = bz - az;
      const segLen = Math.hypot(dx, dz);
      if (segLen < 0.5) continue;
      const ang = Math.atan2(dx, dz);
      const mx2 = (ax + bx) / 2;
      const mz2 = (az + bz) / 2;
      C.add(walk, new THREE.BoxGeometry(width, 1.5, segLen + 0.6), [mx2, -0.69, mz2], ang);
      for (const side of [-1, 1]) {
        const ox = Math.cos(ang) * side * (width / 2 - 0.15);
        const oz = -Math.sin(ang) * side * (width / 2 - 0.15);
        C.add(wall, new THREE.BoxGeometry(0.3, 0.55, segLen + 0.6), [mx2 + ox, 0.33, mz2 + oz], ang);
      }
      // Lamp posts every 24 m, alternating sides.
      for (let d = 24 - lampAcc; d < segLen; d += 24) {
        const t = d / segLen;
        const side = Math.floor((lampAcc + d) / 24) % 2 ? 1 : -1;
        const px = ax + dx * t + Math.cos(ang) * side * (width / 2 - 0.15);
        const pz = az + dz * t - Math.sin(ang) * side * (width / 2 - 0.15);
        C.add(poleMat, new THREE.CylinderGeometry(0.07, 0.09, 4, 6), [px, 2.06, pz]);
        C.add(lampMat, new THREE.SphereGeometry(0.28, 8, 6), [px, 4.15, pz]);
      }
      lampAcc = (lampAcc + segLen) % 24;
    }
    C.build(group, false);
  }
  return group;
}
