# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server (popup UI development)
npm run build     # tsc -b, both targets → dist/chrome/ and dist/firefox/, then check:offline
npm run build:chrome   # one target (same tsc -b first, check:offline after)
npm run build:firefox
npm run package:chrome   # build + reproducible zip → release/ (same for package:firefox)
npm run package:source   # AMO source zip via git archive → release/ (refuses a dirty tree; --dirty for a trial run)
npm run lint      # ESLint
npm run lint:firefox   # web-ext lint on dist/firefox/
npm run check:offline  # fails on any URL outside the allowlist or any network API in dist/ (every build runs it)
npm run preview   # Preview production build
npm test          # Vitest in a node environment (no DOM), runs test/**/*.test.ts: core/ modules on in-memory stores, the storage backends (test/platform/), pure UI helpers such as dayDeltaLabel
npm run test:watch  # Vitest in watch mode
```

`tsc -b` also type-checks `test/` (via `tsconfig.test.json`), so a test that drifts from a core module's types fails the build, not just at runtime. Load the extension by pointing Chrome to `dist/chrome/` (Firefox: `about:debugging` → `dist/firefox/manifest.json`) after building.

Node is pinned to 24.x (`.nvmrc`, `engines`, and `.npmrc`'s `engine-strict`, so `npm ci` refuses other versions): AMO reviewers rebuild the Firefox package from source and must get identical files (README-AMO.md).

## Architecture

Skies is a **Chrome Manifest V3 popup extension** built with React + TypeScript + Vite. The popup is a single-page React app; there is no content script or injected UI.

`docs/spec-v2.md` is the feature spec and the source of truth — update it before changing behaviour. Modules in `src/core/` are pure: they reach storage only through an injected `KeyValueStore` (`src/core/store.ts`) and never reference `localStorage`, `chrome.*`, `browser.*` or any DOM API (spec §12).

### Component tree and state ownership

```
App.tsx              ← global state: entries (v2 Entry[] — array order IS the list order), settings (v2 AppSettings), isConvertModeOpen + convertPosition, isSearchOpen, isSettingsOpen + settingsFocus (a section to scroll to), isEditMode, the open city panel, and the last removed entry (for Undo); seeded from migrate()'s return value, persists entries+settings through the injected store on every change
├── Header.tsx       ← reference-timezone chip (logo, city, live time) + 3 actions: search toggle, converter, open-settings. The chip's menu lists System and every city (no dedupe) and stores referenceTimezone + referenceEntryId; the chip's name and selected option come from core's resolveReferenceChip(). Identity follows the picked city — the chip's name and the Core Time band's single YOU tag (resolveReferenceChip().youEntryId; under System, the chip reads the system zone's name and YOU is the first entry in the system zone); relation follows the zone — the card's Base and the band's BASE tag, which can repeat. On purpose (spec §9.1); core's referenceRoleOf() holds the rule
│   ├── Searchbar.tsx  ← city search over the bundled GeoNames library (src/data/cities.ts, loaded with import() when the search opens); passes selected city up via callback
│   └── Converter panel (inline in Header)
├── TimezoneList.tsx ← controlled by entries/setEntries from App; renders in entries order inside a dnd-kit DndContext (sorting enabled only in edit mode: grip to drag, minus to remove)
│   └── Timezone.tsx  ← individual card; reads time with Intl.DateTimeFormat, updates every 1s; click opens that city's panel; `isCompact` = edit mode's single-row card
├── CoreTimePanel.tsx ← bottom-docked; passes the whole list to src/core/coretime.ts, which decides who takes part (includeInCoreTime) and returns a row for every entry. Tapping a city name in the band toggles includeInCoreTime (excluded rows stay, dimmed); the PARTIAL_OVERLAP hint is itself the exclude button. Collapsed by default; collapsed during edit mode, expands on exit. Past 10 rows the band scrolls on its own; header and conclusion line stay outside the scroll (spec §9.3). Not computed at all while the panel is set to Hide. Every element reads coreTime()'s result — never compute Core Time state in the UI (spec §5.3)
├── SettingsPanel.tsx ← full-popup slide-in. Display (hour format, show seconds, "Edit city list" → edit mode), Core time (panel mode, default work hours/days), About (Share, Rate, Send Feedback, Website, Version read from package.json, and under it Recent updates — 2–3 static lines from recentUpdates.ts, replaced each release, facts not verdicts; spec §9.4). DST alerts/Account sections wait on steps 7/8 (dst banner, ExtPay) so the page doesn't point at features that don't exist yet
├── CitySettingsPanel.tsx ← per-city panel: rename (entry.label) and reset to the name it was added with, read-only work hours/days ("coming in the next update" — there is no Pro gating or isPro() yet), a link to Settings' Core time section, Remove
└── UndoToast.tsx    ← "Removed X · Undo" after any removal (city panel or edit mode); just "Removed X" when putting it back would go over the city limit

