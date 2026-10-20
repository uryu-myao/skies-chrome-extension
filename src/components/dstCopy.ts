import type { GapChange } from '../core/dst';
import { formatRelativeOffset, formatUtcOffset } from '../core/tz';

// The DST banner's and card badge's wording (spec §6.2). "You" is the
// subject and the gap is the news; the zone's policy isn't. Never "falls
// back" or "an hour earlier": Sydney moves forward in October, Lord Howe by
// 30 minutes. A zone is named by its UTC offset, never an abbreviation like
// EST (spec §4.2).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-11-01" → "Nov 1".
export function shortDate(dateKey: string): string {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}`;
}

function when(change: GapChange): string {
  const date = shortDate(change.date);
  if (change.daysFromNow <= 0) return `Later today (${date})`;
  if (change.daysFromNow === 1) return `Tomorrow (${date})`;
  return `In ${change.daysFromNow} days (${date})`;
}

function hours(minutes: number): string {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (m) return `${h}:${String(m).padStart(2, '0')} hours`;
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

// "13 hours → 14 hours". How far apart, not which way — unless the change
// flips which side is ahead, when the size alone could read "1 hour → 1 hour".
export function gapChangeText(before: number, after: number): string {
  if (before * after < 0) {
    const side = (minutes: number) => `${hours(minutes)} ${minutes > 0 ? 'ahead' : 'behind'}`;
    return `${side(before)} → ${side(after)}`;
  }
  return `${hours(before)} → ${hours(after)}`;
}

export interface DstBannerCopy {
  headline: string;
  detail: string;
}

// `city` is the entry's label. Each wording says who moves on that date and
// who doesn't: a one-sided switch is the case the user can't see coming.
export function dstBannerCopy(change: GapChange, city: string): DstBannerCopy {
  const gap = gapChangeText(change.gapBeforeMinutes, change.gapAfterMinutes);
  switch (change.mover) {
    case 'entry':
      return {
        headline: `${when(change)}, ${city} shifts to ${formatUtcOffset(change.entryOffsetAfterMinutes)} — your clock doesn’t.`,
        detail: `Your gap: ${gap}`,
      };
    case 'reference':
      return {
        headline: `${when(change)}, your clock shifts to ${formatUtcOffset(change.referenceOffsetAfterMinutes)} — ${city}’s doesn’t.`,
        detail: `Your gap with ${city}: ${gap}`,
      };
    case 'both':
      return {
        headline: `${when(change)}, your clock and ${city}’s both shift.`,
        detail: `Your gap: ${gap}`,
      };
  }
}

// The card's passive marker (spec §6.3, layer 1): the date and what the
// card's own relative offset becomes, "Nov 1 → −14h".
export function dstBadgeText(change: GapChange): string {
  return `${shortDate(change.date)} → ${formatRelativeOffset(change.gapAfterMinutes)}`;
}

export function dstBadgeDescription(change: GapChange): string {
  return `Gap changes on ${shortDate(change.date)}: ${formatRelativeOffset(change.gapBeforeMinutes)} → ${formatRelativeOffset(change.gapAfterMinutes)}`;
}
