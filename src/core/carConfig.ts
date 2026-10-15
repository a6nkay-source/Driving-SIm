import { createStore, loadJSON, saveJSON } from './store';

export type PaintFinish = 'metallic' | 'pearl' | 'matte' | 'gloss';
export type RimStyle = 'gunmetal' | 'black' | 'bronze' | 'silver';
export type WingStyle = 'stock' | 'track' | 'none';

export interface PaintOption {
  id: string;
  name: string;
  color: string;
  finish: PaintFinish;
}

export const PAINTS: PaintOption[] = [
  { id: 'midnight-purple', name: 'Midnight Purple', color: '#2a1a4a', finish: 'pearl' },
  { id: 'gun-metallic', name: 'Gun Metallic', color: '#3a3d42', finish: 'metallic' },
  { id: 'obsidian', name: 'Obsidian Black', color: '#0b0c10', finish: 'metallic' },
  { id: 'bayside-blue', name: 'Bayside Blue', color: '#1d4fa8', finish: 'metallic' },
  { id: 'ultimate-silver', name: 'Ultimate Silver', color: '#a9adb3', finish: 'metallic' },
  { id: 'pearl-white', name: 'Pearl White', color: '#e8e6df', finish: 'pearl' },
  { id: 'vibrant-red', name: 'Vibrant Red', color: '#a3121b', finish: 'gloss' },
  { id: 'katsura-orange', name: 'Katsura Orange', color: '#d9661c', finish: 'pearl' },
  { id: 'monsoon-green', name: 'Monsoon Green', color: '#1f4a3a', finish: 'metallic' },
  { id: 'saffron-gold', name: 'Saffron Gold', color: '#c99a2e', finish: 'metallic' },
  { id: 'stealth-matte', name: 'Stealth Matte Grey', color: '#4a4d52', finish: 'matte' },
];

export const RIMS: { id: RimStyle; name: string; color: string; metalness: number; roughness: number }[] = [
  { id: 'gunmetal', name: 'Gunmetal Forged', color: '#3b3e44', metalness: 0.9, roughness: 0.35 },
  { id: 'black', name: 'Satin Black', color: '#121316', metalness: 0.6, roughness: 0.45 },
  { id: 'bronze', name: 'Bronze Forged', color: '#7a5a2c', metalness: 0.95, roughness: 0.3 },
  { id: 'silver', name: 'Hyper Silver', color: '#c4c8cf', metalness: 1, roughness: 0.2 },
];

export const CALIPERS: { id: string; name: string; color: string }[] = [
  { id: 'amber', name: 'Amber', color: '#e09a1a' },
  { id: 'red', name: 'Racing Red', color: '#c0161e' },
  { id: 'silver', name: 'Silver', color: '#9a9ea6' },
  { id: 'blue', name: 'Electric Blue', color: '#2463d6' },
];

export const WINGS: { id: WingStyle; name: string }[] = [
  { id: 'stock', name: 'Stock ducktail' },
  { id: 'track', name: 'Carbon track wing' },
  { id: 'none', name: 'Clean deck' },
];

export interface CarConfig {
  paint: string;
  rims: RimStyle;
  caliper: string;
  wing: WingStyle;
  tint: number;
  plate: string;
}

export const DEFAULT_CAR: CarConfig = {
  paint: 'gun-metallic',
  rims: 'gunmetal',
  caliper: 'amber',
  wing: 'stock',
  tint: 0.7,
  plate: 'MH 01 GT 3535',
};

const KEY = 'drive-mumbai:car:v1';
export const carStore = createStore<CarConfig>(loadJSON(KEY, DEFAULT_CAR));
carStore.subscribe(() => saveJSON(KEY, carStore.get()));

export function paintById(id: string): PaintOption {
  return PAINTS.find((p) => p.id === id) ?? PAINTS[1];
}
