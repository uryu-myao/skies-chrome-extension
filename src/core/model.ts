import type { KeyValueStore } from './store';
import { friendlyZoneName } from './tz';
import type { AppData, AppSettings, Entry, WorkDays, WorkHours } from './types';

// The `timemate.` prefix predates the rename to Skies and must stay —
// it is where every existing user's data already lives. Same for the v1 keys
// and the backup key in migrate.ts, and the sun cache in Timezone.tsx.
export const APP_DATA_STORAGE_KEY = 'timemate.data.v2';

export const DEFAULT_SETTINGS: AppSettings = {
  hour24: true,
  showSeconds: false,
  sortOrder: 'manual',
  referenceTimezone: null,
  referenceEntryId: null,
  defaultWorkHours: { start: 9, end: 18 },
  defaultWorkDays: [1, 2, 3, 4, 5],
  coreTimePanel: 'always',
  dstBannerEnabled: true,
  dstLeadDays: 14,
  dstNotificationEnabled: false,
};

// The most cities the list holds, free and Pro alike (spec §8). Every way the
// list can grow checks hasRoomForCity() — adding, Undo — and what's read on
// open is capped to it.
export const MAX_CITIES = 30;

export function hasRoomForCity(entries: Entry[]): boolean {
  return entries.length < MAX_CITIES;
}

// Stored data is only ever over the limit if something other than the app
// wrote it — a hand-edited profile, a later version's data after a downgrade:
// nothing this or any earlier version writes goes past 11. Keeps the top of
// the list, what the user sees first.
export function capToCityLimit(entries: Entry[]): Entry[] {
  if (entries.length <= MAX_CITIES) return entries;
  console.warn(`Skies: ${entries.length} cities stored, keeping the first ${MAX_CITIES}`);
  return entries.slice(0, MAX_CITIES);
}

export function createDefaultAppData(): AppData {
  return {
    version: 2,
    entries: [],
    groups: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function createEntry(partial: Partial<Entry> & { timezone: string }): Entry {
  const label = partial.label ?? partial.timezone;
  return {
    id: partial.id ?? crypto.randomUUID(),
    timezone: partial.timezone,
    label,
    defaultLabel: partial.defaultLabel ?? label,
    person: partial.person ?? null,
    workHours: partial.workHours ?? null,
    workDays: partial.workDays ?? null,
    includeInCoreTime: partial.includeInCoreTime ?? true,
    pinned: partial.pinned ?? false,
    groups: partial.groups ?? [],
    order: partial.order ?? 0,
    lat: partial.lat,
    lon: partial.lon,
  };
}

// An entry saved before defaultLabel existed still carries its original name
// as its label: a label only changes through renameEntry(), which records the
// default first.
export function defaultLabelOf(entry: Entry): string {
  return entry.defaultLabel ?? entry.label;
}

export function renameEntry(entry: Entry, label: string): Entry {
  return { ...entry, label, defaultLabel: defaultLabelOf(entry) };
}

export function resetEntryLabel(entry: Entry): Entry {
  return { ...entry, label: defaultLabelOf(entry) };
}

export function toggleIncludeInCoreTime(entry: Entry): Entry {
  return { ...entry, includeInCoreTime: !entry.includeInCoreTime };
}

export type ReferenceSelection =
  | { kind: 'system' }
  | { kind: 'entry'; entryId: string }
  // A zone is set but no entry in the list carries it any more.
  | { kind: 'none' };

export interface ReferenceChip {
  label: string;
  selection: ReferenceSelection;
  // The list entry that stands for the user — the Core Time band's YOU. Not
  // always the selection: under System nothing is selected, yet the user
  // still has a city in the list (spec §9.1, §9.3). Null when no entry fits.
  youEntryId: string | null;
}

// Identity — "which one is me" — decided once, for the header chip and the
// Core Time band alike, so the two can't disagree (spec §9.1). Base / BASE
// are relation and follow the zone instead (referenceRoleOf below).
//
// - System (referenceTimezone null): the chip reads the system zone's own
//   name, never a list entry's label, even one in the same zone — or picking
//   System next to a same-zone "Tsu" would still read "Tsu" and look ignored.
//   YOU is still the first entry in the system zone, if there is one:
//   System is the default, and without it most users would never see YOU.
// - A picked entry: its label, found by referenceEntryId; it's also YOU.
// - That entry gone (removed), or data from before referenceEntryId: the
//   first entry left in the zone, then the zone's own name and no YOU.
export function resolveReferenceChip(
  entries: Entry[],
  settings: AppSettings,
  systemTimezone: string
): ReferenceChip {
  const firstIn = (zone: string) => entries.find((entry) => entry.timezone === zone);

  const zone = settings.referenceTimezone;
  if (zone === null) {
    return {
      label: friendlyZoneName(systemTimezone),
      selection: { kind: 'system' },
      youEntryId: firstIn(systemTimezone)?.id ?? null,
    };
  }

  const picked = entries.find(
    (entry) => entry.id === settings.referenceEntryId && entry.timezone === zone
  );
  const entry = picked ?? firstIn(zone);
  if (!entry) {
    return { label: friendlyZoneName(zone), selection: { kind: 'none' }, youEntryId: null };
  }
  return { label: entry.label, selection: { kind: 'entry', entryId: entry.id }, youEntryId: entry.id };
}

// An entry's part in the reference, for the Core Time band's tag (spec §9.3).
// 'you' is identity — the chip's youEntryId, so never more than one. 'base'
// is relation — any other entry in the reference zone, as many as there are
// (the card's `Base` means the same).
export type ReferenceRole = 'you' | 'base' | null;

export function referenceRoleOf(
  entry: Entry,
  chip: ReferenceChip,
  referenceTimezone: string
): ReferenceRole {
  if (chip.youEntryId === entry.id) return 'you';
  return entry.timezone === referenceTimezone ? 'base' : null;
}

export interface ResolvedWorkHours extends WorkHours {
  isDefault: boolean;
}

export interface ResolvedWorkDays {
  days: WorkDays;
  isDefault: boolean;
}

// The only sanctioned way to read an entry's working hours — never read
// entry.workHours directly, null means "inherit global default", not "no hours".
export function resolveWorkHours(entry: Entry, settings: AppSettings): ResolvedWorkHours {
  if (entry.workHours === null) {
    return { ...settings.defaultWorkHours, isDefault: true };
  }
  return { ...entry.workHours, isDefault: false };
}

// The only sanctioned way to read an entry's working days — see resolveWorkHours.
export function resolveWorkDays(entry: Entry, settings: AppSettings): ResolvedWorkDays {
  if (entry.workDays === null) {
    return { days: settings.defaultWorkDays, isDefault: true };
  }
  return { days: entry.workDays, isDefault: false };
}

export function loadAppData(store: KeyValueStore): AppData | null {
  try {
    const raw = store.get(APP_DATA_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as AppData;
    if (!parsed || parsed.version !== 2 || !Array.isArray(parsed.entries)) {
      return null;
    }

    // Data from before manual ordering has no `order` yet; migrate() freezes
    // it, so leave that array exactly as stored.
    if (!parsed.entries.every((entry) => typeof entry.order === 'number')) {
      return parsed;
    }
    return { ...parsed, entries: [...parsed.entries].sort((a, b) => a.order - b.order) };
  } catch {
    return null;
  }
}

export function saveAppData(store: KeyValueStore, data: AppData): void {
  const entries = data.entries.map((entry, order) => ({ ...entry, order }));
  store.set(APP_DATA_STORAGE_KEY, JSON.stringify({ ...data, entries }));
}
