import { describe, expect, it } from 'vitest';
import { createEntry, DEFAULT_SETTINGS, referenceRoleOf, resolveReferenceChip } from '../../src/core/model';
import {
  canonicalZone,
  friendlyZoneName,
  offsetMinutes,
  resolveIntlZone,
  sameZone,
  toIntlZone,
} from '../../src/core/tz';
import { ZONES as CITY_ZONES } from '../../src/data/cities';
import { ZONE_COORDINATES } from '../../src/data/zoneCoordinates';
import { ZONE_LINKS } from '../../src/data/zoneLinks';

// Zone names (spec §4.2): stored names stay as they are; comparisons use
// sameZone(), Intl gets toIntlZone().

describe('canonicalZone', () => {
  it.each([
    ['Asia/Calcutta', 'Asia/Kolkata'],
    ['Europe/Kiev', 'Europe/Kyiv'],
    ['Asia/Saigon', 'Asia/Ho_Chi_Minh'],
    ['America/Buenos_Aires', 'America/Argentina/Buenos_Aires'],
    ['US/Eastern', 'America/New_York'],
    ['UTC', 'Etc/UTC'],
  ])('%s → %s', (old, current) => {
    expect(canonicalZone(old)).toBe(current);
  });

  it('leaves a current name alone', () => {
    expect(canonicalZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(canonicalZone('Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  // backward links these to the zone they share rules with (Abidjan, Berlin),
  // but they are what Ghana and Norway call their zones today.
  it('keeps names zone.tab still lists, even when backward merges them', () => {
    expect(canonicalZone('Africa/Accra')).toBe('Africa/Accra');
    expect(canonicalZone('Europe/Oslo')).toBe('Europe/Oslo');
    expect(friendlyZoneName('Africa/Accra')).toBe('Accra');
  });

  it('leaves a name it doesn’t know alone', () => {
    expect(canonicalZone('Etc/GMT-9')).toBe('Etc/GMT-9');
    expect(canonicalZone('Not/A_Zone')).toBe('Not/A_Zone');
  });
});

describe('sameZone', () => {
  it('matches an old name with its current one, either way round', () => {
    expect(sameZone('Asia/Calcutta', 'Asia/Kolkata')).toBe(true);
    expect(sameZone('Europe/Kyiv', 'Europe/Kiev')).toBe(true);
    expect(sameZone('UTC', 'Etc/UTC')).toBe(true);
  });

  it('keeps different zones apart', () => {
    expect(sameZone('Asia/Kolkata', 'Asia/Colombo')).toBe(false);
    expect(sameZone('Africa/Accra', 'Africa/Abidjan')).toBe(false);
  });
});

describe('toIntlZone', () => {
  it('falls back to an old spelling when the engine doesn’t know the new name', () => {
    const oldEngine = (name: string) => name !== 'Europe/Kyiv';
    expect(resolveIntlZone('Europe/Kyiv', oldEngine)).toBe('Europe/Kiev');
  });

  it('keeps the name when the engine takes it, and when nothing works', () => {
    expect(resolveIntlZone('Asia/Calcutta', () => true)).toBe('Asia/Calcutta');
    expect(resolveIntlZone('Europe/Kyiv', () => false)).toBe('Europe/Kyiv');
  });

  it('an old name and its current one give the same offsets', () => {
    const at = new Date('2026-06-21T12:00:00Z');
    expect(offsetMinutes('Asia/Calcutta', at)).toBe(offsetMinutes('Asia/Kolkata', at));
    expect(offsetMinutes('Europe/Kiev', at)).toBe(offsetMinutes('Europe/Kyiv', at));
  });

  // Every name the extension can meet: the city library's, zone.tab's, and
  // backward's old names with their targets.
  const everyZone = [
    ...new Set([...CITY_ZONES, ...Object.keys(ZONE_COORDINATES), ...Object.keys(ZONE_LINKS), ...Object.values(ZONE_LINKS)]),
  ];
  it(`gives Intl a name it accepts for all ${everyZone.length} known zones`, () => {
    for (const zone of everyZone) {
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: toIntlZone(zone) }), zone).not.toThrow();
    }
  });
});

// Chrome reports these zones by their old names; the list has the new ones.
describe.each([
  ['Asia/Calcutta', 'Asia/Kolkata', 'Kolkata'],
  ['Europe/Kiev', 'Europe/Kyiv', 'Kyiv'],
  ['Asia/Saigon', 'Asia/Ho_Chi_Minh', 'Ho Chi Minh'],
])('system zone %s, city in %s', (systemZone, cityZone, name) => {
  const mine = createEntry({ id: 'mine', timezone: cityZone, label: 'Home' });
  const colleague = createEntry({ id: 'colleague', timezone: cityZone, label: 'Colleague' });
  const elsewhere = createEntry({ id: 'elsewhere', timezone: 'Asia/Tokyo', label: 'Tokyo' });
  const entries = [elsewhere, mine, colleague];

  it(`System: the city is YOU, and the chip reads ${name}`, () => {
    const chip = resolveReferenceChip(entries, DEFAULT_SETTINGS, systemZone);
    expect(chip.youEntryId).toBe('mine');
    expect(chip.label).toBe(name);
    expect(referenceRoleOf(colleague, chip, systemZone)).toBe('base');
    expect(referenceRoleOf(elsewhere, chip, systemZone)).toBeNull();
  });

  it(`System with no city in the zone: the chip still reads ${name}`, () => {
    expect(resolveReferenceChip([elsewhere], DEFAULT_SETTINGS, systemZone).label).toBe(name);
  });
});
