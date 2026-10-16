/**
 * Hand-built landmark models placed at their OpenStreetMap footprints:
 * the Gateway of India (Indo-Saracenic basalt arch) and Flora Fountain.
 * They are stylised, not survey-accurate reconstructions.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Landmark } from '../map/types';
import { buildCsmt, buildHajiAli, labelSprite } from './LandmarkModels';

function norm(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (!n.getAttribute('uv')) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((n.getAttribute('position').count) * 2), 2));
  if (!n.getAttribute('normal')) n.computeVertexNormals();
  return n;
}

function gatewayGeometry(len: number, wid: number): THREE.BufferGeometry {
  const L = Math.max(22, Math.min(36, len));
  const W = Math.max(12, Math.min(22, wid));
  const H = 20;
  const parts: THREE.BufferGeometry[] = [];
  // Plinth.
  parts.push(new THREE.BoxGeometry(L + 6, 1.2, W + 6).translate(0, 0.6, 0));
  // Façade with the great central arch and smaller side arches, extruded through the depth.
  const shape = new THREE.Shape();
  shape.moveTo(-L / 2, 0);
  shape.lineTo(L / 2, 0);
  shape.lineTo(L / 2, H);
  shape.lineTo(-L / 2, H);
  shape.closePath();
  const arch = (cx: number, w: number, h: number) => {
    const p = new THREE.Path();
    p.moveTo(cx - w / 2, 0.01);
    p.lineTo(cx + w / 2, 0.01);
    p.lineTo(cx + w / 2, h - w / 2);
    p.absarc(cx, h - w / 2, w / 2, 0, Math.PI, false);
    p.lineTo(cx - w / 2, 0.01);
    return p;
  };
  shape.holes.push(arch(0, L * 0.3, H * 0.74));
  for (const s of [-1, 1]) {
    shape.holes.push(arch(s * L * 0.34, L * 0.1, H * 0.36));
    const upper = new THREE.Path();
    const cx = s * L * 0.34;
    const w = L * 0.08;
    upper.moveTo(cx - w / 2, H * 0.5);
    upper.lineTo(cx + w / 2, H * 0.5);
    upper.lineTo(cx + w / 2, H * 0.72 - w / 2);
    upper.absarc(cx, H * 0.72 - w / 2, w / 2, 0, Math.PI, false);
    upper.lineTo(cx - w / 2, H * 0.5);
    shape.holes.push(upper);
  }
  const facade = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false, curveSegments: 14 });
  facade.translate(0, 1.2, -W / 2);
  parts.push(facade);
  // Cornice band and parapet.
  parts.push(new THREE.BoxGeometry(L + 0.8, 0.9, W + 0.8).translate(0, H + 1.2, 0));
  for (let i = -6; i <= 6; i++) {
    parts.push(new THREE.BoxGeometry(0.7, 1.2, 0.7).translate((i / 6) * (L / 2 - 1), H + 2.2, W / 2));
    parts.push(new THREE.BoxGeometry(0.7, 1.2, 0.7).translate((i / 6) * (L / 2 - 1), H + 2.2, -W / 2));
  }
  // Four corner turrets with domes and finials.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (L / 2 - 1.2);
      const z = sz * (W / 2 - 1.2);
      parts.push(new THREE.CylinderGeometry(1.5, 1.7, 5.5, 8).translate(x, H + 4.2, z));
      parts.push(new THREE.CylinderGeometry(1.9, 1.9, 0.5, 8).translate(x, H + 7.1, z));
      parts.push(new THREE.SphereGeometry(1.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, H + 7.3, z));
      parts.push(new THREE.ConeGeometry(0.25, 1.6, 6).translate(x, H + 9.6, z));
    }
  }
  // Central dome behind the arch.
  parts.push(new THREE.CylinderGeometry(4.2, 4.6, 2.5, 16).translate(0, H + 2.6, 0));
  parts.push(new THREE.SphereGeometry(4.3, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, H + 3.8, 0));
  parts.push(new THREE.ConeGeometry(0.4, 2.4, 8).translate(0, H + 9.2, 0));
  // Pilasters on the façade.
  for (const s of [-1, 1]) {
    for (const k of [0.17, 0.5]) {
      parts.push(new THREE.BoxGeometry(1.1, H, 0.6).translate(s * L * k, 1.2 + H / 2, W / 2 + 0.3));
      parts.push(new THREE.BoxGeometry(1.1, H, 0.6).translate(s * L * k, 1.2 + H / 2, -W / 2 - 0.3));
    }
  }
  const merged = mergeGeometries(parts.map(norm), false)!;
  merged.computeVertexNormals();
  return merged;
}

function fountainGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.CylinderGeometry(4.2, 4.4, 0.8, 24).translate(0, 0.4, 0),
    new THREE.CylinderGeometry(1.4, 1.8, 2.2, 12).translate(0, 1.9, 0),
    new THREE.CylinderGeometry(2.4, 1.6, 0.5, 16).translate(0, 3.2, 0),
    new THREE.CylinderGeometry(0.8, 1.0, 2.4, 10).translate(0, 4.6, 0),
    new THREE.CylinderGeometry(1.4, 0.9, 0.4, 12).translate(0, 5.9, 0),
    new THREE.CylinderGeometry(0.35, 0.45, 2.6, 8).translate(0, 7.4, 0),
    new THREE.SphereGeometry(0.55, 10, 8).translate(0, 8.9, 0),
  ];
  const merged = mergeGeometries(parts.map(norm), false)!;
  merged.computeVertexNormals();
  return merged;
}

export interface LandmarkObjects {
  group: THREE.Group;
  /** Floating name labels (faded with distance by the drive scene). */
  labels: { sprite: THREE.Sprite; x: number; z: number }[];
  /** Collision: wall segments and circles. */
  segments: number[];
  circles: number[];
  polygons: number[][];
}

