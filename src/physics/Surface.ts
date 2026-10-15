/**
 * Drivable surface heights. Ground level is y = 0; elevated flyover decks come
 * from network edges with per-point heights. A car only "sees" a deck whose
 * height is within a step of its own height, so it drives under flyovers and
 * up their ramps naturally. Parapets keep cars on the deck.
 */
import { SpatialGrid } from '../map/SpatialGrid';
import type { EdgeData } from '../map/types';

export interface DeckSeg {
  ax: number;
  az: number;
  ah: number;
  bx: number;
  bz: number;
  bh: number;
  hw: number;
  edge: number;
}

const STEP = 1.3;

export class SurfaceSystem {
  readonly decks: DeckSeg[] = [];
  private grid = new SpatialGrid(24, 4096);

  constructor(edges: EdgeData[]) {
    edges.forEach((e, ei) => {
      if (!e.h) return;
      for (let i = 0; i + 3 < e.p.length; i += 2) {
        const k = i / 2;
        const ah = e.h[k];
        const bh = e.h[k + 1];
        if (ah < 0.05 && bh < 0.05) continue;
        const seg: DeckSeg = { ax: e.p[i], az: e.p[i + 1], ah, bx: e.p[i + 2], bz: e.p[i + 3], bh, hw: e.w / 2 + 0.6, edge: ei };
        const id = this.decks.length;
        this.decks.push(seg);
        this.grid.insert(id, Math.min(seg.ax, seg.bx) - seg.hw, Math.min(seg.az, seg.bz) - seg.hw, Math.max(seg.ax, seg.bx) + seg.hw, Math.max(seg.az, seg.bz) + seg.hw);
      }
    });
  }

  private project(d: DeckSeg, x: number, z: number): { t: number; dist: number; qx: number; qz: number; h: number } {
    const dx = d.bx - d.ax;
    const dz = d.bz - d.az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 1e-9 ? ((x - d.ax) * dx + (z - d.az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = d.ax + dx * t;
    const qz = d.az + dz * t;
    return { t, dist: Math.hypot(x - qx, z - qz), qx, qz, h: d.ah + (d.bh - d.ah) * t };
  }

  /** Highest surface under (x, z) that a car at height refY can be standing on. */
  heightAt(x: number, z: number, refY: number): number {
    let best = 0;
    this.grid.query(x, z, x, z, (id) => {
      const d = this.decks[id];
      const p = this.project(d, x, z);
      if (p.dist <= d.hw && p.h <= refY + STEP && p.h > best) best = p.h;
    });
    return best;
  }

  /**
   * Keeps an elevated car on its deck (parapet walls). Returns the outward
   * normal if the car was pushed back, else null.
   */
  constrain(state: { x: number; z: number; y: number }, carHalfWidth = 1.0): { nx: number; nz: number } | null {
    if (state.y < 1.6) return null;
    let inside = false;
    let nearest: { d: DeckSeg; p: ReturnType<SurfaceSystem['project']> } | null = null;
    this.grid.queryRadius(state.x, state.z, 30, (id) => {
      const d = this.decks[id];
      const p = this.project(d, state.x, state.z);
      if (Math.abs(p.h - state.y) > 2.5) return;
      if (p.dist <= d.hw - carHalfWidth) {
        inside = true;
        return true;
      }
      if (!nearest || p.dist - d.hw < nearest.p.dist - nearest.d.hw) nearest = { d, p };
    });
    if (inside || !nearest) return null;
    const n = nearest as { d: DeckSeg; p: ReturnType<SurfaceSystem['project']> };
    const limit = Math.max(0.5, n.d.hw - carHalfWidth);
    if (n.p.dist <= limit) return null;
    const ux = (state.x - n.p.qx) / n.p.dist;
    const uz = (state.z - n.p.qz) / n.p.dist;
    state.x = n.p.qx + ux * limit;
    state.z = n.p.qz + uz * limit;
    return { nx: -ux, nz: -uz };
  }

  /** True if (x, z) is under or on any deck footprint (used to place pillars / skip props). */
  coveredByDeck(x: number, z: number, minH = 0.5): boolean {
    let hit = false;
    this.grid.query(x, z, x, z, (id) => {
      const d = this.decks[id];
      const p = this.project(d, x, z);
      if (p.dist <= d.hw && p.h > minH) {
        hit = true;
        return true;
      }
    });
    return hit;
  }
}
