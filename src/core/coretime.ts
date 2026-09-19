import { resolveWorkDays, resolveWorkHours } from './model';
import type { AppSettings, Entry } from './types';
import {
  addLocalCalendarDays,
  formatHHMM,
  getSystemTimezone,
  localDateKey,
  localHHMM,
  localMidnightUtcMillis,
  localDateParts,
  localMinutesOfDay,
  localWeekday,
  MINUTES_PER_SLOT,
  SLOTS_PER_DAY,
} from './tz';

export interface CoreTimeAxisSlot {
  slot: number;
  refTime: string;
}

export interface CoreTimeRow {
  entryId: string;
  blocks: boolean[];
  localDate: string;
  crossesDay: boolean;
}

export interface CoreTimeOverlapRange {
  startSlot: number;
  endSlot: number;
}

export interface CoreTimeClosestPerEntry {
  entryId: string;
  localTime: string;
  deviationMinutes: number;
}

export interface CoreTimeClosest {
  refTime: string;
  perEntry: CoreTimeClosestPerEntry[];
  gapMinutes: number;
}

export interface CoreTimeNextOverlap {
  daysFromToday: number;
  weekday: number;
  startSlot: number;
  endSlot: number;
}

// The panel's conclusion as a status + exactly the data that status needs —
// no copy strings here, that's the UI's job. Expanded/collapsed render modes
// both read this same value; there is no second decision path.
export type CoreTimeConclusion =
  | { status: 'NO_ENTRIES' }
  | { status: 'OVERLAP' }
  | { status: 'NO_OVERLAP_TODAY'; closest: CoreTimeClosest }
  | { status: 'ALL_OFF'; offEntryIds: string[]; nextOverlap: CoreTimeNextOverlap | null }
  | {
      status: 'PARTIAL_OFF';
      workingEntryIds: string[];
      offEntryIds: string[];
      nextOverlap: CoreTimeNextOverlap | null;
    };

export interface CoreTimeResult {
  axis: CoreTimeAxisSlot[];
  rows: CoreTimeRow[];
  overlap: CoreTimeOverlapRange[];
  conclusion: CoreTimeConclusion;
}

export interface CoreTimeInput {
  entries: Entry[];
  settings: AppSettings;
  referenceDate: Date;
}

function buildSlotInstants(referenceTimezone: string, referenceDate: Date): Date[] {
  const { year, month, day } = localDateParts(referenceTimezone, referenceDate);
  const dayStartUtcMillis = localMidnightUtcMillis(referenceTimezone, year, month, day);
  return Array.from(
    { length: SLOTS_PER_DAY },
    (_, slot) => new Date(dayStartUtcMillis + slot * MINUTES_PER_SLOT * 60000)
  );
}

function buildRow(entry: Entry, settings: AppSettings, slotInstants: Date[]): CoreTimeRow {
  const { start, end } = resolveWorkHours(entry, settings);
  const { days } = resolveWorkDays(entry, settings);
  const daySet = new Set(days);
  const startMinutes = start * 60;
  const endMinutes = end * 60;

  const blocks = slotInstants.map((instant) => {
    const weekday = localWeekday(entry.timezone, instant);
    if (!daySet.has(weekday)) return false;
    const minutes = localMinutesOfDay(entry.timezone, instant);
    return minutes >= startMinutes && minutes < endMinutes;
  });

  const localDate = localDateKey(entry.timezone, slotInstants[0]);
  const crossesDay = slotInstants.some(
    (instant) => localDateKey(entry.timezone, instant) !== localDate
  );

  return { entryId: entry.id, blocks, localDate, crossesDay };
}

// Intersection of every row's working slots, collapsed into contiguous ranges.
function computeOverlapRanges(rows: CoreTimeRow[]): CoreTimeOverlapRange[] {
  if (rows.length === 0) return [];

  const ranges: CoreTimeOverlapRange[] = [];
  let start: number | null = null;
  for (let slot = 0; slot <= SLOTS_PER_DAY; slot++) {
    const isOverlap = slot < SLOTS_PER_DAY && rows.every((row) => row.blocks[slot]);
    if (isOverlap && start === null) {
      start = slot;
    } else if (!isOverlap && start !== null) {
      ranges.push({ startSlot: start, endSlot: slot });
      start = null;
    }
  }
  return ranges;
}

// Minutes an entry's local time is outside its own working window at `instant`.
// Infinity when the entry's local weekday isn't a work day at all (including
// an entry with an empty workDays list, which never has a valid window).
function deviationMinutes(entry: Entry, settings: AppSettings, instant: Date): number {
  const { start, end } = resolveWorkHours(entry, settings);
  const { days } = resolveWorkDays(entry, settings);
  const weekday = localWeekday(entry.timezone, instant);
  if (!days.includes(weekday)) return Infinity;

  const minutes = localMinutesOfDay(entry.timezone, instant);
  const startMinutes = start * 60;
  const endMinutes = end * 60;
  if (minutes >= startMinutes && minutes < endMinutes) return 0;
  return minutes < startMinutes ? startMinutes - minutes : minutes - endMinutes;
}

