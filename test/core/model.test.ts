import { beforeEach, describe, expect, it } from 'vitest';
import {
  createEntry,
  DEFAULT_SETTINGS,
  defaultLabelOf,
  loadAppData,
  renameEntry,
  resetEntryLabel,
  resolveWorkDays,
  resolveWorkHours,
  resolveReferenceChip,
  saveAppData,
  toggleIncludeInCoreTime,
} from '../../src/core/model';
import type { AppSettings, Entry } from '../../src/core/types';

beforeEach(() => {
  localStorage.clear();
});

describe('resolveWorkHours', () => {
  it('inherits the global default when workHours is null, flagged isDefault', () => {
    const entry = createEntry({ timezone: 'Asia/Tokyo' });
    const resolved = resolveWorkHours(entry, DEFAULT_SETTINGS);
    expect(resolved).toEqual({ ...DEFAULT_SETTINGS.defaultWorkHours, isDefault: true });
  });

  it('uses the entry own value when set, flagged not-default', () => {
    const entry = createEntry({ timezone: 'Asia/Tokyo', workHours: { start: 10, end: 16 } });
    const resolved = resolveWorkHours(entry, DEFAULT_SETTINGS);
    expect(resolved).toEqual({ start: 10, end: 16, isDefault: false });
  });
});

describe('resolveWorkDays', () => {
  it('inherits the global default when workDays is null', () => {
    const entry = createEntry({ timezone: 'Asia/Tokyo' });
    const resolved = resolveWorkDays(entry, DEFAULT_SETTINGS);
    expect(resolved).toEqual({ days: DEFAULT_SETTINGS.defaultWorkDays, isDefault: true });
  });

  it('treats an explicit empty array as a real, non-default value', () => {
    const entry = createEntry({ timezone: 'Asia/Tokyo', workDays: [] });
    const resolved = resolveWorkDays(entry, DEFAULT_SETTINGS);
    expect(resolved).toEqual({ days: [], isDefault: false });
  });
});

describe('createEntry', () => {
  it('fills schema defaults and generates a unique id', () => {
    const a = createEntry({ timezone: 'Europe/Berlin' });
    const b = createEntry({ timezone: 'Europe/Berlin' });
    expect(a.id).not.toEqual(b.id);
    expect(a.label).toBe('Europe/Berlin');
    expect(a.person).toBeNull();
    expect(a.workHours).toBeNull();
    expect(a.workDays).toBeNull();
    expect(a.includeInCoreTime).toBe(true);
    expect(a.pinned).toBe(false);
    expect(a.groups).toEqual([]);
  });

  it('records the name it was added with as the default label', () => {
    expect(createEntry({ timezone: 'Asia/Shanghai', label: 'Xuzhou' }).defaultLabel).toBe('Xuzhou');
    expect(createEntry({ timezone: 'Europe/Berlin' }).defaultLabel).toBe('Europe/Berlin');
  });
});

describe('renameEntry / resetEntryLabel', () => {
  it('keeps the original default across several renames, and reset restores it', () => {
    const entry = createEntry({ timezone: 'Asia/Kolkata', label: 'Mumbai' });
    const renamed = renameEntry(renameEntry(entry, 'Bombay'), 'Office');
    expect(renamed.label).toBe('Office');
    expect(defaultLabelOf(renamed)).toBe('Mumbai');
    expect(resetEntryLabel(renamed).label).toBe('Mumbai');
  });

  it('captures the current name as default for an entry saved before defaultLabel existed', () => {
    const legacy: Entry = { ...createEntry({ timezone: 'Asia/Shanghai', label: 'Xuzhou' }) };
    delete legacy.defaultLabel;
    expect(defaultLabelOf(legacy)).toBe('Xuzhou');

    const renamed = renameEntry(legacy, 'Home');
    expect(renamed.defaultLabel).toBe('Xuzhou');
    expect(resetEntryLabel(renamed).label).toBe('Xuzhou');
  });

  it('reset on a never-renamed entry is a no-op on the label', () => {
    const entry = createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' });
    expect(resetEntryLabel(entry)).toEqual(entry);
  });
});

