// What the Chrome build does with storage on a popup open, as scenarios that
// run against any version of core: 3.1.2's (to write the expected output in
// test/fixtures/storage-written-by-3.1.2.json) or today's (to check against
// it). Chrome's storage must come out byte-identical (spec §10.6).
import type { AppData, Entry } from '../../src/core/types';

// The parts of core a scenario uses. `migrate` is async here because today's
// is; 3.1.2's synchronous one is wrapped.
export interface CoreApi {
  migrate(now: Date): Promise<AppData>;
  save(data: AppData): void;
  createEntry(partial: Partial<Entry> & { timezone: string }): Entry;
  renameEntry(entry: Entry, label: string): Entry;
  toggleIncludeInCoreTime(entry: Entry): Entry;
}

// The clock for every scenario: migrate(now), and the backup's migratedAt.
export const NOW = new Date('2026-09-25T07:00:00Z');

// crypto.randomUUID stand-in, restarted for each scenario, so entry ids that
// migrate() generates are the same in both runs.
export function uuidSequence(): () => `${string}-${string}-${string}-${string}-${string}` {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

export const V1_KEYS = {
  timezones: 'timemate.timezones.v1',
  pinned: 'timemate.pinned.v1',
  sortMode: 'timemate.sort-mode.v1',
  hourFormat: 'timemate.hour-format.v1',
};

// A list as 3.x users have it: non-ASCII and quoted labels, custom hours and
// days, a city left out of Core Time, a picked reference city.
export function buildV2List(api: CoreApi): AppData {
  return {
    version: 2,
    entries: [
      api.createEntry({ id: 'e-tokyo', timezone: 'Asia/Tokyo', label: '東京', lat: 35.6895, lon: 139.69171 }),
      api.createEntry({
        id: 'e-zurich',
        timezone: 'Europe/Zurich',
        label: 'Zürich',
        workHours: { start: 8, end: 17 },
        workDays: [1, 2, 3, 4],
      }),
      api.createEntry({ id: 'e-ny', timezone: 'America/New_York', label: 'New York', lat: 40.71427, lon: -74.00597 }),
      api.createEntry({ id: 'e-kolkata', timezone: 'Asia/Kolkata', label: 'Kolkata', includeInCoreTime: false }),
    ],
    groups: [],
    settings: {
      hour24: true,
      showSeconds: false,
      sortOrder: 'manual',
      referenceTimezone: 'Asia/Tokyo',
      referenceEntryId: 'e-tokyo',
      defaultWorkHours: { start: 9, end: 18 },
      defaultWorkDays: [1, 2, 3, 4, 5],
      coreTimePanel: 'always',
      dstBannerEnabled: true,
      dstLeadDays: 14,
      dstNotificationEnabled: false,
    },
  };
}

export interface Scenario {
  name: string;
  run(api: CoreApi): Promise<void>;
}

export const SCENARIOS: Scenario[] = [
  {
    // Open, change things the way the UI does, save — App.tsx saves the whole
    // list on every change — then open again.
    name: 'v2 written by 3.x: read, edit, save, reopen',
    async run(api) {
      const data = await api.migrate(NOW);
      let entries = [
        api.createEntry({ id: 'e-saopaulo', timezone: 'America/Sao_Paulo', label: 'São Paulo', lat: -23.5475, lon: -46.63611 }),
        ...data.entries,
      ];
      entries[2] = api.renameEntry(entries[2], 'Office "HQ"');
      entries[1] = api.toggleIncludeInCoreTime(entries[1]);
      entries = entries.filter((entry) => entry.id !== 'e-ny');
      entries = [entries[0], entries[entries.length - 1], ...entries.slice(1, -1)];
      const settings = {
        ...data.settings,
        hour24: false,
        showSeconds: true,
        coreTimePanel: 'collapsed' as const,
        defaultWorkHours: { start: 10, end: 19 },
        defaultWorkDays: [0, 1, 2, 3, 4],
      };
      api.save({ version: 2, entries, groups: [], settings });
      await api.migrate(NOW);
    },
  },
  { name: 'pure v1: migrate', run: async (api) => void (await api.migrate(NOW)) },
  { name: 'v2 left by 2.1.0: rebuild from v1', run: async (api) => void (await api.migrate(NOW)) },
  { name: 'fresh install', run: async (api) => void (await api.migrate(NOW)) },
];
