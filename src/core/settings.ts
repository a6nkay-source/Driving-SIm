import { createStore, loadJSON, saveJSON } from './store';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type CameraMode = 'chase' | 'far' | 'hood' | 'cockpit';
export type TimeOfDay = 'day' | 'sunset' | 'night';
export type Weather = 'clear' | 'monsoon';

export interface Settings {
  quality: Quality;
  renderScale: number;
  shadows: boolean;
  bloom: boolean;
  viewDistance: number;
  trafficDensity: number;
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
  trafficDensity: 2,
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
