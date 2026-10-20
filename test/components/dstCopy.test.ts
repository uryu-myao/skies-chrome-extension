import { describe, expect, it } from 'vitest';
import { detectDstTransitions, pickDstBanner, type DstBannerDay, type GapChange } from '../../src/core/dst';
import { createEntry, DEFAULT_SETTINGS } from '../../src/core/model';
import {
  dstBadgeText,
  dstBannerCopy as dstBannerParts,
  gapChangeText,
  lineText,
  shortDate,
  shortGapText,
} from '../../src/components/dstCopy';

// The wording as plain text; the parts are checked on their own below.
const dstBannerCopy = (...args: Parameters<typeof dstBannerParts>) => {
  const { headline, detail } = dstBannerParts(...args);
  return { headline: lineText(headline), detail: lineText(detail) };
};

function gapChange(timezone: string, reference: string, from: string): GapChange {
  const result = detectDstTransitions({
    entries: [createEntry({ timezone })],
    settings: { ...DEFAULT_SETTINGS, referenceTimezone: reference },
    fromDate: new Date(from),
  });
  return result.entries[0].gapChanges[0];
}

// The banner's day for one city, as App gets it.
function dayOf(timezone: string, reference: string, from: string): DstBannerDay {
  const settings = { ...DEFAULT_SETTINGS, referenceTimezone: reference };
  const result = detectDstTransitions({ entries: [createEntry({ timezone })], settings, fromDate: new Date(from) });
  return pickDstBanner(result, settings)!;
}

const named = (name: string) => () => name;

describe('dstBannerCopy (§6.2)', () => {
  it('Tokyo vs Boston: the city moves, your clock doesn’t — and no EST', () => {
    const copy = dstBannerCopy(dayOf('America/New_York', 'Asia/Tokyo', '2026-10-23T00:00:00Z'), named('Boston'));
    expect(copy).toEqual({
      headline: 'In 9 days (Nov 1), Boston shifts to UTC−05 — your clock doesn’t.',
      detail: 'Your gap: 13 hours → 14 hours',
    });
  });

  it('Berlin vs Tokyo: your clock moves, the city’s doesn’t', () => {
    const copy = dstBannerCopy(dayOf('Asia/Tokyo', 'Europe/Berlin', '2026-10-20T00:00:00Z'), named('Tokyo'));
    expect(copy).toEqual({
      headline: 'In 5 days (Oct 25), your clock shifts to UTC+01 — Tokyo’s doesn’t.',
      detail: 'Your gap with Tokyo: 7 hours → 8 hours',
    });
  });

  it('Sydney in October: the gap grows, nothing says "back"', () => {
    const copy = dstBannerCopy(dayOf('Australia/Sydney', 'Asia/Tokyo', '2026-09-30T00:00:00Z'), named('Sydney'));
    expect(copy.headline).toBe('In 4 days (Oct 4), Sydney shifts to UTC+11 — your clock doesn’t.');
    expect(copy.detail).toBe('Your gap: 1 hour → 2 hours');
    expect(`${copy.headline} ${copy.detail}`).not.toMatch(/back|forward|earlier|later/i);
  });

  it('Sydney in April: the same city, the gap shrinks', () => {
    const copy = dstBannerCopy(dayOf('Australia/Sydney', 'Asia/Tokyo', '2026-03-30T00:00:00Z'), named('Sydney'));
    expect(copy).toEqual({
      headline: 'In 6 days (Apr 5), Sydney shifts to UTC+10 — your clock doesn’t.',
      detail: 'Your gap: 2 hours → 1 hour',
    });
  });

  it('later today and tomorrow', () => {
    // From Tokyo: Boston switches at 15:00 on Nov 1.
    const today = dayOf('America/New_York', 'Asia/Tokyo', '2026-11-01T01:00:00Z');
    expect(dstBannerCopy(today, named('Boston')).headline).toMatch(/^Later today \(Nov 1\), /);
    const tomorrow = dayOf('America/New_York', 'Asia/Tokyo', '2026-10-31T01:00:00Z');
    expect(dstBannerCopy(tomorrow, named('Boston')).headline).toMatch(/^Tomorrow \(Nov 1\), /);
  });

  it('both clocks moving on the same day', () => {
    const change: GapChange = {
      mover: 'both',
      at: 0,
      date: '2026-11-01',
      daysFromNow: 3,
      inEffect: false,
      gapBeforeMinutes: 60,
      gapAfterMinutes: 180,
      entryOffsetAfterMinutes: 0,
      referenceOffsetAfterMinutes: 0,
      switchKeys: [],
    };
    const day: DstBannerDay = {
      date: change.date,
      daysFromNow: change.daysFromNow,
      inEffect: 'none',
      referenceMoves: true,
      referenceOffsetAfterMinutes: 0,
      items: [{ entryId: 'e', change }],
      switchKeys: [],
    };
    expect(dstBannerCopy(day, named('Boston'))).toEqual({
      headline: 'In 3 days (Nov 1), your clock and Boston’s both shift.',
      detail: 'Your gap: 1 hour → 3 hours',
    });
  });
});

