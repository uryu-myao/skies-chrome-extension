import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_V1_STORAGE_KEY,
  freezeDisplayOrder,
  mapV1ToV2,
  migrate,
  needsOrderFreeze,
  readV1Snapshot,
  removeLegacySunCache,
} from '../../src/core/migrate';
import {
  APP_DATA_STORAGE_KEY,
  createEntry,
  DEFAULT_SETTINGS,
  loadAppData,
  saveAppData,
} from '../../src/core/model';
import type { KeyValueStore } from '../../src/core/store';
import type { AppData, Entry, SortOrder } from '../../src/core/types';
import { extensionStorageStore } from '../../src/platform/storage/extensionStorageStore';
import { fakeArea, firefoxStore, memoryStore } from '../helpers/stores';
import v1Real from '../fixtures/v1-real.json';
import from210 from '../fixtures/v2-written-by-2.1.0.json';

// v1-real.json is a real v1 export pulled from DevTools -> Application ->
// Local Storage (per §10.5's "real v1 dataset" requirement) — sortMode and
// hourFormat were not captured from that profile, so they're filled with
// the same defaults ('newest'/'12') the empty-profile check returned.

const V1_TIMEZONES_KEY = 'timemate.timezones.v1';
const V1_PINNED_KEY = 'timemate.pinned.v1';
const V1_SORT_MODE_KEY = 'timemate.sort-mode.v1';
const V1_HOUR_FORMAT_KEY = 'timemate.hour-format.v1';

// Everything that touches storage runs on both kinds of backend (spec §2.3):
// a synchronous one, as Chrome's localStorage is, and Firefox's storage.local
// behind its asynchronous adapter. The migration is one piece of code; every
// starting state in §3.5 has to hold on both.
interface Backend {
  store: KeyValueStore;
  // What storage itself holds for `key` — for Firefox, storage.local, not the
  // adapter's memory.
  stored(key: string): string | null;
  failWritesTo(key: string): void;
  restoreWrites(): void;
}

const BACKENDS: Array<[string, () => Promise<Backend>]> = [
  [
    'synchronous store (Chrome)',
    async () => {
      const m = memoryStore();
      return { ...m, stored: (key) => m.data.get(key) ?? null };
    },
  ],
  [
    'storage.local (Firefox)',
    async () => {
      const f = await firefoxStore();
      return { ...f, stored: (key) => (f.data.get(key) as string | undefined) ?? null };
    },
  ],
];

let backend: Backend;
let store: KeyValueStore;

