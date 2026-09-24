import type { AppSettings, Entry } from './types';
import { addLocalCalendarDays, getSystemTimezone, localWallClockUtcMillis, offsetMinutes } from './tz';

export interface DstTransition {
  date: string; // YYYY-MM-DD, the zone's own local calendar date the new offset takes effect
  daysFromNow: number;
  offsetBeforeMinutes: number;
  offsetAfterMinutes: number;
  deltaMinutes: number; // signed: offsetAfter - offsetBefore, never assumed
}

export interface EntryDstResult {
  entryId: string;
  timezone: string;
  transition: DstTransition | null;
}

export interface ReferenceDstResult {
  timezone: string;
  transition: DstTransition | null;
}

export interface DstDetectionResult {
  reference: ReferenceDstResult;
  entries: EntryDstResult[];
}

export interface DstDetectionInput {
  entries: Entry[];
  settings: AppSettings;
  fromDate: Date;
  leadDays?: number;
}

function offsetAtLocalNoon(timezone: string, year: number, month: number, day: number): number {
  const instant = localWallClockUtcMillis(timezone, year, month, day, 12, 0);
  return offsetMinutes(timezone, new Date(instant));
}

// Walks forward day by day sampling this zone's own local-noon offset; a
// change between two consecutive days marks a transition. Direction always
// comes from the actual signed delta — never assume "falls back" or "springs
// forward", since southern-hemisphere zones move opposite the northern ones.
function detectZoneTransition(
  timezone: string,
  fromDate: Date,
  leadDays: number
): DstTransition | null {
  const start = addLocalCalendarDays(timezone, fromDate, 0);
  let previousOffset = offsetAtLocalNoon(timezone, start.year, start.month, start.day);

  for (let day = 1; day <= leadDays; day++) {
    const { year, month, day: d } = addLocalCalendarDays(timezone, fromDate, day);
    const offset = offsetAtLocalNoon(timezone, year, month, d);
    if (offset !== previousOffset) {
      return {
        date: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        daysFromNow: day,
        offsetBeforeMinutes: previousOffset,
        offsetAfterMinutes: offset,
        deltaMinutes: offset - previousOffset,
      };
    }
    previousOffset = offset;
  }
  return null;
}

// Detects upcoming DST transitions for every entry and for the reference
// timezone itself (catching one-sided transitions, where the reference zone
// doesn't observe DST but an entry does, or vice versa).
export function detectDstTransitions({
  entries,
  settings,
  fromDate,
  leadDays,
}: DstDetectionInput): DstDetectionResult {
  const window = leadDays ?? settings.dstLeadDays;
  const referenceTimezone = settings.referenceTimezone ?? getSystemTimezone();

  return {
    reference: {
      timezone: referenceTimezone,
      transition: detectZoneTransition(referenceTimezone, fromDate, window),
    },
    entries: entries.map((entry) => ({
      entryId: entry.id,
      timezone: entry.timezone,
      transition: detectZoneTransition(entry.timezone, fromDate, window),
    })),
  };
}