export function buildLandmarks(list: Landmark[]): LandmarkObjects {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const segments: number[] = [];
  const circles: number[] = [];
  const polygons: number[][] = [];
  const labels: LandmarkObjects['labels'] = [];
  const addLabel = (x: number, y: number, z: number, title: string, sub: string) => {
    const sprite = labelSprite(title, sub);
    sprite.position.set(x, y, z);
    group.add(sprite);
    labels.push({ sprite, x, z });
  };
  /** Rectangle footprint (local L × W, rotated) as collision walls and a polygon. */
  const footprint = (l: Landmark, L: number, W: number, rot: number) => {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const pts = [
      [-L / 2, -W / 2],
      [L / 2, -W / 2],
      [L / 2, W / 2],
      [-L / 2, W / 2],
    ].map(([x, z]) => [l.x + x * c + z * s, l.z - x * s + z * c]);
    const ring: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      segments.push(a[0], a[1], b[0], b[1]);
      ring.push(a[0], a[1]);
    }
    polygons.push(ring);
  };
  const basalt = new THREE.MeshStandardMaterial({ color: 0xc8ad7f, roughness: 0.82, metalness: 0 });
  const marble = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.6 });
  for (const l of list) {
    if (l.type === 'gateway') {
      // The model's arched façade runs along its local X axis: align it with the
      // footprint's longer dimension so the great arch faces city and harbour.
      const swap = l.wid > l.len;
      const len = swap ? l.wid : l.len;
      const wid = swap ? l.len : l.wid;
      const rot = swap ? l.rot - Math.PI / 2 : l.rot;
      const mesh = new THREE.Mesh(gatewayGeometry(len, wid), basalt);
      mesh.position.set(l.x, 0, l.z);
      mesh.rotation.y = rot;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'gateway-of-india';
      group.add(mesh);
      // Footprint rectangle for collision (plinth size).
      const L = Math.max(22, Math.min(36, len)) + 6;
      const W = Math.max(12, Math.min(22, wid)) + 6;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const pts = [
        [-L / 2, -W / 2],
        [L / 2, -W / 2],
        [L / 2, W / 2],
        [-L / 2, W / 2],
      ].map(([x, z]) => [l.x + x * c + z * s, l.z - x * s + z * c]);
      const ring: number[] = [];
      for (let i = 0; i < 4; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 4];
        segments.push(a[0], a[1], b[0], b[1]);
        ring.push(a[0], a[1]);
      }
      polygons.push(ring);
      addLabel(l.x, 34, l.z, 'Gateway of India', 'गेटवे ऑफ इंडिया');
    } else if (l.type === 'csmt') {
      const g = buildCsmt(l.len, l.wid);
      g.position.set(l.x, 0, l.z);
      g.rotation.y = l.rot;
      group.add(g);
      const L = Math.max(80, Math.min(130, l.len));
      const W = Math.max(56, Math.min(90, l.wid));
      footprint(l, L + 3, W, l.rot);
      addLabel(l.x, 76, l.z, 'Chhatrapati Shivaji Maharaj Terminus (VT)', 'छत्रपती शिवाजी महाराज टर्मिनस');
    } else if (l.type === 'hajiali') {
      const g = buildHajiAli(l.len, l.wid, l.path, l);
      g.position.set(l.x, 0, l.z);
      g.rotation.y = l.rot;
      group.add(g);
      addLabel(l.x, 38, l.z, 'Haji Ali Dargah', 'हाजी अली दर्गा');
    } else if (l.type === 'fountain') {
      const mesh = new THREE.Mesh(fountainGeometry(), marble);
      mesh.position.set(l.x, 0, l.z);
      mesh.castShadow = true;
      group.add(mesh);
      const water = new THREE.Mesh(
        new THREE.CircleGeometry(3.9, 24).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x2d5f73, roughness: 0.05, metalness: 0.1 }),
      );
      water.position.set(l.x, 0.75, l.z);
      group.add(water);
      circles.push(l.x, l.z, 4.4);
    }
  }
  return { group, segments, circles, polygons, labels };
}
