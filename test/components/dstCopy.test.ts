import { describe, expect, it } from 'vitest';
import { detectDstTransitions, type GapChange } from '../../src/core/dst';
import { createEntry, DEFAULT_SETTINGS } from '../../src/core/model';
import { dstBadgeText, dstBannerCopy, gapChangeText, shortDate } from '../../src/components/dstCopy';

function gapChange(timezone: string, reference: string, from: string): GapChange {
  const result = detectDstTransitions({
    entries: [createEntry({ timezone })],
    settings: { ...DEFAULT_SETTINGS, referenceTimezone: reference },
    fromDate: new Date(from),
  });
  return result.entries[0].gapChanges[0];
}

describe('dstBannerCopy (§6.2)', () => {
  it('Tokyo vs Boston: the city moves, your clock doesn’t — and no EST', () => {
    const copy = dstBannerCopy(gapChange('America/New_York', 'Asia/Tokyo', '2026-10-23T00:00:00Z'), 'Boston');
    expect(copy).toEqual({
      headline: 'In 9 days (Nov 1), Boston shifts to UTC−05 — your clock doesn’t.',
      detail: 'Your gap: 13 hours → 14 hours',
    });
  });

  it('Berlin vs Tokyo: your clock moves, the city’s doesn’t', () => {
    const copy = dstBannerCopy(gapChange('Asia/Tokyo', 'Europe/Berlin', '2026-10-20T00:00:00Z'), 'Tokyo');
    expect(copy).toEqual({
      headline: 'In 5 days (Oct 25), your clock shifts to UTC+01 — Tokyo’s doesn’t.',
      detail: 'Your gap with Tokyo: 7 hours → 8 hours',
    });
  });

  it('Sydney in October: the gap grows, nothing says "back"', () => {
    const copy = dstBannerCopy(gapChange('Australia/Sydney', 'Asia/Tokyo', '2026-09-30T00:00:00Z'), 'Sydney');
    expect(copy.headline).toBe('In 4 days (Oct 4), Sydney shifts to UTC+11 — your clock doesn’t.');
    expect(copy.detail).toBe('Your gap: 1 hour → 2 hours');
    expect(`${copy.headline} ${copy.detail}`).not.toMatch(/back|forward|earlier|later/i);
  });

  it('Sydney in April: the same city, the gap shrinks', () => {
    const copy = dstBannerCopy(gapChange('Australia/Sydney', 'Asia/Tokyo', '2026-03-30T00:00:00Z'), 'Sydney');
    expect(copy).toEqual({
      headline: 'In 6 days (Apr 5), Sydney shifts to UTC+10 — your clock doesn’t.',
      detail: 'Your gap: 2 hours → 1 hour',
    });
  });

  it('later today and tomorrow', () => {
    // From Tokyo: Boston switches at 15:00 on Nov 1.
    const today = gapChange('America/New_York', 'Asia/Tokyo', '2026-11-01T01:00:00Z');
    expect(dstBannerCopy(today, 'Boston').headline).toMatch(/^Later today \(Nov 1\), /);
    const tomorrow = gapChange('America/New_York', 'Asia/Tokyo', '2026-10-31T01:00:00Z');
    expect(dstBannerCopy(tomorrow, 'Boston').headline).toMatch(/^Tomorrow \(Nov 1\), /);
  });

  it('both clocks moving on the same day', () => {
    const change: GapChange = {
      mover: 'both',
      at: 0,
      date: '2026-11-01',
      daysFromNow: 3,
      gapBeforeMinutes: 60,
      gapAfterMinutes: 180,
      entryOffsetAfterMinutes: 0,
      referenceOffsetAfterMinutes: 0,
      switchKeys: [],
    };
    expect(dstBannerCopy(change, 'Boston')).toEqual({
      headline: 'In 3 days (Nov 1), your clock and Boston’s both shift.',
      detail: 'Your gap: 1 hour → 3 hours',
    });
  });
});

describe('gapChangeText', () => {
  it('spells out minutes, never decimal hours', () => {
    expect(gapChangeText(570, 630)).toBe('9:30 hours → 10:30 hours');
    expect(gapChangeText(-345, -285)).toBe('5:45 hours → 4:45 hours');
  });

  it('says which side is ahead only when that flips', () => {
    expect(gapChangeText(-60, 60)).toBe('1 hour behind → 1 hour ahead');
    expect(gapChangeText(60, 0)).toBe('1 hour → 0 hours');
  });
});

describe('dstBadgeText (§6.3 layer 1)', () => {
  it('the date and the relative offset the card will show', () => {
    expect(dstBadgeText(gapChange('America/New_York', 'Asia/Tokyo', '2026-10-23T00:00:00Z'))).toBe('Nov 1 → −14h');
    expect(dstBadgeText(gapChange('Australia/Lord_Howe', 'Asia/Tokyo', '2026-09-30T00:00:00Z'))).toBe('Oct 4 → +2h');
  });

  it('shortDate', () => {
    expect(shortDate('2026-03-08')).toBe('Mar 8');
    expect(shortDate('2026-12-31')).toBe('Dec 31');
  });
});
