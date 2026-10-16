/**
 * Natural-language driving commands, typed or spoken, in English, Hinglish,
 * Hindi and Marathi:
 *
 *   "Go to Victoria Terminus"         → autopilot to CSMT
 *   "navigate to Haji Ali"            → route only, you drive
 *   "add 5 rickshaws" / "ऑटो लाओ"     → spawn traffic near you
 *   "drive the bus" / "रिक्षा चालवा"   → switch vehicle
 *   "make it busier", "night", "rain", "honk", "stop" …
 *
 * Pure functions with no browser dependencies, so they are unit-tested.
 */
import type { CameraMode, TimeOfDay, Weather } from '../core/settings';
import type { VehicleKind } from '../traffic/vehicleModels';
import type { PlayerVehicleId } from '../vehicle/fleet';

export interface Place {
  id: string;
  label: string;
  names: string[];
  x: number;
  z: number;
  kind: 'destination' | 'poi' | 'road';
}

export type Command =
  | { type: 'goto'; place: Place; drive: boolean; query: string }
  | { type: 'unknownPlace'; query: string; drive: boolean }
  | { type: 'stop' }
  | { type: 'cancelRoute' }
  | { type: 'resume' }
  | { type: 'spawn'; kind: VehicleKind; count: number }
  | { type: 'vehicle'; id: PlayerVehicleId }
  | { type: 'traffic'; level: number | 'up' | 'down' }
  | { type: 'crowd'; level: number | 'up' | 'down' }
  | { type: 'busier' }
  | { type: 'calmer' }
  | { type: 'time'; value: TimeOfDay }
  | { type: 'weather'; value: Weather }
  | { type: 'camera'; mode?: CameraMode }
  | { type: 'horn' }
  | { type: 'lights'; on?: boolean }
  | { type: 'reset' }
  | { type: 'whereami' }
  | { type: 'speed'; delta: 1 | -1 }
  | { type: 'help' };

const DEVANAGARI = /[\u0900-\u097f]/;

/** Lower-case, strip accents and punctuation, keep Devanagari, collapse spaces. */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Drop the nukta so "ज़" and "ज" (and composed / decomposed forms) compare equal.
    .replace(/\u093c/g, '')
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9\p{Script=Devanagari}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twenty: 20,
  few: 3,
  some: 4,
  couple: 2,
  many: 10,
  lots: 10,
  lot: 10,
  ek: 1,
  do: 2,
  teen: 3,
  char: 4,
  chaar: 4,
  paanch: 5,
  panch: 5,
  das: 10,
  एक: 1,
  दो: 2,
  दोन: 2,
  तीन: 3,
  चार: 4,
  पांच: 5,
  पाँच: 5,
  पाच: 5,
  दस: 10,
  दहा: 10,
};

const KIND_WORDS: [RegExp, VehicleKind][] = [
  [/\b(auto ?rick?shaws?|rick?shaws?|rikshaw|riksha|rixa|ricksha|autos?|tuk ?tuks?|three ?wheelers?|tempo)\b|ऑटो|रिक्शा|रिक्षा|ऑटोरिक्शा/, 'auto'],
  [/\b(taxis?|cabs?|kaali ?peeli|kali ?pili|padmini)\b|टैक्सी|टॅक्सी|काली ?पीली|काळी ?पिवळी/, 'taxi'],
  [/\b(double ?deckers?)\b|डबल डेकर/, 'bus'],
  [/\b(bus|buses|busses|best bus)\b|बस|बेस्ट/, 'bus1'],
  [/\b(trucks?|lorry|lorries|tempos?)\b|ट्रक|लॉरी/, 'truck'],
  [/\b(bikes?|motorbikes?|motorcycles?|scooters?|two ?wheelers?|activa)\b|बाइक|बाईक|स्कूटर|गाडी वाले/, 'bike'],
  [/\b(cars?|vehicles?|gaadi|gadi|gaadiyan)\b|कार|गाड़ी|गाड़ियाँ|गाडी|गाड्या/, 'car'],
];

