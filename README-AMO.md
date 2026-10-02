# Skies — source code for Firefox Add-ons review

Skies is a world-clock popup written in TypeScript and React and bundled with
Vite. The add-on package is the content of `dist/firefox/` after the build
below. Everything in `assets/` is generated from `src/`. `manifest.json` is
generated from `manifest.config.ts`. All other files are copied unchanged
from `public/`.

## Build environment

- Node.js **24.21.0** (see `.nvmrc`), which ships npm **11.19.0**.
  `.npmrc` sets `engine-strict`, so `npm ci` refuses any Node.js version
  other than 24.x.
- Any OS that Node.js supports. The package was built on macOS.
- No network access is needed apart from `npm ci`.

## Build steps

```sh
npm ci
npm run build:firefox
```

The output goes to `dist/firefox/`. Its files are byte-for-byte identical to
the files in the submitted add-on package.

`build:firefox` first type-checks the whole project, tests included (`tsc -b`),
and then runs `vite build --mode firefox`. The build does not read
environment variables or `.env` files. `npm test` runs the unit tests.

## No network access

The add-on makes no network requests, so the manifest declares
`data_collection_permissions: { required: ["none"] }`. Everything the popup
shows is computed locally or bundled: the sky colours (the sun's position is
calculated), the city search, the flags and the fonts. `build:firefox` ends
with `npm run check:offline`, and the build fails if either of these turns
up in `dist/firefox/`:
- an http(s) URL outside a short allowlist in `scripts/check-offline.mjs`
  (store and website links the user opens, license texts, XML namespace
  names);
- any network API other than Vite's modulepreload polyfill, which only
  fetches the add-on's own chunks.

## Third-party data, images and fonts

The city data (GeoNames, CC BY 4.0), the time-zone locations (IANA tz
database), the flag images and the fonts (SIL OFL) are all bundled in the
add-on, and the add-on requests none of them over the network. Each is
produced by a script in `scripts/` whose output is committed; the build
itself downloads nothing. `ATTRIBUTION.md` lists every source.

## Left out of this source package

- **`src/server/`**: a local development server. The extension doesn't
  bundle it. Its dependencies (`express`, `cors`, `dotenv`, `axios`,
  `node-fetch`) are still listed in `package.json`, but no extension code
  imports them.
- Project documentation and editor/lint configuration. The build doesn't use
  any of them.

## Linter warnings

`npm run lint:firefox` runs `web-ext lint` on `dist/firefox/`. It reports no
errors and three warnings:

- `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`: Skies is desktop-only
  and is not offered for Firefox for Android.
- `UNSAFE_VAR_ASSIGNMENT` (×2, `assets/index-*.js`): both come from
  react-dom's internal `setInnerHTML`. React only calls it for
  `dangerouslySetInnerHTML`, which Skies' source never uses.
