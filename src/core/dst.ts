import type { AppSettings, Entry } from './types';
import {
  addLocalCalendarDays,
  canonicalZone,
  getSystemTimezone,
  localDateKey,
  localWallClockUtcMillis,
  offsetMinutes,
  relativeOffsetMinutes,
} from './tz';

// One zone's own clock change (spec §6.1).
export interface DstTransition {
  date: string; // YYYY-MM-DD, the zone's own local calendar date the new offset takes effect
  daysFromNow: number; // in the zone's own calendar, 0 = later today
  at: number; // the instant of the change, epoch ms, to the minute
  offsetBeforeMinutes: number;
  offsetAfterMinutes: number;
  deltaMinutes: number; // signed: offsetAfter - offsetBefore, never assumed
}

// Who moves when the gap to the reference changes: the city ("entry", the
// reference keeps its clock — a one-sided switch), the reference ("you"), or
// both on the same day by different amounts.
export type DstMover = 'entry' | 'reference' | 'both';

// The next change in how far an entry is from the reference — what the alert
// is about (spec §6.2: the relation, not the zone's policy).
export interface GapChange {
  mover: DstMover;
  at: number; // the instant of the change, epoch ms
  date: string; // YYYY-MM-DD in the reference's calendar
  daysFromNow: number; // in the reference's calendar, 0 = later today
  gapBeforeMinutes: number; // entry minus reference, signed, as the card's relative offset
  gapAfterMinutes: number;
  entryOffsetAfterMinutes: number;
  referenceOffsetAfterMinutes: number;
  // The switches behind it, as dstSwitchKey() names them — what dismissing
  // the banner records.
  switchKeys: string[];
}

export interface EntryDstResult {
  entryId: string;
  timezone: string;
  transition: DstTransition | null; // the entry's own clock change
  gapChange: GapChange | null;
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
  // Now. Changes at or before it are over and not reported.
  fromDate: Date;
  leadDays?: number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

function dateKey({ year, month, day }: { year: number; month: number; day: number }): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function epochDay(key: string): number {
  return Date.parse(`${key}T00:00:00Z`) / DAY;
}

function localNoon(timezone: string, fromDate: Date, days: number): number {
  const { year, month, day } = addLocalCalendarDays(timezone, fromDate, days);
  return localWallClockUtcMillis(timezone, year, month, day, 12, 0);
}

// The minute the offset changes between two instants known to be on either
// side of it: bisect until they're a minute apart. Clock changes fall on a
// whole minute, and the last minute boundary at or before `after` is it.
function changeInstant(timezone: string, before: number, after: number): number {
  const offsetBefore = offsetMinutes(timezone, new Date(before));
  let lo = before;
  let hi = after;
  while (hi - lo > MINUTE) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (offsetMinutes(timezone, new Date(mid)) === offsetBefore) lo = mid;
    else hi = mid;
  }
  return Math.floor(hi / MINUTE) * MINUTE;
}

// Walks forward day by day from today sampling this zone's own local-noon
// offset; a change between two consecutive days marks a transition (spec
// §6.1). Today is compared with yesterday, so a change later today counts;
// one already past doesn't. Direction always comes from the actual signed
// delta — never assume "falls back" or "springs forward", since southern-
// hemisphere zones move opposite the northern ones.
export function detectZoneTransition(
  timezone: string,
  fromDate: Date,
  leadDays: number
): DstTransition | null {
  let previousNoon = localNoon(timezone, fromDate, -1);
  let previousOffset = offsetMinutes(timezone, new Date(previousNoon));

  for (let day = 0; day <= leadDays; day++) {
    const noon = localNoon(timezone, fromDate, day);
    const offset = offsetMinutes(timezone, new Date(noon));
    if (offset !== previousOffset) {
      const at = changeInstant(timezone, previousNoon, noon);
      if (at > fromDate.getTime()) {
        return {
          date: dateKey(addLocalCalendarDays(timezone, fromDate, day)),
          daysFromNow: day,
          at,
          offsetBeforeMinutes: previousOffset,
          offsetAfterMinutes: offset,
          deltaMinutes: offset - previousOffset,
        };
      }
    }
    previousNoon = noon;
    previousOffset = offset;
  }
  return null;
}

