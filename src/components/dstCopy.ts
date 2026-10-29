import type { DstBannerDay, GapChange } from '../core/dst';
import { formatDayMonth, type DateOrder } from '../core/locale';
import { formatRelativeOffset, formatUtcOffset } from '../core/tz';

// The DST banner's and card badge's wording (spec §6.2). "You" is the
// subject and the gap is the news; the zone's policy isn't. Never "falls
// back" or "an hour earlier": Sydney moves forward in October, Lord Howe by
// 30 minutes. A zone is named by its UTC offset, never an abbreviation like
// EST (spec §4.2).

// "2026-11-01" → "Nov 1", or "1 Nov" — in the order Date format picks (spec §9.4).
export function shortDate(dateKey: string, order: DateOrder): string {
  const [, month, day] = dateKey.split('-').map(Number);
  return formatDayMonth(day, month, order);
}

// The banner's wording is built from parts so the banner can set city names
// and times apart from the words around them: a city by weight, a time
// (dates, offsets, gaps) by color.
export interface CopyPart {
  text: string;
  kind: 'plain' | 'city' | 'time';
}
export type CopyLine = CopyPart[];

const city = (text: string): CopyPart => ({ text, kind: 'city' });
const time = (text: string): CopyPart => ({ text, kind: 'time' });

// line`In ${time('12 days')}, …` — the literal text is plain; a value is a
// part, a run of parts, or more plain text.
function line(strings: TemplateStringsArray, ...values: (string | CopyPart | CopyLine)[]): CopyLine {
  const parts: CopyLine = [];
  const push = (part: CopyPart) => {
    if (!part.text) return;
    const last = parts[parts.length - 1];
    if (last && last.kind === 'plain' && part.kind === 'plain') last.text += part.text;
    else parts.push({ ...part });
  };
  strings.forEach((text, i) => {
    push({ text, kind: 'plain' });
    if (i >= values.length) return;
    const value = values[i];
    if (typeof value === 'string') push({ text: value, kind: 'plain' });
    else if (Array.isArray(value)) value.forEach(push);
    else push(value);
  });
  return parts;
}

export function lineText(parts: CopyLine): string {
  return parts.map((part) => part.text).join('');
}

// "In 12 days (Nov 1)", "Later today (Nov 1)" before the change; "Today
// (Nov 1)", "Yesterday (Nov 1)" once it's in effect.
function when(daysFromNow: number, dateKey: string, inEffect: boolean, order: DateOrder): CopyLine {
  const date = time(shortDate(dateKey, order));
  if (daysFromNow < 0) return line`Yesterday (${date})`;
  if (daysFromNow === 0) return inEffect ? line`Today (${date})` : line`Later today (${date})`;
  if (daysFromNow === 1) return line`Tomorrow (${date})`;
  return line`In ${time(`${daysFromNow} days`)} (${date})`;
}