const PLAYER_WORDS: [RegExp, PlayerVehicleId][] = [
  [/\b(auto ?rick?shaw|rick?shaw|rikshaw|riksha|auto|tuk ?tuk|three ?wheeler)\b|ऑटो|रिक्शा|रिक्षा/, 'auto'],
  [/\b(taxi|cab|kaali ?peeli|kali ?pili|padmini)\b|टैक्सी|टॅक्सी/, 'taxi'],
  [/\b(bus|best|double ?decker)\b|बस/, 'bus'],
  [/\b(gtr|gt r|gt|sports ?car|nissan|supercar|car|godzilla)\b|स्पोर्ट्स कार|कार/, 'gtr'],
];

function findCount(t: string): number | null {
  const digits = t.match(/\b(\d{1,3})\b/);
  if (digits) return Math.max(1, Math.min(40, parseInt(digits[1], 10)));
  for (const w of t.split(' ')) if (w in NUMBER_WORDS) return NUMBER_WORDS[w];
  return null;
}

const UP = /\b(more|increase|busier|heavier|heavy|max|maximum|full|crazy|jam|zyada|jyada|jaada|badhao|badha)\b|ज़्यादा|ज्यादा|जास्त|बढ़ाओ|बढाओ|वाढवा|भरपूर/;
const DOWN = /\b(less|fewer|decrease|reduce|lighter|light|calm|quiet|quieter|empty|kam|ghatao|none|no|zero|off)\b|कम|कमी|घटाओ|नको/;

const SPAWN_VERB = /\b(add|spawn|bring|more|create|put|summon|send|call|get|need|want|lao|le aao|aur|chahiye|place|drop|show)\b|लाओ|लाओ|आणा|जोड़ो|जोडा|और|चाहिए|पाहिजे|हवी|हवे|हवा|दिखाओ/;
const DRIVE_VEHICLE = /\b(drive|switch|change|use|chalao|chalana|chalaunga|let me drive|i want to drive|get in|ride|become|play as|take the|swap)\b|चलाओ|चलाना|चालवा|चालवायची|चालवायचा/;
const NAV_ONLY = /\b(navigate|navigation|route|directions?|show me the way|show the way|show way|way to|path to|rasta|raasta|set destination|destination|waypoint|guide me)\b|रास्ता|मार्ग|रस्ता|दिशा/;

/** English prefixes: "go to X", "take me to the X", "drive me towards X". */
const GOTO_EN =
  /^(?:please |ok |okay |hey |now )*(?:can you |could you |i want to |i wanna |lets |let us |let s )?(?:go|drive|take me|take us|bring me|head|navigate|route|get me|lead me|auto ?pilot|travel|ride|cruise|guide me|show me the way|show the way|directions|set destination|destination)(?: me| us| over| straight| back)?(?: to| towards| toward| till| upto| up to| for| until)?(?: the)? (.+)$/;
/** Hindi (romanised): "VT chalo", "Haji Ali le chalo", "Bandra jaana hai". */
const GOTO_HI_LATIN = /^(?:chalo |chal |chalein |bhaiya |bhai |bhau )*(.+?)(?: (?:pe|par|tak|ko|ke liye|ki taraf))? (?:le chalo|chalo|chalein|chal|jao|jaana hai|jana hai|jaana|jana|jaayenge|jayenge|chaliye|le chal|ghuma do|pahuncha do|pohcha do)(?: please| na| jaldi| bhai| bhaiya)*$/;
/** Hindi / Marathi (Devanagari): "विक्टोरिया टर्मिनस चलो", "सीएसटीला चला", "हाजी अलीला घेऊन चला". */
const GOTO_DEV =
  /^(?:चलो |चला |भैया |भाऊ )*(.+?)(?: (?:पर|तक|को|की तरफ|कडे|पर्यंत))? (?:ले चलो|चलो|चलिए|जाओ|जाना है|चलें|चला|जा|जाऊया|जायचे आहे|जायचंय|घेऊन चला|घेऊन जा|ने)$/;