describe('resolveReferenceChip — the chip name and selected option (§9.1)', () => {
  const tsu = createEntry({ id: 'tsu', timezone: 'Asia/Tokyo', label: 'Tsu' });
  const boston = createEntry({ id: 'boston', timezone: 'America/New_York', label: 'Boston' });
  const newYork = createEntry({ id: 'ny', timezone: 'America/New_York', label: 'New York' });
  const entries = [tsu, boston, newYork];
  const SYSTEM = 'Asia/Tokyo';

  const pick = (entry: Entry | null): AppSettings => ({
    ...DEFAULT_SETTINGS,
    referenceTimezone: entry?.timezone ?? null,
    referenceEntryId: entry?.id ?? null,
  });

  it("System is named after the system zone, not a same-zone entry's label", () => {
    expect(resolveReferenceChip(entries, pick(null), SYSTEM)).toEqual({
      label: 'Tokyo',
      selection: { kind: 'system' },
    });
  });

  it('a picked entry shows its own label, even when an earlier entry shares its zone', () => {
    expect(resolveReferenceChip(entries, pick(newYork), SYSTEM)).toEqual({
      label: 'New York',
      selection: { kind: 'entry', entryId: newYork.id },
    });
    expect(resolveReferenceChip(entries, pick(boston), SYSTEM)).toEqual({
      label: 'Boston',
      selection: { kind: 'entry', entryId: boston.id },
    });
  });

  it('picking the same-zone entry is distinct from System', () => {
    expect(resolveReferenceChip(entries, pick(tsu), SYSTEM)).toEqual({
      label: 'Tsu',
      selection: { kind: 'entry', entryId: tsu.id },
    });
  });

  it('the picked entry removed: falls back to the next entry left in the zone', () => {
    expect(resolveReferenceChip([tsu, boston], pick(newYork), SYSTEM)).toEqual({
      label: 'Boston',
      selection: { kind: 'entry', entryId: boston.id },
    });
  });

  it('no entry left in the zone: the zone’s own name, nothing selected', () => {
    expect(resolveReferenceChip([tsu], pick(newYork), SYSTEM)).toEqual({
      label: 'New York',
      selection: { kind: 'none' },
    });
    // Tsu picked, then removed: the chip says "Tokyo", not the gone label.
    expect(resolveReferenceChip([], pick(tsu), SYSTEM).label).toBe('Tokyo');
  });

  it('data saved before referenceEntryId: the first entry in the zone, as before', () => {
    const legacy: AppSettings = { ...DEFAULT_SETTINGS, referenceTimezone: 'America/New_York' };
    delete legacy.referenceEntryId;
    expect(resolveReferenceChip(entries, legacy, SYSTEM)).toEqual({
      label: 'Boston',
      selection: { kind: 'entry', entryId: boston.id },
    });
  });

  it('an id that no longer matches the zone is ignored', () => {
    const stale: AppSettings = {
      ...DEFAULT_SETTINGS,
      referenceTimezone: 'America/New_York',
      referenceEntryId: tsu.id,
    };
    expect(resolveReferenceChip(entries, stale, SYSTEM).label).toBe('Boston');
  });
});

describe('toggleIncludeInCoreTime', () => {
  it('flips only includeInCoreTime, and flipping twice restores the entry', () => {
    const entry = createEntry({ timezone: 'America/New_York', label: 'Boston' });
    const excluded = toggleIncludeInCoreTime(entry);
    expect(excluded).toEqual({ ...entry, includeInCoreTime: false });
    expect(toggleIncludeInCoreTime(excluded)).toEqual(entry);
  });

  it('survives a save/load round trip', () => {
    const entry = toggleIncludeInCoreTime(createEntry({ timezone: 'America/New_York' }));
    saveAppData({ version: 2, entries: [entry], groups: [], settings: DEFAULT_SETTINGS });
    expect(loadAppData()?.entries[0].includeInCoreTime).toBe(false);
  });
});

describe('loadAppData / saveAppData', () => {
  it('returns null when nothing is stored', () => {
    expect(loadAppData()).toBeNull();
  });

  it('returns null on corrupt JSON rather than throwing', () => {
    localStorage.setItem('timemate.data.v2', '{not json');
    expect(loadAppData()).toBeNull();
  });

  it('writes each entry\'s array position into order, and loads back sorted by it', () => {
    const settings: AppSettings = { ...DEFAULT_SETTINGS };
    const a = createEntry({ timezone: 'Asia/Tokyo', label: 'A', order: 7 });
    const b = createEntry({ timezone: 'Asia/Tokyo', label: 'B', order: 3 });
    saveAppData({ version: 2, entries: [a, b], groups: [], settings });

    const stored = JSON.parse(localStorage.getItem('timemate.data.v2')!);
    expect(stored.entries.map((e: { order: number }) => e.order)).toEqual([0, 1]);

    // Stored out of array order: load follows `order`, not array position
    stored.entries.reverse();
    localStorage.setItem('timemate.data.v2', JSON.stringify(stored));
    expect(loadAppData()!.entries.map((e) => e.label)).toEqual(['A', 'B']);
  });

  it('leaves data without order exactly as stored (migrate() freezes it)', () => {
    const settings: AppSettings = { ...DEFAULT_SETTINGS };
    const raw = { version: 2, entries: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }], groups: [], settings };
    localStorage.setItem('timemate.data.v2', JSON.stringify(raw));
    expect(loadAppData()!.entries.map((e) => e.label)).toEqual(['X', 'Y']);
  });

  it('round-trips a saved AppData blob', () => {
    const settings: AppSettings = { ...DEFAULT_SETTINGS };
    const data = { version: 2 as const, entries: [createEntry({ timezone: 'Asia/Tokyo' })], groups: [], settings };
    saveAppData(data);
    expect(loadAppData()).toEqual(data);
  });
});
