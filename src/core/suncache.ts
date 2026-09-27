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
export function pruneSunCache(entries: Entry[], now: Date): void {
  try {
    const keep = new Set(entries.map((entry) => sunCacheKey(entry.timezone, localDateKey(entry.timezone, now))));
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(SUN_CACHE_PREFIX) && !keep.has(key)) stale.push(key);
    }
    // Collected first: removing while walking by index would skip keys.
    stale.forEach((key) => localStorage.removeItem(key));
  } catch (error) {
    // A cache that isn't tidied is harmless; a popup that fails to open isn't.
    console.error('pruneSunCache failed', error);
  }
}
