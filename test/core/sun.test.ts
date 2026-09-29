import { describe, expect, it } from 'vitest';
import { DAY_ABOVE, NIGHT_BELOW, solarNoon, sunCoordinates, sunElevation, timeOfDay } from '../../src/core/sun';
import { localWallClockUtcMillis } from '../../src/core/tz';
import sky312 from '../fixtures/sky-3.1.2.json';

interface Day {
  sunriseMinutes: number;
  sunsetMinutes: number;
  timeline: string;
}
interface City {
  lat: number;
  lon: number;
  zone: string;
  days: Record<string, Day>;
}
const CITIES = sky312.cities as Record<string, City>;
const CODE = { night: '.', dawn: 'a', day: 'D', twilight: 't' } as const;

// The zone's local wall-clock `minutes` on `date` (YYYY-MM-DD), as an instant.
function localInstant(zone: string, date: string, minutes: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(localWallClockUtcMillis(zone, y, m, d, Math.floor(minutes / 60), minutes % 60));
}

// Every 15 minutes of the local day, as the fixture samples it.
function timeline(city: City, date: string): string {
  return Array.from({ length: 96 }, (_, i) => CODE[timeOfDay(city.lat, city.lon, localInstant(city.zone, date, i * 15))]).join('');
}

// Where the phase changes: [sample index, from, to] for each change.
function boundaries(line: string): Array<[number, string, string]> {
  const out: Array<[number, string, string]> = [];
  for (let i = 1; i < line.length; i++) if (line[i] !== line[i - 1]) out.push([i, line[i - 1], line[i]]);
  return out;
}

describe('sunElevation — NOAA, checked against Open-Meteo', () => {
  // Open-Meteo's sunrise and sunset (to the minute, truncated) are the moments
  // the sun's centre is at −0.83° geometric elevation.
  const events = Object.entries(CITIES).flatMap(([name, city]) =>
    Object.entries(city.days)
      .filter(([, day]) => day.sunriseMinutes < day.sunsetMinutes)
      .flatMap(([date, day]) => [
        [name, date, 'sunrise', localInstant(city.zone, date, day.sunriseMinutes), city] as const,
        [name, date, 'sunset', localInstant(city.zone, date, day.sunsetMinutes), city] as const,
      ])
  );

  it.each(events)('%s %s %s: the sun is at the horizon', (_name, _date, _event, instant, city) => {
    // ±1 minute of truncation moves the sun by up to about 0.25°.
    expect(sunElevation(city.lat, city.lon, instant)).toBeGreaterThan(-1.2);
    expect(sunElevation(city.lat, city.lon, instant)).toBeLessThan(-0.45);
  });
});

describe('solarNoon', () => {
  it('is when the sun is highest, and splits its solar day', () => {
    const tokyo = CITIES.Tokyo;
    const morning = localInstant(tokyo.zone, '2026-06-21', 8 * 60);
    const noon = solarNoon(tokyo.lon, morning);
    // Tokyo is 4.7° east of its zone's 135°E meridian: noon about 19 minutes early.
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: tokyo.zone, hour: '2-digit', minute: '2-digit' }).format(noon)).toBe('11:42');
    const at = (ms: number) => sunElevation(tokyo.lat, tokyo.lon, new Date(noon.getTime() + ms));
    expect(at(0)).toBeGreaterThan(at(-5 * 60000));
    expect(at(0)).toBeGreaterThan(at(5 * 60000));
    // An evening time belongs to the same solar day: same noon.
    const evening = localInstant(tokyo.zone, '2026-06-21', 20 * 60);
    expect(Math.abs(solarNoon(tokyo.lon, evening).getTime() - noon.getTime())).toBeLessThan(1000);
  });
});

describe('timeOfDay — the sky 3.1.2 showed, from elevation alone (spec §9.2)', () => {
  it('uses the thresholds the spec gives', () => {
    expect([NIGHT_BELOW, DAY_ABOVE]).toEqual([-9, 7]);
  });

  // Every boundary within one 15-minute sample of where 3.1.2 put it, except
  // London at the solstices: two samples — a fixed band of elevation takes
  // longer to cross far from the equator (spec §9.2).
  const cases = ['Tokyo', 'London', 'New York', 'Sydney', 'Singapore'].flatMap((name) =>
    Object.keys(CITIES[name].days).map((date) => [name, date] as const)
  );
  it.each(cases)('%s %s', (name, date) => {
    const city = CITIES[name];
    const before = boundaries(city.days[date].timeline);
    const now = boundaries(timeline(city, date));

    expect(now.map(([, from, to]) => from + to)).toEqual(before.map(([, from, to]) => from + to));
    const allowed = name === 'London' && /-(06|12)-21$/.test(date) ? 2 : 1;
    now.forEach(([i], k) => expect(Math.abs(i - before[k][0])).toBeLessThanOrEqual(allowed));
  });
});

describe('timeOfDay — polar days and nights', () => {
  it('midnight sun in Tromsø: never night; twilight until solar midnight (~00:46), then dawn', () => {
    const line = timeline(CITIES['Tromsø'], '2026-06-21');
    expect(line).toMatch(/^t+a+D+t+$/);
    expect(line.indexOf('a')).toBe(4); // 01:00, the first sample past solar midnight
  });

  it('polar night in Tromsø: never day; the noon glow is dawn, then twilight', () => {
    const line = timeline(CITIES['Tromsø'], '2025-12-21');
    expect(line).not.toContain('D');
    expect(line).toMatch(/^\.+a+t+\.+$/);
  });

  it('Reykjavík in June, sunset after midnight: day through the evening, not night', () => {
    const line = timeline(CITIES['Reykjavík'], '2026-06-21');
    expect(line.slice(12 * 4, 21 * 4)).toMatch(/^D+$/); // 12:00–21:00
  });
});

describe('sunCoordinates', () => {
  const at = new Date('2026-06-21T12:00:00Z');

  it("uses the city's own coordinates — 0 is a coordinate, not a missing one", () => {
    expect(sunCoordinates('Asia/Tokyo', 35.68, 139.69, at)).toEqual({ lat: 35.68, lon: 139.69 });
    expect(sunCoordinates('Africa/Accra', 5.6, 0, at)).toEqual({ lat: 5.6, lon: 0 });
    expect(sunCoordinates('Africa/Libreville', 0, 9.45, at)).toEqual({ lat: 0, lon: 9.45 });
  });

  it("falls back to the zone's principal location from zone.tab", () => {
    expect(sunCoordinates('Asia/Tokyo', undefined, undefined, at)).toEqual({ lat: 35.65, lon: 139.74 });
    expect(sunCoordinates('Asia/Tokyo', 35.68, undefined, at)).toEqual({ lat: 35.65, lon: 139.74 });
  });

  it("finds an old name through tzdata's backward links (Chrome reports Asia/Calcutta)", () => {
    expect(sunCoordinates('Asia/Calcutta', undefined, undefined, at)).toEqual(
      sunCoordinates('Asia/Kolkata', undefined, undefined, at)
    );
  });

  it('puts a zone with no location on the equator, at the longitude its offset stands for', () => {
    expect(sunCoordinates('Etc/GMT-9', undefined, undefined, at)).toEqual({ lat: 0, lon: 135 });
    expect(sunCoordinates('UTC', undefined, undefined, at)).toEqual({ lat: 0, lon: 0 });
  });
});
