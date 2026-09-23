# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server (popup UI development)
npm run build     # tsc -b && vite build → outputs to dist/
npm run lint      # ESLint
npm run preview   # Preview production build
npm test          # Vitest, runs test/**/*.test.ts (core/ modules only)
```

`tsc -b` also type-checks `test/` (via `tsconfig.test.json`), so a test that drifts from a core module's types fails the build, not just at runtime. Load the extension by pointing Chrome to `dist/` after building.

## Architecture

Everywhen is a **Chrome Manifest V3 popup extension** built with React + TypeScript + Vite. The popup is a single-page React app; there is no content script or injected UI.

### Component tree and state ownership

```
App.tsx              ← global state: entries (v2 Entry[] — array order IS the list order), settings (v2 AppSettings), isConvertModeOpen, isSearchOpen, isSettingsOpen, isEditMode, the open city panel, and the last removed entry (for Undo); seeded from migrate()'s return value, persists entries+settings to localStorage
├── Header.tsx       ← 3 actions only: search toggle, converter slider, open-settings (12/24 moved into SettingsPanel)
│   ├── Searchbar.tsx  ← city search via Open-Meteo Geocoding API; passes selected city up via callback
│   └── Converter panel (inline in Header)
├── TimezoneList.tsx ← controlled by entries/setEntries from App; renders in entries order inside a dnd-kit DndContext (sorting enabled only in edit mode: grip to drag, minus to remove)
│   └── Timezone.tsx  ← individual card; reads time with Intl.DateTimeFormat, updates every 1s; click opens that city's panel; `isCompact` = edit mode's single-row card
├── CoreTimePanel.tsx ← bottom-docked; runs src/core/coretime.ts over entries+settings, collapsed by default; collapsed during edit mode, expands on exit
├── SettingsPanel.tsx ← full-popup slide-in; edits settings.{hour24,showSeconds,coreTimePanel,defaultWorkHours,defaultWorkDays} and has the "Edit timezone list" entry into edit mode. DST alerts/Account sections wait on steps 7/8 (dst banner, ExtPay) so the page doesn't point at features that don't exist yet
├── CitySettingsPanel.tsx ← per-city panel: rename (entry.label), read-only work hours/days (Pro), Remove
└── UndoToast.tsx    ← "Removed X · Undo" after any removal (city panel or edit mode)
```

State flows down as props; children communicate upward via callbacks. There is no global store.

### Persistence (localStorage keys)

| Key                       | Content                                |
| ------------------------- | -------------------------------------- |
| `timemate.data.v2`        | `AppData` — `{version, entries, groups, settings}` (see `src/core/types.ts`); `entries` replaces the old `timemate.timezones.v1`/`.pinned.v1` pair. Each entry's `order` is its list position (written by `saveAppData`, sorted on by `loadAppData`). `entry.pinned` and `settings.sortOrder` are deprecated — read only once, by `freezeDisplayOrder()`, to carry the old pinned-first/sorted order into `order` |
| `timemate.backup_v1`      | One-time pre-migration snapshot of the v1 data (`src/core/migrate.ts`) |
| `timemate.swipe-hint-shown.v1` | Legacy — set by the removed swipe-hint animation; no longer read or written, left in place |
| `theme`                   | `"light"` \| `"dark"`                  |

Every key keeps the `timemate.` prefix from before the rename to Everywhen; renaming one would orphan existing users' data.

### Key implementation details

- **City search** — Open-Meteo Geocoding API (`geocoding-api.open-meteo.com`), debounced 300 ms, uses AbortController to cancel stale requests, deduplicates results, max 8 per query.
- **Time display** — `Intl.DateTimeFormat` only; no external API for time. Converter mode forces 24 h, hides seconds, shows ±1 day offsets.
- **Converter slider** — 9 snap points (0–24 h in 3 h steps) with a 14 px magnetic pull radius.
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

- `index.html` → popup
- `public/manifest.json` → Manifest V3, version 1.2.0
- `public/background.js` → service worker (sets uninstall URL only)