Shared: SegmentedControl.tsx (Settings' toggles), ResetButton.tsx (converter reset, city-name reset), dayDeltaLabel.ts (the card footer's yesterday / tomorrow / 2 days back note), recentUpdates.ts (Settings → About's Recent updates lines)
```

State flows down as props; children communicate upward via callbacks. There is no global store.

### Persistence (storage keys)

Persistent data goes through the storage adapter (spec §2.3). `src/platform/storage/` holds the two backends; `__TARGET__` picks one at compile time, so each package carries only its own:

- **Chrome → the popup page's `localStorage`**, exactly as in 3.1.2. Writes are synchronous and throw synchronously, as before.
- **Firefox → `browser.storage.local`** (Firefox clears extension `localStorage` along with browsing data). `init()` reads it all into memory before the first render; `get` reads memory; `set`/`remove` update memory and write out immediately — no debounce (the popup can close any moment), strictly in call order. A failed write is logged and the key reverts in memory to its last stored value; `flush()` resolves once everything issued so far is stored and rejects if any of it failed — migrate() awaits it instead of relying on a synchronous throw. If `init()` itself fails the store runs read-only, so default data never overwrites a profile it couldn't read.

Same keys and same string values on both backends. Storage is scoped to the extension's identity — Chrome's origin (`chrome-extension://<ID>/`), Firefox's add-on ID (`skies@useskies.com`) — so a changed ID orphans it just like a renamed key. (3.1.x's leftover sun cache is only ever deleted, straight from `localStorage`.)

| Key                       | Content                                |
| ------------------------- | -------------------------------------- |
| `timemate.data.v2`        | `AppData` — `{version, entries, groups, settings}` (see `src/core/types.ts`). Each entry's `order` is its list position (written by `saveAppData`, sorted on by `loadAppData`). `entry.pinned` and `settings.sortOrder` are deprecated — read only once, by `freezeDisplayOrder()`, to carry the old pinned-first/sorted order into `order` |
| `timemate.backup_v1`      | One-time pre-migration snapshot of the v1 data, written before v2 and never overwritten (`src/core/migrate.ts`) |
| `timemate.timezones.v1`, `.pinned.v1`, `.sort-mode.v1`, `.hour-format.v1` | v1 data — read by `migrate()` when there is no v2 data, **or when the v2 data is what 2.1.0 left behind** (entries without `order`: 2.1.0 wrote v2 once on first open, then kept using these keys — so they are newer). Sort mode and 12/24 are plain strings, not JSON. Never modified or deleted. Any migration change must be checked against every starting state in spec §3.5 (fresh install / pure v1 / 2.1.0 v2 / 3.0.0 v2 / Firefox fresh install), not only a cleared profile |
| `timemate.sun.<zone>.<date>` | **Legacy** — 3.1.x's sunrise/sunset cache from Open-Meteo. The sky is computed now; `removeLegacySunCache()` (`src/core/migrate.ts`, run from `main.tsx`) deletes any left in `localStorage` on every open |
| `timemate.swipe-hint-shown.v1` | Legacy — set by the removed swipe-hint animation; no longer read or written, left in place |

Every key keeps the `timemate.` prefix from before the rename to Skies; renaming one would orphan existing users' data.

### Key implementation details

- **No network** — the extension makes no requests at all (spec §6.3), hence Firefox's `data_collection_permissions: { required: ["none"] }`. `scripts/check-offline.mjs` runs after every build and fails on any http(s) URL outside its allowlist or any network API besides Vite's modulepreload polyfill. Adding a URL to the allowlist is a spec change first.
- **City search** — local, no network (spec §9.6). `src/data/cities.ts` is generated by `scripts/build-cities.mjs` from GeoNames (50,000+ people or capitals, no city districts; Chinese, Japanese and former English names as aliases) and committed — the build never downloads. It's its own chunk, imported when the search opens. `core/citySearch.ts` ignores case, accents and punctuation; exact matches first, then prefix matches, each by population; max 8; one result per city + zone. Flags are bundled too: `public/flags/<cc>.png`, flagcdn's 80px PNGs (`scripts/fetch-flags.mjs`), shown 32px wide.
- **Fonts** — bundled, no Google Fonts: the faces index.html used to load (Lato 400; Poppins 400, 600, 600 italic — the YOU/BASE tag's italic), latin + latin-ext woff2 in `public/fonts/` with each family's `OFL-*.txt` (the OFL requires it ships with the fonts). `src/styles/_fonts.scss` holds the @font-face rules; `scripts/fetch-fonts.mjs` regenerates both. Weights the CSS asks for but the files don't have (300, 500, 700) resolve to the nearest face, as they always did.
- **Zone names** — stored names are never rewritten; `core/tz.ts` resolves them (spec §4.2). `canonicalZone()` maps old and merged names to current ones via `src/data/zoneLinks.ts` (generated from tzdata's `backward` by `scripts/build-zone-data.mjs`, same release as `zoneCoordinates.ts`; names zone.tab still lists, like Africa/Accra, stay themselves). Compare zones only with `sameZone()`, never `===` — Chrome reports India as Asia/Calcutta while entries say Asia/Kolkata. Hand zones to Intl only through `toIntlZone()`, which swaps in an old spelling if the engine doesn't know a new name (cached per name — name resolution, not an offset). `friendlyZoneName()` canonicalizes first.
- **Time display** — `Intl.DateTimeFormat` only; no external API for time. Converter mode forces 24 h and hides seconds and AM/PM. A card whose date differs from the reference timezone's says `yesterday` / `tomorrow` (`2 days back` / `2 days ahead` across the date line) in its footer.
- **Converter slider** — continuous, not snapped: 9 markers (0–24 h in 3 h steps) with a soft pull (up to 45%) within 14 px of a marker. Opens at the current local time; Reset returns to now.
- **City limit** — `MAX_CITIES = 30` in `src/core/model.ts`, free and Pro alike. Every way the list can grow checks `hasRoomForCity()` (add, Undo), and `main.tsx` caps what's read with `capToCityLimit()`. The search field's limit tip takes its number from `MAX_CITIES` (spec §8).
- **Order** — manual only; no pins, no sort modes. New cities go on top. Reorder happens in edit mode (dnd-kit, pointer + keyboard, auto-scroll).
- **Gestures** — normal: click card → city panel; no long press; no swipe. Edit: drag grip → reorder; minus → remove + Undo; click card → nothing. See spec-v2 §9.5.
- **`src/server/`** — an Express backend that is **not bundled into the extension**; ignore for extension work.

### Path aliases (vite.config.ts / tsconfig.json)

| Alias         | Resolves to       |
| ------------- | ----------------- |
| `@`           | `src/`            |
| `@components` | `src/components/` |
| `@styles`     | `src/styles/`     |

### Extension entry points

- `index.html` → popup. `src/main.tsx` is `initStorage().then(migrate).then(render)` — no top-level await (the build target doesn't allow it). Static CSS fixes `html`/`body` at 420×540 so Firefox opens the popup at its final size before anything renders
- `manifest.config.ts` → Manifest V3, generated per target by the `skies:manifest` plugin in `vite.config.ts`: a shared part plus Firefox's overrides (`background.scripts`, `browser_specific_settings.gecko`, toolbar placement, 96px icon). The Chrome manifest must stay byte-identical to 3.1.2's. Chrome declares no permissions at all; Firefox only `storage` (spec §6.3). Keep it that way unless a feature truly needs one. `version` comes from `package.json` — the only place to bump it. Files in `public/` that only one target uses are listed in `TARGET_ONLY_FILES`
- `public/background.js` → Chrome service worker / Firefox event page (sets uninstall URL only)
- Target-specific code branches on the compile-time constant `__TARGET__` (`'chrome' | 'firefox'`), never on the user agent
