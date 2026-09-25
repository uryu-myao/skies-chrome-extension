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

  it('no entries at all: empty state, no error', () => {
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

// Friday 2026-09-25 15:00 JST — a work day in every city below, Boston
// included (02:00 Friday EDT; Tokyo–Boston is 13h while the US is on DST).
const FRIDAY_AFTERNOON_JST = new Date('2026-09-25T06:00:00Z');

function slotOf(refTime: string): number {
  const [hours, minutes] = refTime.split(':').map(Number);
  return (hours * 60 + minutes) / 30;
}

function asiaAndBoston() {
  return {
    shanghai: createEntry({ timezone: 'Asia/Shanghai', label: 'Shanghai' }),
    boston: createEntry({ timezone: 'America/New_York', label: 'Boston' }),
    tokyo: createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' }),
    kathmandu: createEntry({ timezone: 'Asia/Kathmandu', label: 'Kathmandu' }),
    bangkok: createEntry({ timezone: 'Asia/Bangkok', label: 'Bangkok' }),
  };
}

describe('coreTime — closest (§5.3 NO_OVERLAP_TODAY)', () => {
  it('closest avoids the end boundary; a tie returns every bottleneck, in list order', () => {
    // Two cities on US Eastern, so dropping either one alone still leaves
    // no overlap — no single outlier, this stays NO_OVERLAP_TODAY.
    const { shanghai, boston, tokyo, kathmandu, bangkok } = asiaAndBoston();
    const newYork = createEntry({ timezone: 'America/New_York', label: 'New York' });
    const result = coreTime({
      entries: [shanghai, boston, tokyo, kathmandu, bangkok, newYork],
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: FRIDAY_AFTERNOON_JST,
    });

    const { conclusion } = result;
    expect(conclusion.status).toBe('NO_OVERLAP_TODAY');
    if (conclusion.status !== 'NO_OVERLAP_TODAY') return;
    const { closest } = conclusion;

    // 18:30, 19:00 and 19:30 all total 480 min; earliest wins. Every entry
    // here ends at 18:00, and none sits on it — 18:00 used to score 0.
    expect(closest.refTime).toBe('18:30');
    expect(closest.perEntry.map((p) => p.localTime)).not.toContain('18:00');
    // Boston and New York are both 210 min out: neither alone is the
    // bottleneck. Tokyo is out too (60 min) but not at the max.
    expect(closest.gapMinutes).toBe(210);
    expect(closest.bottleneckEntryIds).toEqual([boston.id, newYork.id]);
    expect(closest.perEntry.find((p) => p.entryId === boston.id)).toMatchObject({
      localTime: '05:30',
      deviationMinutes: 210,
      direction: 'BEFORE_START',
    });
    // Kathmandu's +5:45 puts its local times on :15/:45, off the 30-min
    // grid; inside its window that must still be exactly 0, no residue.
    expect(closest.perEntry.find((p) => p.entryId === kathmandu.id)).toMatchObject({
      localTime: '15:15',
      deviationMinutes: 0,
      direction: null,
    });
  });

  it('a deviation of 0 means exactly a working block — rows and closest share one definition', () => {
    const tokyo = createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' });
    const entries = [tokyo, createEntry({ timezone: 'America/New_York', label: 'Boston' })];
    const result = coreTime({
      entries,
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: REFERENCE_DATE,
    });

    const { conclusion } = result;
    expect(conclusion.status).toBe('NO_OVERLAP_TODAY');
    if (conclusion.status !== 'NO_OVERLAP_TODAY') return;
    const slot = slotOf(conclusion.closest.refTime);

    // This pair used to land on 07:00 JST with Boston at exactly 18:00 —
    // deviation 0 but not a working block.
    expect(conclusion.closest.refTime).toBe('06:30');
    for (const p of conclusion.closest.perEntry) {
      const row = result.rows.find((r) => r.entryId === p.entryId)!;
      expect(p.deviationMinutes === 0).toBe(row.blocks[slot]);
    }
    expect(conclusion.closest.gapMinutes).toBeGreaterThan(0);
    // A single bottleneck: Tokyo, 150 min before its day starts.
    expect(conclusion.closest.bottleneckEntryIds).toEqual([tokyo.id]);
  });

  it('bottleneck after its day ends: the outnumbered side stays late', () => {
    // Three cities on +9 against two on US Eastern: keeping the three inside
    // their day is cheapest, so the two absorb it — the evening before.
    const tokyo = createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' });
    const seoul = createEntry({ timezone: 'Asia/Seoul', label: 'Seoul' });
    const palau = createEntry({ timezone: 'Pacific/Palau', label: 'Palau' });
    const newYork = createEntry({ timezone: 'America/New_York', label: 'New York' });
    const toronto = createEntry({ timezone: 'America/Toronto', label: 'Toronto' });
    const result = coreTime({
      entries: [tokyo, seoul, palau, newYork, toronto],
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: REFERENCE_DATE,
    });

    const { conclusion } = result;
    expect(conclusion.status).toBe('NO_OVERLAP_TODAY');
    if (conclusion.status !== 'NO_OVERLAP_TODAY') return;

    // 09:00 JST = 20:00 EDT the evening before. A meeting there runs
    // 20:00–20:30, 150 min past New York's 18:00 end.
    expect(conclusion.closest.refTime).toBe('09:00');
    expect(conclusion.closest.bottleneckEntryIds).toEqual([newYork.id, toronto.id]);
    expect(conclusion.closest.gapMinutes).toBe(150);
    expect(conclusion.closest.perEntry.find((p) => p.entryId === newYork.id)).toMatchObject({
      localTime: '20:00',
      direction: 'AFTER_END',
    });
  });
});

describe('coreTime — PARTIAL_OVERLAP (§5.3 leave-one-out)', () => {
  it('one outlier: all but Boston overlap, and the full overlap stays empty', () => {
    const { shanghai, boston, tokyo, kathmandu, bangkok } = asiaAndBoston();
    const result = coreTime({
      entries: [shanghai, boston, tokyo, kathmandu, bangkok],
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: FRIDAY_AFTERNOON_JST,
    });

    expect(result.overlap).toEqual([]);
    // 12:30 JST = 09:15 in Kathmandu (its first working slot on this axis),
    // 18:00 = Tokyo's end. Slots 25–36.
    expect(result.conclusion).toEqual({
      status: 'PARTIAL_OVERLAP',
      overlap: [{ startSlot: 25, endSlot: 36 }],
      includedIds: [shanghai.id, tokyo.id, kathmandu.id, bangkok.id],
      excludedId: boston.id,
    });
  });

  it('several candidates: no single outlier to name, falls back to closest', () => {
    // Dropping Boston leaves Tokyo + London (17:00–18:00 JST); dropping Tokyo
    // leaves Boston + London. Two candidates, so neither is "the" outlier.
    const entries = [
      createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' }),
      createEntry({ timezone: 'America/New_York', label: 'Boston' }),
      createEntry({ timezone: 'Europe/London', label: 'London' }),
    ];
    const result = coreTime({
      entries,
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: REFERENCE_DATE,
    });

    expect(result.conclusion.status).toBe('NO_OVERLAP_TODAY');
  });

  it('no candidate: two cities on each side, no single drop helps, falls back to closest', () => {
    const entries = [
      createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' }),
      createEntry({ timezone: 'Asia/Seoul', label: 'Seoul' }),
      createEntry({ timezone: 'America/New_York', label: 'Boston' }),
      createEntry({ timezone: 'America/New_York', label: 'New York' }),
    ];
    const result = coreTime({
      entries,
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: REFERENCE_DATE,
    });

    expect(result.conclusion.status).toBe('NO_OVERLAP_TODAY');
  });

  it('someone off today is PARTIAL_OFF, even when the rest would overlap without them', () => {
    // Saturday: Tokyo is off. Dropping Tokyo would leave Shanghai + Singapore
    // overlapping, but that's a workDays matter, not an hours outlier.
    const tokyo = createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' });
    const shanghai = createEntry({
      timezone: 'Asia/Shanghai',
      label: 'Shanghai',
      workDays: [1, 2, 3, 4, 5, 6],
    });
    const singapore = createEntry({
      timezone: 'Asia/Singapore',
      label: 'Singapore',
      workDays: [1, 2, 3, 4, 5, 6],
    });
    const result = coreTime({
      entries: [tokyo, shanghai, singapore],
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: SATURDAY_NOON_JST,
    });

    expect(result.conclusion.status).toBe('PARTIAL_OFF');
  });
});

describe('coreTime — includeInCoreTime', () => {
  it('an excluded entry keeps its row but takes no part in the overlap or conclusion', () => {
    const { shanghai, boston, tokyo, kathmandu, bangkok } = asiaAndBoston();
    const excludedBoston = { ...boston, includeInCoreTime: false };
    const result = coreTime({
      entries: [shanghai, excludedBoston, tokyo, kathmandu, bangkok],
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: FRIDAY_AFTERNOON_JST,
    });

    // Rows for everyone, in list order, so the panel can show Boston dimmed.
    expect(result.rows.map((row) => [row.entryId, row.included])).toEqual([
      [shanghai.id, true],
      [boston.id, false],
      [tokyo.id, true],
      [kathmandu.id, true],
      [bangkok.id, true],
    ]);
    expect(result.rows[1].blocks.some(Boolean)).toBe(true);
    // Without Boston the other four overlap — the same range PARTIAL_OVERLAP
    // pointed at.
    expect(result.overlap).toEqual([{ startSlot: 25, endSlot: 36 }]);
    expect(result.conclusion).toEqual({ status: 'OVERLAP' });
  });

  it('every entry excluded: NO_ENTRIES, rows still returned', () => {
    const entries = Object.values(asiaAndBoston()).map((entry) => ({
      ...entry,
      includeInCoreTime: false,
    }));
    const result = coreTime({
      entries,
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: FRIDAY_AFTERNOON_JST,
    });

    expect(result.rows).toHaveLength(5);
    expect(result.rows.every((row) => !row.included)).toBe(true);
    expect(result.overlap).toEqual([]);
    expect(result.conclusion).toEqual({ status: 'NO_ENTRIES' });
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

// Saturday 2026-07-18 12:00 in Tokyo, 11:00 in Singapore/Shanghai — the
// weekend on both sides.
const SATURDAY_NOON_JST = new Date('2026-07-18T03:00:00Z');
// Saturday 2026-07-18 10:00 in Tokyo, but still Friday 21:00 in New York.
const SATURDAY_MORNING_JST = new Date('2026-07-18T01:00:00Z');
// Sunday 2026-07-19 12:00 in Tokyo, 11:00 in Singapore.
const SUNDAY_NOON_JST = new Date('2026-07-19T03:00:00Z');

describe('coreTime — §5.3 off-day states', () => {
  it('ALL_OFF: everyone is on their weekend, nextOverlap skips Sunday to Monday', () => {
    const tokyo = createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' });
    const singapore = createEntry({ timezone: 'Asia/Singapore', label: 'Singapore' });
    const result = coreTime({
      entries: [tokyo, singapore],
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: SATURDAY_NOON_JST,
    });

    expect(result.overlap).toEqual([]);
    // Monday 10:00-18:00 JST: Singapore starts 09:00 SGT = 10:00 JST (slot
    // 20), Tokyo ends 18:00 (slot 36)
    expect(result.conclusion).toEqual({
      status: 'ALL_OFF',
      offEntryIds: [tokyo.id, singapore.id],
      nextOverlap: { daysFromToday: 2, weekday: 1, startSlot: 20, endSlot: 36 },
    });
  });

  it('ALL_OFF for an entry on the reference timezone itself, not a failed closest (§5.3 artifact a)', () => {
    // Zero offset from the reference means a constant local weekday across
    // the whole axis — the case that used to fall through to closest = null.
    const tokyo = createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' });
    const result = coreTime({
      entries: [tokyo],
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: SATURDAY_NOON_JST,
    });

    expect(result.conclusion).toEqual({
      status: 'ALL_OFF',
      offEntryIds: [tokyo.id],
      nextOverlap: { daysFromToday: 2, weekday: 1, startSlot: 18, endSlot: 36 },
    });
  });

  it('nextOverlap counts from tomorrow: a Sunday finds Monday at daysFromToday 1', () => {
    const tokyo = createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' });
    const singapore = createEntry({ timezone: 'Asia/Singapore', label: 'Singapore' });
    const result = coreTime({
      entries: [tokyo, singapore],
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: SUNDAY_NOON_JST,
    });

    expect(result.conclusion).toEqual({
      status: 'ALL_OFF',
      offEntryIds: [tokyo.id, singapore.id],
      nextOverlap: { daysFromToday: 1, weekday: 1, startSlot: 20, endSlot: 36 },
    });
  });

  it('PARTIAL_OFF: only the entry whose own workDays include Saturday is working', () => {
    const tokyo = createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' });
    const shanghai = createEntry({
      timezone: 'Asia/Shanghai',
      label: 'Shanghai',
      workDays: [1, 2, 3, 4, 5, 6],
    });
    const result = coreTime({
      entries: [tokyo, shanghai],
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: SATURDAY_NOON_JST,
    });

    expect(result.overlap).toEqual([]);
    // Next *full* overlap needs Tokyo back too: Monday, 09:00 CST = 10:00 JST
    expect(result.conclusion).toEqual({
      status: 'PARTIAL_OFF',
      workingEntryIds: [shanghai.id],
      offEntryIds: [tokyo.id],
      nextOverlap: { daysFromToday: 2, weekday: 1, startSlot: 20, endSlot: 36 },
    });
  });

  it("PARTIAL_OFF judges each entry by its own weekday at referenceDate: Tokyo's Saturday is New York's Friday", () => {
    const tokyo = createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo' });
    const newYork = createEntry({ timezone: 'America/New_York', label: 'New York' });
    const result = coreTime({
      entries: [tokyo, newYork],
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: SATURDAY_MORNING_JST,
    });

    // Default hours never overlap across a 13h gap, so all 7 lookahead days
    // come up empty: null, not a fallback suggestion.
    expect(result.conclusion).toEqual({
      status: 'PARTIAL_OFF',
      workingEntryIds: [newYork.id],
      offEntryIds: [tokyo.id],
      nextOverlap: null,
    });
  });

  it('nextOverlap is null when the 7-day search finds nothing — an entry that never works', () => {
    const tokyo = createEntry({ timezone: 'Asia/Tokyo', label: 'Tokyo', workDays: [] });
    const result = coreTime({
      entries: [tokyo],
      settings: settingsWithReference('Asia/Tokyo'),
      referenceDate: REFERENCE_DATE,
    });

    expect(result.conclusion).toEqual({
      status: 'ALL_OFF',
      offEntryIds: [tokyo.id],
      nextOverlap: null,
    });
  });
});