// Names one zone's switch: same zone (whatever it's called) and same local
// date is the same switch. Dismissing the banner stores these (spec §6.3).
export function dstSwitchKey(timezone: string, transition: DstTransition): string {
  return `${canonicalZone(timezone)}@${transition.date}`;
}

// The next change in the gap between an entry and the reference. Either can
// move, or both. Two switches less than a day apart count as one change
// (New York and Chicago switch an hour apart; their gap is the same after),
// and if they cancel out there is none — an entry in the reference's own
// zone, or London against Berlin, never changes.
function gapChangeOf(
  entryZone: string,
  entryTransition: DstTransition | null,
  referenceZone: string,
  referenceTransition: DstTransition | null,
  fromDate: Date,
  leadDays: number
): GapChange | null {
  const switches = [
    entryTransition && { mover: 'entry' as const, zone: entryZone, transition: entryTransition },
    referenceTransition && { mover: 'reference' as const, zone: referenceZone, transition: referenceTransition },
  ]
    .filter((s) => s !== null)
    .sort((a, b) => a.transition.at - b.transition.at);
  if (switches.length === 0) return null;

  const first = switches[0].transition.at;
  const together = switches.filter((s) => s.transition.at - first < DAY);
  const last = together[together.length - 1].transition.at;

  const gapBeforeMinutes = relativeOffsetMinutes(entryZone, referenceZone, new Date(first - MINUTE));
  const gapAfterMinutes = relativeOffsetMinutes(entryZone, referenceZone, new Date(last));
  if (gapBeforeMinutes === gapAfterMinutes) return null;

  const date = localDateKey(referenceZone, new Date(first));
  const daysFromNow = epochDay(date) - epochDay(localDateKey(referenceZone, fromDate));
  if (daysFromNow > leadDays) return null;

  return {
    mover: together.length > 1 ? 'both' : together[0].mover,
    at: first,
    date,
    daysFromNow,
    gapBeforeMinutes,
    gapAfterMinutes,
    entryOffsetAfterMinutes: offsetMinutes(entryZone, new Date(last)),
    referenceOffsetAfterMinutes: offsetMinutes(referenceZone, new Date(last)),
    switchKeys: together.map((s) => dstSwitchKey(s.zone, s.transition)),
  };
}

// Detects upcoming DST transitions for every entry and for the reference
// timezone itself, and from the two the next change in each entry's gap to
// the reference — which catches one-sided switches: the reference zone
// doesn't observe DST but an entry does, or the other way round.
export function detectDstTransitions({
  entries,
  settings,
  fromDate,
  leadDays,
}: DstDetectionInput): DstDetectionResult {
  const lead = leadDays ?? settings.dstLeadDays;
  const referenceTimezone = settings.referenceTimezone ?? getSystemTimezone();
  const referenceTransition = detectZoneTransition(referenceTimezone, fromDate, lead);

  // Many entries share a zone; each zone is walked once.
  const byZone = new Map<string, DstTransition | null>();
  const transitionOf = (zone: string) => {
    if (!byZone.has(zone)) byZone.set(zone, detectZoneTransition(zone, fromDate, lead));
    return byZone.get(zone)!;
  };

  return {
    reference: { timezone: referenceTimezone, transition: referenceTransition },
    entries: entries.map((entry) => {
      const transition = transitionOf(entry.timezone);
      return {
        entryId: entry.id,
        timezone: entry.timezone,
        transition,
        gapChange: gapChangeOf(entry.timezone, transition, referenceTimezone, referenceTransition, fromDate, lead),
      };
    }),
  };
}
