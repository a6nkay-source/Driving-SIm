/**
 * Spoken Hindi / Marathi voice lines through the browser's speech synthesis
 * (the operating system's own voices — nothing is downloaded or licensed),
 * with on-screen captions and English translations. Marathi voices are rare,
 * so Marathi lines fall back to a Hindi voice (both use Devanagari), and if
 * there is no Indian voice at all the captions still appear.
 */
import { createStore } from '../core/store';
import type { Line } from './lines';

export type VoicePack = 'mix' | 'hi' | 'mr' | 'en' | 'off';

export interface Caption {
  id: number;
  text: string;
  translation: string;
  lang: 'hi' | 'mr' | 'en';
  who?: string;
}

export const captionStore = createStore<{ captions: Caption[] }>({ captions: [] });
let captionId = 1;

function addCaption(c: Omit<Caption, 'id'>, ms: number): void {
  const id = captionId++;
  captionStore.set((s) => ({ captions: [...s.captions.slice(-2), { ...c, id }] }));
  setTimeout(() => captionStore.set((s) => ({ captions: s.captions.filter((x) => x.id !== id) })), ms);
}

const BCP: Record<'hi' | 'mr' | 'en', string[]> = {
  mr: ['mr-IN', 'mr'],
  hi: ['hi-IN', 'hi'],
  en: ['en-IN', 'en-GB', 'en-US', 'en'],
};

export class Voice {
  pack: VoicePack = 'mix';
  captions = true;
  volume = 0.9;
  muted = false;
  private voices: SpeechSynthesisVoice[] = [];
  private busyUntil = 0;
  private currentPriority = -1;
  private synth: SpeechSynthesis | null = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

  constructor() {
    if (!this.synth) return;
    const load = () => {
      this.voices = this.synth!.getVoices();
    };
    load();
    this.synth.addEventListener?.('voiceschanged', load);
  }

  get available(): boolean {
    return !!this.synth;
  }

  /** Whether an actual voice exists for a language (for the settings screen). */
  hasVoice(lang: 'hi' | 'mr' | 'en'): boolean {
    return !!this.findVoice(lang, true);
  }

  private findVoice(lang: 'hi' | 'mr' | 'en', exact = false): SpeechSynthesisVoice | null {
    const tags = BCP[lang];
    for (const tag of tags) {
      const v = this.voices.find((x) => x.lang.toLowerCase().replace('_', '-') === tag.toLowerCase()) ?? this.voices.find((x) => x.lang.toLowerCase().startsWith(tag.toLowerCase()));
      if (v) return v;
    }
    if (exact) return null;
    if (lang === 'mr') return this.findVoice('hi', true);
    return null;
  }

  /** Chooses which language of a line to speak for the current voice pack. */
  private choose(line: Line): { text: string; lang: 'hi' | 'mr' | 'en' } {
    const pack = this.pack;
    if (pack === 'en') return { text: line.en, lang: 'en' };
    if (pack === 'hi' && line.hi) return { text: line.hi, lang: 'hi' };
    if (pack === 'mr' && line.mr) return { text: line.mr, lang: 'mr' };
    if (line.hi && line.mr) return Math.random() < 0.5 ? { text: line.hi, lang: 'hi' } : { text: line.mr, lang: 'mr' };
    if (line.mr) return { text: line.mr, lang: 'mr' };
    if (line.hi) return { text: line.hi, lang: 'hi' };
    return { text: line.en, lang: 'en' };
  }

  /**
   * Speaks a line. priority 2 = guidance (interrupts), 1 = nearby people,
   * 0 = background chatter (dropped if anything is already speaking).
   */
  say(line: Line, opts: { priority?: number; volume?: number; pitch?: number; rate?: number; who?: string } = {}): void {
    if (this.pack === 'off') return;
    const priority = opts.priority ?? 1;
    const now = performance.now();
    const speaking = now < this.busyUntil;
    if (speaking && priority <= this.currentPriority && priority < 2) return;
    const { text, lang } = this.choose(line);
    if (this.captions) addCaption({ text, translation: lang === 'en' ? '' : line.en, lang, who: opts.who }, Math.max(2600, text.length * 90));
    if (!this.synth || this.muted) return;
    const voice = this.findVoice(lang);
    if (!voice && lang !== 'en') return; // captions only — never read Devanagari with an English voice
    if (speaking) this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? BCP[lang][0];
    u.volume = Math.max(0, Math.min(1, this.volume * (opts.volume ?? 1)));
    u.pitch = opts.pitch ?? 1;
    u.rate = opts.rate ?? 1.02;
    this.currentPriority = priority;
    this.busyUntil = now + 800 + text.length * 85;
    u.onend = () => {
      this.busyUntil = 0;
      this.currentPriority = -1;
    };
    try {
      this.synth.speak(u);
    } catch {
      /* speech not permitted yet */
    }
  }

  stop(): void {
    this.synth?.cancel();
    this.busyUntil = 0;
    this.currentPriority = -1;
  }
}
