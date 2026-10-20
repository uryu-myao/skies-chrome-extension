import { describe, expect, it } from 'vitest';
import { detectDstTransitions, detectZoneTransition, dstSwitchKey } from '../../src/core/dst';
import { createEntry, DEFAULT_SETTINGS } from '../../src/core/model';
import type { AppSettings } from '../../src/core/types';

function settingsWithReference(timezone: string, dstLeadDays = 14): AppSettings {
  return { ...DEFAULT_SETTINGS, referenceTimezone: timezone, dstLeadDays };
}

function detectOne(timezone: string, reference: string, from: string, leadDays?: number) {
  return detectDstTransitions({
    entries: [createEntry({ id: 'e', timezone })],
    settings: settingsWithReference(reference, leadDays),
    fromDate: new Date(from),
  });
}

describe('detectDstTransitions — §10.1 boundary dates', () => {
  it('US enters DST 2026-03-08: offset moves -300 -> -240 at 02:00 local', () => {
    const transition = detectOne('America/New_York', 'UTC', '2026-03-01T00:00:00Z').entries[0].transition;
    expect(transition).toMatchObject({
      date: '2026-03-08',
      offsetBeforeMinutes: -300,
      offsetAfterMinutes: -240,
      deltaMinutes: 60,
      at: Date.parse('2026-03-08T07:00:00Z'),
    });
  });

  it('US exits DST 2026-11-01: offset moves -240 -> -300 at 02:00 local', () => {
    const transition = detectOne('America/New_York', 'UTC', '2026-10-20T00:00:00Z').entries[0].transition;
    expect(transition).toMatchObject({
      date: '2026-11-01',
      offsetBeforeMinutes: -240,
      offsetAfterMinutes: -300,
      deltaMinutes: -60,
      at: Date.parse('2026-11-01T06:00:00Z'),
    });
  });

  it('EU enters DST 2026-03-29: offset moves +60 -> +120 at 01:00 UTC', () => {
    const transition = detectOne('Europe/Berlin', 'UTC', '2026-03-22T00:00:00Z').entries[0].transition;
    expect(transition).toMatchObject({
      date: '2026-03-29',
      offsetBeforeMinutes: 60,
      offsetAfterMinutes: 120,
      deltaMinutes: 60,
      at: Date.parse('2026-03-29T01:00:00Z'),
    });
  });

  it('EU exits DST 2026-10-25: offset moves +120 -> +60 at 01:00 UTC', () => {
    const transition = detectOne('Europe/Berlin', 'UTC', '2026-10-20T00:00:00Z').entries[0].transition;
    expect(transition).toMatchObject({
      date: '2026-10-25',
      offsetBeforeMinutes: 120,
      offsetAfterMinutes: 60,
      deltaMinutes: -60,
      at: Date.parse('2026-10-25T01:00:00Z'),
    });
  });

  it('Australia enters DST 2026-10-04 (southern hemisphere): offset increases in October', () => {
    const transition = detectOne('Australia/Sydney', 'UTC', '2026-09-27T00:00:00Z').entries[0].transition;
    expect(transition).toMatchObject({
      date: '2026-10-04',
      offsetBeforeMinutes: 600,
      offsetAfterMinutes: 660,
      deltaMinutes: 60,
      at: Date.parse('2026-10-03T16:00:00Z'),
    });
  });

  it('Lord Howe shifts by 30 minutes, not an hour', () => {
    const transition = detectOne('Australia/Lord_Howe', 'UTC', '2026-09-27T00:00:00Z').entries[0].transition;
    expect(transition).toMatchObject({ date: '2026-10-04', offsetBeforeMinutes: 630, offsetAfterMinutes: 660, deltaMinutes: 30 });
  });

  it('returns no transition and no gap change when nothing switches inside the window', () => {
    const result = detectOne('Asia/Tokyo', 'Asia/Kolkata', '2026-03-22T00:00:00Z');
    expect(result.reference.transition).toBeNull();
    expect(result.entries[0].transition).toBeNull();
    expect(result.entries[0].gapChange).toBeNull();
  });
});

describe('detectDstTransitions — the lead window', () => {
  // Boston switches 2026-11-01 06:00Z.
  it('finds a switch exactly leadDays away, not one a day further', () => {
    expect(detectOne('America/New_York', 'UTC', '2026-10-18T12:00:00Z', 14).entries[0].transition?.daysFromNow).toBe(14);
    expect(detectOne('America/New_York', 'UTC', '2026-10-17T12:00:00Z', 14).entries[0].transition).toBeNull();
  });

  it('reads settings.dstLeadDays when no leadDays is given', () => {
    const result = detectDstTransitions({
      entries: [createEntry({ timezone: 'America/New_York' })],
      settings: settingsWithReference('UTC', 3),
      fromDate: new Date('2026-10-25T12:00:00Z'),
    });
    expect(result.entries[0].transition).toBeNull();
  });

  it('counts a switch later today, and not one already past', () => {
    // 01:00 EDT on Nov 1: the switch is an hour away.
    expect(detectOne('America/New_York', 'UTC', '2026-11-01T05:00:00Z').entries[0].transition?.daysFromNow).toBe(0);
    // 10:00 EST on Nov 1: it happened this morning.
    expect(detectOne('America/New_York', 'UTC', '2026-11-01T15:00:00Z').entries[0].transition).toBeNull();
  });
});

