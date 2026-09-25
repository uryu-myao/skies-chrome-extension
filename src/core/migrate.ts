import { createDefaultAppData, createEntry, DEFAULT_SETTINGS, loadAppData, saveAppData } from './model';
import { getSystemTimezone, relativeOffsetMinutes } from './tz';
import type { AppData, AppSettings, Entry, SortOrder } from './types';

const V1_TIMEZONES_KEY = 'timemate.timezones.v1';
const V1_PINNED_KEY = 'timemate.pinned.v1';
const V1_SORT_MODE_KEY = 'timemate.sort-mode.v1';
const V1_HOUR_FORMAT_KEY = 'timemate.hour-format.v1';
export const BACKUP_V1_STORAGE_KEY = 'timemate.backup_v1';

export interface V1TimezoneEntry {
  id: string;
  city: string;
  zone: string;
  lat?: number;
  lon?: number;
}

export type V1SortMode = 'newest' | 'time' | 'alphabet';
export type V1HourFormat = '12' | '24';

export interface V1Snapshot {
  timezones: V1TimezoneEntry[];
  pinnedIds: string[];
  sortMode: V1SortMode | null;
  hourFormat: V1HourFormat | null;
}

const SORT_MODE_TO_ORDER: Record<V1SortMode, SortOrder> = {
  newest: 'manual',
  time: 'offset',
  alphabet: 'name',
};

// What v1 itself showed when its key was missing or held anything else. A v1
// user falls back to these, not to v2's defaults (24-hour), so nobody's view
// changes in the move.
const V1_DEFAULT_SORT_MODE: V1SortMode = 'newest';
const V1_DEFAULT_HOUR_FORMAT: V1HourFormat = '12';

// Not silent: an unrecognised value means a user's setting is being replaced,
// and there'd be no other trace of it.
function warnUnrecognised(key: string, raw: string, fallback: string): void {
  console.warn(
    `[Skies] ${key} holds an unrecognised value ${JSON.stringify(raw)}; migrating it as ${fallback}, which is what v1 showed for it`
  );
}

function safeParseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function readV1Snapshot(): V1Snapshot {
  const timezones = safeParseArray<V1TimezoneEntry>(
    localStorage.getItem(V1_TIMEZONES_KEY)
  ).filter(
    (item): item is V1TimezoneEntry =>
      !!item &&
      typeof item.id === 'string' &&
      typeof item.city === 'string' &&
      typeof item.zone === 'string'
  );

  const pinnedIds = safeParseArray<string>(
    localStorage.getItem(V1_PINNED_KEY)
  ).filter((id) => typeof id === 'string');

  // Every published v1 (1.0.2–2.1.0) wrote these two as plain strings —
  // localStorage.setItem(key, 'alphabet'), not JSON — and read them back the
  // same way, so they're compared as stored. A JSON-encoded '"alphabet"' was
  // never a v1 value. A missing key is normal (null); anything else warns.
  const sortModeRaw = localStorage.getItem(V1_SORT_MODE_KEY);
  const sortMode: V1SortMode | null =
    sortModeRaw === 'newest' || sortModeRaw === 'time' || sortModeRaw === 'alphabet'
      ? sortModeRaw
      : null;
  if (sortModeRaw !== null && sortMode === null) {
    warnUnrecognised(V1_SORT_MODE_KEY, sortModeRaw, `"${V1_DEFAULT_SORT_MODE}"`);
  }

  const hourFormatRaw = localStorage.getItem(V1_HOUR_FORMAT_KEY);
  const hourFormat: V1HourFormat | null =
    hourFormatRaw === '12' || hourFormatRaw === '24' ? hourFormatRaw : null;
  if (hourFormatRaw !== null && hourFormat === null) {
    warnUnrecognised(V1_HOUR_FORMAT_KEY, hourFormatRaw, `"${V1_DEFAULT_HOUR_FORMAT}"`);
  }

  return { timezones, pinnedIds, sortMode, hourFormat };
}

// Pure: v1 city.timezone -> entry.timezone, city.name (city.city here) -> entry.label,
// membership in the old pinned-ids array -> entry.pinned. entry.id is freshly generated.
// Array order is preserved 1:1 from the stored v1 order.
export function mapV1ToV2(snapshot: V1Snapshot): AppData {
  const pinnedSet = new Set(snapshot.pinnedIds);

  const entries = snapshot.timezones.map((tz) =>
    createEntry({
      timezone: tz.zone,
      label: tz.city,
      pinned: pinnedSet.has(tz.id),
      lat: tz.lat,
      lon: tz.lon,
    })
  );

  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    hour24: (snapshot.hourFormat ?? V1_DEFAULT_HOUR_FORMAT) === '24',
    sortOrder: SORT_MODE_TO_ORDER[snapshot.sortMode ?? V1_DEFAULT_SORT_MODE],
  };

  return { version: 2, entries, groups: [], settings };
}

