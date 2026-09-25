import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_V1_STORAGE_KEY,
  freezeDisplayOrder,
  mapV1ToV2,
  migrate,
  needsOrderFreeze,
  readV1Snapshot,
} from '../../src/core/migrate';
import {
  APP_DATA_STORAGE_KEY,
  createEntry,
  DEFAULT_SETTINGS,
  loadAppData,
  saveAppData,
} from '../../src/core/model';
import type { AppData, Entry, SortOrder } from '../../src/core/types';
import v1Real from '../fixtures/v1-real.json';

// v1-real.json is a real v1 export pulled from DevTools -> Application ->
// Local Storage (per §10.5's "real v1 dataset" requirement) — sortMode and
// hourFormat were not captured from that profile, so they're filled with
// the same defaults ('newest'/'12') the empty-profile check returned.

const V1_TIMEZONES_KEY = 'timemate.timezones.v1';
const V1_PINNED_KEY = 'timemate.pinned.v1';
const V1_SORT_MODE_KEY = 'timemate.sort-mode.v1';
const V1_HOUR_FORMAT_KEY = 'timemate.hour-format.v1';

function seedV1Storage(fixture: typeof v1Real): void {
  localStorage.setItem(V1_TIMEZONES_KEY, JSON.stringify(fixture.timezones));
  localStorage.setItem(V1_PINNED_KEY, JSON.stringify(fixture.pinned));
  localStorage.setItem(V1_SORT_MODE_KEY, fixture.sortMode);
  localStorage.setItem(V1_HOUR_FORMAT_KEY, fixture.hourFormat);
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('readV1Snapshot', () => {
  it('returns empty/null defaults when nothing is stored', () => {
    expect(readV1Snapshot()).toEqual({
      timezones: [],
      pinnedIds: [],
      sortMode: null,
      hourFormat: null,
    });
  });

  it('parses a real v1 export and drops malformed entries', () => {
    seedV1Storage(v1Real);
    localStorage.setItem(V1_TIMEZONES_KEY, JSON.stringify([...v1Real.timezones, { id: 'bad' }]));

    const snapshot = readV1Snapshot();
    expect(snapshot.timezones).toHaveLength(v1Real.timezones.length);
    expect(snapshot.pinnedIds).toEqual(v1Real.pinned);
    expect(snapshot.sortMode).toBe('newest');
    expect(snapshot.hourFormat).toBe('12');
  });
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

describe('migrate', () => {
  it('backs up v1 data and writes v2 data on first run', () => {
    seedV1Storage(v1Real);
    const data = migrate();

    expect(data.entries).toHaveLength(v1Real.timezones.length);
    expect(localStorage.getItem(BACKUP_V1_STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem(APP_DATA_STORAGE_KEY)).not.toBeNull();
    // v1 keys are left untouched
    expect(JSON.parse(localStorage.getItem(V1_TIMEZONES_KEY)!)).toEqual(v1Real.timezones);
  });

  it('is idempotent: re-running is a no-op that returns the same data', () => {
    seedV1Storage(v1Real);
    const first = migrate();
    const backupAfterFirst = localStorage.getItem(BACKUP_V1_STORAGE_KEY);

    const second = migrate();

    expect(second).toEqual(first);
    expect(localStorage.getItem(BACKUP_V1_STORAGE_KEY)).toBe(backupAfterFirst);
  });

  it('never produces an empty-list result when v1 has entries, even if the v2 write fails', () => {
    seedV1Storage(v1Real);
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key) => {
      if (key === APP_DATA_STORAGE_KEY) {
        throw new Error('quota exceeded');
      }
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const data = migrate();

    expect(data.entries.length).toBeGreaterThan(0);
    expect(errorSpy).toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it('produces an empty-but-valid AppData when there is no v1 data at all', () => {
    const data = migrate();
    expect(data).toEqual(expect.objectContaining({ version: 2, entries: [] }));
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

describe('migrate — freezing the pre-manual-order display order', () => {
  it('freezes and persists existing v2 data that has no order yet', () => {
    const data = legacyData(
      [
        createEntry({ timezone: 'Asia/Tokyo', label: 'A' }),
        createEntry({ timezone: 'Asia/Tokyo', label: 'B', pinned: true }),
        createEntry({ timezone: 'Asia/Tokyo', label: 'C' }),
      ],
      'manual'
    );
    localStorage.setItem(APP_DATA_STORAGE_KEY, JSON.stringify(data));
    expect(needsOrderFreeze(data)).toBe(true);

    const migrated = migrate(FREEZE_AT);

    expect(labels(migrated)).toEqual(['B', 'C', 'A']);
    const stored = loadAppData()!;
    expect(labels(stored)).toEqual(['B', 'C', 'A']);
    expect(needsOrderFreeze(stored)).toBe(false);
  });

  it('runs once: a later manual reorder is not overridden by the old pinned/sort rules', () => {
    const data = legacyData(
      [
        createEntry({ timezone: 'Asia/Tokyo', label: 'A' }),
        createEntry({ timezone: 'Asia/Tokyo', label: 'B', pinned: true }),
      ],
      'manual'
    );
    localStorage.setItem(APP_DATA_STORAGE_KEY, JSON.stringify(data));
    const frozen = migrate(FREEZE_AT);
    expect(labels(frozen)).toEqual(['B', 'A']);

    // The user drags A above the (still pinned: true) B
    saveAppData({ ...frozen, entries: [frozen.entries[1], frozen.entries[0]] });

    expect(labels(migrate(FREEZE_AT))).toEqual(['A', 'B']);
  });

  it('v1 → v2 lands in the order the v1 list showed (real export: pinned Tokyo, then Xuzhou)', () => {
    seedV1Storage(v1Real);
    const data = migrate(FREEZE_AT);
    expect(labels(data)).toEqual(['Tokyo', 'Xuzhou']);
    expect(orders(data)).toEqual([0, 1]);
  });

  it('v1 → v2 with no pins and the newest-first default shows the stored v1 array reversed', () => {
    seedV1Storage({ ...v1Real, pinned: [] });
    expect(labels(migrate(FREEZE_AT))).toEqual(['Xuzhou', 'Tokyo']);
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
  localStorage.setItem(V1_TIMEZONES_KEY, JSON.stringify(FIVE_CITIES));
  localStorage.setItem(V1_PINNED_KEY, JSON.stringify(['c2', 'c4']));
  localStorage.setItem(V1_SORT_MODE_KEY, sortMode);
}

describe('migrate — pure v1, end to end through every sort mode', () => {
  it('alphabet: pinned first, each group by name', () => {
    seedFiveCities('alphabet');
    const data = migrate(SEP_25);
    expect(labels(data)).toEqual(['Boston', 'Shanghai', 'Bangkok', 'Kathmandu', 'Tokyo']);
    expect(data.settings.sortOrder).toBe('name');
  });

  it('time: pinned first, each group furthest behind first (v1 sorted by local time)', () => {
    seedFiveCities('time');
    const data = migrate(SEP_25);
    expect(labels(data)).toEqual(['Boston', 'Shanghai', 'Kathmandu', 'Bangkok', 'Tokyo']);
    expect(data.settings.sortOrder).toBe('offset');
  });

  it('newest: pinned first, each group newest first (stored array reversed)', () => {
    seedFiveCities('newest');
    expect(labels(migrate(SEP_25))).toEqual(['Shanghai', 'Boston', 'Tokyo', 'Kathmandu', 'Bangkok']);
  });
});
