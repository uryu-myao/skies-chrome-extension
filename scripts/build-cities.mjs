// Generates src/data/cities.ts — the city search's library — from the
// GeoNames dumps (https://download.geonames.org/export/dump/, CC BY 4.0).
//
//   node scripts/build-cities.mjs
//
// Needs network access (about 210 MB, most of it alternateNamesV2.zip) and
// `unzip`. The output is committed; building the extension never runs this.
//
// Kept: every city with 50,000+ people or that is a national capital,
// except city districts (feature code PPLX). Each one's searchable names:
// its GeoNames name and ASCII name, its preferred English name, its Chinese
// and Japanese names, and its former English names (Bangalore, Calcutta,
// Kiev, Saigon) — never colloquial ones ("New York Van Java").
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const root = path.resolve(import.meta.dirname, '..');
const BASE = 'https://download.geonames.org/export/dump/';
const MIN_POPULATION = 50000;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skies-geonames-'));
async function download(name) {
  const response = await fetch(BASE + name);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  fs.writeFileSync(path.join(dir, name), Buffer.from(await response.arrayBuffer()));
  return response.headers.get('last-modified');
}

try {
  const lastModified = await download('cities15000.zip');
  await Promise.all(['admin1CodesASCII.txt', 'countryInfo.txt', 'alternateNamesV2.zip'].map(download));
  const dumpDate = new Date(lastModified).toISOString().slice(0, 10);

  // geonameid, name, asciiname, alternatenames, latitude, longitude, feature
  // class, feature code, country code, cc2, admin1 … population (14) … timezone (17)
  const cities = execFileSync('unzip', ['-p', path.join(dir, 'cities15000.zip'), 'cities15000.txt'], {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  })
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const f = line.split('\t');
      return {
        id: f[0],
        name: f[1],
        ascii: f[2],
        lat: +f[4],
        lon: +f[5],
        featureCode: f[7],
        country: f[8],
        admin1: `${f[8]}.${f[10]}`,
        population: +f[14],
        zone: f[17],
      };
    })
    .filter((c) => (c.population >= MIN_POPULATION || c.featureCode === 'PPLC') && c.featureCode !== 'PPLX' && c.zone);
  const kept = new Map(cities.map((c) => [c.id, c]));

  // alternateNameId, geonameid, isolanguage, name, isPreferredName,
  // isShortName, isColloquial, isHistoric, from, to
  const aliases = new Map();
  const english = new Map();
  const unzip = spawn('unzip', ['-p', path.join(dir, 'alternateNamesV2.zip'), 'alternateNamesV2.txt']);
  for await (const line of readline.createInterface({ input: unzip.stdout, crlfDelay: Infinity })) {
    const f = line.split('\t');
    if (!kept.has(f[1])) continue;
    const [, id, lang, name, preferred, , colloquial, historic, , to] = f;
    if (colloquial === '1') continue;
    const past = historic === '1' || !!to;
    const cjk = lang === 'zh' || lang.startsWith('zh-') || lang === 'ja' || lang.startsWith('ja-');
    if (lang === 'en' && preferred === '1' && !past) english.set(id, name);
    if ((cjk && !past) || (lang === 'en' && past)) {
      if (!aliases.has(id)) aliases.set(id, new Set());
      aliases.get(id).add(name);
    }
  }

  const regionNames = new Map(
    fs.readFileSync(path.join(dir, 'admin1CodesASCII.txt'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t').slice(0, 2))
  );
  const countryNames = new Map(
    fs
      .readFileSync(path.join(dir, 'countryInfo.txt'), 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const f = l.split('\t');
        return [f[0], f[4]];
      })
  );

  // Largest first: ties in search ranking go by population.
  cities.sort((a, b) => b.population - a.population || (a.id < b.id ? -1 : 1));
  const zones = [...new Set(cities.map((c) => c.zone))].sort();
  const regions = [...new Set(cities.map((c) => regionNames.get(c.admin1) ?? ''))].sort();
  const countries = Object.fromEntries([...new Set(cities.map((c) => c.country))].sort().map((cc) => [cc, countryNames.get(cc) ?? cc]));
  // Any whitespace — tabs, newlines, ideographic spaces ("会津若松　") — becomes one
  // space; | separates names, so it can't be in one.
  const clean = (s) => s.replace(/[|\s]+/gu, ' ').trim();
  const rows = cities.map((c) => {
    const name = clean(english.get(c.id) ?? c.name);
    const extra = [...new Set([c.name, c.ascii, ...(aliases.get(c.id) ?? [])].map(clean))].filter((n) => n && n !== name);
    return [
      name,
      c.country,
      regions.indexOf(regionNames.get(c.admin1) ?? ''),
      c.lat.toFixed(2),
      c.lon.toFixed(2),
      zones.indexOf(c.zone),
      c.population,
      extra.join('|'),
    ].join('\t');
  });
  const escapeTemplate = (s) => s.replace(/[`\\]|\$\{/g, (m) => '\\' + m);

  const out = `// GENERATED by scripts/build-cities.mjs from the GeoNames dump of ${dumpDate}
// (${BASE}: cities15000, alternateNamesV2, admin1CodesASCII, countryInfo) —
// do not edit by hand. Regenerate: node scripts/build-cities.mjs
//
// GeoNames data, CC BY 4.0 (see ATTRIBUTION.md), filtered and reformatted:
// ${cities.length} cities of ${MIN_POPULATION.toLocaleString('en')}+ people or national capitals, city districts
// (PPLX) left out; names in English, plus Chinese, Japanese and former English
// names for searching. Loaded only when the search opens (Searchbar.tsx).

// Country code → English name (GeoNames countryInfo).
export const COUNTRIES: Readonly<Record<string, string>> = ${JSON.stringify(countries)};

// First-level region names (GeoNames admin1), referenced by index.
export const REGIONS: readonly string[] = ${JSON.stringify(regions)};

// IANA time zones, referenced by index.
export const ZONES: readonly string[] = ${JSON.stringify(zones)};

// One city per line, most populous first:
// name, country, region index, latitude, longitude, zone index, population,
// other names separated by |.
export const CITIES = \`${escapeTemplate(rows.join('\n'))}\`;
`;
  fs.mkdirSync(path.join(root, 'src/data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/data/cities.ts'), out);
  console.log(`src/data/cities.ts: GeoNames ${dumpDate}, ${cities.length} cities, ${zones.length} zones, ${[...aliases.values()].reduce((n, s) => n + s.size, 0)} aliases, ${Buffer.byteLength(out)} bytes`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
