import type { KeyValueStore } from '../../core/store';

// The part of browser.storage.local this backend uses.
export interface StorageArea {
  get(keys: null): Promise<Record<string, unknown>>;
  set(items: Record<string, string>): Promise<void>;
  remove(keys: string): Promise<void>;
}

export interface ExtensionStore extends KeyValueStore {
  // Reads all of storage into memory; call once, before anything else.
  init(): Promise<void>;
}

// Firefox's persistent store (spec §2.3): browser.storage.local, which —
// unlike localStorage — survives the user clearing browsing data.
//
// init() reads everything into memory once, so get() stays synchronous.
// set() / remove() change memory and send the write at once: no debounce,
// because the popup can close at any moment and a write still waiting in
// a debounce window would be lost. Writes go out one at a time in call
// order, so a later value never lands before an earlier one.
//
// A failed write is logged, and the key goes back in memory to the value
// storage is known to hold — unless a later write to it is already on its
// way — so memory never claims what storage doesn't have. flush() reports
// failures to callers that need to know, like migrate().
export function extensionStorageStore(area: StorageArea): ExtensionStore {
  const memory = new Map<string, string>(); // what get() answers
  const stored = new Map<string, string>(); // what storage is known to hold
  const latestWrite = new Map<string, number>(); // key → sequence number of its newest write
  let sequence = 0;
  let queue: Promise<void> = Promise.resolve();
  let failures: unknown[] = []; // since the last flush()
  // Set when init() couldn't read storage. Writing then would replace data we
  // never saw with defaults, so every write is refused instead.
  let readOnly = false;

  function write(key: string, value: string | null): void {
    if (readOnly) {
      const error = new Error(`storage.local could not be read, so ${key} is not written`);
      console.error('[Skies]', error);
      failures.push(error);
      return;
    }
    const id = ++sequence;
    latestWrite.set(key, id);
    if (value === null) memory.delete(key);
    else memory.set(key, value);

    queue = queue.then(async () => {
      try {
        if (value === null) {
          await area.remove(key);
          stored.delete(key);
        } else {
          await area.set({ [key]: value });
          stored.set(key, value);
        }
      } catch (error) {
        console.error(`[Skies] storage.local: writing ${key} failed`, error);
        failures.push(error);
        if (latestWrite.get(key) === id) {
          const previous = stored.get(key);
          if (previous === undefined) memory.delete(key);
          else memory.set(key, previous);
        }
      }
    });
  }

  return {
    async init() {
      try {
        const items = await area.get(null);
        for (const [key, value] of Object.entries(items)) {
          // Every value this app writes is a string (spec §2.3).
          if (typeof value !== 'string') continue;
          memory.set(key, value);
          stored.set(key, value);
        }
      } catch (error) {
        readOnly = true;
        console.error('[Skies] storage.local could not be read; running read-only so nothing overwrites it', error);
      }
    },
    get: (key) => memory.get(key) ?? null,
    set: (key, value) => write(key, value),
    remove: (key) => write(key, null),
    keys: () => [...memory.keys()],
    async flush() {
      await queue;
      if (failures.length === 0) return;
      const [first] = failures;
      failures = [];
      throw first;
    },
  };
}
