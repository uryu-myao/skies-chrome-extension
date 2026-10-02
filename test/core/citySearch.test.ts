import { describe, expect, it } from 'vitest';
import { buildCityIndex, normalizeForSearch, searchCities, SEARCH_RESULT_LIMIT, type CityLibrary } from '../../src/core/citySearch';
import * as library from '../../src/data/cities';

describe('normalizeForSearch', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeForSearch('São Paulo')).toBe('sao paulo');
    expect(normalizeForSearch('  WINSTON-Salem ')).toBe('winston salem');
    expect(normalizeForSearch('Ōsaka')).toBe('osaka');
    expect(normalizeForSearch('Kraków')).toBe('krakow');
  });

  it('folds full-width letters and keeps CJK as it is', () => {
    expect(normalizeForSearch('Ｔｏｋｙｏ')).toBe('tokyo');
    expect(normalizeForSearch('東京')).toBe('東京');
  });
});

describe('searchCities — ranking', () => {
  // Most populous first, as the generated library is.
  const tiny: CityLibrary = {
    COUNTRIES: { US: 'United States', GB: 'United Kingdom' },
    REGIONS: ['', 'England', 'Illinois', 'Massachusetts'],
    ZONES: ['America/Chicago', 'America/New_York', 'Europe/London'],
    CITIES: [
      'Springfield Heights\tUS\t2\t1\t1\t0\t900000\t',
      'Springfield\tUS\t3\t42.1\t-72.59\t1\t154000\t',
      'Springfield\tUS\t2\t39.8\t-89.64\t0\t114000\t',
      'Sprotbrough\tGB\t1\t53.5\t-1.2\t2\t60000\tSpringfield Town',
    ].join('\n'),
  };
  const index = buildCityIndex(tiny);
  const names = (query: string, limit?: number) =>
    searchCities(index, query, limit).map((city) => `${city.city}, ${city.region}`);

  it('puts exact matches before prefix matches, each by population', () => {
    expect(names('springfield')).toEqual([
      'Springfield, Massachusetts',
      'Springfield, Illinois',
      'Springfield Heights, Illinois',
      'Sprotbrough, England',
    ]);
  });

  it('matches any of a city’s names, and returns the name to show', () => {
    expect(names('springfield town')).toEqual(['Sprotbrough, England']);
  });

  it('returns no more than the limit — 8, as Open-Meteo’s count did', () => {
    expect(SEARCH_RESULT_LIMIT).toBe(8);
    expect(names('spr', 2)).toHaveLength(2);
  });

  it('returns nothing for an empty or punctuation-only query', () => {
    expect(names('')).toEqual([]);
    expect(names(' - ')).toEqual([]);
  });
});

describe('searchCities — the bundled GeoNames library', () => {
  const index = buildCityIndex(library);
  const top = (query: string) =>
    searchCities(index, query)
      .slice(0, 5)
      .map((city) => `${city.city} ${city.countryCode}`);

  it('every zone is one Intl knows, every city has a zone and coordinates', () => {
    for (const zone of library.ZONES) expect(() => new Intl.DateTimeFormat('en', { timeZone: zone })).not.toThrow();
    expect(index.length).toBeGreaterThan(10000);
    for (const { city } of index) {
      expect(city.zone).toBeTruthy();
      expect(Number.isFinite(city.lat) && Number.isFinite(city.lon)).toBe(true);
    }
  });

  it.each([
    ['Tokyo', 'Tokyo JP'],
    ['東京', 'Tokyo JP'],
    ['东京', 'Tokyo JP'],
    ['São Paulo', 'São Paulo BR'],
    ['Sao Paulo', 'São Paulo BR'],
    ['Bengaluru', 'Bengaluru IN'],
    ['Bangalore', 'Bengaluru IN'],
    ['Kolkata', 'Kolkata IN'],
    ['Calcutta', 'Kolkata IN'],
    ['Kyiv', 'Kyiv UA'],
    ['Kiev', 'Kyiv UA'],
    ['Ho Chi Minh', 'Ho Chi Minh City VN'],
    ['Saigon', 'Ho Chi Minh City VN'],
    ['上海', 'Shanghai CN'],
    ['大阪', 'Osaka JP'],
    ['New York', 'New York US'],
  ])('%s → %s first', (query, first) => {
    expect(top(query)[0]).toBe(first);
  });

  it('Springfield: the largest ones, by population', () => {
    expect(searchCities(index, 'Springfield').map((city) => city.region)).toEqual([
      'Missouri',
      'Massachusetts',
      'Illinois',
      'Oregon',
      'Ohio',
    ]);
  });

  it('no colloquial names: "New York" is not Jakarta', () => {
    expect(top('New York')).not.toContain('Jakarta ID');
  });

  it('finds nothing for a place that is not in it', () => {
    expect(searchCities(index, 'Xyzzyq')).toEqual([]);
  });
});
