/** Timed checkpoint challenges. Stops reference district destination ids. */
export interface ChallengeRoute {
  id: string;
  district: string;
  name: string;
  blurb: string;
  stops: string[];
}

export const ROUTES: ChallengeRoute[] = [
  {
    id: 'queens-necklace',
    district: 'mumbai',
    name: 'Queen’s Necklace Sprint',
    blurb: 'Nariman Point to Girgaon Chowpatty along the Marine Drive sea face.',
    stops: ['nariman-point', 'marine-drive', 'chowpatty'],
  },
  {
    id: 'heritage-loop',
    district: 'mumbai',
    name: 'Fort Heritage Loop',
    blurb: 'Churchgate, Flora Fountain, CSMT and Kala Ghoda, finishing at the Gateway of India.',
    stops: ['churchgate', 'flora-fountain', 'csmt', 'kala-ghoda', 'gateway'],
  },
  {
    id: 'colaba-dash',
    district: 'mumbai',
    name: 'Colaba Dash',
    blurb: 'From the Gateway down Colaba Causeway to Cuffe Parade.',
    stops: ['gateway', 'colaba-causeway', 'cuffe-parade'],
  },
  {
    id: 'sea-face',
    district: 'mumbai',
    name: 'Bandra Sea Face',
    blurb: 'Bandstand promenade to Carter Road.',
    stops: ['bandstand', 'mount-mary', 'carter-road'],
  },
  {
    id: 'hill-road-run',
    district: 'mumbai',
    name: 'Hill Road Run',
    blurb: 'Mount Mary, Hill Road and Linking Road to Bandra station.',
    stops: ['mount-mary', 'hill-road', 'linking-road', 'bandra-station'],
  },
  {
    id: 'sea-link-run',
    district: 'mumbai',
    name: 'Sea Link Run',
    blurb: 'Worli Sea Face onto the Bandra–Worli Sea Link and across the bay to Bandstand.',
    stops: ['worli-sea-face', 'sea-link', 'bandstand'],
  },
  {
    id: 'island-city',
    district: 'mumbai',
    name: 'Colaba to Bandra',
    blurb: 'The whole island city: Gateway of India, Marine Drive, Haji Ali, Worli and over the Sea Link to Bandra.',
    stops: ['gateway', 'marine-drive', 'haji-ali', 'worli-sea-face', 'sea-link', 'bandstand'],
  },
  {
    id: 'temple-run',
    district: 'mumbai',
    name: 'Darshan Run',
    blurb: 'Mahalaxmi to Siddhivinayak and Shivaji Park through the mill district.',
    stops: ['mahalaxmi', 'lower-parel', 'siddhivinayak', 'shivaji-park'],
  },
  {
    id: 'fallback-loop',
    district: 'fallback',
    name: 'Boulevard Loop',
    blurb: 'Along the sea face boulevard and back through Market Street (fictional district).',
    stops: ['promenade-north', 'market-square', 'harbour-garden', 'promenade-south'],
  },
];

export function routesFor(district: string): ChallengeRoute[] {
  return ROUTES.filter((r) => r.district === district);
}
