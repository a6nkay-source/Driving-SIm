/**
 * District definitions for the OpenStreetMap import pipeline.
 *
 * Each district is a lat/lon bounding box that is fetched from the Overpass
 * API, converted into local metric coordinates and cut into streaming chunks.
 * Add a new entry here and run `npm run map:fetch -- <id>` followed by
 * `npm run map:build -- <id>` to expand the playable area.
 */
export interface DistrictConfig {
  id: string;
  name: string;
  /** Short description shown in the in-game map menu. */
  blurb: string;
  /** [south, west, north, east] in WGS84 degrees. */
  bbox: [number, number, number, number];
  /** Chunk edge length in metres. */
  chunkSize: number;
  /** Default spawn: a lat/lon that is snapped to the nearest drivable road. */
  spawn: { lat: number; lon: number; label: string };
  /** Named destinations. Coordinates are approximate real-world locations. */
  destinations: { id: string; name: string; nameMr?: string; lat: number; lon: number }[];
  /** Vehicle mix for traffic in this district (weights). */
  traffic: { car: number; taxi: number; bus: number; auto: number };
}

export const DISTRICTS: Record<string, DistrictConfig> = {
  'south-mumbai': {
    id: 'south-mumbai',
    name: 'South Mumbai',
    blurb: 'Marine Drive, Nariman Point, Churchgate, Fort, Colaba and the Gateway of India.',
    bbox: [18.9, 72.805, 18.958, 72.842],
    chunkSize: 400,
    spawn: { lat: 18.9262, lon: 72.8224, label: 'Nariman Point' },
    destinations: [
      { id: 'gateway', name: 'Gateway of India', nameMr: 'गेटवे ऑफ इंडिया', lat: 18.922, lon: 72.8347 },
      { id: 'marine-drive', name: 'Marine Drive', nameMr: 'मरीन ड्राइव्ह', lat: 18.9432, lon: 72.8232 },
      { id: 'nariman-point', name: 'Nariman Point', nameMr: 'नरिमन पॉइंट', lat: 18.9253, lon: 72.8195 },
      { id: 'chowpatty', name: 'Girgaon Chowpatty', nameMr: 'गिरगाव चौपाटी', lat: 18.9544, lon: 72.8135 },
      { id: 'churchgate', name: 'Churchgate Station', nameMr: 'चर्चगेट', lat: 18.9353, lon: 72.8274 },
      { id: 'csmt', name: 'Chhatrapati Shivaji Maharaj Terminus', nameMr: 'छत्रपती शिवाजी महाराज टर्मिनस', lat: 18.9399, lon: 72.8354 },
      { id: 'flora-fountain', name: 'Hutatma Chowk (Flora Fountain)', nameMr: 'हुतात्मा चौक', lat: 18.9327, lon: 72.8317 },
      { id: 'kala-ghoda', name: 'Kala Ghoda', nameMr: 'काळा घोडा', lat: 18.9281, lon: 72.8320 },
      { id: 'colaba-causeway', name: 'Colaba Causeway', nameMr: 'कुलाबा कॉजवे', lat: 18.9177, lon: 72.8286 },
      { id: 'cuffe-parade', name: 'Cuffe Parade', nameMr: 'कफ परेड', lat: 18.9105, lon: 72.8195 },
      { id: 'wankhede', name: 'Wankhede Stadium', nameMr: 'वानखेडे स्टेडियम', lat: 18.9389, lon: 72.8258 },
      { id: 'oval-maidan', name: 'Oval Maidan', nameMr: 'ओव्हल मैदान', lat: 18.9296, lon: 72.8290 },
      { id: 'crawford-market', name: 'Crawford Market', nameMr: 'क्रॉफर्ड मार्केट', lat: 18.9474, lon: 72.8343 },
      { id: 'regal', name: 'Regal Circle', nameMr: 'रीगल सर्कल', lat: 18.9248, lon: 72.8322 },
    ],
    // Auto-rickshaws are not permitted in the island city south of Bandra/Sion,
    // so South Mumbai traffic is cars, black-and-yellow taxis and BEST buses.
    traffic: { car: 0.55, taxi: 0.33, bus: 0.12, auto: 0 },
  },
  'bandra-west': {
    id: 'bandra-west',
    name: 'Bandra West',
    blurb: 'Bandstand, Carter Road, Hill Road, Linking Road and the Bandra Reclamation.',
    bbox: [19.038, 72.818, 19.07, 72.842],
    chunkSize: 400,
    spawn: { lat: 19.0545, lon: 72.8226, label: 'Carter Road' },
    destinations: [
      { id: 'bandstand', name: 'Bandstand Promenade', nameMr: 'बँडस्टँड', lat: 19.0458, lon: 72.8195 },
      { id: 'carter-road', name: 'Carter Road', nameMr: 'कार्टर रोड', lat: 19.0612, lon: 72.8228 },
      { id: 'mount-mary', name: 'Mount Mary Church', nameMr: 'माउंट मेरी', lat: 19.0468, lon: 72.8226 },
      { id: 'hill-road', name: 'Hill Road', nameMr: 'हिल रोड', lat: 19.0545, lon: 72.8302 },
      { id: 'linking-road', name: 'Linking Road', nameMr: 'लिंकिंग रोड', lat: 19.0612, lon: 72.8339 },
      { id: 'bandra-station', name: 'Bandra Station', nameMr: 'वांद्रे', lat: 19.0544, lon: 72.8406 },
      { id: 'bandra-fort', name: 'Bandra Fort', nameMr: 'वांद्रे किल्ला', lat: 19.0418, lon: 72.8186 },
    ],
    traffic: { car: 0.5, taxi: 0.15, bus: 0.08, auto: 0.27 },
  },
};

export function getDistrict(id: string | undefined): DistrictConfig {
  const key = id ?? 'south-mumbai';
  const d = DISTRICTS[key];
  if (!d) {
    throw new Error(`Unknown district "${key}". Known: ${Object.keys(DISTRICTS).join(', ')}`);
  }
  return d;
}
