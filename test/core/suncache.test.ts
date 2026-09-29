import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntry } from '../../src/core/model';
import type { KeyValueStore } from '../../src/core/store';
import { pruneSunCache, sunCacheKey } from '../../src/core/suncache';
import { localStorageStore } from '../../src/platform/storage/localStorageStore';
import { fakeWebStorage } from '../helpers/stores';

const SUN = '{"sunriseMinutes":330,"sunsetMinutes":1080}';

// 23:30 UTC: already the 16th in Tokyo, still the 15th in New York.
const NOW = new Date('2026-06-15T23:30:00Z');

const tokyo = createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' });
const newYork = createEntry({ timezone: 'America/New_York', label: 'New York' });
const buenosAires = createEntry({ timezone: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' });

// The cache lives in localStorage on both targets; main.tsx prunes it through
// the localStorage store, so the tests do too.
let web: ReturnType<typeof fakeWebStorage>;
let store: KeyValueStore;

function storedKeys(): string[] {
  return [...web.data.keys()].sort();
}

beforeEach(() => {
  web = fakeWebStorage();
  store = localStorageStore(web);
  vi.restoreAllMocks();
});

describe('sunCacheKey', () => {
  it('is the zone and its local date under the timemate.sun. prefix', () => {
    expect(sunCacheKey('Asia/Tokyo', '2026-06-16')).toBe('timemate.sun.Asia/Tokyo.2026-06-16');
  });
});

describe('pruneSunCache — spec §3', () => {
  it("keeps today's key for each listed zone, by that zone's own date", () => {
    web.setItem('timemate.sun.Asia/Tokyo.2026-06-16', SUN);
    web.setItem('timemate.sun.America/New_York.2026-06-15', SUN);

    pruneSunCache(store, [tokyo, newYork], NOW);

    expect(storedKeys()).toEqual([
      'timemate.sun.America/New_York.2026-06-15',
      'timemate.sun.Asia/Tokyo.2026-06-16',
    ]);
  });

  it('removes every earlier day, not just yesterday', () => {
    web.setItem('timemate.sun.Asia/Tokyo.2026-06-16', SUN);
    web.setItem('timemate.sun.Asia/Tokyo.2026-06-15', SUN);
    web.setItem('timemate.sun.Asia/Tokyo.2026-06-12', SUN);
    web.setItem('timemate.sun.Asia/Tokyo.2025-12-31', SUN);

    pruneSunCache(store, [tokyo], NOW);

    expect(storedKeys()).toEqual(['timemate.sun.Asia/Tokyo.2026-06-16']);
  });

  it("removes a removed city's key, even today's", () => {
    web.setItem('timemate.sun.Asia/Tokyo.2026-06-16', SUN);
    web.setItem('timemate.sun.Europe/Paris.2026-06-16', SUN);

    pruneSunCache(store, [tokyo], NOW);

    expect(storedKeys()).toEqual(['timemate.sun.Asia/Tokyo.2026-06-16']);
  });

  it('handles zones with more than one slash', () => {
    web.setItem('timemate.sun.America/Argentina/Buenos_Aires.2026-06-15', SUN);
    web.setItem('timemate.sun.America/Argentina/Buenos_Aires.2026-06-14', SUN);

    pruneSunCache(store, [buenosAires], NOW);

    expect(storedKeys()).toEqual(['timemate.sun.America/Argentina/Buenos_Aires.2026-06-15']);
  });

  it('removes them all when the list is empty', () => {
    web.setItem('timemate.sun.Asia/Tokyo.2026-06-16', SUN);

    pruneSunCache(store, [], NOW);

    expect(storedKeys()).toEqual([]);
  });

  it('never touches a key outside the sun prefix', () => {
    const others = {
      'timemate.data.v2': '{}',
      'timemate.backup_v1': '{}',
      'timemate.timezones.v1': '[]',
      'timemate.swipe-hint-shown.v1': 'true',
      'unrelated': 'x',
    };
    Object.entries(others).forEach(([key, value]) => web.setItem(key, value));
    web.setItem('timemate.sun.Asia/Tokyo.2026-06-15', SUN);

    pruneSunCache(store, [], NOW);

    expect(storedKeys()).toEqual(Object.keys(others).sort());
  });

  it('logs and removes nothing when it fails, rather than throwing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    web.setItem('timemate.sun.Asia/Tokyo.2026-06-15', SUN);
    const broken = createEntry({ timezone: 'Not/A_Zone', label: 'Broken' });

    expect(() => pruneSunCache(store, [tokyo, broken], NOW)).not.toThrow();

    expect(storedKeys()).toEqual(['timemate.sun.Asia/Tokyo.2026-06-15']);
    expect(error).toHaveBeenCalled();
  });
});
