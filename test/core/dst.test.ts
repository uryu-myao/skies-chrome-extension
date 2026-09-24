import { describe, expect, it } from 'vitest';
import { detectDstTransitions } from '../../src/core/dst';
import { createEntry, DEFAULT_SETTINGS } from '../../src/core/model';
import type { AppSettings } from '../../src/core/types';

function settingsWithReference(timezone: string): AppSettings {
  return { ...DEFAULT_SETTINGS, referenceTimezone: timezone, dstLeadDays: 14 };
}

describe('detectDstTransitions — §10.1 boundary dates', () => {
  it('US enters DST 2026-03-08: offset moves -300 -> -240', () => {
    const result = detectDstTransitions({
      entries: [createEntry({ timezone: 'America/New_York' })],
      settings: settingsWithReference('UTC'),
      fromDate: new Date('2026-03-01T00:00:00Z'),
    });

    const transition = result.entries[0].transition;
    expect(transition).not.toBeNull();
    expect(transition!.date).toBe('2026-03-08');
    expect(transition!.offsetBeforeMinutes).toBe(-300);
    expect(transition!.offsetAfterMinutes).toBe(-240);
    expect(transition!.deltaMinutes).toBe(60);
  });

  it('US exits DST 2026-11-01: offset moves -240 -> -300', () => {
    const result = detectDstTransitions({
      entries: [createEntry({ timezone: 'America/New_York' })],
      settings: settingsWithReference('UTC'),
      fromDate: new Date('2026-10-25T00:00:00Z'),
    });

    const transition = result.entries[0].transition;
    expect(transition).not.toBeNull();
    expect(transition!.date).toBe('2026-11-01');
    expect(transition!.deltaMinutes).toBe(-60);
  });

  it('EU enters DST 2026-03-29: offset moves +60 -> +120', () => {
    const result = detectDstTransitions({
      entries: [createEntry({ timezone: 'Europe/Berlin' })],
      settings: settingsWithReference('UTC'),
      fromDate: new Date('2026-03-22T00:00:00Z'),
    });

    const transition = result.entries[0].transition;
    expect(transition).not.toBeNull();
    expect(transition!.date).toBe('2026-03-29');
    expect(transition!.deltaMinutes).toBe(60);
  });

  it('Australia enters DST 2026-10-04 (southern hemisphere): offset increases, not "falls back"', () => {
    const result = detectDstTransitions({
      entries: [createEntry({ timezone: 'Australia/Sydney' })],
      settings: settingsWithReference('UTC'),
      fromDate: new Date('2026-09-27T00:00:00Z'),
    });

    const transition = result.entries[0].transition;
    expect(transition).not.toBeNull();
    expect(transition!.date).toBe('2026-10-04');
    expect(transition!.offsetBeforeMinutes).toBe(600);
    expect(transition!.offsetAfterMinutes).toBe(660);
    expect(transition!.deltaMinutes).toBe(60);
    expect(transition!.deltaMinutes).toBeGreaterThan(0);
  });

  it('Tokyo vs Berlin: one-sided transition — reference (Tokyo) has none, entry (Berlin) does', () => {
    const result = detectDstTransitions({
      entries: [createEntry({ timezone: 'Europe/Berlin' })],
      settings: settingsWithReference('Asia/Tokyo'),
      fromDate: new Date('2026-03-22T00:00:00Z'),
    });

    expect(result.reference.transition).toBeNull();
    expect(result.entries[0].transition).not.toBeNull();
    expect(result.entries[0].transition!.date).toBe('2026-03-29');
  });

  it('returns null when no transition falls inside the lead window', () => {
    const result = detectDstTransitions({
      entries: [createEntry({ timezone: 'Asia/Tokyo' })],
      settings: settingsWithReference('Asia/Kolkata'),
      fromDate: new Date('2026-03-22T00:00:00Z'),
    });

    expect(result.reference.transition).toBeNull();
    expect(result.entries[0].transition).toBeNull();
  });
});
