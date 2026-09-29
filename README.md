# Skies

Skies is a Chrome extension built with React, TypeScript, and Vite for viewing multiple city time zones in a single popup.

- Website: [useskies.com](https://useskies.com)
- Chrome Web Store: [Skies — World Clock & Time Zones](https://chromewebstore.google.com/detail/gmjjpjccmmdnainbbgchlnkhmgckcmik)
- Contact: [hi@useskies.com](mailto:hi@useskies.com)

It is designed for quick cross-time-zone planning:

- Search and add cities from around the world
- Read each city as a gap from your own time zone, not just a UTC offset
- Arrange the list by hand, in edit mode
- Switch between 12-hour and 24-hour display
- Use the built-in converter panel to compare times across zones
- See the working-hours overlap across every city in the Core Time panel
- Persist cities and settings locally between popup sessions

## Tech Stack

- React 18
- TypeScript
- Vite
- Sass
- dnd-kit (list reordering)
- Vitest (unit tests for `src/core/`)
- Chrome Extension Manifest V3

## Main Features

### World Clock Panel

- Add up to 30 cities
- Keep a custom city list in local storage
- Each card's footer leads with the gap to the reference time zone
  (`−13h`, `+3:30h`, or `Base`), with the UTC offset beside it
- A date that isn't the reference zone's date is labelled `yesterday` /
  `tomorrow` (or `2 days back` / `2 days ahead` across the date line)
- Card background follows the city's local sky: night, dawn, day, twilight

### Reference Time Zone

- The header chip picks which zone everything is measured against
- Defaults to the system time zone; can be any added city
- Every gap is computed for the displayed moment, never cached, so DST
  switches are reflected the day they happen

### Search

- City search suggestions while typing
- Click a result to create a new timezone card
- Duplicate city + timezone entries are blocked

### City Settings

- Click a card to open that city's panel
- Rename a city, and reset the name back to the one it was added with
- Work hours / work days are shown read-only (Pro)
- Remove a city, with a `Removed X · Undo` toast

### Edit Mode

- Opened from Settings → `Edit city list`
- Drag the grip to reorder; keyboard works too (Space to pick up, arrows to
  move, Space to drop)
- Remove a city with the minus control
- Order is saved immediately

### Settings

- Opened from the header; slides in over the popup
- Display: hour format, show seconds, `Edit city list`
- Core time: panel mode, default work hours and work days
- About: Share Skies (copies the store link), Rate on Chrome Store,
  Send Feedback (Google Form), Website (`useskies.com`), Version, and a short
  Recent updates note under it

### Core Time Panel

- Docked at the bottom; shows the working-hours overlap across cities
- Handles the common empty states: nobody's overlap today, everyone off,
  only some cities working — with the next overlap where one exists

### Time Converter

- Open the converter panel from the header
- Slider represents a 24-hour range, with each dot representing 3 hours
- Converter defaults to the user's current local time range
- Dragging the slider updates all timezone cards together
- Converter mode forces 24-hour output
- Reset returns the slider to now

## Project Structure

```text
.
├── manifest.config.ts     # manifest.json per build target (Chrome, Firefox)
├── public/
│   ├── background.js
│   └── icons/
├── src/
│   ├── core/              # pure logic: no DOM, chrome.* or browser.*; storage only via store.ts — unit tested
│   │   ├── store.ts       # KeyValueStore, the interface core reads and writes through
│   │   ├── types.ts       # v2 schema
│   │   ├── model.ts       # defaults, load/save, entry helpers
│   │   ├── migrate.ts     # v1 → v2, freezing the old display order
│   │   ├── tz.ts          # offsets, relative gaps, local dates
│   │   ├── coretime.ts    # working-hours intersection
│   │   ├── sun.ts         # sun elevation and solar noon (NOAA) → the card's sky
│   │   └── dst.ts         # upcoming DST transitions
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── Searchbar.tsx
│   │   ├── Timezone.tsx
│   │   ├── TimezoneList.tsx
│   │   ├── CoreTimePanel.tsx
│   │   ├── SettingsPanel.tsx
│   │   ├── CitySettingsPanel.tsx
│   │   └── UndoToast.tsx
│   ├── data/              # generated data files (zoneCoordinates.ts from IANA tzdata) — see scripts/
│   ├── platform/storage/  # KeyValueStore backends: localStorage (Chrome), storage.local (Firefox)
│   ├── styles/
│   ├── App.tsx
│   └── main.tsx
├── test/core/             # Vitest suites for src/core
├── docs/spec-v2.md        # the v2 feature spec — source of truth
├── package.json
└── README.md
```

## Requirements

- Node.js 18 or newer recommended
- npm
- Google Chrome or another Chromium-based browser

## Install Dependencies

```bash
npm install
```

## Start Development

Run the Vite development server:

```bash
npm run dev
```

This starts the frontend in development mode.

## Build the Extension

```bash
npm run build
```

The production build will be generated in the `dist/` directory. `npm run build` runs `tsc -b` first, which type-checks `src/` and `test/`.

## Lint the Project

```bash
npm run lint
```

## Run the Tests

```bash
npm test
```

Vitest covers `src/core/`: time zone maths, the Core Time algorithm, DST detection, and the v1 → v2 migration (run on both storage backends). It also covers the storage backends in `src/platform/storage/`, and checks that Chrome's stored data is byte-identical to what 3.1.2 wrote.

## Load the Extension in Chrome

After building:

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the project `dist/chrome/` directory

If you rebuild, reload the extension from the extensions page.

## Development Notes

- Extension metadata lives in [manifest.config.ts](manifest.config.ts); the build writes `dist/chrome/manifest.json` and `dist/firefox/manifest.json` from it
- Popup UI starts from [src/App.tsx](src/App.tsx), which owns the entries and settings state
- Header interactions and converter UI live in [src/components/Header.tsx](src/components/Header.tsx)
- Timezone card rendering lives in [src/components/Timezone.tsx](src/components/Timezone.tsx)
- List order, reordering, and edit mode live in [src/components/TimezoneList.tsx](src/components/TimezoneList.tsx)
- Persistence and the schema live in [src/core/model.ts](src/core/model.ts); migrations in [src/core/migrate.ts](src/core/migrate.ts)
- Storage keys keep the `timemate.` prefix from before the product was renamed to Skies — renaming one would orphan existing users' data
- The feature spec is [docs/spec-v2.md](docs/spec-v2.md); update it before changing behavior

## Publish Checklist

Before publishing a new version:

1. Update the version in [package.json](package.json) — the manifests and Settings → About both read it from there
2. Replace the lines in [src/components/recentUpdates.ts](src/components/recentUpdates.ts) with this version's changes — two or three, facts not verdicts (spec §9.4)
3. Run `npm run lint`
4. Run `npm test`
5. Run `npm run build`
6. Load the latest `dist/chrome/` build in Chrome and test the popup manually
7. Verify search, the city panel, edit-mode reordering, hour format, Core Time, and converter behavior

## Notes About APIs

- City search currently uses a free public geocoding API
- The card's sky (night / dawn / day / twilight) is computed locally from the sun's elevation (NOAA equations) — no API. Cities without coordinates use their time zone's principal location from IANA tzdata (`scripts/build-zone-coordinates.mjs` regenerates `src/data/zoneCoordinates.ts`)
- Current timezone display is calculated on the client using JavaScript internationalization APIs
- The extension does not require location permission for its current converter default behavior

## Background Script

The extension includes [public/background.js](public/background.js) to support uninstall feedback via `chrome.runtime.setUninstallURL(...)`.

Update the uninstall survey URL there before release if needed.
