import { createStore, loadJSON, saveJSON } from './store';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type CameraMode = 'chase' | 'far' | 'hood' | 'cockpit';
export type TimeOfDay = 'day' | 'sunset' | 'night';
export type Weather = 'clear' | 'monsoon';
/** Which language street voices and guidance speak (captions are always available). */
export type VoicePack = 'mix' | 'hi' | 'mr' | 'en' | 'off';
/** Speech-recognition language for voice commands. */
export type VoiceLang = 'en-IN' | 'hi-IN' | 'mr-IN';

export interface Settings {
  quality: Quality;
  renderScale: number;
  shadows: boolean;
  bloom: boolean;
  viewDistance: number;
  /** 0 off … 4 Mumbai rush hour. */
  trafficDensity: number;
  /** Pedestrians and crowds, 0 off … 4 festival crowds. */
  crowdDensity: number;
  /** Parked cars, hand-carts and street stalls. */
  streetLife: boolean;
  masterVolume: number;
  engineVolume: number;
  effectsVolume: number;
  ambienceVolume: number;
  muted: boolean;
  steeringSensitivity: number;
  steeringAssist: boolean;
  camera: CameraMode;
  units: 'kmh' | 'mph';
  showFps: boolean;
  timeOfDay: TimeOfDay;
  weather: Weather;
  voicePack: VoicePack;
  voiceVolume: number;
  captions: boolean;
  voiceLang: VoiceLang;
}

export const QUALITY_PRESETS: Record<Quality, Pick<Settings, 'renderScale' | 'shadows' | 'bloom' | 'viewDistance'>> = {
  low: { renderScale: 0.75, shadows: false, bloom: false, viewDistance: 450 },
  medium: { renderScale: 1, shadows: true, bloom: false, viewDistance: 700 },
  high: { renderScale: 1, shadows: true, bloom: true, viewDistance: 1000 },
  ultra: { renderScale: 1, shadows: true, bloom: true, viewDistance: 1400 },
};

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  ...QUALITY_PRESETS.high,
  trafficDensity: 3,
  crowdDensity: 3,
  streetLife: true,
  masterVolume: 0.8,
  engineVolume: 0.9,
  effectsVolume: 0.8,
  ambienceVolume: 0.6,
  muted: false,
  steeringSensitivity: 1,
  steeringAssist: true,
  camera: 'chase',
  units: 'kmh',
  showFps: false,
  timeOfDay: 'sunset',
  weather: 'clear',
  voicePack: 'mix',
  voiceVolume: 0.9,
  captions: true,
  voiceLang: 'en-IN',
};

const KEY = 'drive-mumbai:settings:v1';

export const settingsStore = createStore<Settings>(loadJSON(KEY, DEFAULT_SETTINGS));
settingsStore.subscribe(() => saveJSON(KEY, settingsStore.get()));

export function applyQualityPreset(q: Quality): void {
  settingsStore.set({ quality: q, ...QUALITY_PRESETS[q] });
}

/** Picks a starting preset for this device the first time the game runs. */
export function detectDefaultQuality(): Quality {
  try {
    const cores = navigator.hardwareConcurrency ?? 4;
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    if (mobile) return 'low';
    if (cores <= 4) return 'medium';
    return 'high';
  } catch {
    return 'medium';
  }
}

export function ensureFirstRunDefaults(): void {
  try {
    if (!globalThis.localStorage?.getItem(KEY)) applyQualityPreset(detectDefaultQuality());
  } catch {
    /* ignore */
  }
}
