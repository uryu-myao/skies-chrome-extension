// Two display settings that follow the browser's language unless set
// (spec §9.4): which comes first in a date, the day or the month, and which
// day a week starts on. Both only arrange things — the month names are
// always MONTH_SHORT, and stored work days are always 0=Sunday..6=Saturday
// (spec §2.2). The language tag comes in as an argument; core never reads
// `navigator`.

export type DateOrder = 'dayMonth' | 'monthDay';
export type WeekStart = 'sunday' | 'monday';
export type DateFormatSetting = 'auto' | DateOrder;
export type WeekStartSetting = 'auto' | WeekStart;

// The only month names shown anywhere. Never Intl's: en-GB's September is
// "Sept", de-DE's "Sept.", and the footer and badges are laid out for three
// letters.
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// What Skies did before these settings existed, for a tag that can't be read.
const FALLBACK_DATE_ORDER: DateOrder = 'dayMonth';
const FALLBACK_WEEK_START: WeekStart = 'sunday';

// Regions whose week doesn't start on Monday, from CLDR's weekData — where
// Intl.Locale has neither getWeekInfo() nor weekInfo. Saturday-start regions
// (EG, IR, …) and the Maldives (Friday) are here too: with only Sunday and
// Monday on offer, Sunday keeps their Sunday–Thursday work week in one run.
// test/core/locale.test.ts checks this against Node's CLDR region by region.
const NON_MONDAY_REGIONS = new Set([
  // Sunday
  'AG', 'AS', 'BD', 'BR', 'BS', 'BT', 'BW', 'BZ', 'CA', 'CO', 'DM', 'DO', 'ET', 'GT', 'GU', 'HK',
  'HN', 'ID', 'IL', 'IN', 'IS', 'JM', 'JP', 'KE', 'KH', 'KR', 'LA', 'MH', 'MM', 'MO', 'MT', 'MX',
  'MZ', 'NI', 'NP', 'PA', 'PE', 'PH', 'PK', 'PR', 'PT', 'PY', 'SA', 'SG', 'SV', 'TH', 'TT', 'TW',
  'UM', 'US', 'VE', 'VI', 'WS', 'YE', 'ZA', 'ZW',
  // Saturday
  'AF', 'BH', 'DJ', 'DZ', 'EG', 'IQ', 'IR', 'JO', 'KW', 'LY', 'OM', 'QA', 'SD', 'SY',
  // Friday
  'MV',
]);

export function regionWeekStart(region: string): WeekStart {
  return NON_MONDAY_REGIONS.has(region.toUpperCase()) ? 'sunday' : 'monday';
}

// Null for an empty or malformed tag.
function parse(languageTag: string): Intl.Locale | null {
  try {
    return new Intl.Locale(languageTag);
  } catch {
    return null;
  }
}

// The tag's region, or its likely one: "en" → US, "ja" → JP. Only for the
// region — formatting with the maximized tag is wrong: ICU reads en-Latn-GB
// as plain English and puts the month first.
function regionOf(locale: Intl.Locale): string | undefined {
  return locale.region ?? locale.maximize().region;
}

// A fixed day where the day and month numbers differ: 24 September.
const SAMPLE_DATE = new Date(Date.UTC(2026, 8, 24, 12));

export function localeDateOrder(languageTag: string): DateOrder {
  const locale = parse(languageTag);
  if (!locale) return FALLBACK_DATE_ORDER;
  try {
    // Gregorian and Latin digits, so a locale with another default calendar
    // still names a day and a month. Only their order is used, never the text.
    const types = new Intl.DateTimeFormat(locale.toString(), {
      month: 'short',
      day: 'numeric',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'UTC',
    })
      .formatToParts(SAMPLE_DATE)
      .map((part) => part.type);
    const day = types.indexOf('day');
    const month = types.indexOf('month');
    if (day === -1 || month === -1) return FALLBACK_DATE_ORDER;
    return month < day ? 'monthDay' : 'dayMonth';
  } catch {
    return FALLBACK_DATE_ORDER;
  }
}

// getWeekInfo() is the current name; weekInfo the accessor engines shipped
// first. Neither is everywhere yet.
interface WeekInfoLocale {
  getWeekInfo?: () => { firstDay: number };
  weekInfo?: { firstDay: number };
}

function firstDayOf(locale: Intl.Locale): number | null {
  const withInfo = locale as unknown as WeekInfoLocale;
  try {
    const info = typeof withInfo.getWeekInfo === 'function' ? withInfo.getWeekInfo() : withInfo.weekInfo;
    return typeof info?.firstDay === 'number' ? info.firstDay : null;
  } catch {
    return null;
  }
}

export function localeWeekStart(languageTag: string): WeekStart {
  const locale = parse(languageTag);
  if (!locale) return FALLBACK_WEEK_START;
  // firstDay is ISO: 1 = Monday … 7 = Sunday.
  const firstDay = firstDayOf(locale);
  if (firstDay !== null) return firstDay === 1 ? 'monday' : 'sunday';
  const region = regionOf(locale);
  return region ? regionWeekStart(region) : FALLBACK_WEEK_START;
}

// Absent from data saved before these settings existed: that's Auto.
export function resolveDateOrder(setting: DateFormatSetting | undefined, languageTag: string): DateOrder {
  return setting && setting !== 'auto' ? setting : localeDateOrder(languageTag);
}

export function resolveWeekStart(setting: WeekStartSetting | undefined, languageTag: string): WeekStart {
  return setting && setting !== 'auto' ? setting : localeWeekStart(languageTag);
}

// The weekday values (0=Sunday..6=Saturday) in the order they're shown. Only
// the order changes: a picker built from this still reads and writes the
// values themselves (spec §2.2).
export function weekdayDisplayOrder(weekStart: WeekStart): number[] {
  return weekStart === 'monday' ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
}

// 24, 9 → "24 Sep" or "Sep 24". `month` is 1-based.
export function formatDayMonth(day: number, month: number, order: DateOrder): string {
  const name = MONTH_SHORT[month - 1];
  return order === 'monthDay' ? `${name} ${day}` : `${day} ${name}`;
}