describe('dstBannerCopy — several cities the same day (§6.3, option A)', () => {
  const settingsFor = (reference: string) => ({ ...DEFAULT_SETTINGS, referenceTimezone: reference });
  const banner = (zones: [string, string][], reference: string, from: string) => {
    const entries = zones.map(([id, timezone]) => createEntry({ id, label: id, timezone }));
    const settings = settingsFor(reference);
    const day = pickDstBanner(detectDstTransitions({ entries, settings, fromDate: new Date(from) }), settings)!;
    return { day, copy: dstBannerCopy(day, (id: string) => id) };
  };

  it('the cities move: one banner names each, with its gap', () => {
    const { day, copy } = banner(
      [['Boston', 'America/New_York'], ['New York', 'America/New_York'], ['San Francisco', 'America/Los_Angeles']],
      'Asia/Tokyo',
      '2026-10-20T00:00:00Z'
    );
    expect(day.items).toHaveLength(3);
    expect(day.switchKeys).toEqual(['America/New_York@2026-11-01', 'America/Los_Angeles@2026-11-01']);
    expect(copy).toEqual({
      headline: 'In 12 days (Nov 1), 3 cities shift — your clock doesn’t.',
      detail: 'Boston\u00a013 → 14 h · New York\u00a013 → 14 h · San Francisco\u00a016 → 17 h',
    });
  });

  it('past three cities: two by name and "+N more"', () => {
    const { copy } = banner(
      [
        ['Boston', 'America/New_York'],
        ['Chicago', 'America/Chicago'],
        ['Denver', 'America/Denver'],
        ['San Francisco', 'America/Los_Angeles'],
      ],
      'Asia/Tokyo',
      '2026-10-20T00:00:00Z'
    );
    expect(copy).toEqual({
      headline: 'In 12 days (Nov 1), 4 cities shift — your clock doesn’t.',
      detail: 'Boston\u00a013 → 14 h · Chicago\u00a014 → 15 h · +2 more',
    });
  });

  it('your clock moves: that leads, with the number of cities', () => {
    const { day, copy } = banner(
      [['Tokyo', 'Asia/Tokyo'], ['Dubai', 'Asia/Dubai'], ['London', 'Europe/London'], ['Boston', 'America/New_York']],
      'Europe/Berlin',
      '2026-10-20T00:00:00Z'
    );
    // London switches with you: no change, not counted.
    expect(day.items.map((item) => item.entryId)).toEqual(['Tokyo', 'Dubai', 'Boston']);
    expect(day.switchKeys).toEqual(['Europe/Berlin@2026-10-25']);
    expect(copy).toEqual({
      headline: 'In 5 days (Oct 25), your clock shifts to UTC+01.',
      detail: 'Gaps change for 3 cities',
    });
  });
});

