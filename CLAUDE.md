# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server (popup UI development)
npm run build     # tsc -b && vite build → outputs to dist/
npm run lint      # ESLint
npm run preview   # Preview production build
```

There are no tests. Load the extension by pointing Chrome to `dist/` after building.

## Architecture

TimeMate is a **Chrome Manifest V3 popup extension** built with React + TypeScript + Vite. The popup is a single-page React app; there is no content script or injected UI.

### Component tree and state ownership

```
App.tsx              ← global state: entries (v2 Entry[]), settings, sortMode, hourFormat, isConvertModeOpen, isSearchOpen, convertPosition; persists entries+settings to localStorage
├── Header.tsx       ← UI controls (sort, hour format, theme, converter slider, search toggle)
│   ├── Searchbar.tsx  ← city search via Open-Meteo Geocoding API; passes selected city up via callback
│   └── Converter panel (inline in Header)
├── TimezoneList.tsx ← controlled by entries/setEntries from App; owns only UI-local state (active card, sort tick)
│   └── Timezone.tsx  ← individual card; reads time with Intl.DateTimeFormat, updates every 1s
└── CoreTimePanel.tsx ← bottom-docked; runs src/core/coretime.ts over entries+settings, collapsed by default
```

State flows down as props; children communicate upward via callbacks. There is no global store.

### Persistence (localStorage keys)

| Key                       | Content                                |
| ------------------------- | -------------------------------------- |
| `timemate.data.v2`        | `AppData` — `{version, entries, groups, settings}` (see `src/core/types.ts`); `entries` replaces the old `timemate.timezones.v1`/`.pinned.v1` pair — pin state now lives on `entry.pinned` |
| `timemate.backup_v1`      | One-time pre-migration snapshot of the v1 data (`src/core/migrate.ts`) |
| `timemate.sort-mode.v1`   | `"newest"` \| `"time"` \| `"alphabet"` |
| `timemate.hour-format.v1` | `"12"` \| `"24"`                       |
| `theme`                   | `"light"` \| `"dark"`                  |

### Key implementation details

- **City search** — Open-Meteo Geocoding API (`geocoding-api.open-meteo.com`), debounced 300 ms, uses AbortController to cancel stale requests, deduplicates results, max 8 per query.
- **Time display** — `Intl.DateTimeFormat` only; no external API for time. Converter mode forces 24 h, hides seconds, shows ±1 day offsets.
- **Converter slider** — 9 snap points (0–24 h in 3 h steps) with a 14 px magnetic pull radius.
- **Sorting** — pinned cities always float to top within their sort group.
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
