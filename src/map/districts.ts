/**
 * District definitions for the OpenStreetMap import pipeline.
 *
 * Each district is a lat/lon bounding box that is fetched from the Overpass
 * API, converted into local metric coordinates and cut into streaming chunks.
 * Add a new entry here and run `npm run map:fetch -- <id>` followed by
 * `npm run map:build -- <id>` to expand the playable area.
 */
export interface DistrictDestination {
  id: string;
  name: string;
  nameMr?: string;
  nameHi?: string;
  /** Extra spoken / typed names used by the command parser (e.g. "VT"). */
  aliases?: string[];
  lat: number;
  lon: number;
}

export interface DistrictConfig {
  id: string;
  name: string;
  /** Short description shown in the in-game map menu. */
  blurb: string;
  /** [south, west, north, east] in WGS84 degrees. */
  bbox: [number, number, number, number];
  /** Chunk edge length in metres. */
  chunkSize: number;
  /** Land-mask resolution in metres per pixel (coarser for big districts). */
  maskRes?: number;
  /** Default spawn: a lat/lon that is snapped to the nearest drivable road. */
  spawn: { lat: number; lon: number; label: string };
  /** Named destinations. Coordinates are approximate real-world locations. */
  destinations: DistrictDestination[];
  /** Vehicle mix for traffic in this district (weights). */
  traffic: { car: number; taxi: number; bus: number; auto: number; bike: number; truck: number; autoNorthOfLat?: number };
}

