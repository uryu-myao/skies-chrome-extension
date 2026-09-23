# Everywhen

Everywhen is a Chrome extension built with React, TypeScript, and Vite for viewing multiple city time zones in a single popup.

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

- Add up to 10 cities
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
├── public/
│   ├── manifest.json
│   ├── background.js
│   └── icons/
├── src/
│   ├── core/              # pure logic, no DOM or chrome.* — unit tested
│   │   ├── types.ts       # v2 schema
│   │   ├── model.ts       # defaults, load/save, entry helpers
│   │   ├── migrate.ts     # v1 → v2, freezing the old display order
│   │   ├── tz.ts          # offsets, relative gaps, local dates
│   │   ├── coretime.ts    # working-hours intersection
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

Vitest covers `src/core/`: time zone maths, the Core Time algorithm, DST detection, and the v1 → v2 migration.

## Load the Extension in Chrome

After building:

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the project `dist/` directory

If you rebuild, reload the extension from the extensions page.

## Development Notes

- Extension metadata lives in [public/manifest.json](public/manifest.json)
- Popup UI starts from [src/App.tsx](src/App.tsx), which owns the entries and settings state
- Header interactions and converter UI live in [src/components/Header.tsx](src/components/Header.tsx)
- Timezone card rendering lives in [src/components/Timezone.tsx](src/components/Timezone.tsx)
- List order, reordering, and edit mode live in [src/components/TimezoneList.tsx](src/components/TimezoneList.tsx)
- Persistence and the schema live in [src/core/model.ts](src/core/model.ts); migrations in [src/core/migrate.ts](src/core/migrate.ts)
- Storage keys keep the `timemate.` prefix from before the rename — renaming one would orphan existing users' data
- The feature spec is [docs/spec-v2.md](docs/spec-v2.md); update it before changing behavior

## Publish Checklist

Before publishing a new version:

1. Update the extension version in [public/manifest.json](public/manifest.json)
2. Run `npm run lint`
3. Run `npm test`
4. Run `npm run build`
5. Load the latest `dist/` build in Chrome and test the popup manually
6. Verify search, the city panel, edit-mode reordering, hour format, Core Time, and converter behavior

## Notes About APIs

- City search currently uses a free public geocoding API
- Sunrise/sunset for the card backgrounds comes from a free public forecast API, cached per zone per day
- Current timezone display is calculated on the client using JavaScript internationalization APIs
- The extension does not require location permission for its current converter default behavior

## Background Script

The extension includes [public/background.js](public/background.js) to support uninstall feedback via `chrome.runtime.setUninstallURL(...)`.

Update the uninstall survey URL there before release if needed.