export function needsOrderFreeze(data: AppData): boolean {
  return data.entries.some((entry: Partial<Entry>) => typeof entry.order !== 'number');
}

// Pure. Reproduces the list's display order from before manual ordering —
// pinned entries first, then the saved sortOrder (manual = newest first,
// i.e. the stored array reversed; offset = furthest behind the reference
// first, as of `now`; name) — and makes that the manual order. Removing pins
// and sort modes must not reshuffle a list the user is used to seeing, and
// must not fall back to raw insertion order. Entries are only reordered,
// never dropped.
export function freezeDisplayOrder(data: AppData, now: Date): AppData {
  const { sortOrder } = data.settings;
  const referenceTimezone = data.settings.referenceTimezone ?? getSystemTimezone();
  const offsetOf = (entry: Entry) => relativeOffsetMinutes(entry.timezone, referenceTimezone, now);

  const entries = data.entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      if (a.entry.pinned !== b.entry.pinned) return a.entry.pinned ? -1 : 1;
      if (sortOrder === 'name') return a.entry.label.localeCompare(b.entry.label);
      if (sortOrder === 'offset') return offsetOf(a.entry) - offsetOf(b.entry);
      return b.index - a.index;
    })
    .map(({ entry }, order) => ({ ...entry, order }));

  return { ...data, entries };
}

// Freezes and persists the old display order the first time data without
// `order` is seen; a no-op afterwards. If the write fails the frozen data is
// still returned, so this session renders the right order either way.
function freezeOrderOnce(data: AppData, now: Date): AppData {
  if (!needsOrderFreeze(data)) return data;
  const frozen = freezeDisplayOrder(data, now);
  try {
    saveAppData(frozen);
  } catch (err) {
    console.error('[Skies] failed to persist the frozen list order:', err);
  }
  return frozen;
}

function backupV1Once(snapshot: V1Snapshot): void {
  if (localStorage.getItem(BACKUP_V1_STORAGE_KEY)) return;
  localStorage.setItem(
    BACKUP_V1_STORAGE_KEY,
    JSON.stringify({ ...snapshot, migratedAt: new Date().toISOString() })
  );
}

// Every v1 build wrote the city list on first mount, so its key — even as
// "[]" — means this browser ran v1. A fresh install has none of the v1 keys.
function hasV1Data(): boolean {
  return localStorage.getItem(V1_TIMEZONES_KEY) !== null;
}

// v2 data 2.1.0 left behind. 2.1.0 ran this migration silently on its first
// popup open and never again (v2 existed from then on), while its UI kept
// reading and writing only the v1 keys — so anything the user did in 2.1.0
// after that first open is in the v1 keys and not here. Its entries have no
// `order` (added after 2.1.0 shipped), and the v1 keys are still there. It
// was never shown or edited by a v2 UI, so rebuilding it from the v1 keys
// loses nothing.
function isLeftBy210(data: AppData): boolean {
  return needsOrderFreeze(data) && hasV1Data();
}

// Entry point: run at startup, before any rendering; the caller renders from
// the returned data. Four starting states (spec §3.5) — check every change
// against all of them, not just a fresh profile:
//
//   nothing stored          fresh install → v2 defaults
//   v1 keys only            never opened 2.1.0 → migrate from v1
//   v2 without order + v1   left by 2.1.0 → rebuild from the (newer) v1 keys
//   v2 with order           written by 3.0.0+ → read as is
//
// Idempotent: once v2 has `order` it's only read. The v1 keys are never
// modified, and timemate.backup_v1 is written once — a rebuild doesn't
// replace the snapshot 2.1.0 took on its first open. On failure nothing is
// written and the caller still never renders an empty list.
export function migrate(now: Date = new Date()): AppData {
  const existing = loadAppData();
  if (existing && !isLeftBy210(existing)) return freezeOrderOnce(existing, now);

  if (!existing && !hasV1Data()) {
    const fresh = createDefaultAppData();
    try {
      saveAppData(fresh);
    } catch (err) {
      console.error('[Skies] failed to save the initial data:', err);
    }
    return fresh;
  }

  let mapped: AppData | null = null;
  try {
    const snapshot = readV1Snapshot();
    mapped = freezeDisplayOrder(mapV1ToV2(snapshot), now);
    backupV1Once(snapshot);
    saveAppData(mapped);
    return mapped;
  } catch (err) {
    console.error('[Skies] v1→v2 migration failed, v1 data left untouched:', err);
    // Return the best-effort in-memory mapping even if persisting it failed,
    // so a caller never renders an empty list off the back of a write error;
    // failing that, 2.1.0's older v2 data beats nothing.
    if (mapped) return mapped;
    return existing ? freezeDisplayOrder(existing, now) : createDefaultAppData();
  }
}
