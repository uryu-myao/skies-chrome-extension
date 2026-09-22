import { describe, expect, it } from 'vitest';
import { coreTime } from '../../src/core/coretime';
import { createEntry, DEFAULT_SETTINGS } from '../../src/core/model';
import type { AppSettings } from '../../src/core/types';

// A Wednesday, and specifically during EU/US summer DST — the JST-16:00-18:00
// business case below only holds while Berlin is on CEST (+2), so the fixed
// date matters, not just "any weekday".
const REFERENCE_DATE = new Date('2026-07-15T12:00:00Z');

function settingsWithReference(timezone: string): AppSettings {
  return { ...DEFAULT_SETTINGS, referenceTimezone: timezone };
}

describe('coreTime — §10.4 business cases', () => {
  it('Tokyo + Boston, default hours: overlap is empty, NO_OVERLAP_TODAY carries a closest slot', () => {
    const entries = [
      createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' }),
      createEntry({ timezone: 'America/New_York', label: 'Boston' }),
    ];
    const result = coreTime({
      entries,
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: REFERENCE_DATE,
    });

    // Wednesday in both cities, so both are on a work day — the zero overlap
    // is purely the hours not lining up (§5.3), not anyone being off.
    expect(result.overlap).toEqual([]);
    const { conclusion } = result;
    expect(conclusion.status).toBe('NO_OVERLAP_TODAY');
    if (conclusion.status !== 'NO_OVERLAP_TODAY') return;
    expect(conclusion.closest.perEntry).toHaveLength(2);
    expect(conclusion.closest.gapMinutes).toBeGreaterThan(0);
  });

  it('Tokyo + Singapore + Berlin, default hours: overlap is 16:00-18:00 JST', () => {
    const entries = [
      createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' }),
      createEntry({ timezone: 'Asia/Singapore', label: 'Singapore' }),
      createEntry({ timezone: 'Europe/Berlin', label: 'Berlin' }),
    ];
    const result = coreTime({
      entries,
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: REFERENCE_DATE,
    });

    // 16:00 = slot 32, 18:00 = slot 36 (30-minute slots)
    expect(result.overlap).toEqual([{ startSlot: 32, endSlot: 36 }]);
  });

  it('single entry: overlap is exactly that entry own working hours', () => {
    const entries = [createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' })];
    const result = coreTime({
      entries,
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: REFERENCE_DATE,
    });

    // 9:00 = slot 18, 18:00 = slot 36
    expect(result.overlap).toEqual([{ startSlot: 18, endSlot: 36 }]);
    expect(result.conclusion).toEqual({ status: 'OVERLAP' });
  });

  it('all entries excluded from Core Time: empty state, no error', () => {
    const result = coreTime({
      entries: [],
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: REFERENCE_DATE,
    });

    expect(result.rows).toEqual([]);
    expect(result.overlap).toEqual([]);
    expect(result.conclusion).toEqual({ status: 'NO_ENTRIES' });
  });

  it('an entry with an empty workDays list never participates, overlap stays empty', () => {
    const entries = [createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo', workDays: [] })];
    const result = coreTime({
      entries,
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: REFERENCE_DATE,
    });

    expect(result.rows[0].blocks.every((b) => b === false)).toBe(true);
    expect(result.overlap).toEqual([]);
  });
});

describe('coreTime — axis and rows', () => {
  it('produces 48 axis slots half an hour apart, starting at reference-local midnight', () => {
    const result = coreTime({
      entries: [],
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: REFERENCE_DATE,
    });
    expect(result.axis).toHaveLength(48);
    expect(result.axis[0].refTime).toBe('00:00');
    expect(result.axis[47].refTime).toBe('23:30');
  });

  it('flags crossesDay for an entry whose local date changes within the 48-slot axis', () => {
    // Kiritimati (+14) vs a Tokyo-referenced axis: 25h away from Niue-style
    // offsets means the entry's local calendar date is not constant across
    // a full reference-local day.
    const entries = [createEntry({ timezone: 'Pacific/Kiritimati', label: 'Kiritimati' })];
    const result = coreTime({
      entries,
      settings: settingsWithReference('Pacific/Niue'),
      referenceDate: REFERENCE_DATE,
    });
    expect(result.rows[0].crossesDay).toBe(true);
  });
});