function seedV1Storage(fixture: typeof v1Real): void {
  store.set(V1_TIMEZONES_KEY, JSON.stringify(fixture.timezones));
  store.set(V1_PINNED_KEY, JSON.stringify(fixture.pinned));
  store.set(V1_SORT_MODE_KEY, fixture.sortMode);
  store.set(V1_HOUR_FORMAT_KEY, fixture.hourFormat);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('mapV1ToV2', () => {
  it('preserves entry count, order, and pinned status', () => {
    const snapshot = { ...v1Real, pinnedIds: v1Real.pinned } as unknown as Parameters<typeof mapV1ToV2>[0];
    const data = mapV1ToV2(snapshot);

    expect(data.entries).toHaveLength(v1Real.timezones.length);
    data.entries.forEach((entry, i) => {
      expect(entry.timezone).toBe(v1Real.timezones[i].zone);
      expect(entry.label).toBe(v1Real.timezones[i].city);
    });
    expect(data.entries.map((e) => e.pinned)).toEqual([true, false]);
  });

  it('maps sortMode and hourFormat into v2 settings', () => {
    const snapshot = { timezones: [], pinnedIds: [], sortMode: 'time' as const, hourFormat: '24' as const };
    const data = mapV1ToV2(snapshot);
    expect(data.settings.sortOrder).toBe('offset');
    expect(data.settings.hour24).toBe(true);
  });

  it('generates a fresh, unique id per entry, discarding the old v1 id', () => {
    const snapshot = { ...v1Real, pinnedIds: v1Real.pinned } as unknown as Parameters<typeof mapV1ToV2>[0];
    const data = mapV1ToV2(snapshot);
    const oldIds = new Set(v1Real.timezones.map((t) => t.id));
    data.entries.forEach((entry) => expect(oldIds.has(entry.id)).toBe(false));
  });
});

// Data as saved before manual ordering: no `order` on any entry.
function legacyData(entries: Entry[], sortOrder: SortOrder, referenceTimezone: string | null = null): AppData {
  const withoutOrder = entries.map((entry) => {
    const copy: Partial<Entry> = { ...entry };
    delete copy.order;
    return copy as Entry;
  });
  return {
    version: 2,
    entries: withoutOrder,
    groups: [],
    settings: { ...DEFAULT_SETTINGS, sortOrder, referenceTimezone },
  };
}

const labels = (data: AppData) => data.entries.map((entry) => entry.label);
const orders = (data: AppData) => data.entries.map((entry) => entry.order);
const FREEZE_AT = new Date('2026-07-15T12:00:00Z');

describe('freezeDisplayOrder', () => {
  it('manual: pinned first, then newest first — the reversed stored array', () => {
    const data = legacyData(
      [
        createEntry({ timezone: 'Asia/Tokyo', label: 'A' }),
        createEntry({ timezone: 'Asia/Tokyo', label: 'B', pinned: true }),
        createEntry({ timezone: 'Asia/Tokyo', label: 'C' }),
        createEntry({ timezone: 'Asia/Tokyo', label: 'D', pinned: true }),
      ],
      'manual'
    );
    const frozen = freezeDisplayOrder(data, FREEZE_AT);
    expect(labels(frozen)).toEqual(['D', 'B', 'C', 'A']);
    expect(orders(frozen)).toEqual([0, 1, 2, 3]);
  });

  it('offset: pinned first, then furthest behind the reference timezone first', () => {
    const data = legacyData(
      [
        createEntry({ timezone: 'Asia/Kolkata', label: 'Mumbai' }),
        createEntry({ timezone: 'Europe/Berlin', label: 'Berlin', pinned: true }),
        createEntry({ timezone: 'America/New_York', label: 'New York' }),
      ],
      'offset',
      'Asia/Tokyo'
    );
    expect(labels(freezeDisplayOrder(data, FREEZE_AT))).toEqual(['Berlin', 'New York', 'Mumbai']);
  });

  it('name: pinned first, then alphabetical', () => {
    const data = legacyData(
      [
        createEntry({ timezone: 'Europe/Zurich', label: 'Zurich' }),
        createEntry({ timezone: 'Asia/Kolkata', label: 'Mumbai', pinned: true }),
        createEntry({ timezone: 'Europe/Amsterdam', label: 'Amsterdam' }),
      ],
      'name'
    );
    expect(labels(freezeDisplayOrder(data, FREEZE_AT))).toEqual(['Mumbai', 'Amsterdam', 'Zurich']);
  });

  it('only reorders — every entry survives, untouched apart from order', () => {
    const entries = [
      createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo', pinned: true, workDays: [1, 2] }),
      createEntry({ timezone: 'Asia/Shanghai', label: 'Shanghai' }),
    ];
    const frozen = freezeDisplayOrder(legacyData(entries, 'manual'), FREEZE_AT);
    expect(frozen.entries).toHaveLength(2);
    expect(frozen.entries.find((e) => e.label === 'Tokyo')).toEqual({ ...entries[0], order: 0 });
  });
});

describe('mapV1ToV2 — without a value, what v1 showed, not v2 defaults', () => {
  it('no sort mode → newest (manual); no hour format → 12-hour', () => {
    const data = mapV1ToV2({ timezones: [], pinnedIds: [], sortMode: null, hourFormat: null });
    expect(data.settings.sortOrder).toBe('manual');
    expect(data.settings.hour24).toBe(false);
  });
});

// The user's reproduction: five cities, Boston and Shanghai pinned.
const FIVE_CITIES = [
  { id: 'c1', city: 'Bangkok', zone: 'Asia/Bangkok' },
  { id: 'c2', city: 'Boston', zone: 'America/New_York' },
  { id: 'c3', city: 'Kathmandu', zone: 'Asia/Kathmandu' },
  { id: 'c4', city: 'Shanghai', zone: 'Asia/Shanghai' },
  { id: 'c5', city: 'Tokyo', zone: 'Asia/Tokyo' },
];
// US on DST: Boston −4, Kathmandu +5:45, Bangkok +7, Shanghai +8, Tokyo +9.
const SEP_25 = new Date('2026-09-25T07:00:00Z');

function seedFiveCities(sortMode: string): void {
  store.set(V1_TIMEZONES_KEY, JSON.stringify(FIVE_CITIES));
  store.set(V1_PINNED_KEY, JSON.stringify(['c2', 'c4']));
  store.set(V1_SORT_MODE_KEY, sortMode);
}

// A browser that ran 2.1.0: its first popup open wrote timemate.data.v2 and
// timemate.backup_v1 (the fixture, generated by 2.1.0's own code: Bangkok,
// Boston pinned, Kathmandu; newest; 12-hour). After that 2.1.0's UI kept
// writing only the v1 keys — `v1Changes` is what the user did afterwards.
function seedAfter210(v1Changes: Record<string, string> = {}): void {
  store.set(APP_DATA_STORAGE_KEY, from210['timemate.data.v2']);
  store.set(BACKUP_V1_STORAGE_KEY, from210['timemate.backup_v1']);
  for (const [key, value] of Object.entries({ ...from210.v1Keys, ...v1Changes })) {
    store.set(key, value);
  }
}

const DAY_ONE = JSON.parse(from210.v1Keys['timemate.timezones.v1']) as typeof FIVE_CITIES;

describe.each(BACKENDS)('on a %s', (_name, open) => {
  beforeEach(async () => {
    backend = await open();
    store = backend.store;
  });

  describe('readV1Snapshot', () => {
    it('returns empty/null defaults when nothing is stored', () => {
      expect(readV1Snapshot(store)).toEqual({
        timezones: [],
        pinnedIds: [],
        sortMode: null,
        hourFormat: null,
      });
    });

    it('parses a real v1 export and drops malformed entries', () => {
      seedV1Storage(v1Real);
      store.set(V1_TIMEZONES_KEY, JSON.stringify([...v1Real.timezones, { id: 'bad' }]));

      const snapshot = readV1Snapshot(store);
      expect(snapshot.timezones).toHaveLength(v1Real.timezones.length);
      expect(snapshot.pinnedIds).toEqual(v1Real.pinned);
      expect(snapshot.sortMode).toBe('newest');
      expect(snapshot.hourFormat).toBe('12');
    });
  });

  describe('migrate', () => {
    it('backs up v1 data and writes v2 data on first run', async () => {
      seedV1Storage(v1Real);
      const data = await migrate(store);

      expect(data.entries).toHaveLength(v1Real.timezones.length);
      expect(store.get(BACKUP_V1_STORAGE_KEY)).not.toBeNull();
      expect(store.get(APP_DATA_STORAGE_KEY)).not.toBeNull();
      // v1 keys are left untouched
      expect(JSON.parse(store.get(V1_TIMEZONES_KEY)!)).toEqual(v1Real.timezones);
    });

    it('is idempotent: re-running is a no-op that returns the same data', async () => {
      seedV1Storage(v1Real);
      const first = await migrate(store);
      const backupAfterFirst = store.get(BACKUP_V1_STORAGE_KEY);

      const second = await migrate(store);

      expect(second).toEqual(first);
      expect(store.get(BACKUP_V1_STORAGE_KEY)).toBe(backupAfterFirst);
    });

    it('never produces an empty-list result when v1 has entries, even if the v2 write fails', async () => {
      seedV1Storage(v1Real);
      backend.failWritesTo(APP_DATA_STORAGE_KEY);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const data = await migrate(store);

      expect(data.entries.length).toBeGreaterThan(0);
      expect(errorSpy).toHaveBeenCalled();
    });

    // spec §3.1: the backup is stored before v2 is written.
    it('writes no v2 when the backup write fails, so the next open migrates again', async () => {
      seedV1Storage(v1Real);
      backend.failWritesTo(BACKUP_V1_STORAGE_KEY);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const data = await migrate(store);

      expect(labels(data)).toEqual(['Tokyo', 'Xuzhou']);
      for (const key of [BACKUP_V1_STORAGE_KEY, APP_DATA_STORAGE_KEY]) {
        expect(backend.stored(key)).toBeNull();
        expect(store.get(key)).toBeNull();
      }

      backend.restoreWrites();
      expect(labels(await migrate(store))).toEqual(['Tokyo', 'Xuzhou']);
      expect(backend.stored(BACKUP_V1_STORAGE_KEY)).not.toBeNull();
      expect(backend.stored(APP_DATA_STORAGE_KEY)).not.toBeNull();
    });

    it('leaves no half-written v2 when the v2 write fails, in storage or in memory', async () => {
      seedV1Storage(v1Real);
      backend.failWritesTo(APP_DATA_STORAGE_KEY);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await migrate(store);

      expect(backend.stored(APP_DATA_STORAGE_KEY)).toBeNull();
      expect(store.get(APP_DATA_STORAGE_KEY)).toBeNull();
      // The backup made it, and is the only thing that did: still pure v1 +
      // backup, so the next open migrates again.
      expect(backend.stored(BACKUP_V1_STORAGE_KEY)).not.toBeNull();
      backend.restoreWrites();
      expect(labels(await migrate(store))).toEqual(['Tokyo', 'Xuzhou']);
      expect(backend.stored(APP_DATA_STORAGE_KEY)).not.toBeNull();
    });

    it('produces an empty-but-valid AppData when there is no v1 data at all', async () => {
      const data = await migrate(store);
      expect(data).toEqual(expect.objectContaining({ version: 2, entries: [] }));
    });
  });

  describe('migrate — freezing the pre-manual-order display order', () => {
    // v2 data without `order` and no v1 keys existed only in pre-release dev
    // builds; every real user with order-less v2 data came from 2.1.0 and still
    // has v1 keys (see "upgrading from 2.1.0" below).
    it('freezes and persists existing v2 data that has no order yet (no v1 keys)', async () => {
      const data = legacyData(
        [
          createEntry({ timezone: 'Asia/Tokyo', label: 'A' }),
          createEntry({ timezone: 'Asia/Tokyo', label: 'B', pinned: true }),
          createEntry({ timezone: 'Asia/Tokyo', label: 'C' }),
        ],
        'manual'
      );
      store.set(APP_DATA_STORAGE_KEY, JSON.stringify(data));
      expect(needsOrderFreeze(data)).toBe(true);

      const migrated = await migrate(store, FREEZE_AT);

      expect(labels(migrated)).toEqual(['B', 'C', 'A']);
      const stored = loadAppData(store)!;
      expect(labels(stored)).toEqual(['B', 'C', 'A']);
      expect(needsOrderFreeze(stored)).toBe(false);
    });

    it('runs once: a later manual reorder is not overridden by the old pinned/sort rules', async () => {
      const data = legacyData(
        [
          createEntry({ timezone: 'Asia/Tokyo', label: 'A' }),
          createEntry({ timezone: 'Asia/Tokyo', label: 'B', pinned: true }),
        ],
        'manual'
      );
      store.set(APP_DATA_STORAGE_KEY, JSON.stringify(data));
      const frozen = await migrate(store, FREEZE_AT);
      expect(labels(frozen)).toEqual(['B', 'A']);

      // The user drags A above the (still pinned: true) B
      saveAppData(store, { ...frozen, entries: [frozen.entries[1], frozen.entries[0]] });

      expect(labels(await migrate(store, FREEZE_AT))).toEqual(['A', 'B']);
    });

    it('v1 → v2 lands in the order the v1 list showed (real export: pinned Tokyo, then Xuzhou)', async () => {
      seedV1Storage(v1Real);
      const data = await migrate(store, FREEZE_AT);
      expect(labels(data)).toEqual(['Tokyo', 'Xuzhou']);
      expect(orders(data)).toEqual([0, 1]);
    });

    it('v1 → v2 with no pins and the newest-first default shows the stored v1 array reversed', async () => {
      seedV1Storage({ ...v1Real, pinned: [] });
      expect(labels(await migrate(store, FREEZE_AT))).toEqual(['Xuzhou', 'Tokyo']);
    });
  });

  describe('readV1Snapshot — v1 stored sort mode and hour format as plain strings', () => {
    it('reads the plain strings every published v1 wrote, without warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      store.set(V1_SORT_MODE_KEY, 'alphabet');
      store.set(V1_HOUR_FORMAT_KEY, '24');

      expect(readV1Snapshot(store)).toMatchObject({ sortMode: 'alphabet', hourFormat: '24' });
      expect(warn).not.toHaveBeenCalled();
    });

    it('an unrecognised sort mode warns, with the raw value — never a silent fallback', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // JSON-encoded is not a v1 format: v1 never wrote '"alphabet"'.
      store.set(V1_SORT_MODE_KEY, JSON.stringify('alphabet'));

      expect(readV1Snapshot(store).sortMode).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(V1_SORT_MODE_KEY);
      expect(warn.mock.calls[0][0]).toContain(JSON.stringify('"alphabet"'));
    });

    it('an unrecognised hour format warns too', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      store.set(V1_HOUR_FORMAT_KEY, 'h24');

      expect(readV1Snapshot(store).hourFormat).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(V1_HOUR_FORMAT_KEY);
    });

    it('a missing key is normal, not a warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      readV1Snapshot(store);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('migrate — pure v1, end to end through every sort mode', () => {
    it('alphabet: pinned first, each group by name', async () => {
      seedFiveCities('alphabet');
      const data = await migrate(store, SEP_25);
      expect(labels(data)).toEqual(['Boston', 'Shanghai', 'Bangkok', 'Kathmandu', 'Tokyo']);
      expect(data.settings.sortOrder).toBe('name');
    });

    it('time: pinned first, each group furthest behind first (v1 sorted by local time)', async () => {
      seedFiveCities('time');
      const data = await migrate(store, SEP_25);
      expect(labels(data)).toEqual(['Boston', 'Shanghai', 'Kathmandu', 'Bangkok', 'Tokyo']);
      expect(data.settings.sortOrder).toBe('offset');
    });

    it('newest: pinned first, each group newest first (stored array reversed)', async () => {
      seedFiveCities('newest');
      expect(labels(await migrate(store, SEP_25))).toEqual(['Shanghai', 'Boston', 'Tokyo', 'Kathmandu', 'Bangkok']);
    });
  });

  describe('migrate — fresh install (nothing stored)', () => {
    it('gets v2 defaults — 24-hour, not v1’s 12-hour fallback — and no v1 backup', async () => {
      const data = await migrate(store, SEP_25);
      expect(data.entries).toEqual([]);
      expect(data.settings).toEqual(DEFAULT_SETTINGS);
      expect(store.get(BACKUP_V1_STORAGE_KEY)).toBeNull();
    });
  });

  describe('migrate — upgrading from 2.1.0 (v2 without order, v1 keys still there)', () => {
    it('the fixture really is what 2.1.0 wrote: no order on any entry', () => {
      const stale = JSON.parse(from210['timemate.data.v2']) as AppData;
      expect(needsOrderFreeze(stale)).toBe(true);
    });

    it('nothing changed since the first open (the common case): same cities, same order', async () => {
      seedAfter210();
      const data = await migrate(store, SEP_25);
      expect(labels(data)).toEqual(['Boston', 'Kathmandu', 'Bangkok']);
      expect(needsOrderFreeze(loadAppData(store)!)).toBe(false);
    });

    it('added a city since: it is there', async () => {
      seedAfter210({
        [V1_TIMEZONES_KEY]: JSON.stringify([...DAY_ONE, { id: 'c4', city: 'Shanghai', zone: 'Asia/Shanghai' }]),
      });
      expect(labels(await migrate(store, SEP_25))).toEqual(['Boston', 'Shanghai', 'Kathmandu', 'Bangkok']);
    });

    it('removed a city since: it stays removed', async () => {
      seedAfter210({
        [V1_TIMEZONES_KEY]: JSON.stringify(DAY_ONE.filter((city) => city.city !== 'Kathmandu')),
      });
      expect(labels(await migrate(store, SEP_25))).toEqual(['Boston', 'Bangkok']);
    });

    it('changed the sort mode since: the new one is used', async () => {
      seedAfter210({ [V1_SORT_MODE_KEY]: 'alphabet' });
      const data = await migrate(store, SEP_25);
      expect(labels(data)).toEqual(['Boston', 'Bangkok', 'Kathmandu']);
      expect(data.settings.sortOrder).toBe('name');
    });

    it('changed 12/24 since: the new one is used', async () => {
      seedAfter210({ [V1_HOUR_FORMAT_KEY]: '24' });
      expect((await migrate(store, SEP_25)).settings.hour24).toBe(true);
    });

    it('emptied the list since: it is empty, not the three cities from the first open', async () => {
      seedAfter210({ [V1_TIMEZONES_KEY]: '[]' });
      expect((await migrate(store, SEP_25)).entries).toEqual([]);
    });

    it('never replaces the backup 2.1.0 took on its first open', async () => {
      seedAfter210({
        [V1_TIMEZONES_KEY]: JSON.stringify([...DAY_ONE, { id: 'c4', city: 'Shanghai', zone: 'Asia/Shanghai' }]),
      });
      await migrate(store, SEP_25);
      expect(store.get(BACKUP_V1_STORAGE_KEY)).toBe(from210['timemate.backup_v1']);
    });

    it('leaves the v1 keys untouched', async () => {
      seedAfter210({ [V1_SORT_MODE_KEY]: 'time' });
      await migrate(store, SEP_25);
      for (const [key, value] of Object.entries({ ...from210.v1Keys, [V1_SORT_MODE_KEY]: 'time' })) {
        expect(store.get(key)).toBe(value);
      }
    });

    it('rebuilds once: afterwards v2 written by 3.0.0 is read as is, v1 keys or not', async () => {
      seedAfter210();
      const rebuilt = await migrate(store, SEP_25);
      // The user reorders in 3.0.0; the v1 keys (still there) say otherwise.
      saveAppData(store, { ...rebuilt, entries: [...rebuilt.entries].reverse() });

      expect(labels(await migrate(store, SEP_25))).toEqual(['Bangkok', 'Kathmandu', 'Boston']);
    });
  });
});