export const DISTRICTS: Record<string, DistrictConfig> = {
  mumbai: {
    id: 'mumbai',
    name: 'Mumbai — Colaba to Bandra',
    blurb:
      'One connected island city: Colaba, Fort, Marine Drive, Malabar Hill, Girgaon, Mahalaxmi, Worli, Lower Parel, Prabhadevi, Dadar and Bandra West, joined by the Bandra–Worli Sea Link.',
    bbox: [18.895, 72.792, 19.072, 72.848],
    chunkSize: 400,
    maskRes: 4,
    spawn: { lat: 18.9262, lon: 72.8224, label: 'Nariman Point' },
    destinations: [
      { id: 'gateway', name: 'Gateway of India', nameMr: 'गेटवे ऑफ इंडिया', nameHi: 'गेटवे ऑफ इंडिया', aliases: ['gateway', 'gate way', 'taj', 'apollo bunder'], lat: 18.922, lon: 72.8347 },
      { id: 'marine-drive', name: 'Marine Drive', nameMr: 'मरीन ड्राइव्ह', nameHi: 'मरीन ड्राइव', aliases: ['queens necklace', "queen's necklace", 'netaji subhash road'], lat: 18.9432, lon: 72.8232 },
      { id: 'nariman-point', name: 'Nariman Point', nameMr: 'नरिमन पॉइंट', nameHi: 'नरीमन पॉइंट', lat: 18.9253, lon: 72.8195 },
      { id: 'chowpatty', name: 'Girgaon Chowpatty', nameMr: 'गिरगाव चौपाटी', nameHi: 'गिरगांव चौपाटी', aliases: ['chowpatty', 'chaupati', 'beach'], lat: 18.9544, lon: 72.8135 },
      { id: 'churchgate', name: 'Churchgate Station', nameMr: 'चर्चगेट', nameHi: 'चर्चगेट', aliases: ['churchgate'], lat: 18.9353, lon: 72.8274 },
      {
        id: 'csmt',
        name: 'Chhatrapati Shivaji Maharaj Terminus',
        nameMr: 'छत्रपती शिवाजी महाराज टर्मिनस',
        nameHi: 'छत्रपति शिवाजी महाराज टर्मिनस',
        aliases: ['victoria terminus', 'victoria', 'vt', 'v t', 'cst', 'csmt', 'cstm', 'shivaji terminus', 'bori bunder', 'विक्टोरिया टर्मिनस', 'व्हिक्टोरिया टर्मिनस', 'वीटी', 'सीएसटी'],
        lat: 18.9399,
        lon: 72.8354,
      },
      { id: 'flora-fountain', name: 'Hutatma Chowk (Flora Fountain)', nameMr: 'हुतात्मा चौक', nameHi: 'हुतात्मा चौक', aliases: ['flora fountain', 'hutatma chowk', 'fountain'], lat: 18.9327, lon: 72.8317 },
      { id: 'kala-ghoda', name: 'Kala Ghoda', nameMr: 'काळा घोडा', nameHi: 'काला घोड़ा', lat: 18.9281, lon: 72.832 },
      { id: 'colaba-causeway', name: 'Colaba Causeway', nameMr: 'कुलाबा कॉजवे', nameHi: 'कोलाबा कॉजवे', aliases: ['colaba'], lat: 18.9177, lon: 72.8286 },
      { id: 'cuffe-parade', name: 'Cuffe Parade', nameMr: 'कफ परेड', nameHi: 'कफ परेड', lat: 18.9105, lon: 72.8195 },
      { id: 'wankhede', name: 'Wankhede Stadium', nameMr: 'वानखेडे स्टेडियम', nameHi: 'वानखेड़े स्टेडियम', aliases: ['wankhede', 'cricket stadium'], lat: 18.9389, lon: 72.8258 },
      { id: 'oval-maidan', name: 'Oval Maidan', nameMr: 'ओव्हल मैदान', nameHi: 'ओवल मैदान', lat: 18.9296, lon: 72.829 },
      { id: 'crawford-market', name: 'Crawford Market', nameMr: 'क्रॉफर्ड मार्केट', nameHi: 'क्रॉफर्ड मार्केट', aliases: ['mahatma phule market'], lat: 18.9474, lon: 72.8343 },
      { id: 'regal', name: 'Regal Circle', nameMr: 'रीगल सर्कल', nameHi: 'रीगल सर्कल', aliases: ['regal cinema'], lat: 18.9248, lon: 72.8322 },
      { id: 'hanging-gardens', name: 'Hanging Gardens, Malabar Hill', nameMr: 'हँगिंग गार्डन', nameHi: 'हैंगिंग गार्डन', aliases: ['malabar hill', 'hanging garden', 'kamala nehru park'], lat: 18.9567, lon: 72.8052 },
      { id: 'mumbai-central', name: 'Mumbai Central', nameMr: 'मुंबई सेंट्रल', nameHi: 'मुंबई सेंट्रल', aliases: ['bombay central'], lat: 18.9696, lon: 72.8195 },
      { id: 'haji-ali', name: 'Haji Ali', nameMr: 'हाजी अली', nameHi: 'हाजी अली', aliases: ['haji ali dargah', 'dargah', 'हाजी अली दर्गा'], lat: 18.9782, lon: 72.8114 },
      { id: 'mahalaxmi', name: 'Mahalaxmi Racecourse', nameMr: 'महालक्ष्मी रेसकोर्स', nameHi: 'महालक्ष्मी रेसकोर्स', aliases: ['mahalaxmi', 'race course'], lat: 18.9827, lon: 72.8216 },
      { id: 'lower-parel', name: 'Lower Parel', nameMr: 'लोअर परळ', nameHi: 'लोअर परेल', aliases: ['phoenix mills', 'palladium'], lat: 18.9945, lon: 72.8257 },
      { id: 'worli-sea-face', name: 'Worli Sea Face', nameMr: 'वरळी सी फेस', nameHi: 'वर्ली सी फेस', aliases: ['worli'], lat: 19.009, lon: 72.8147 },
      { id: 'siddhivinayak', name: 'Siddhivinayak Temple', nameMr: 'सिद्धिविनायक मंदिर', nameHi: 'सिद्धिविनायक मंदिर', aliases: ['siddhivinayak', 'prabhadevi'], lat: 19.0169, lon: 72.8303 },
      { id: 'shivaji-park', name: 'Shivaji Park', nameMr: 'शिवाजी पार्क', nameHi: 'शिवाजी पार्क', aliases: ['dadar'], lat: 19.0269, lon: 72.8383 },
      { id: 'sea-link', name: 'Bandra–Worli Sea Link', nameMr: 'वांद्रे-वरळी सागरी सेतू', nameHi: 'बांद्रा-वर्ली सी लिंक', aliases: ['sea link', 'bandra worli sea link', 'rajiv gandhi sea link'], lat: 19.0379, lon: 72.8172 },
      { id: 'bandstand', name: 'Bandstand Promenade', nameMr: 'बँडस्टँड', nameHi: 'बैंडस्टैंड', aliases: ['bandstand', 'bandra fort'], lat: 19.0458, lon: 72.8195 },
      { id: 'carter-road', name: 'Carter Road', nameMr: 'कार्टर रोड', nameHi: 'कार्टर रोड', lat: 19.0612, lon: 72.8228 },
      { id: 'mount-mary', name: 'Mount Mary Church', nameMr: 'माउंट मेरी', nameHi: 'माउंट मैरी', aliases: ['mount mary'], lat: 19.0468, lon: 72.8226 },
      { id: 'hill-road', name: 'Hill Road, Bandra', nameMr: 'हिल रोड', nameHi: 'हिल रोड', aliases: ['hill road'], lat: 19.0545, lon: 72.8302 },
      { id: 'linking-road', name: 'Linking Road', nameMr: 'लिंकिंग रोड', nameHi: 'लिंकिंग रोड', lat: 19.0612, lon: 72.8339 },
      { id: 'bandra-station', name: 'Bandra Station', nameMr: 'वांद्रे स्टेशन', nameHi: 'बांद्रा स्टेशन', aliases: ['bandra'], lat: 19.0544, lon: 72.8406 },
    ],
    // Auto-rickshaws are not permitted in the island city south of Bandra /
    // Mahim, so they only join traffic in the suburbs.
    traffic: { car: 0.42, taxi: 0.24, bus: 0.08, auto: 0.18, bike: 0.2, truck: 0.06, autoNorthOfLat: 19.036 },
  },
};

export function getDistrict(id: string | undefined): DistrictConfig {
  const key = id ?? 'mumbai';
  const d = DISTRICTS[key];
  if (!d) {
    throw new Error(`Unknown district "${key}". Known: ${Object.keys(DISTRICTS).join(', ')}`);
  }
  return d;
}
