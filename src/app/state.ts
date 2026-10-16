import { createStore } from '../core/store';
import type { MapIndexEntry } from '../map/types';

export type Screen = 'menu' | 'garage' | 'map' | 'settings' | 'about' | 'loading' | 'playing' | 'paused';

export type GameMode = 'free' | 'checkpoints';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'error' | 'success';
}

export interface Session {
  district: string;
  /** Start location: a destination id or 'spawn'. */
  start: string;
  /** Waypoint destination id ('' for none). */
  destination: string;
  /** Custom map-clicked destination in world metres. */
  customDestination: { x: number; z: number } | null;
  mode: GameMode;
  route: string;
}

export interface AppState {
  screen: Screen;
  /** Screen to return to when leaving settings / map opened from pause. */
  returnTo: Screen;
  loading: { progress: number; label: string };
  error: string | null;
  toasts: Toast[];
  districts: MapIndexEntry[];
  session: Session;
  webglOk: boolean;
  audioBlocked: boolean;
}

export const appStore = createStore<AppState>({
  screen: 'menu',
  returnTo: 'menu',
  loading: { progress: 0, label: '' },
  error: null,
  toasts: [],
  districts: [],
  session: {
    district: 'mumbai',
    start: 'spawn',
    destination: 'gateway',
    customDestination: null,
    mode: 'free',
    route: 'queens-necklace',
  },
  webglOk: true,
  audioBlocked: false,
});

let toastId = 1;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 2600): void {
  const id = toastId++;
  appStore.set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
  setTimeout(() => appStore.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

export function setSession(patch: Partial<Session>): void {
  appStore.set((s) => ({ session: { ...s.session, ...patch } }));
}

export function go(screen: Screen): void {
  appStore.set({ screen });
}

/** The command bar and voice-command state shown over the HUD. */
export interface CommandState {
  open: boolean;
  listening: boolean;
  /** Live transcript while listening. */
  interim: string;
  heard: string;
  reply: string;
  replyOk: boolean;
  /** Last voice error (permission denied, no microphone, unsupported). */
  error: string;
}

export const commandStore = createStore<CommandState>({ open: false, listening: false, interim: '', heard: '', reply: '', replyOk: true, error: '' });