// Reference-axis slot minimizing the sum of every entry's deviation from its
// own working window. Ties broken by earliest slot. Null when no slot has a
// finite total (e.g. an entry with no valid work day anywhere on this axis).
function computeClosest(
  entries: Entry[],
  settings: AppSettings,
  slotInstants: Date[]
): CoreTimeClosest | null {
  let best: { slot: number; total: number; perEntry: CoreTimeClosestPerEntry[] } | null = null;

  for (let slot = 0; slot < slotInstants.length; slot++) {
    const instant = slotInstants[slot];
    const perEntry: CoreTimeClosestPerEntry[] = [];
    let total = 0;
    let valid = true;

    for (const entry of entries) {
      const deviation = deviationMinutes(entry, settings, instant);
      if (!Number.isFinite(deviation)) {
        valid = false;
        break;
      }
      total += deviation;
      perEntry.push({
        entryId: entry.id,
        localTime: localHHMM(entry.timezone, instant),
        deviationMinutes: deviation,
      });
    }

    if (!valid) continue;
    if (best === null || total < best.total) {
      best = { slot, total, perEntry };
    }
  }

  if (best === null) return null;

  return {
    refTime: formatHHMM(best.slot * MINUTES_PER_SLOT),
    perEntry: best.perEntry,
    gapMinutes: Math.max(...best.perEntry.map((p) => p.deviationMinutes)),
  };
}

const MAX_LOOKAHEAD_DAYS = 7;

// Whether `entry`'s own local calendar date, right now, is one of its work
// days — independent of work *hours*. Evaluated at the single instant
// `referenceDate` (not scanned across the reference axis), which is what
// keeps this immune to the boundary artifact where an offset entry's axis
// briefly grazes a workday slot from the tail end of yesterday.
function isOnWorkdayToday(entry: Entry, settings: AppSettings, referenceDate: Date): boolean {
  const { days } = resolveWorkDays(entry, settings);
  return days.includes(localWeekday(entry.timezone, referenceDate));
}

// First of the next `MAX_LOOKAHEAD_DAYS` reference-timezone calendar days
// with a non-empty overlap. Each candidate day gets its own full 48-slot
// axis and row/overlap computation, same as `coreTime` does for today.
function findNextOverlap(
  entries: Entry[],
  settings: AppSettings,
  referenceTimezone: string,
  referenceDate: Date
): CoreTimeNextOverlap | null {
  for (let daysFromToday = 1; daysFromToday <= MAX_LOOKAHEAD_DAYS; daysFromToday++) {
    const { year, month, day } = addLocalCalendarDays(referenceTimezone, referenceDate, daysFromToday);
    const dayAnchor = new Date(localMidnightUtcMillis(referenceTimezone, year, month, day));
    const slotInstants = buildSlotInstants(referenceTimezone, dayAnchor);
    const rows = entries.map((entry) => buildRow(entry, settings, slotInstants));
    const overlap = computeOverlapRanges(rows);

    if (overlap.length > 0) {
      return {
        daysFromToday,
        weekday: localWeekday(referenceTimezone, dayAnchor),
        startSlot: overlap[0].startSlot,
        endSlot: overlap[0].endSlot,
      };
    }
  }
  return null;
}

function computeConclusion(
  entries: Entry[],
  settings: AppSettings,
  referenceTimezone: string,
  referenceDate: Date,
  overlap: CoreTimeOverlapRange[],
  slotInstants: Date[]
): CoreTimeConclusion {
  if (entries.length === 0) return { status: 'NO_ENTRIES' };
  if (overlap.length > 0) return { status: 'OVERLAP' };

  const offEntryIds = entries
    .filter((entry) => !isOnWorkdayToday(entry, settings, referenceDate))
    .map((entry) => entry.id);

  if (offEntryIds.length === entries.length) {
    return {
      status: 'ALL_OFF',
      offEntryIds,
      nextOverlap: findNextOverlap(entries, settings, referenceTimezone, referenceDate),
    };
  }

  if (offEntryIds.length > 0) {
    const offSet = new Set(offEntryIds);
    const workingEntryIds = entries.map((entry) => entry.id).filter((id) => !offSet.has(id));
    return {
      status: 'PARTIAL_OFF',
      workingEntryIds,
      offEntryIds,
      nextOverlap: findNextOverlap(entries, settings, referenceTimezone, referenceDate),
    };
  }

  // Every entry is on its own work day today, so some slot on this axis
  // should satisfy all of them simultaneously — computeClosest returning
  // null here means the assumption broke (e.g. an extreme-offset pairing
  // where "today" never actually overlaps for everyone at once). That's a
  // bug, not a UI state: log it and let the caller fall back to NO_ENTRIES.
  const closest = computeClosest(entries, settings, slotInstants);
  if (!closest) {
    console.error(
      'coreTime: computeClosest returned null although every entry is on its work day today',
      { entries: entries.map((entry) => ({ id: entry.id, timezone: entry.timezone })), referenceTimezone }
    );
    return { status: 'NO_ENTRIES' };
  }
  return { status: 'NO_OVERLAP_TODAY', closest };
}

export function coreTime({ entries, settings, referenceDate }: CoreTimeInput): CoreTimeResult {
  const referenceTimezone = settings.referenceTimezone ?? getSystemTimezone();
  const slotInstants = buildSlotInstants(referenceTimezone, referenceDate);

  const axis: CoreTimeAxisSlot[] = slotInstants.map((_, slot) => ({
    slot,
    refTime: formatHHMM(slot * MINUTES_PER_SLOT),
  }));

  const rows = entries.map((entry) => buildRow(entry, settings, slotInstants));
  const overlap = computeOverlapRanges(rows);
  const conclusion = computeConclusion(
    entries,
    settings,
    referenceTimezone,
    referenceDate,
    overlap,
    slotInstants
  );

  return { axis, rows, overlap, conclusion };
}
