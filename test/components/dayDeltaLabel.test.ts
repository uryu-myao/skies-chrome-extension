import { describe, expect, it } from 'vitest';
import { dayDeltaLabel } from '../../src/components/dayDeltaLabel';
import { localDayDelta } from '../../src/core/tz';

describe('dayDeltaLabel — the card footer note (§9.2)', () => {
  it('±1 day is yesterday / tomorrow', () => {
    expect(dayDeltaLabel(-1)).toBe('yesterday');
    expect(dayDeltaLabel(1)).toBe('tomorrow');
  });

  it('±2 days has its own wording, not yesterday / tomorrow', () => {
    expect(dayDeltaLabel(-2)).toBe('2 days back');
    expect(dayDeltaLabel(2)).toBe('2 days ahead');
  });
});

describe('Kiritimati vs Niue, end to end (§10.3)', () => {
  // 25 hours apart, so their dates are two days apart for one hour a day:
  // 10:00–11:00 UTC, when Kiritimati (+14) is past midnight and Niue (−11)
  // is not yet.
  const TWO_DAYS_APART = new Date('2026-06-15T10:30:00Z'); // Kiritimati 00:30 Jun 16, Niue 23:30 Jun 14
  const ONE_DAY_APART = new Date('2026-06-15T07:30:00Z'); // Kiritimati 21:30 Jun 15, Niue 20:30 Jun 14

  it('Niue on a Kiritimati base reads "2 days back", and the reverse "2 days ahead"', () => {
    expect(dayDeltaLabel(localDayDelta('Pacific/Niue', 'Pacific/Kiritimati', TWO_DAYS_APART))).toBe(
      '2 days back'
    );
    expect(dayDeltaLabel(localDayDelta('Pacific/Kiritimati', 'Pacific/Niue', TWO_DAYS_APART))).toBe(
      '2 days ahead'
    );
  });

  it('the rest of the day the same pair is only one day apart', () => {
    expect(dayDeltaLabel(localDayDelta('Pacific/Niue', 'Pacific/Kiritimati', ONE_DAY_APART))).toBe(
      'yesterday'
    );
  });
});