describe('dstBannerCopy — once the change is in effect (§6.3)', () => {
  // From Tokyo, Boston switches at 15:00 on Sunday Nov 1.
  it('later that day: past tense, the gap as it is now', () => {
    const day = dayOf('America/New_York', 'Asia/Tokyo', '2026-11-01T07:00:00Z');
    expect(day).toMatchObject({ inEffect: 'all', daysFromNow: 0 });
    expect(dstBannerCopy(day, named('Boston'))).toEqual({
      headline: 'Today (Nov 1), Boston shifted to UTC−05 — your clock didn’t.',
      detail: 'Your gap is now 14 hours (was 13 hours)',
    });
  });

  it('the day after — Monday, the first meeting on the new gap', () => {
    const day = dayOf('America/New_York', 'Asia/Tokyo', '2026-11-02T00:00:00Z');
    expect(dstBannerCopy(day, named('Boston')).headline).toBe(
      'Yesterday (Nov 1), Boston shifted to UTC−05 — your clock didn’t.'
    );
  });

  it('gone the day after that', () => {
    const settings = { ...DEFAULT_SETTINGS, referenceTimezone: 'Asia/Tokyo' };
    const entries = [createEntry({ timezone: 'America/New_York' })];
    const result = detectDstTransitions({ entries, settings, fromDate: new Date('2026-11-02T15:00:00Z') });
    expect(pickDstBanner(result, settings)).toBeNull();
  });

  it('your clock moved: past tense from your side', () => {
    const day = dayOf('Asia/Tokyo', 'Europe/Berlin', '2026-10-25T08:00:00Z');
    expect(dstBannerCopy(day, named('Tokyo'))).toEqual({
      headline: 'Today (Oct 25), your clock shifted to UTC+01 — Tokyo’s didn’t.',
      detail: 'Your gap with Tokyo is now 8 hours (was 7 hours)',
    });
  });

  it('several cities, some done and some still to come today: "Today", present tense', () => {
    const settings = { ...DEFAULT_SETTINGS, referenceTimezone: 'Asia/Tokyo' };
    const entries = [
      createEntry({ id: 'Boston', timezone: 'America/New_York' }),
      createEntry({ id: 'San Francisco', timezone: 'America/Los_Angeles' }),
    ];
    const at = (iso: string) =>
      pickDstBanner(detectDstTransitions({ entries, settings, fromDate: new Date(iso) }), settings)!;
    // 16:00 in Tokyo: Boston switched at 15:00, San Francisco does at 18:00.
    const some = at('2026-11-01T07:00:00Z');
    expect(some.inEffect).toBe('some');
    expect(dstBannerCopy(some, (id: string) => id).headline).toBe('Today (Nov 1), 2 cities shift — your clock doesn’t.');
    const all = at('2026-11-01T10:00:00Z');
    expect(dstBannerCopy(all, (id: string) => id)).toEqual({
      headline: 'Today (Nov 1), 2 cities shifted — your clock didn’t.',
      detail: 'Boston\u00a013 → 14 h · San Francisco\u00a016 → 17 h',
    });
  });
});

describe('dstBannerCopy — parts', () => {
  it('cities and times are their own parts', () => {
    const { headline, detail } = dstBannerParts(
      dayOf('America/New_York', 'Asia/Tokyo', '2026-10-23T00:00:00Z'),
      named('Boston')
    );
    expect(headline.filter((p) => p.kind !== 'plain')).toEqual([
      { kind: 'time', text: '9 days' },
      { kind: 'time', text: 'Nov 1' },
      { kind: 'city', text: 'Boston' },
      { kind: 'time', text: 'UTC−05' },
    ]);
    expect(detail.filter((p) => p.kind !== 'plain').map((p) => p.text)).toEqual(['13 hours', '14 hours']);
  });
});

describe('shortGapText', () => {
  it('spells out minutes and flips', () => {
    expect(shortGapText(-13 * 60, -14 * 60)).toBe('13 → 14 h');
    expect(shortGapText(570, 630)).toBe('9:30 → 10:30 h');
    expect(shortGapText(-60, 60)).toBe('1 h behind → 1 h ahead');
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
