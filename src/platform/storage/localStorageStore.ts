import type { KeyValueStore } from '../../core/store';

// The popup page's localStorage, exactly as 3.1.2 used it (spec §2.3): the
// Chrome build's persistent store, and the sun cache's home on both
// targets. Writes are synchronous and a failure throws from set() /
// remove() as it always did, so flush() has nothing to wait for.
export function localStorageStore(storage: Storage = localStorage): KeyValueStore {
  return {
    get: (key) => storage.getItem(key),
    set: (key, value) => storage.setItem(key, value),
    remove: (key) => storage.removeItem(key),
    keys: () => {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key !== null) keys.push(key);
      }
      return keys;
    },
    flush: () => Promise.resolve(),
  };
}
