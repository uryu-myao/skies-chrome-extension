export const SLOTS_PER_DAY = 48;
export const MINUTES_PER_SLOT = 30;

// The only sanctioned way to get a timezone's UTC offset — computed per
// specific date, never cached, never hardcoded. On a DST-transition day the
// AM/PM offsets for the same zone differ, which is why `date` is required.
export function offsetMinutes(timezone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const asUTC = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour % 24,
    +parts.minute,
    +parts.second
  );
  return (asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}

export function localMinutesOfDay(timezone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value])
  ) as Record<string, string>;
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
}

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export function localDateParts(timezone: string, date: Date): LocalDateParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value])
  ) as Record<string, string>;
  return { year: +parts.year, month: +parts.month, day: +parts.day };
}

// Local weekday, 0=Sunday..6=Saturday — matches Date.getDay(). Never derived
// from the reference timezone's weekday; always computed per-entry.
export function localWeekday(timezone: string, date: Date): number {
  const { year, month, day } = localDateParts(timezone, date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function localDateKey(timezone: string, date: Date): string {
  const { year, month, day } = localDateParts(timezone, date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getSystemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// UTC instant of a given local wall-clock time for Y-M-D in `timezone`.
// Two-step guess-and-correct: offsetMinutes is evaluated at a nearby guess
// instant, which is exact except in the rare case a DST transition falls
// within minutes of the target wall-clock time itself — one extra
// correction pass covers that.
export function localWallClockUtcMillis(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): number {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 2; i++) {
    const offset = offsetMinutes(timezone, new Date(guess));
    const corrected = Date.UTC(year, month - 1, day, hour, minute, 0) - offset * 60000;
    if (corrected === guess) break;
    guess = corrected;
  }
  return guess;
}

export function localMidnightUtcMillis(
  timezone: string,
  year: number,
  month: number,
  day: number
): number {
  return localWallClockUtcMillis(timezone, year, month, day, 0, 0);
}

// Adds `days` calendar days to date's local Y-M-D in `timezone`, using
// UTC-based epoch-day arithmetic so it never trips over the zone's own DST.
export function addLocalCalendarDays(timezone: string, date: Date, days: number): LocalDateParts {
  const { year, month, day } = localDateParts(timezone, date);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86400000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function slotToMinutes(slot: number): number {
  return slot * MINUTES_PER_SLOT;
}

export function minutesToSlot(minutes: number): number {
  return Math.floor(minutes / MINUTES_PER_SLOT);
}

export function formatHHMM(minutesOfDay: number): string {
  const wrapped = ((minutesOfDay % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function localHHMM(timezone: string, date: Date): string {
  return formatHHMM(localMinutesOfDay(timezone, date));
}

export type TimeOfDay = 'night' | 'dawn' | 'day' | 'twilight';

export interface SunWindow {
  sunriseMinutes: number;
  sunsetMinutes: number;
}

const TWILIGHT_MINUTES = 45;

// Falls back to a generic 6:00/18:00 sunrise/sunset when no sun window is
// available (no lat/lon for the zone — e.g. the header's reference-timezone
// chip, which only ever has an IANA id to work with).
export function timeOfDay(timezone: string, date: Date, sun: SunWindow | null = null): TimeOfDay {
  const nowMin = localMinutesOfDay(timezone, date);
  const sunriseMinutes = sun?.sunriseMinutes ?? 360;
  const sunsetMinutes = sun?.sunsetMinutes ?? 1080;

  if (nowMin >= sunriseMinutes + TWILIGHT_MINUTES && nowMin <= sunsetMinutes - TWILIGHT_MINUTES) {
    return 'day';
  }
  if (nowMin >= sunriseMinutes - TWILIGHT_MINUTES && nowMin <= sunriseMinutes + TWILIGHT_MINUTES) {
    return 'dawn';
  }
  if (nowMin >= sunsetMinutes - TWILIGHT_MINUTES && nowMin <= sunsetMinutes + TWILIGHT_MINUTES) {
    return 'twilight';
  }
  return 'night';
}
