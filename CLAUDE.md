# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server (popup UI development)
npm run build     # tsc -b && vite build → outputs to dist/
npm run lint      # ESLint
npm run preview   # Preview production build
npm test          # Vitest, runs test/**/*.test.ts (core/ modules, plus pure UI helpers such as dayDeltaLabel)
npm run test:watch  # Vitest in watch mode
```

`tsc -b` also type-checks `test/` (via `tsconfig.test.json`), so a test that drifts from a core module's types fails the build, not just at runtime. Load the extension by pointing Chrome to `dist/` after building.

## Architecture

Skies is a **Chrome Manifest V3 popup extension** built with React + TypeScript + Vite. The popup is a single-page React app; there is no content script or injected UI.

`docs/spec-v2.md` is the feature spec and the source of truth — update it before changing behaviour. Modules in `src/core/` are pure: no `chrome.*`, no DOM.

### Component tree and state ownership

```
App.tsx              ← global state: entries (v2 Entry[] — array order IS the list order), settings (v2 AppSettings), isConvertModeOpen + convertPosition, isSearchOpen, isSettingsOpen + settingsFocus (a section to scroll to), isEditMode, the open city panel, and the last removed entry (for Undo); seeded from migrate()'s return value, persists entries+settings to localStorage on every change
├── Header.tsx       ← reference-timezone chip (logo, city, live time; its menu sets settings.referenceTimezone) + 3 actions: search toggle, converter, open-settings
│   ├── Searchbar.tsx  ← city search via Open-Meteo Geocoding API; passes selected city up via callback
│   └── Converter panel (inline in Header)
├── TimezoneList.tsx ← controlled by entries/setEntries from App; renders in entries order inside a dnd-kit DndContext (sorting enabled only in edit mode: grip to drag, minus to remove)
│   └── Timezone.tsx  ← individual card; reads time with Intl.DateTimeFormat, updates every 1s; click opens that city's panel; `isCompact` = edit mode's single-row card
├── CoreTimePanel.tsx ← bottom-docked; passes the whole list to src/core/coretime.ts, which decides who takes part (includeInCoreTime) and returns a row for every entry. Tapping a city name in the band toggles includeInCoreTime (excluded rows stay, dimmed); the PARTIAL_OVERLAP hint is itself the exclude button. Collapsed by default; collapsed during edit mode, expands on exit. Every element reads coreTime()'s result — never compute Core Time state in the UI (spec §5.3)
├── SettingsPanel.tsx ← full-popup slide-in. Display (hour format, show seconds, "Edit city list" → edit mode), Core time (panel mode, default work hours/days), About (Share, Rate, Send Feedback, Website, Version read from package.json). DST alerts/Account sections wait on steps 7/8 (dst banner, ExtPay) so the page doesn't point at features that don't exist yet
├── CitySettingsPanel.tsx ← per-city panel: rename (entry.label) and reset to the name it was added with, read-only work hours/days ("coming in the next update" — there is no Pro gating or isPro() yet), a link to Settings' Core time section, Remove
└── UndoToast.tsx    ← "Removed X · Undo" after any removal (city panel or edit mode)

Shared: SegmentedControl.tsx (Settings' toggles), ResetButton.tsx (converter reset, city-name reset), dayDeltaLabel.ts (the card footer's yesterday / tomorrow / 2 days back note)
```

State flows down as props; children communicate upward via callbacks. There is no global store.

### Persistence (localStorage keys)

Everything is in the popup page's `localStorage` — no `chrome.storage`. `localStorage` is scoped to the extension's origin (`chrome-extension://<ID>/`), so a changed extension ID orphans it just like a renamed key.

| Key                       | Content                                |
| ------------------------- | -------------------------------------- |
| `timemate.data.v2`        | `AppData` — `{version, entries, groups, settings}` (see `src/core/types.ts`). Each entry's `order` is its list position (written by `saveAppData`, sorted on by `loadAppData`). `entry.pinned` and `settings.sortOrder` are deprecated — read only once, by `freezeDisplayOrder()`, to carry the old pinned-first/sorted order into `order` |
| `timemate.backup_v1`      | One-time pre-migration snapshot of the v1 data, written before v2 and never overwritten (`src/core/migrate.ts`) |
| `timemate.timezones.v1`, `.pinned.v1`, `.sort-mode.v1`, `.hour-format.v1` | v1 data — read by `migrate()` when there is no v2 data; never modified or deleted |
| `timemate.sun.<zone>.<date>` | Sunrise/sunset cache for the card's sky colours, one per zone per day (`Timezone.tsx`; yesterday's is evicted) |
| `timemate.swipe-hint-shown.v1` | Legacy — set by the removed swipe-hint animation; no longer read or written, left in place |

Every key keeps the `timemate.` prefix from before the rename to Skies; renaming one would orphan existing users' data.

### Key implementation details

- **City search** — Open-Meteo Geocoding API (`geocoding-api.open-meteo.com`), debounced 300 ms, uses AbortController to cancel stale requests, deduplicates results, max 8 per query.
- **Time display** — `Intl.DateTimeFormat` only; no external API for time. Converter mode forces 24 h and hides seconds and AM/PM. A card whose date differs from the reference timezone's says `yesterday` / `tomorrow` (`2 days back` / `2 days ahead` across the date line) in its footer.
- **Converter slider** — continuous, not snapped: 9 markers (0–24 h in 3 h steps) with a soft pull (up to 45%) within 14 px of a marker. Opens at the current local time; Reset returns to now.
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

- `index.html` → popup (`src/main.tsx` runs `migrate()` before the first render)
- `public/manifest.json` → Manifest V3. Declares no permissions at all; keep it that way unless a feature truly needs one (spec §6.3). The version lives here **and** in `package.json` — bump both (Settings → About reads `package.json`)
- `public/background.js` → service worker (sets uninstall URL only)
