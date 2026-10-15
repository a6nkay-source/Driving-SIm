/**
 * Local equirectangular projection. Accurate to well under a metre across a
 * district-sized area (a few kilometres), which is all the game needs.
 */
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON_EQ = 111_320;

export interface Projection {
  originLat: number;
  originLon: number;
  toLocal(lat: number, lon: number): [number, number];
  toLatLon(x: number, z: number): [number, number];
}

export function createProjection(originLat: number, originLon: number): Projection {
  const kx = M_PER_DEG_LON_EQ * Math.cos((originLat * Math.PI) / 180);
  const kz = M_PER_DEG_LAT;
  return {
    originLat,
    originLon,
    toLocal(lat, lon) {
      // +X east, +Z south.
      return [(lon - originLon) * kx, -(lat - originLat) * kz];
    },
    toLatLon(x, z) {
      return [originLat - z / kz, originLon + x / kx];
    },
  };
}

export function bboxCenter(bbox: [number, number, number, number]): [number, number] {
  const [s, w, n, e] = bbox;
  return [(s + n) / 2, (w + e) / 2];
}
