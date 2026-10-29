import { afterEach, describe, expect, it } from 'vitest';
import {
  formatDayMonth,
  localeDateOrder,
  localeWeekStart,
  MONTH_SHORT,
  regionWeekStart,
  resolveDateOrder,
  resolveWeekStart,
  weekdayDisplayOrder,
} from '../../src/core/locale';
import { DEFAULT_SETTINGS } from '../../src/core/model';

// Spec §9.4, §10.9.

describe('localeDateOrder', () => {
  it.each([
    ['en-US', 'monthDay'],
    ['en-GB', 'dayMonth'],
    ['ja-JP', 'monthDay'],
    ['de-DE', 'dayMonth'],
  ] as const)('%s → %s', (tag, order) => {
    expect(localeDateOrder(tag)).toBe(order);
  });

  it('fills in the region of a tag without one', () => {
    expect(localeDateOrder('en')).toBe('monthDay');
    expect(localeDateOrder('ja')).toBe('monthDay');
    expect(localeDateOrder('de')).toBe('dayMonth');
  });

  it('reads a locale whose default calendar is not Gregorian', () => {
    expect(localeDateOrder('fa-IR')).toBe('dayMonth');
  });

  it('an unreadable tag keeps the day first, as before the setting', () => {
    expect(localeDateOrder('')).toBe('dayMonth');
    expect(localeDateOrder('not a tag')).toBe('dayMonth');
  });
});

describe('localeWeekStart', () => {
  it.each([
    ['en-US', 'sunday'],
    ['en-GB', 'monday'],
    ['ja-JP', 'sunday'],
    ['de-DE', 'monday'],
  ] as const)('%s → %s', (tag, start) => {
    expect(localeWeekStart(tag)).toBe(start);
  });

  it('fills in the region of a tag without one', () => {
    expect(localeWeekStart('en')).toBe('sunday');
    expect(localeWeekStart('ja')).toBe('sunday');
    expect(localeWeekStart('de')).toBe('monday');
  });

  it('a Saturday-start region counts as Sunday', () => {
    expect(localeWeekStart('ar-EG')).toBe('sunday');
  });

  it('an unreadable tag starts on Sunday, as before the setting', () => {
    expect(localeWeekStart('')).toBe('sunday');
    expect(localeWeekStart('not a tag')).toBe('sunday');
  });

  describe('where Intl.Locale has no week info', () => {
    const proto = Intl.Locale.prototype;
    const saved = {
      getWeekInfo: Object.getOwnPropertyDescriptor(proto, 'getWeekInfo'),
      weekInfo: Object.getOwnPropertyDescriptor(proto, 'weekInfo'),
    };
    const remove = (name: keyof typeof saved) => delete (proto as unknown as Record<string, unknown>)[name];

    afterEach(() => {
      for (const [name, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(proto, name, descriptor);
      }
    });

    it('the region table gives the same answers', () => {
      remove('getWeekInfo');
      remove('weekInfo');
      expect(localeWeekStart('en-US')).toBe('sunday');
      expect(localeWeekStart('en-GB')).toBe('monday');
      expect(localeWeekStart('ja-JP')).toBe('sunday');
      expect(localeWeekStart('de-DE')).toBe('monday');
      expect(localeWeekStart('ja')).toBe('sunday');
    });

    it('falls back to the older weekInfo accessor', () => {
      remove('getWeekInfo');
      expect(localeWeekStart('en-GB')).toBe('monday');
      expect(localeWeekStart('en-US')).toBe('sunday');
    });
  });
});

describe('regionWeekStart', () => {
  // Every current region code Node's CLDR knows (deprecated ones such as BU
  // canonicalize to another region and are skipped).
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const regions = [...letters].flatMap((a) => [...letters].map((b) => a + b)).filter((region) => {
    try {
      return new Intl.Locale(`und-${region}`).maximize().region === region;
    } catch {
      return false;
    }
  });

  it('agrees with CLDR region by region', () => {
    expect(regions.length).toBeGreaterThan(200);
    const disagree = regions.filter((region) => {
      // Typed only in newer TypeScript libs.
      const locale = new Intl.Locale(`und-${region}`) as Intl.Locale & { getWeekInfo(): { firstDay: number } };
      const firstDay = locale.getWeekInfo().firstDay;
      return regionWeekStart(region) !== (firstDay === 1 ? 'monday' : 'sunday');
    });
    expect(disagree).toEqual([]);
  });
});

describe('resolveDateOrder / resolveWeekStart', () => {
  it('an explicit choice wins over the language', () => {
    expect(resolveDateOrder('dayMonth', 'en-US')).toBe('dayMonth');
    expect(resolveDateOrder('monthDay', 'en-GB')).toBe('monthDay');
    expect(resolveWeekStart('monday', 'en-US')).toBe('monday');
    expect(resolveWeekStart('sunday', 'de-DE')).toBe('sunday');
  });

  it('Auto, or absent from older data, follows the language', () => {
    expect(resolveDateOrder('auto', 'en-US')).toBe('monthDay');
    expect(resolveDateOrder(undefined, 'en-GB')).toBe('dayMonth');
    expect(resolveWeekStart('auto', 'de-DE')).toBe('monday');
    expect(resolveWeekStart(undefined, 'ja-JP')).toBe('sunday');
  });

  it('the defaults leave both settings out of stored data', () => {
    expect(DEFAULT_SETTINGS).not.toHaveProperty('dateFormat');
    expect(DEFAULT_SETTINGS).not.toHaveProperty('weekStart');
  });
});

describe('MONTH_SHORT / formatDayMonth', () => {
  it('always three letters — never Intl’s en-GB "Sept"', () => {
    expect(MONTH_SHORT).toHaveLength(12);
    expect(MONTH_SHORT.every((name) => /^[A-Z][a-z]{2}$/.test(name))).toBe(true);
    expect(formatDayMonth(24, 9, resolveDateOrder('auto', 'en-GB'))).toBe('24 Sep');
    expect(formatDayMonth(24, 9, resolveDateOrder('auto', 'de-DE'))).toBe('24 Sep');
  });

  it('in either order', () => {
    expect(formatDayMonth(24, 9, 'monthDay')).toBe('Sep 24');
    expect(formatDayMonth(1, 11, 'dayMonth')).toBe('1 Nov');
  });
});

describe('weekdayDisplayOrder (§2.2)', () => {
  it('only reorders the weekday values', () => {
    expect(weekdayDisplayOrder('sunday')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayDisplayOrder('monday')).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('the first button of a Monday week is Monday (1), not Sunday (0)', () => {
    // What the picker does: a button's value is the weekday it shows, and a
    // toggle stores the days sorted by value.
    const toggle = (days: number[], day: number) =>
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
    const first = weekdayDisplayOrder('monday')[0];
    const last = weekdayDisplayOrder('monday')[6];
    expect(toggle([2, 3, 4, 5], first)).toEqual([1, 2, 3, 4, 5]);
    expect(toggle([1, 2, 3, 4, 5], last)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
