import { ZONE_LINKS } from '../data/zoneLinks';

export const SLOTS_PER_DAY = 48;
export const MINUTES_PER_SLOT = 30;

const OFFSET_FIELDS: Intl.DateTimeFormatOptions = {
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};
const TIME_OF_DAY_FIELDS: Intl.DateTimeFormatOptions = {
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
};
const DATE_FIELDS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};

// ---- Zone names (spec §4.2) ------------------------------------------------
// Stored names stay as they are: an entry keeps the name it was added with
// (GeoNames gives current ones), and old data is never rewritten. These three
// decide what a name means when it's compared or handed to Intl.

// The current IANA name for `timezone`: an old or merged name
// (Asia/Calcutta, as Chrome reports India's zone) becomes the name it links
// to (Asia/Kolkata). A name zone.tab still lists is current and stays itself.
// The table is generated from tzdata's `backward` (src/data/zoneLinks.ts).
export function canonicalZone(timezone: string): string {
  return ZONE_LINKS[timezone] ?? timezone;
}

// Whether two names are the same zone. Every comparison of zone names goes
// through this, never === — the system zone can come as Asia/Calcutta while
// the entry says Asia/Kolkata.
export function sameZone(a: string, b: string): boolean {
  return canonicalZone(a) === canonicalZone(b);
}

let namesByCanonical: Map<string, string[]> | null = null;

// Every spelling of `timezone`'s zone: the name itself, the current name,
// then the old names that link to it.
function spellingsOf(timezone: string): string[] {
  if (!namesByCanonical) {
    namesByCanonical = new Map();
    for (const [name, current] of Object.entries(ZONE_LINKS)) {
      namesByCanonical.set(current, [...(namesByCanonical.get(current) ?? []), name]);
    }
  }
  const canonical = canonicalZone(timezone);
  return [...new Set([timezone, canonical, ...(namesByCanonical.get(canonical) ?? [])])];
}

// The first spelling of `timezone` that `accepts` takes, or the name itself
// if none does. Pure, for tests; toIntlZone() asks the real Intl.
export function resolveIntlZone(timezone: string, accepts: (name: string) => boolean): string {
  return spellingsOf(timezone).find(accepts) ?? timezone;
}

function intlAccepts(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

const intlNames = new Map<string, string>();

// The name to hand Intl for `timezone`. An engine that predates a rename
// (Europe/Kyiv is 2022) rejects the new name; then an old spelling of the same
// zone it does know is used instead — same rules since 1970, same times.
// Every Intl call with a zone goes through this. The answer is cached per
// name: it's which spelling this engine understands, fixed for the session
// and independent of any date — not an offset or a local date, which §4.2
// forbids caching.
export function toIntlZone(timezone: string): string {
  let name = intlNames.get(timezone);
  if (name === undefined) {
    name = resolveIntlZone(timezone, intlAccepts);
    intlNames.set(timezone, name);
  }
  return name;
}

const formatters = new Map<Intl.DateTimeFormatOptions, Map<string, Intl.DateTimeFormat>>();

// One formatter per (fields, zone), reused. A formatter holds only the zone
// and which fields to print — every answer is still computed from the date
// passed to each call, so no offset or date is cached (§4.2). What's saved
// is building it: ~21µs new vs ~1.4µs reused, and one coreTime() makes
// thousands of these calls.
function formatterFor(fields: Intl.DateTimeFormatOptions, timezone: string): Intl.DateTimeFormat {
  let byZone = formatters.get(fields);
  if (!byZone) {
    byZone = new Map();
    formatters.set(fields, byZone);
  }
  let dtf = byZone.get(timezone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', { ...fields, timeZone: toIntlZone(timezone) });
    byZone.set(timezone, dtf);
  }
  return dtf;
}

// The only sanctioned way to get a timezone's UTC offset — computed per
// specific date, never cached, never hardcoded. On a DST-transition day the
// AM/PM offsets for the same zone differ, which is why `date` is required.
export function offsetMinutes(timezone: string, date: Date): number {
  const dtf = formatterFor(OFFSET_FIELDS, timezone);
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

// How far `timezone` is ahead of (+) or behind (−) the reference timezone at
// `date`. Same rule as offsetMinutes: per specific date, never cached — a
// pair like Tokyo/Berlin is 8h apart in winter and 7h in summer.
export function relativeOffsetMinutes(timezone: string, referenceTimezone: string, date: Date): number {
  return offsetMinutes(timezone, date) - offsetMinutes(referenceTimezone, date);
}

const MINUS_SIGN = '−';

function splitSignedMinutes(minutes: number) {
  const abs = Math.abs(minutes);
  return { sign: minutes < 0 ? MINUS_SIGN : '+', hours: Math.floor(abs / 60), mins: abs % 60 };
}

// "+3h", "−13h", "+3:30h", "+5:45h" — minutes spelled out, never decimal
// hours ("+3.5h"). Zero is "0h": the UI decides whether that entry is the
// reference itself (shown as "Base") or just another zone at the same offset.
export function formatRelativeOffset(minutes: number): string {
  if (minutes === 0) return '0h';
  const { sign, hours, mins } = splitSignedMinutes(minutes);
  return `${sign}${hours}${mins ? `:${String(mins).padStart(2, '0')}` : ''}h`;
}

// "UTC+09", "UTC−04", "UTC+05:45"; plain "UTC" at zero. This — never a zone
// abbreviation like JST/EST/CST — is how a zone is identified (spec §4.2).
export function formatUtcOffset(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const { sign, hours, mins } = splitSignedMinutes(minutes);
  return `UTC${sign}${String(hours).padStart(2, '0')}${mins ? `:${String(mins).padStart(2, '0')}` : ''}`;
}

export function localMinutesOfDay(timezone: string, date: Date): number {
  const dtf = formatterFor(TIME_OF_DAY_FIELDS, timezone);
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
  const dtf = formatterFor(DATE_FIELDS, timezone);
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

// Calendar days between `timezone`'s local date and the reference timezone's
// local date at the same instant: −1 = a day behind, +1 = a day ahead. Can
// reach ±2 across the date line (Kiritimati +14 vs Niue −11 is 25h apart).
export function localDayDelta(timezone: string, referenceTimezone: string, date: Date): number {
  const epochDay = ({ year, month, day }: LocalDateParts) => Date.UTC(year, month - 1, day) / 86400000;
  return epochDay(localDateParts(timezone, date)) - epochDay(localDateParts(referenceTimezone, date));
}

// The engine's name for the machine's zone, as is — Chrome says Asia/Calcutta
// where GeoNames says Asia/Kolkata. Compare it with sameZone(), and name it
// with friendlyZoneName(), which goes through canonicalZone().
export function getSystemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// A readable name from an IANA id — the last segment of its current name,
// underscores as spaces: "Asia/Tokyo" → "Tokyo", "America/Argentina/
// Buenos_Aires" → "Buenos Aires", and "Asia/Calcutta" → "Kolkata". Same
// convention as an entry's default label.
export function friendlyZoneName(zone: string): string {
  const last = canonicalZone(zone).split('/').pop() ?? zone;
  return last.replace(/_/g, ' ');
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
