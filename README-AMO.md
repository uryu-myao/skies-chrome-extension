# Skies — source code for Firefox Add-ons review

> **Not ready for submission.** `data_collection_permissions` in the Firefox
> manifest (`manifest.config.ts`) is a placeholder (`required: ["none"]`). Its
> final value is decided in a later step of the Firefox port. Do not submit
> this add-on to AMO until then, and delete this note when that's done.

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

## Left out of this source package

- **`src/server/`**: a local development server. The extension doesn't
  bundle it. Its dependencies (`express`, `cors`, `dotenv`, `axios`,
  `node-fetch`) are still listed in `package.json`, but no extension code
  imports them.
- Source artwork (`design/`), project documentation, and editor/lint
  configuration. The build doesn't use any of them.

## Linter warnings

`npm run lint:firefox` runs `web-ext lint` on `dist/firefox/`. It reports no
errors and three warnings:

- `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`: Skies is desktop-only
  and is not offered for Firefox for Android.
- `UNSAFE_VAR_ASSIGNMENT` (×2, `assets/index-*.js`): both come from
  react-dom's internal `setInnerHTML`. React only calls it for
  `dangerouslySetInnerHTML`, which Skies' source never uses.
