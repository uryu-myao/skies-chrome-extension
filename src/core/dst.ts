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
  daysFromNow: number; // in the zone's own calendar: 0 = today, negative = past
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
  daysFromNow: number; // in the reference's calendar: 0 = today, −1 = yesterday
  // Already happened (at ≤ now). Shown on the day of the change and the day
  // after, in the past tense — the first meetings on the new gap are when
  // it's easiest to get wrong, and the switches fall on weekends.
  inEffect: boolean;
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
  transition: DstTransition | null; // the entry's own next clock change
  // Every change in its gap to the reference from yesterday to the end of
  // the window, soonest first — Berlin on Oct 25, then Boston on Nov 1.
  gapChanges: GapChange[];
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
  // Now. A change at or before it is in effect: kept in gapChanges for the
  // day of the change and the day after, never as the next `transition`.
  fromDate: Date;
  leadDays?: number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;
// A gap change stays on show for the day it happens and the day after, in
// the reference's calendar (spec §6.3).
const IN_EFFECT_DAYS = 2;
// How far back each zone is walked to find those: a zone's date can be a day
// either side of the reference's.
const LOOKBACK_DAYS = IN_EFFECT_DAYS + 1;

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

// Walks day by day sampling this zone's own local-noon offset; a change
// between two consecutive days marks a transition (spec §6.1). Day `fromDay`
// is compared with the day before it, so with fromDay 0 a change later today
// counts. Direction always comes from the actual signed delta — never assume
// "falls back" or "springs forward", since southern-hemisphere zones move
// opposite the northern ones.
function zoneTransitions(timezone: string, fromDate: Date, fromDay: number, leadDays: number): DstTransition[] {
  const transitions: DstTransition[] = [];
  let previousNoon = localNoon(timezone, fromDate, fromDay - 1);
  let previousOffset = offsetMinutes(timezone, new Date(previousNoon));

  for (let day = fromDay; day <= leadDays; day++) {
    const noon = localNoon(timezone, fromDate, day);
    const offset = offsetMinutes(timezone, new Date(noon));
    if (offset !== previousOffset) {
      transitions.push({
        date: dateKey(addLocalCalendarDays(timezone, fromDate, day)),
        daysFromNow: day,
        at: changeInstant(timezone, previousNoon, noon),
        offsetBeforeMinutes: previousOffset,
        offsetAfterMinutes: offset,
        deltaMinutes: offset - previousOffset,
      });
    }
    previousNoon = noon;
    previousOffset = offset;
  }
  return transitions;
}

// The zone's next clock change from now to `leadDays` ahead; one already
// past (earlier today) doesn't count.
export function detectZoneTransition(
  timezone: string,
  fromDate: Date,
  leadDays: number
): DstTransition | null {
  return zoneTransitions(timezone, fromDate, 0, leadDays).find((t) => t.at > fromDate.getTime()) ?? null;
}

// Names one zone's switch: same zone (whatever it's called) and same local
// date is the same switch. Dismissing the banner stores these (spec §6.3).
export function dstSwitchKey(timezone: string, transition: DstTransition): string {
  return `${canonicalZone(timezone)}@${transition.date}`;
}

