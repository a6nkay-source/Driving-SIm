import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(fn: () => void): () => void;
}

/** A tiny observable store; React components read it through useStore. */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      listeners.forEach((l) => l());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function useStore<T extends object, S>(store: Store<T>, selector: (s: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}

/** localStorage helpers that never throw (private mode, blocked storage, etc.). */
export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — settings simply won't persist */
  }
}
