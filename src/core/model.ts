import type { AppData, AppSettings, Entry, WorkDays, WorkHours } from './types';

export const APP_DATA_STORAGE_KEY = 'timemate.data.v2';

export const DEFAULT_SETTINGS: AppSettings = {
  hour24: true,
  showSeconds: false,
  sortOrder: 'manual',
  referenceTimezone: null,
  defaultWorkHours: { start: 9, end: 18 },
  defaultWorkDays: [1, 2, 3, 4, 5],
  coreTimePanel: 'always',
  dstBannerEnabled: true,
  dstLeadDays: 14,
  dstNotificationEnabled: false,
};

export function createDefaultAppData(): AppData {
  return {
    version: 2,
    entries: [],
    groups: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function createEntry(partial: Partial<Entry> & { timezone: string }): Entry {
  return {
    id: partial.id ?? crypto.randomUUID(),
    timezone: partial.timezone,
    label: partial.label ?? partial.timezone,
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

export function loadAppData(): AppData | null {
  try {
    const raw = localStorage.getItem(APP_DATA_STORAGE_KEY);
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

export function saveAppData(data: AppData): void {
  const entries = data.entries.map((entry, order) => ({ ...entry, order }));
  localStorage.setItem(APP_DATA_STORAGE_KEY, JSON.stringify({ ...data, entries }));
}
