/**
 * Uniform grid spatial index over axis-aligned boxes. Items are integer ids;
 * queries return each id at most once per call (stamp-based de-duplication).
 */
export class SpatialGrid {
  private cells = new Map<number, number[]>();
  private stamp: Int32Array;
  private stampId = 1;
  private readonly inv: number;

  constructor(
    readonly cellSize: number,
    capacity = 1024,
  ) {
    this.inv = 1 / cellSize;
    this.stamp = new Int32Array(capacity);
  }

  private key(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  insert(id: number, minX: number, minZ: number, maxX: number, maxZ: number): void {
    if (id >= this.stamp.length) {
      const grown = new Int32Array(Math.max(id + 1, this.stamp.length * 2));
      grown.set(this.stamp);
      this.stamp = grown;
    }
    const x0 = Math.floor(minX * this.inv);
    const x1 = Math.floor(maxX * this.inv);
    const z0 = Math.floor(minZ * this.inv);
    const z1 = Math.floor(maxZ * this.inv);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let cell = this.cells.get(k);
        if (!cell) {
          cell = [];
          this.cells.set(k, cell);
        }
        cell.push(id);
      }
    }
  }

  remove(id: number, minX: number, minZ: number, maxX: number, maxZ: number): void {
    const x0 = Math.floor(minX * this.inv);
    const x1 = Math.floor(maxX * this.inv);
    const z0 = Math.floor(minZ * this.inv);
    const z1 = Math.floor(maxZ * this.inv);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        const cell = this.cells.get(k);
        if (!cell) continue;
        const i = cell.indexOf(id);
        if (i >= 0) {
          cell[i] = cell[cell.length - 1];
          cell.pop();
        }
        if (cell.length === 0) this.cells.delete(k);
      }
    }
  }

  /** Calls fn for every id whose box overlaps the query box. Return true from fn to stop early. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, fn: (id: number) => boolean | void): void {
    const s = ++this.stampId;
    const x0 = Math.floor(minX * this.inv);
    const x1 = Math.floor(maxX * this.inv);
    const z0 = Math.floor(minZ * this.inv);
    const z1 = Math.floor(maxZ * this.inv);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const cell = this.cells.get(this.key(ix, iz));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const id = cell[i];
          if (this.stamp[id] === s) continue;
          this.stamp[id] = s;
          if (fn(id) === true) return;
        }
      }
    }
  }

  queryRadius(x: number, z: number, r: number, fn: (id: number) => boolean | void): void {
    this.query(x - r, z - r, x + r, z + r, fn);
  }

  clear(): void {
    this.cells.clear();
  }
}
