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
  // entry.includeInCoreTime. An excluded entry still gets its row, so the
  // panel can show it dimmed rather than hide it, but it takes no part in
  // the overlap or the conclusion.
  included: boolean;
  blocks: boolean[];
  localDate: string;
  crossesDay: boolean;
}

export interface CoreTimeOverlapRange {
  startSlot: number;
  endSlot: number;
}

// Which side of its own work window an entry is on; null while inside it.
export type WorkWindowDirection = 'BEFORE_START' | 'AFTER_END';

export interface CoreTimeClosestPerEntry {
  entryId: string;
  localTime: string;
  deviationMinutes: number;
  direction: WorkWindowDirection | null;
}

export interface CoreTimeClosest {
  refTime: string;
  perEntry: CoreTimeClosestPerEntry[];
  // The largest single deviation at refTime — the bottleneck entry's. Always
  // > 0: a slot where every deviation is 0 is an overlap slot, and then the
  // conclusion is OVERLAP, not NO_OVERLAP_TODAY.
  gapMinutes: number;
  // Every entry at gapMinutes, in list order. More than one on a tie — and
  // then none of them alone is "the" bottleneck: excluding one wouldn't
  // close the gap, so the UI must not name just one.
  bottleneckEntryIds: string[];
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
  // Everyone is on a work day and the full overlap is empty, but dropping
  // exactly one entry — the one outlier — leaves a non-empty one. Not the
  // same thing as PARTIAL_OFF: that's someone off today (workDays), this is
  // work *hours* that don't line up. `overlap` is the subset's.
  | {
      status: 'PARTIAL_OVERLAP';
      overlap: CoreTimeOverlapRange[];
      includedIds: string[];
      excludedId: string;
    }
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
  // The whole list, in list order. Only entries with includeInCoreTime take
  // part in the overlap and the conclusion; every entry gets a row.
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

interface WorkWindowPosition {
  deviationMinutes: number;
  direction: WorkWindowDirection | null;
}

// The one definition of "is this entry working at `instant`" (§5.2 rule 3:
// local weekday ∈ workDays and local time ∈ [start, end)). Rows, the overlap
// and closest all derive from it, so a slot is a working slot exactly when
// its deviation is 0. Null when the local weekday isn't a work day at all
// (including an empty workDays list): no finite deviation exists.
//
// Outside the window, the deviation is how far a meeting starting at this
// slot sits outside the entry's day: how early it starts before `start`, or
// how far its one-slot length runs past `end`. That's what keeps a slot
// starting exactly at `end` — outside [start, end) — from counting as 0.
function workWindowPosition(
  entry: Entry,
  settings: AppSettings,
  instant: Date
): WorkWindowPosition | null {
  const { start, end } = resolveWorkHours(entry, settings);
  const { days } = resolveWorkDays(entry, settings);
  if (!days.includes(localWeekday(entry.timezone, instant))) return null;

  const minutes = localMinutesOfDay(entry.timezone, instant);
  const startMinutes = start * 60;
  const endMinutes = end * 60;
  if (minutes < startMinutes) {
    return { deviationMinutes: startMinutes - minutes, direction: 'BEFORE_START' };
  }
  if (minutes >= endMinutes) {
    return { deviationMinutes: minutes + MINUTES_PER_SLOT - endMinutes, direction: 'AFTER_END' };
  }
  return { deviationMinutes: 0, direction: null };
}

function buildRow(entry: Entry, settings: AppSettings, slotInstants: Date[]): CoreTimeRow {
  const blocks = slotInstants.map(
    (instant) => workWindowPosition(entry, settings, instant)?.deviationMinutes === 0
  );

  const localDate = localDateKey(entry.timezone, slotInstants[0]);
  const crossesDay = slotInstants.some(
    (instant) => localDateKey(entry.timezone, instant) !== localDate
  );

  return { entryId: entry.id, included: entry.includeInCoreTime, blocks, localDate, crossesDay };
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

// Reference-axis slot minimizing the sum of every entry's deviation from its
// own working window. Ties broken by earliest slot. Null when no slot has a
// finite total (e.g. an entry with no valid work day anywhere on this axis).
// The bottleneck is the entry with the largest deviation at that slot; on a
// tie, all of them.
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
      const position = workWindowPosition(entry, settings, instant);
      if (position === null) {
        valid = false;
        break;
      }
      total += position.deviationMinutes;
      perEntry.push({
        entryId: entry.id,
        localTime: localHHMM(entry.timezone, instant),
        deviationMinutes: position.deviationMinutes,
        direction: position.direction,
      });
    }

    if (!valid) continue;
    if (best === null || total < best.total) {
      best = { slot, total, perEntry };
    }
  }

  if (best === null) return null;

  const gapMinutes = Math.max(...best.perEntry.map((p) => p.deviationMinutes));

  return {
    refTime: formatHHMM(best.slot * MINUTES_PER_SLOT),
    perEntry: best.perEntry,
    gapMinutes,
    bottleneckEntryIds: best.perEntry
      .filter((p) => p.deviationMinutes === gapMinutes)
      .map((p) => p.entryId),
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

// Leave-one-out: drop each row in turn and recompute the overlap of the rest.
// Returns the PARTIAL_OVERLAP conclusion only when exactly one drop works —
// several candidates means no single outlier to name, none means it isn't
// one city's fault; both fall back to closest. Deliberately no search for
// the largest workable subset: that's exponential in the number of cities
// and not something the panel could explain in a sentence. Needs three
// rows: "all but X" with two cities is just the other city's own hours.
function findSingleOutlier(
  rows: CoreTimeRow[]
): Extract<CoreTimeConclusion, { status: 'PARTIAL_OVERLAP' }> | null {
  if (rows.length < 3) return null;

  let found: Extract<CoreTimeConclusion, { status: 'PARTIAL_OVERLAP' }> | null = null;
  for (let i = 0; i < rows.length; i++) {
    const rest = rows.filter((_, j) => j !== i);
    const overlap = computeOverlapRanges(rest);
    if (overlap.length === 0) continue;
    if (found) return null;
    found = {
      status: 'PARTIAL_OVERLAP',
      overlap,
      includedIds: rest.map((row) => row.entryId),
      excludedId: rows[i].entryId,
    };
  }
  return found;
}

function computeConclusion(
  entries: Entry[],
  settings: AppSettings,
  referenceTimezone: string,
  referenceDate: Date,
  rows: CoreTimeRow[],
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

  // Everyone's on a work day, so the empty overlap is the hours. With several
  // cities that's usually one outlier.
  const partialOverlap = findSingleOutlier(rows);
  if (partialOverlap) return partialOverlap;

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
  const includedEntries = entries.filter((entry) => entry.includeInCoreTime);
  const includedRows = rows.filter((row) => row.included);
  const overlap = computeOverlapRanges(includedRows);
  const conclusion = computeConclusion(
    includedEntries,
    settings,
    referenceTimezone,
    referenceDate,
    includedRows,
    overlap,
    slotInstants
  );

  return { axis, rows, overlap, conclusion };
}