function hours(minutes: number): string {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (m) return `${h}:${String(m).padStart(2, '0')} hours`;
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

const flips = (before: number, after: number) => before * after < 0;
const side = (minutes: number) => (minutes > 0 ? ' ahead' : ' behind');

// "13 hours → 14 hours". How far apart, not which way — unless the change
// flips which side is ahead, when the size alone could read "1 hour → 1 hour".
function gapChangeParts(before: number, after: number): CopyLine {
  if (flips(before, after)) {
    return line`${time(hours(before))}${side(before)} → ${time(hours(after))}${side(after)}`;
  }
  return line`${time(hours(before))} → ${time(hours(after))}`;
}

export function gapChangeText(before: number, after: number): string {
  return lineText(gapChangeParts(before, after));
}

// Once in effect: "14 hours (was 13 hours)".
function gapNowParts(before: number, after: number): CopyLine {
  if (flips(before, after)) {
    return line`${time(hours(after))}${side(after)} (was ${time(hours(before))}${side(before)})`;
  }
  return line`${time(hours(after))} (was ${time(hours(before))})`;
}

export interface DstBannerCopy {
  headline: CopyLine;
  detail: CopyLine;
}

// One city that day: the full wording, saying who moves on that date and
// who doesn't — a one-sided switch is the case the user can't see coming.
function oneCity(change: GapChange, name: string, order: DateOrder): DstBannerCopy {
  const w = when(change.daysFromNow, change.date, change.inEffect, order);
  const entryUtc = time(formatUtcOffset(change.entryOffsetAfterMinutes));
  const referenceUtc = time(formatUtcOffset(change.referenceOffsetAfterMinutes));
  const before = change.gapBeforeMinutes;
  const after = change.gapAfterMinutes;

  if (change.inEffect) {
    const now = gapNowParts(before, after);
    switch (change.mover) {
      case 'entry':
        return { headline: line`${w}, ${city(name)} shifted to ${entryUtc} — your clock didn’t.`, detail: line`Your gap is now ${now}` };
      case 'reference':
        return {
          headline: line`${w}, your clock shifted to ${referenceUtc} — ${city(name)}’s didn’t.`,
          detail: line`Your gap with ${city(name)} is now ${now}`,
        };
      case 'both':
        return { headline: line`${w}, your clock and ${city(name)}’s both shifted.`, detail: line`Your gap is now ${now}` };
    }
  }

  const gap = gapChangeParts(before, after);
  switch (change.mover) {
    case 'entry':
      return { headline: line`${w}, ${city(name)} shifts to ${entryUtc} — your clock doesn’t.`, detail: line`Your gap: ${gap}` };
    case 'reference':
      return {
        headline: line`${w}, your clock shifts to ${referenceUtc} — ${city(name)}’s doesn’t.`,
        detail: line`Your gap with ${city(name)}: ${gap}`,
      };
    case 'both':
      return { headline: line`${w}, your clock and ${city(name)}’s both shift.`, detail: line`Your gap: ${gap}` };
  }
}

function shortHours(minutes: number): string {
  const abs = Math.abs(minutes);
  const m = abs % 60;
  return `${Math.floor(abs / 60)}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

// "13 → 14 h"; "1 h behind → 1 h ahead" when the change flips the side.
export function shortGapText(before: number, after: number): string {
  if (flips(before, after)) {
    const sided = (minutes: number) => `${shortHours(minutes)} h${side(minutes)}`;
    return `${sided(before)} → ${sided(after)}`;
  }
  return `${shortHours(before)} → ${shortHours(after)} h`;
}

// Up to three cities by name; past that, two and "+N more". The badges carry
// every city's own change.
const NAMED_CITIES = 3;

// The banner for one day (spec §6.2, §6.3). `cityOf` gives an entry's label.
// Several cities: when they move, the cities lead and each gap is listed;
// when your clock moves, that leads — every city moves against you then.
// Past tense only once every change that day is in effect; a day with some
// still to come reads "Today …, 4 cities shift".
export function dstBannerCopy(day: DstBannerDay, cityOf: (entryId: string) => string, order: DateOrder): DstBannerCopy {
  if (day.items.length === 1) return oneCity(day.items[0].change, cityOf(day.items[0].entryId), order);

  const done = day.inEffect === 'all';
  const w = when(day.daysFromNow, day.date, day.inEffect !== 'none', order);
  const count = day.items.length;
  if (day.referenceMoves) {
    const utc = time(formatUtcOffset(day.referenceOffsetAfterMinutes));
    return {
      headline: done ? line`${w}, your clock shifted to ${utc}.` : line`${w}, your clock shifts to ${utc}.`,
      detail: done ? line`Gaps changed for ${String(count)} cities` : line`Gaps change for ${String(count)} cities`,
    };
  }
  const named = count > NAMED_CITIES ? day.items.slice(0, NAMED_CITIES - 1) : day.items;
  const detail: CopyLine = [];
  named.forEach(({ entryId, change }, i) => {
    // A no-break space: a city and its gap wrap as one item.
    detail.push(...line`${i ? ' · ' : ''}${city(cityOf(entryId))}\u00a0${time(shortGapText(change.gapBeforeMinutes, change.gapAfterMinutes))}`);
  });
  if (named.length < count) detail.push(...line` · +${String(count - named.length)} more`);
  return {
    headline: done
      ? line`${w}, ${String(count)} cities shifted — your clock didn’t.`
      : line`${w}, ${String(count)} cities shift — your clock doesn’t.`,
    detail,
  };
}

// The card's passive marker (spec §6.3, layer 1): the date and what the
// card's own relative offset becomes, "Nov 1 → −14h".
export function dstBadgeText(change: GapChange, order: DateOrder): string {
  return `${shortDate(change.date, order)} → ${formatRelativeOffset(change.gapAfterMinutes)}`;
}

export function dstBadgeDescription(change: GapChange, order: DateOrder): string {
  return `Gap changes on ${shortDate(change.date, order)}: ${formatRelativeOffset(change.gapBeforeMinutes)} → ${formatRelativeOffset(change.gapAfterMinutes)}`;
}
