/**
 * Voice commands through the browser's Web Speech API (SpeechRecognition).
 * Chrome, Edge and Safari support it; Firefox does not, so the typed command
 * bar is always available as well. The browser asks for microphone
 * permission the first time, and recognition may be processed by the
 * browser vendor's speech service — the README and settings say so.
 */
import { commandStore } from '../app/state';
import type { VoiceLang } from '../core/settings';

interface RecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [i: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [i: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone permission was denied. Allow the microphone for this site in the browser, or type with T.',
  'service-not-allowed': 'This browser does not allow speech recognition here. Type your command with T instead.',
  'audio-capture': 'No microphone found.',
  network: 'Speech recognition needs an internet connection in this browser.',
  'no-speech': "Didn't hear anything — press V and speak.",
  'language-not-supported': 'This browser cannot recognise that language — try English (India) in Settings → World.',
};

export class VoiceCommands {
  lang: VoiceLang = 'en-IN';
  listening = false;
  onResult: ((text: string) => void) | null = null;
  private rec: Recognition | null = null;

  static get supported(): boolean {
    return !!ctor();
  }

  start(): void {
    const C = ctor();
    if (!C) {
      commandStore.set({ error: 'Voice commands need Chrome, Edge or Safari. You can type commands with T.', open: true });
      return;
    }
    if (this.listening) return;
    const rec = new C();
    rec.lang = this.lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    let final = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      commandStore.set({ interim: (final + interim).trim() });
    };
    rec.onerror = (e) => {
      commandStore.set({ error: ERRORS[e.error] ?? `Voice error: ${e.error}` });
    };
    rec.onend = () => {
      this.listening = false;
      this.rec = null;
      commandStore.set({ listening: false, interim: '' });
      const text = final.trim();
      if (text) this.onResult?.(text);
    };
    try {
      rec.start();
      this.rec = rec;
      this.listening = true;
      commandStore.set({ listening: true, interim: '', error: '', heard: '', reply: '' });
    } catch (err) {
      commandStore.set({ error: `Could not start the microphone: ${(err as Error).message}` });
    }
  }

  stop(): void {
    this.rec?.stop();
  }
}