describe('detectDstTransitions — the gap to the reference (§6.2)', () => {
  it('Tokyo vs Berlin, one-sided: only Berlin moves, the gap changes all the same', () => {
    const result = detectOne('Europe/Berlin', 'Asia/Tokyo', '2026-03-22T00:00:00Z');
    expect(result.reference.transition).toBeNull();
    expect(result.entries[0].gapChange).toMatchObject({
      mover: 'entry',
      date: '2026-03-29',
      gapBeforeMinutes: -8 * 60,
      gapAfterMinutes: -7 * 60,
      entryOffsetAfterMinutes: 120,
      referenceOffsetAfterMinutes: 540,
    });
  });

  it('Berlin vs Tokyo, the other way round: the reference moves, Tokyo never does', () => {
    const result = detectOne('Asia/Tokyo', 'Europe/Berlin', '2026-10-20T00:00:00Z');
    expect(result.entries[0].transition).toBeNull();
    expect(result.reference.transition?.date).toBe('2026-10-25');
    expect(result.entries[0].gapChange).toMatchObject({
      mover: 'reference',
      date: '2026-10-25',
      gapBeforeMinutes: 7 * 60,
      gapAfterMinutes: 8 * 60,
      switchKeys: ['Europe/Berlin@2026-10-25'],
    });
  });

  it('Tokyo vs Boston on 2026-11-01: 13 hours → 14 hours', () => {
    const gap = detectOne('America/New_York', 'Asia/Tokyo', '2026-10-23T00:00:00Z').entries[0].gapChange;
    expect(gap).toMatchObject({
      mover: 'entry',
      date: '2026-11-01',
      daysFromNow: 9,
      gapBeforeMinutes: -13 * 60,
      gapAfterMinutes: -14 * 60,
      entryOffsetAfterMinutes: -300,
      switchKeys: ['America/New_York@2026-11-01'],
    });
  });

  it("Sydney seen from Boston: the date and day count are the reference's own", () => {
    // Sydney's 02:00 on Oct 4 is noon on Oct 3 in Boston.
    const gap = detectOne('Australia/Sydney', 'America/New_York', '2026-09-28T12:00:00Z').entries[0].gapChange;
    expect(gap).toMatchObject({
      mover: 'entry',
      date: '2026-10-03',
      daysFromNow: 5,
      gapBeforeMinutes: 14 * 60,
      gapAfterMinutes: 15 * 60,
    });
  });

  it('Berlin, then Boston a week later: the next change is the reference’s', () => {
    const gap = detectOne('America/New_York', 'Europe/Berlin', '2026-10-20T00:00:00Z').entries[0].gapChange;
    expect(gap).toMatchObject({ mover: 'reference', date: '2026-10-25', gapBeforeMinutes: -360, gapAfterMinutes: -300 });
  });

  it('…and once Berlin has switched, Boston’s own change is next', () => {
    const gap = detectOne('America/New_York', 'Europe/Berlin', '2026-10-26T00:00:00Z').entries[0].gapChange;
    expect(gap).toMatchObject({ mover: 'entry', date: '2026-11-01', gapBeforeMinutes: -300, gapAfterMinutes: -360 });
  });

  it('no gap change for an entry in the reference zone, or one that switches with it', () => {
    const result = detectDstTransitions({
      entries: [
        createEntry({ timezone: 'Europe/Berlin' }),
        createEntry({ timezone: 'Europe/London' }),
        createEntry({ timezone: 'America/Chicago' }),
      ],
      settings: settingsWithReference('Europe/Berlin'),
      fromDate: new Date('2026-10-20T00:00:00Z'),
    });
    expect(result.entries[0].transition).not.toBeNull();
    expect(result.entries[0].gapChange).toBeNull();
    expect(result.entries[1].gapChange).toBeNull();
    expect(result.entries[2].gapChange?.mover).toBe('reference');
  });

  it('New York vs Chicago switch an hour apart; the gap is the same after, so no change', () => {
    const result = detectOne('America/New_York', 'America/Chicago', '2026-10-25T00:00:00Z');
    expect(result.entries[0].transition).not.toBeNull();
    expect(result.reference.transition).not.toBeNull();
    expect(result.entries[0].gapChange).toBeNull();
  });

  it('a gap change past the window in the reference’s calendar is left out', () => {
    // Anchorage's 02:00 on Nov 1 is 00:00 on Nov 2 in Kiritimati: at 00:30
    // on Oct 18 in Anchorage (22:30 in Kiritimati) that's day 14 for
    // Anchorage, day 15 for the reference.
    const result = detectOne('America/Anchorage', 'Pacific/Kiritimati', '2026-10-18T08:30:00Z', 14);
    expect(result.entries[0].transition?.daysFromNow).toBe(14);
    expect(result.entries[0].gapChange).toBeNull();
  });

  it('an old zone name is the same switch as the current one', () => {
    const transition = detectZoneTransition('US/Eastern', new Date('2026-10-25T00:00:00Z'), 14)!;
    expect(dstSwitchKey('US/Eastern', transition)).toBe('America/New_York@2026-11-01');
  });
});
