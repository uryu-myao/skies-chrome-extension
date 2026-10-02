// City search over the bundled GeoNames library (src/data/cities.ts, spec
// §9.6). Pure: the library is passed in, so the popup loads it only when the
// search opens and tests can hand in a small one.

export interface CityLibrary {
  COUNTRIES: Readonly<Record<string, string>>;
  REGIONS: readonly string[];
  ZONES: readonly string[];
  // One city per line: name, country, region index, lat, lon, zone index,
  // population, other names separated by |.
  CITIES: string;
}

export interface City {
  city: string;
  zone: string;
  country: string;
  countryCode: string;
  region: string;
  lat: number;
  lon: number;
  population: number;
}

interface IndexedCity {
  city: City;
  names: string[]; // every searchable name, normalized
}

export type CityIndex = readonly IndexedCity[];

// Case, accents and punctuation don't count: "sao paulo" finds São Paulo,
// "winston salem" finds Winston-Salem. NFKD also folds full-width letters.
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function buildCityIndex(library: CityLibrary): CityIndex {
  return library.CITIES.split('\n').map((line) => {
    const [name, countryCode, region, lat, lon, zone, population, others] = line.split('\t');
    return {
      city: {
        city: name,
        zone: library.ZONES[+zone],
        country: library.COUNTRIES[countryCode] ?? countryCode,
        countryCode,
        region: library.REGIONS[+region],
        lat: +lat,
        lon: +lon,
        population: +population,
      },
      names: [...new Set([name, ...(others ? others.split('|') : [])].map(normalizeForSearch))],
    };
  });
}

// As many results as the search showed before (Open-Meteo's count=8).
export const SEARCH_RESULT_LIMIT = 8;

// Cities whose name — any of them — is the query, then those whose name
// starts with it; each group most populous first. The index is already
// most-populous-first, so a stable filter keeps that order.
export function searchCities(index: CityIndex, query: string, limit = SEARCH_RESULT_LIMIT): City[] {
  const q = normalizeForSearch(query);
  if (!q) return [];
  const exact: City[] = [];
  const prefix: City[] = [];
  for (const { city, names } of index) {
    if (names.includes(q)) exact.push(city);
    else if (names.some((name) => name.startsWith(q))) prefix.push(city);
  }
  return [...exact, ...prefix].slice(0, limit);
}