/** Removes Marathi case suffixes glued to the place name ("सीएसटीला" → "सीएसटी"). */
function stripSuffixes(q: string): string[] {
  const out = [q];
  for (const suf of ['ला', 'कडे', 'पर्यंत', 'मध्ये', 'ला जा', 'वर', 'पे', 'पर']) {
    if (q.endsWith(suf) && q.length > suf.length + 1) out.push(q.slice(0, -suf.length).trim());
  }
  for (const pre of ['the ', 'a ', 'station ']) if (q.startsWith(pre)) out.push(q.slice(pre.length));
  for (const post of [' please', ' station', ' railway station', ' now', ' fast', ' jaldi']) if (q.endsWith(post)) out.push(q.slice(0, -post.length));
  return out;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function tokenMatch(a: string, b: string): number {
  if (a === b) return 1;
  const d = levenshtein(a, b);
  const L = Math.max(a.length, b.length);
  if (L >= 7 && d <= 2) return 1 - d * 0.12;
  if (L >= 4 && d <= 1) return 0.85;
  // Prefix ("parel" vs "parell", "sidhivinayak" vs "siddhivinayak")
  if (L >= 5 && (a.startsWith(b) || b.startsWith(a)) && Math.min(a.length, b.length) >= 4) return 0.75;
  return 0;
}

/** Similarity 0..1 between a query and one name of a place. */
export function nameScore(query: string, name: string): number {
  const q = normalize(query);
  const n = normalize(name);
  if (!q || !n) return 0;
  if (q === n) return 1;
  const qc = q.replace(/ /g, '');
  const nc = n.replace(/ /g, '');
  if (qc === nc) return 0.98;
  const qt = q.split(' ').filter((w) => w.length > 1 || DEVANAGARI.test(w) || /\d/.test(w));
  const nt = n.split(' ').filter((w) => w.length > 1 || DEVANAGARI.test(w) || /\d/.test(w));
  if (!qt.length || !nt.length) return 0;
  // Every query token should match some name token (fuzzily).
  let sum = 0;
  for (const a of qt) {
    let best = 0;
    for (const b of nt) best = Math.max(best, tokenMatch(a, b));
    sum += best;
  }
  const recall = sum / qt.length;
  let cover = 0;
  for (const b of nt) {
    let best = 0;
    for (const a of qt) best = Math.max(best, tokenMatch(a, b));
    cover += best;
  }
  const precision = cover / nt.length;
  if (recall < 0.7) {
    // Whole-word containment of a compact name ("vt" in "the vt station")
    if (nc.length >= 2 && ` ${q} `.includes(` ${n} `)) return 0.8;
    return 0;
  }
  return recall * 0.7 + precision * 0.3;
}

const KIND_BONUS: Record<Place['kind'], number> = { destination: 0.06, poi: 0.02, road: 0 };

/** Best matching place for a spoken / typed name, or null. */
export function matchPlace(query: string, places: Place[]): { place: Place; score: number } | null {
  let best: { place: Place; score: number } | null = null;
  const variants = stripSuffixes(normalize(query));
  for (const p of places) {
    for (const name of p.names) {
      for (const v of variants) {
        const s = nameScore(v, name);
        if (s <= 0) continue;
        const total = s + KIND_BONUS[p.kind];
        if (!best || total > best.score) best = { place: p, score: total };
      }
    }
  }
  return best && best.score >= 0.62 ? best : null;
}

function levelCommand(t: string, type: 'traffic' | 'crowd'): Command {
  const n = t.match(/\b([0-4])\b/);
  if (n) return { type, level: parseInt(n[1], 10) } as Command;
  if (/\b(no|zero|none|off|empty)\b|नको|बंद/.test(t)) return { type, level: 0 } as Command;
  if (/\b(max|maximum|rush ?hour|mumbai|bombay|crazy|full|jam)\b|भरपूर|पूरा/.test(t)) return { type, level: 4 } as Command;
  return { type, level: DOWN.test(t) && !UP.test(t) ? 'down' : 'up' } as Command;
}

/** An explicit "go / drive / navigate to …" request — handled before keyword commands. */
const EXPLICIT_GOTO = /^(?:please |ok |okay |hey )*(?:go|drive|take me|take us|bring me|head|navigate|route|get me|travel|ride|directions|show me the way|show the way)(?: me| us| over| straight| back)? (?:to|towards|toward|till|upto|up to)\b/;

function gotoCommand(t: string, places: Place[]): Command | null {
  const navOnly = NAV_ONLY.test(t);
  const m = t.match(GOTO_EN) ?? t.match(GOTO_HI_LATIN) ?? t.match(GOTO_DEV);
  if (!m) return null;
  const query = m[1].trim();
  const hit = matchPlace(query, places);
  if (hit) return { type: 'goto', place: hit.place, drive: !navOnly, query };
  return { type: 'unknownPlace', query, drive: !navOnly };
}

/** Parses one command. Returns null when nothing recognisable was said. */
export function parseCommand(input: string, places: Place[]): Command | null {
  const t = normalize(input);
  if (!t) return null;
  if (EXPLICIT_GOTO.test(t)) {
    const g = gotoCommand(t, places);
    if (g) return g;
  }

  if (/^(help|commands|what can i say|what can you do|\?|मदद|मदत|हेल्प)$/.test(t)) return { type: 'help' };
  if (/\b(where am i|where are we|kahan hu|kaha hu|kahan hain|location)\b|कहाँ हूँ|कहां हूं|कुठे आहे|कुठे आहोत/.test(t)) return { type: 'whereami' };

  // Weather before "stop" so "stop the rain" is understood.
  if (/\b(stop|no|end)( the)? (rain|raining|monsoon)\b|\b(clear|sunny|dry|clear sky|clear weather)\b|बारिश बंद|पाऊस थांब|धूप/.test(t)) return { type: 'weather', value: 'clear' };
  if (/\b(rain|raining|monsoon|storm|baarish|barish|baarish|paus|pavus|thunder)\b|बारिश|बरसात|पाऊस|मान्सून|मॉन्सून/.test(t)) return { type: 'weather', value: 'monsoon' };

  if (/^(stop|halt|brake|ruko|roko|ruk jao|rukjao|bas|bus kar|thamba|thamb|cancel autopilot|stop autopilot|autopilot off|stop driving|disengage|manual|take over|i ll drive|ill drive|let me drive)$|^(रुको|रोको|रुक जाओ|थांबा|थांब|बस|बस करो)$/.test(t))
    return { type: 'stop' };
  if (/\b(cancel|clear|remove|delete)( the)? (route|destination|navigation|waypoint)\b|रास्ता हटाओ|मार्ग रद्द/.test(t)) return { type: 'cancelRoute' };
  if (/^(resume|continue|go on|carry on|keep going|autopilot|autopilot on|engage|chalte raho|chalo chalo)$|^(चलते रहो|चला चला|पुढे चला)$/.test(t)) return { type: 'resume' };
  if (/\b(faster|speed up|hurry|jaldi|tez)\b|जल्दी|तेज़|तेज|लवकर/.test(t) && !GOTO_EN.test(t)) return { type: 'speed', delta: 1 };
  if (/\b(slower|slow down|dheere|aaram se|dhire)\b|धीरे|आराम से|हळू/.test(t)) return { type: 'speed', delta: -1 };

  if (/\b(reset|respawn|unstuck|flip|get me out|stuck)\b|रीसेट/.test(t)) return { type: 'reset' };
  if (/\b(horn|honk|beep|pom ?pom|peep)\b|हॉर्न|होर्न|भोंगा/.test(t)) return { type: 'horn' };
  if (/\b(lights?|headlights?|headlamps?|batti|battiyan)\b|बत्ती|लाइट|दिवे/.test(t)) {
    const on = /\b(on|start|chalu|jalao)\b|चालू|जलाओ|लावा/.test(t) ? true : /\b(off|band|bujhao)\b|बंद|बुझाओ/.test(t) ? false : undefined;
    return { type: 'lights', on };
  }
  if (/\b(camera|view|cockpit|first person|third person|bonnet|hood cam|chase cam|far cam|inside view)\b|कैमरा|कॅमेरा/.test(t)) {
    const mode: CameraMode | undefined = /\b(cockpit|first person|inside)\b/.test(t)
      ? 'cockpit'
      : /\b(bonnet|hood)\b/.test(t)
        ? 'hood'
        : /\b(far|wide|zoom out)\b/.test(t)
          ? 'far'
          : /\b(chase|third person|behind)\b/.test(t)
            ? 'chase'
            : undefined;
    return { type: 'camera', mode };
  }

  // Time of day.
  if (/\b(night|raat|midnight|dark|nighttime)\b|रात|रात्र/.test(t) && !/\b(light)\b/.test(t)) return { type: 'time', value: 'night' };
  if (/\b(sunset|evening|dusk|shaam|sham|golden hour|twilight)\b|शाम|संध्याकाळ|सूर्यास्त/.test(t)) return { type: 'time', value: 'sunset' };
  if (/\b(day|daytime|morning|noon|afternoon|din|subah|sunrise|daylight)\b|दिन|सुबह|सकाळ|दुपार/.test(t) && !/\b(today)\b/.test(t)) return { type: 'time', value: 'day' };

  // Make the city busier / calmer.
  if (/\b(busier|more crowded|crowded|crowdy|like bombay|like mumbai|real mumbai|rush hour|chaos|chaotic|full mumbai|peak hour)\b|भीड़ बढ़ाओ|भीड बढाओ|गर्दी वाढवा|मुंबई जैसा/.test(t))
    return { type: 'busier' };
  if (/\b(calmer|quieter|empty (city|streets|roads)|less busy|peaceful|sunday morning)\b|शांत/.test(t)) return { type: 'calmer' };
  if (/\b(traffic|cars on the road|density)\b|ट्रैफिक|ट्रॅफिक|वाहतूक/.test(t)) return levelCommand(t, 'traffic');
  if (/\b(people|crowds?|pedestrians?|log|janta|walkers|humans)\b|लोग|लोक|भीड़|भीड|गर्दी|जनता/.test(t)) return levelCommand(t, 'crowd');

  // Switch the player's vehicle ("drive the bus", "रिक्षा चालवा").
  const switchTo = /\b(switch|change|swap|go back)( over)? to\b/.test(t);
  if ((DRIVE_VEHICLE.test(t) || switchTo) && (switchTo || !/\b(drive|ride|go|take)\b(?: me| us)? (?:to|towards|toward|till|until)\b/.test(t))) {
    for (const [re, id] of PLAYER_WORDS) if (re.test(t)) return { type: 'vehicle', id };
  }

  // Spawn traffic ("add a rickshaw", "5 buses", "ऑटो लाओ").
  const kind = KIND_WORDS.find(([re]) => re.test(t))?.[1];
  if (kind && (SPAWN_VERB.test(t) || findCount(t) !== null || t.split(' ').length <= 2)) {
    const count = findCount(t) ?? (/\b(more|lots|many|bunch|fleet)\b|बहुत|खूप/.test(t) ? 6 : 1);
    return { type: 'spawn', kind, count };
  }

  // Go somewhere.
  const g = gotoCommand(t, places);
  if (g) return g;
  // A bare place name ("Haji Ali", "सीएसटी").
  const bare = matchPlace(t, places);
  if (bare && bare.score >= 0.8) return { type: 'goto', place: bare.place, drive: !NAV_ONLY.test(t), query: t };
  return null;
}

/** Example phrases shown in the command bar's help. */
export const COMMAND_EXAMPLES: { text: string; hint: string }[] = [
  { text: 'Go to Victoria Terminus', hint: 'autopilot drives you there' },
  { text: 'Navigate to Haji Ali', hint: 'route only — you drive' },
  { text: 'Add 5 rickshaws', hint: 'spawn traffic around you' },
  { text: 'Drive the auto', hint: 'switch to rickshaw · taxi · bus · GT' },
  { text: 'Make it busier', hint: 'Mumbai rush-hour traffic and crowds' },
  { text: 'Night · Sunset · Rain', hint: 'time and weather' },
  { text: 'Stop', hint: 'take back control' },
  { text: 'सीएसटी चलो · हाजी अलीला चला', hint: 'Hindi and Marathi work too' },
];
