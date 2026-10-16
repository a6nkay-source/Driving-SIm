/**
 * Spoken lines in Hindi and Marathi (with English for captions and as a
 * fallback). Each line can carry both languages; the voice pack setting picks
 * which one is spoken. Place names come in from the map in Devanagari.
 */
export interface Line {
  hi?: string;
  mr?: string;
  en: string;
}

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

export const L = {
  welcome: (): Line => pick([
    { hi: 'मुंबई में आपका स्वागत है!', mr: 'मुंबईत आपले स्वागत आहे!', en: 'Welcome to Mumbai!' },
    { hi: 'चलो, मुंबई घूमते हैं!', mr: 'चला, मुंबई फिरूया!', en: "Let's explore Mumbai!" },
  ]),
  autopilot: (hi: string, mr: string, en: string): Line =>
    pick([
      { hi: `ठीक है, ${hi} चलते हैं।`, mr: `ठीक आहे, ${mr}ला जाऊया.`, en: `Okay, heading to ${en}.` },
      { hi: `बैठ जाइए, ${hi} ले चलता हूँ।`, mr: `बसा, ${mr}ला घेऊन जातो.`, en: `Sit back, taking you to ${en}.` },
    ]),
  route: (hi: string, mr: string, en: string): Line => ({ hi: `${hi} का रास्ता दिखा रहा हूँ।`, mr: `${mr}चा रस्ता दाखवतो.`, en: `Showing the way to ${en}.` }),
  arrived: (hi: string, mr: string, en: string): Line =>
    pick([
      { hi: `लीजिए, ${hi} आ गया!`, mr: `${mr} आलं!`, en: `Here we are: ${en}!` },
      { hi: `${hi} पहुँच गए।`, mr: `आपण ${mr}ला पोहोचलो.`, en: `We have reached ${en}.` },
    ]),
  notFound: (): Line => ({ hi: 'माफ़ कीजिए, यह जगह नहीं मिली।', mr: 'माफ करा, ही जागा सापडली नाही.', en: "Sorry, I couldn't find that place." }),
  noRoute: (): Line => ({ hi: 'वहाँ का रास्ता नहीं मिला।', mr: 'तिथे जायचा रस्ता सापडला नाही.', en: "I can't find a road there." }),
  handBack: (): Line => ({ hi: 'ठीक है, गाड़ी अब आपके हाथ में।', mr: 'ठीक आहे, गाडी आता तुमच्या हातात.', en: 'Okay, you have control.' }),
  redLight: (): Line => pick([
    { hi: 'लाल बत्ती है, रुकते हैं।', mr: 'लाल सिग्नल आहे, थांबूया.', en: 'Red light, stopping.' },
    { hi: 'सिग्नल लाल है।', mr: 'सिग्नल लाल आहे.', en: 'The signal is red.' },
  ]),
  turn: (t: 'left' | 'right' | 'uturn'): Line =>
    t === 'left'
      ? { hi: 'आगे बाएँ मुड़िए।', mr: 'पुढे डावीकडे वळा.', en: 'Turn left ahead.' }
      : t === 'right'
        ? { hi: 'आगे दाएँ मुड़िए।', mr: 'पुढे उजवीकडे वळा.', en: 'Turn right ahead.' }
        : { hi: 'यू-टर्न लीजिए।', mr: 'यू-टर्न घ्या.', en: 'Make a U-turn.' },
  busier: (): Line => pick([
    { hi: 'अब लगी असली मुंबई!', mr: 'आता वाटतेय खरी मुंबई!', en: 'Now this is the real Mumbai!' },
    { hi: 'पीक आवर! पूरी मुंबई सड़क पर है।', mr: 'गर्दीची वेळ! सगळी मुंबई रस्त्यावर आहे.', en: 'Rush hour! All of Mumbai is on the road.' },
  ]),
  calmer: (): Line => ({ hi: 'आज सड़कें खाली हैं।', mr: 'आज रस्ते मोकळे आहेत.', en: 'The roads are empty today.' }),
  rain: (): Line => ({ hi: 'बारिश आ गई!', mr: 'पाऊस आला!', en: 'Here comes the rain!' }),
  clear: (): Line => ({ hi: 'बारिश रुक गई।', mr: 'पाऊस थांबला.', en: 'The rain has stopped.' }),
  night: (): Line => ({ hi: 'रात हो गई, बत्तियाँ जलाओ।', mr: 'रात्र झाली, दिवे लावा.', en: "It's night — lights on." }),
  sunset: (): Line => ({ hi: 'क्या सूर्यास्त है!', mr: 'काय सुंदर सूर्यास्त!', en: 'What a sunset!' }),
  day: (): Line => ({ hi: 'सुप्रभात मुंबई!', mr: 'सुप्रभात मुंबई!', en: 'Good morning, Mumbai!' }),
  spawned: (kind: string, n: number): Line => {
    const hiK: Record<string, string> = { auto: 'ऑटो', taxi: 'टैक्सी', bus: 'बस', bus1: 'बस', truck: 'ट्रक', bike: 'बाइक', car: 'गाड़ियाँ' };
    const mrK: Record<string, string> = { auto: 'रिक्षा', taxi: 'टॅक्सी', bus: 'बस', bus1: 'बस', truck: 'ट्रक', bike: 'बाईक', car: 'गाड्या' };
    return n === 1
      ? { hi: `एक ${hiK[kind]} आ रहा है।`, mr: `एक ${mrK[kind]} येतेय.`, en: `One ${kind === 'auto' ? 'rickshaw' : kind === 'bus1' ? 'bus' : kind} coming up.` }
      : { hi: `${n} ${hiK[kind]} आ रहे हैं।`, mr: `${n} ${mrK[kind]} येत आहेत.`, en: `${n} more ${kind === 'auto' ? 'rickshaws' : kind === 'bus1' ? 'buses' : kind + 's'} coming up.` };
  },
  vehicle: (id: string): Line =>
    id === 'auto'
      ? { hi: 'चलो, ऑटो चलाते हैं! मीटर डाउन।', mr: 'चला, रिक्षा चालवूया! मीटर डाऊन.', en: "Let's drive the rickshaw! Meter down." }
      : id === 'taxi'
        ? { hi: 'काली-पीली तैयार है।', mr: 'काळी-पिवळी तयार आहे.', en: 'The kaali-peeli is ready.' }
        : id === 'bus'
          ? { hi: 'बेस्ट बस तैयार है, सवारी बैठ गई।', mr: 'बेस्ट बस तयार आहे, प्रवासी बसले.', en: 'The BEST bus is ready, passengers aboard.' }
          : { hi: 'स्पोर्ट्स कार तैयार है।', mr: 'स्पोर्ट्स कार तयार आहे.', en: 'Back in the sports car.' },
  where: (road: string, area: string): Line => ({ hi: `आप ${road} पर हैं, ${area} के पास।`, mr: `तुम्ही ${road}वर आहात, ${area}जवळ.`, en: `You are on ${road}, near ${area}.` }),
  faster: (): Line => ({ hi: 'ठीक है, थोड़ा तेज़।', mr: 'ठीक आहे, थोडं वेगात.', en: 'Okay, a bit faster.' }),
  slower: (): Line => ({ hi: 'ठीक है, आराम से।', mr: 'ठीक आहे, हळू हळू.', en: 'Okay, slowing down.' }),

  // ---- Street voices
  shout: (): Line =>
    pick([
      { hi: 'अरे भाई, देख के चलाओ!', en: 'Hey brother, watch where you drive!' },
      { hi: 'ओये! धीरे चलाओ!', en: 'Oi! Slow down!' },
      { hi: 'अंधा है क्या?', en: 'Are you blind?' },
      { mr: 'ए, बाजूला हो!', en: 'Hey, move aside!' },
      { mr: 'अरे बापरे!', en: 'Oh my god!' },
      { mr: 'हळू चालव रे!', en: 'Drive slowly, man!' },
      { mr: 'काय रे, दिसत नाही का?', en: "What, can't you see?" },
    ]),
  vendor: (kind: string): Line => {
    const calls: Record<string, Line[]> = {
      vadapav: [
        { mr: 'वडा पाव! गरम गरम वडा पाव!', en: 'Vada pav! Hot vada pav!' },
        { mr: 'वडा पाव घ्या, भजी पाव!', en: 'Vada pav, bhaji pav!' },
      ],
      chai: [
        { hi: 'चाय! गरम चाय!', en: 'Tea! Hot tea!' },
        { mr: 'कटिंग चहा! कटिंग!', en: 'Cutting chai!' },
      ],
      coconut: [{ mr: 'नारळ पाणी! थंडगार नारळ पाणी!', en: 'Coconut water! Ice-cold coconut water!' }],
      fruit: [
        { hi: 'ताज़े फल ले लो! सस्ते में!', en: 'Fresh fruit! Cheap!' },
        { mr: 'आंबे घ्या, हापूस आंबे!', en: 'Mangoes! Alphonso mangoes!' },
      ],
    };
    return pick(calls[kind] ?? calls.chai);
  },
  conductor: (): Line =>
    pick([
      { mr: 'पुढे चला, पुढे चला!', en: 'Move ahead, move ahead!' },
      { hi: 'आगे बढ़ो, आगे बढ़ो!', en: 'Move forward, please!' },
      { mr: 'तिकीट, तिकीट!', en: 'Tickets, tickets!' },
      { hi: 'चलो जल्दी चढ़ो!', en: 'Come on, climb aboard!' },
    ]),
  passenger: (): Line =>
    pick([
      { hi: 'भैया, मीटर से चलोगे?', en: 'Brother, will you go by the meter?' },
      { mr: 'दादा, स्टेशनला चलणार का?', en: 'Will you go to the station?' },
      { hi: 'भैया, बांद्रा चलोगे?', en: 'Will you go to Bandra?' },
    ]),
};
