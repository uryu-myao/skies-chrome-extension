# Attribution

Skies bundles data, images and fonts from the sources below. All of them
ship inside the extension, and the extension makes no network requests to
any of these sources.

## City data — GeoNames

The city search (`src/data/cities.ts`) is built from the
[GeoNames](https://www.geonames.org/) geographical database, which is
licensed under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
(CC BY 4.0).

**Changes made:** `scripts/build-cities.mjs` filters the GeoNames dumps
`cities15000`, `alternateNamesV2`, `admin1CodesASCII` and `countryInfo`.
It keeps only cities with at least 50,000 people or that are national
capitals, and leaves out city districts. For each city it keeps only:
- the name, region, country, coordinates, time zone and population;
- Chinese, Japanese and former English names.

Coordinates are rounded to two decimal places. The data is re-encoded into
a compact text format for the extension. The file header records the date
of the dump that was used.

**No warranty:** GeoNames provides the data "as is", without warranty or
any representation of accuracy, timeliness or completeness. Skies passes
it on on the same terms.

The extension shows this credit, with links to GeoNames and the license, in
**Settings → About → City data**.

## Time zone locations and names — IANA tz database

`src/data/zoneCoordinates.ts` holds the coordinates of each time zone's
principal location, taken from `zone.tab` in the
[IANA time zone database](https://www.iana.org/time-zones).
`src/data/zoneLinks.ts` maps old zone names to current ones, taken from its
`backward` file. The database is in the public domain.
`scripts/build-zone-data.mjs` generates both files from the same release,
and their headers record which tzdata version was used.

## Flags — flagcdn.com

The flags shown beside search results (`public/flags/`) are
[flagcdn.com](https://flagcdn.com/)'s 80-pixel-wide PNG set, from
[Flagpedia](https://flagpedia.net/). Flagpedia bases its flags on the
public-domain vector files in
[Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_flags_by_country).
`scripts/fetch-flags.mjs` fetches the set from `https://flagcdn.com/w80.zip`.

## Fonts — Lato and Poppins

The fonts in `public/fonts/` are licensed under the
[SIL Open Font License 1.1](https://openfontlicense.org/):

- **Lato** — Copyright (c) 2010-2014 by tyPoland Lukasz Dziedzic, with
  Reserved Font Name "Lato". License: `public/fonts/OFL-Lato.txt`.
- **Poppins** — Copyright 2020 The Poppins Project Authors. License:
  `public/fonts/OFL-Poppins.txt`.

The woff2 files are the ones Google Fonts serves, latin and latin-ext
subsets only. Both license files ship inside the extension next to the
fonts. `scripts/fetch-fonts.mjs` fetches them.