// Firefox is a new listing: storage.local starts empty (spec §3.5).
describe('migrate — Firefox fresh install (storage.local empty)', () => {
  it('gets v2 defaults, written to storage.local and confirmed, with no v1 backup', async () => {
    const firefox = await firefoxStore();

    const data = await migrate(firefox.store, SEP_25);

    expect(data.entries).toEqual([]);
    expect(data.settings).toEqual(DEFAULT_SETTINGS);
    expect(JSON.parse(firefox.data.get(APP_DATA_STORAGE_KEY) as string)).toEqual(data);
    expect(firefox.data.has(BACKUP_V1_STORAGE_KEY)).toBe(false);
    expect(firefox.calls.map((call) => call.key)).toEqual([APP_DATA_STORAGE_KEY]);
  });

  it('the next open reads it back and writes nothing — the 3.0.0 state from then on', async () => {
    const firefox = await firefoxStore();
    const first = await migrate(firefox.store, SEP_25);
    const writes = firefox.calls.length;

    const reopened = extensionStorageStore(firefox.area);
    await reopened.init();

    expect(await migrate(reopened, SEP_25)).toEqual(first);
    expect(firefox.calls).toHaveLength(writes);
  });

  it('when storage.local cannot be read: defaults on screen, nothing written over the unread data', async () => {
    const saved = JSON.stringify({ version: 2, entries: [], groups: [], settings: { ...DEFAULT_SETTINGS, hour24: false } });
    const fake = fakeArea({ [APP_DATA_STORAGE_KEY]: saved });
    fake.options.failRead = true;
    const unread = extensionStorageStore(fake.area);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await unread.init();

    const data = await migrate(unread, SEP_25);

    expect(data.settings).toEqual(DEFAULT_SETTINGS);
    expect(fake.calls).toEqual([]);
    expect(fake.data.get(APP_DATA_STORAGE_KEY)).toBe(saved);
    expect(error).toHaveBeenCalled();
  });
});

// 3.1.x's sunrise/sunset cache (spec §3): the sky is computed now.
describe('removeLegacySunCache', () => {
  it('deletes every timemate.sun.* key and nothing else', () => {
    const { store, data } = memoryStore({
      'timemate.sun.Asia/Tokyo.2026-06-16': '{}',
      'timemate.sun.America/Argentina/Buenos_Aires.2025-12-31': '{}',
      'timemate.data.v2': '{}',
      'timemate.backup_v1': '{}',
      'timemate.timezones.v1': '[]',
      'timemate.swipe-hint-shown.v1': 'true',
      unrelated: 'x',
    });

    removeLegacySunCache(store);

    expect([...data.keys()].sort()).toEqual([
      'timemate.backup_v1',
      'timemate.data.v2',
      'timemate.swipe-hint-shown.v1',
      'timemate.timezones.v1',
      'unrelated',
    ]);
  });

  it('logs rather than throws when storage fails — the popup still opens', () => {
    const { store } = memoryStore({ 'timemate.sun.Asia/Tokyo.2026-06-16': '{}' });
    store.keys = () => {
      throw new Error('storage unavailable');
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => removeLegacySunCache(store)).not.toThrow();
    expect(error).toHaveBeenCalled();
  });
});