// The changes in the gap between an entry and the reference. Either can
// move, or both. Two switches less than a day apart count as one change
// (New York and Chicago switch an hour apart; their gap is the same after),
// and if they cancel out there is none — an entry in the reference's own
// zone, or London against Berlin, never changes.
function gapChangesOf(
  entryZone: string,
  entryTransitions: DstTransition[],
  referenceZone: string,
  referenceTransitions: DstTransition[],
  fromDate: Date,
  leadDays: number
): GapChange[] {
  const switches = [
    ...entryTransitions.map((transition) => ({ mover: 'entry' as const, zone: entryZone, transition })),
    ...referenceTransitions.map((transition) => ({ mover: 'reference' as const, zone: referenceZone, transition })),
  ].sort((a, b) => a.transition.at - b.transition.at);

  const changes: GapChange[] = [];
  for (let i = 0; i < switches.length; ) {
    const first = switches[i].transition.at;
    const together = switches.slice(i).filter((s) => s.transition.at - first < DAY);
    i += together.length;
    const last = together[together.length - 1].transition.at;

    const gapBeforeMinutes = relativeOffsetMinutes(entryZone, referenceZone, new Date(first - MINUTE));
    const gapAfterMinutes = relativeOffsetMinutes(entryZone, referenceZone, new Date(last));
    if (gapBeforeMinutes === gapAfterMinutes) continue;

    const date = localDateKey(referenceZone, new Date(first));
    const daysFromNow = epochDay(date) - epochDay(localDateKey(referenceZone, fromDate));
    if (daysFromNow > leadDays || daysFromNow <= -IN_EFFECT_DAYS) continue;

    changes.push({
      mover: together.length > 1 ? 'both' : together[0].mover,
      at: first,
      date,
      daysFromNow,
      inEffect: first <= fromDate.getTime(),
      gapBeforeMinutes,
      gapAfterMinutes,
      entryOffsetAfterMinutes: offsetMinutes(entryZone, new Date(last)),
      referenceOffsetAfterMinutes: offsetMinutes(referenceZone, new Date(last)),
      switchKeys: together.map((s) => dstSwitchKey(s.zone, s.transition)),
    });
  }
  return changes;
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

  // Many entries share a zone; each zone is walked once, from a few days back
  // so a change that just happened is still known.
  const byZone = new Map<string, DstTransition[]>();
  const transitionsOf = (zone: string) => {
    if (!byZone.has(zone)) byZone.set(zone, zoneTransitions(zone, fromDate, -LOOKBACK_DAYS, lead));
    return byZone.get(zone)!;
  };
  const next = (transitions: DstTransition[]) => transitions.find((t) => t.at > fromDate.getTime()) ?? null;
  const referenceTransitions = transitionsOf(referenceTimezone);

  return {
    reference: { timezone: referenceTimezone, transition: next(referenceTransitions) },
    entries: entries.map((entry) => {
      const transitions = transitionsOf(entry.timezone);
      return {
        entryId: entry.id,
        timezone: entry.timezone,
        transition: next(transitions),
        gapChanges: gapChangesOf(entry.timezone, transitions, referenceTimezone, referenceTransitions, fromDate, lead),
      };
    }),
  };
}

// ---- The banner (spec §6.3, layer 2) ---------------------------------------

export interface DstBannerItem {
  entryId: string;
  change: GapChange;
}

// What the banner shows: every change on one day of the reference's
// calendar — the soonest day with anything not yet dismissed (spec §6.3).
export interface DstBannerDay {
  date: string; // YYYY-MM-DD in the reference's calendar
  daysFromNow: number;
  // Every change that day has happened (past tense), some have (today, the
  // rest later), or none yet.
  inEffect: 'all' | 'some' | 'none';
  // Your own clock moves that day. Then every item moves against you, and
  // the banner leads with that rather than with the cities.
  referenceMoves: boolean;
  referenceOffsetAfterMinutes: number;
  items: DstBannerItem[]; // list order
  // Every switch behind the items: closing the banner records them all, so
  // one close covers the day.
  switchKeys: string[];
}

function isDismissed(settings: AppSettings, change: GapChange): boolean {
  const dismissed = settings.dstDismissed ?? [];
  return change.switchKeys.every((key) => dismissed.includes(key));
}

// The banner's day, or null while the banner is turned off or there's
// nothing left to show. Several cities changing the same day — the US on
// Nov 1, or every city when your own clock moves — make one banner, not one
// each.
export function pickDstBanner(result: DstDetectionResult, settings: AppSettings): DstBannerDay | null {
  if (!settings.dstBannerEnabled) return null;
  const pending = result.entries.flatMap(({ entryId, gapChanges }) =>
    gapChanges.filter((change) => !isDismissed(settings, change)).map((change) => ({ entryId, change }))
  );
  if (pending.length === 0) return null;

  const soonest = pending.reduce((a, b) => (b.change.at < a.change.at ? b : a));
  const date = soonest.change.date;
  const items = pending.filter((item) => item.change.date === date);
  const withReference = items.find((item) => item.change.mover !== 'entry');
  const done = items.filter((item) => item.change.inEffect).length;
  return {
    date,
    daysFromNow: soonest.change.daysFromNow,
    inEffect: done === items.length ? 'all' : done > 0 ? 'some' : 'none',
    referenceMoves: withReference !== undefined,
    referenceOffsetAfterMinutes: (withReference ?? soonest).change.referenceOffsetAfterMinutes,
    items,
    switchKeys: [...new Set(items.flatMap((item) => item.change.switchKeys))],
  };
}

// Records the switches behind a dismissed banner, so the same switch doesn't
// come back; another switch still does. Keys for switches that are over are
// dropped on the way, so the list never grows past the few in the window.
export function dismissDstSwitches(settings: AppSettings, keys: string[], now: Date): AppSettings {
  // A key's date is its zone's own, and a change stays on show for
  // IN_EFFECT_DAYS: keep a day of slack either side of that.
  const stale = new Date(now.getTime() - (IN_EFFECT_DAYS + 1) * DAY).toISOString().slice(0, 10);
  const kept = (settings.dstDismissed ?? []).filter((key) => key.slice(key.lastIndexOf('@') + 1) >= stale);
  return { ...settings, dstDismissed: [...new Set([...kept, ...keys])] };
}
