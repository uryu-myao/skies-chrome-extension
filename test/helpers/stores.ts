// Stores for tests — no DOM, no real localStorage, no browser.storage.
import type { KeyValueStore } from '../../src/core/store';
import { extensionStorageStore, type StorageArea } from '../../src/platform/storage/extensionStorageStore';

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

export interface AreaCall {
  op: 'set' | 'remove';
  key: string;
  value?: string;
}

// A stand-in for browser.storage.local: asynchronous like the real one. A
// test can fail writes to chosen keys, fail the initial read, or hold each
// write until it releases it (to see what runs while one is in flight).
export function fakeArea(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  const calls: AreaCall[] = [];
  const failing = new Set<string>();
  const held: Array<() => void> = [];
  const options = { failRead: false, holdWrites: false };

  async function run(call: AreaCall, apply: () => void): Promise<void> {
    calls.push(call);
    if (options.holdWrites) await new Promise<void>((release) => held.push(release));
    else await Promise.resolve();
    if (failing.has(call.key)) throw new Error(`storage.local ${call.op} ${call.key} failed`);
    apply();
  }

  const area: StorageArea = {
    async get() {
      if (options.failRead) throw new Error('storage.local read failed');
      return Object.fromEntries(data);
    },
    set(items) {
      const [[key, value]] = Object.entries(items);
      return run({ op: 'set', key, value }, () => data.set(key, value));
    },
    remove(key) {
      return run({ op: 'remove', key }, () => data.delete(key));
    },
  };

  return {
    area,
    data,
    calls,
    options,
    failWritesTo: (key: string) => void failing.add(key),
    restoreWrites: () => failing.clear(),
    // Lets the oldest held write finish.
    releaseNext: () => held.shift()?.(),
    heldCount: () => held.length,
  };
}

// The Firefox backend over a fake storage.local, already init()ed.
export async function firefoxStore(initial: Record<string, unknown> = {}) {
  const fake = fakeArea(initial);
  const store = extensionStorageStore(fake.area);
  await store.init();
  return { ...fake, store };
}
