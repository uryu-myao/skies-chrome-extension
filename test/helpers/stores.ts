// Stores for tests — no DOM, no real localStorage, no browser.storage.
import type { KeyValueStore } from '../../src/core/store';

// A KeyValueStore over a Map, with synchronous writes like localStorage:
// a write set up to fail throws from set() and leaves the map unchanged.
export function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const failing = new Set<string>();
  const store: KeyValueStore = {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      if (failing.has(key)) throw new Error(`writing ${key} failed`);
      data.set(key, value);
    },
    remove: (key) => {
      if (failing.has(key)) throw new Error(`removing ${key} failed`);
      data.delete(key);
    },
    keys: () => [...data.keys()],
    flush: () => Promise.resolve(),
  };
  return {
    store,
    data,
    failWritesTo: (key: string) => void failing.add(key),
    restoreWrites: () => failing.clear(),
  };
}

// A Web Storage object (what localStorage is) over a Map.
export function fakeWebStorage(initial: Record<string, string> = {}): Storage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
  };
}
