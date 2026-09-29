import type { KeyValueStore } from './store';
import { localDateKey } from './tz';
import type { Entry } from './types';

// The `timemate.` prefix predates the rename to Skies and stays, like every
// other key (see model.ts).
const SUN_CACHE_PREFIX = 'timemate.sun.';

// One sunrise/sunset per zone per day; `dateKey` is the zone's own local date
// (localDateKey), which is also the day the cached times belong to.
export function sunCacheKey(zone: string, dateKey: string): string {
  return `${SUN_CACHE_PREFIX}${zone}.${dateKey}`;
}

// Removes every sun-cache key except today's for a zone that's still in the
// list (spec §3). A card only ever writes its own zone's key for today, so
// anything else is left over: a day the popup wasn't opened, or a city
// that's since been removed. Only keys under the sun prefix are touched.
// `store` is wherever the cache lives — localStorage on both targets, not
// the persistent store (spec §2.3).
export function pruneSunCache(store: KeyValueStore, entries: Entry[], now: Date): void {
  try {
    const keep = new Set(entries.map((entry) => sunCacheKey(entry.timezone, localDateKey(entry.timezone, now))));
    // keys() is a snapshot, so removing while going through it skips nothing.
    const stale = store.keys().filter((key) => key.startsWith(SUN_CACHE_PREFIX) && !keep.has(key));
    stale.forEach((key) => store.remove(key));
  } catch (error) {
    // A cache that isn't tidied is harmless; a popup that fails to open isn't.
    console.error('pruneSunCache failed', error);
  }
}
