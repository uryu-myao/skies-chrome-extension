# Everywhen

Everywhen is a Chrome extension built with React, TypeScript, and Vite for viewing multiple city time zones in a single popup.

It is designed for quick cross-time-zone planning:

- Search and add cities from around the world
- Pin important cities to the top
- Sort by newest, local time, or alphabet
- Switch between 12-hour and 24-hour display
- Use the built-in converter panel to compare times across zones
- Persist user settings locally between popup sessions

## Tech Stack

- React 18
- TypeScript
- Vite
- Sass
- Chrome Extension Manifest V3

## Main Features

### World Clock Panel

- Add up to 10 cities
- Keep a custom city list in local storage
- Pin and unpin cities
- Save selected sort mode
- Save selected hour format
- Save pinned state

### Search

- City search suggestions while typing
- Click a result to create a new timezone card
- Duplicate city + timezone entries are blocked

### Time Converter

- Open the converter panel from the header
- Slider represents a 24-hour range, with each dot representing 3 hours
- Converter defaults to the user's current local time range
- Dragging the slider updates all timezone cards together
- Converter mode forces 24-hour output
- Converter mode shows `-1` / `+1` when the converted date crosses day boundaries

## Project Structure

```text
.
├── public/
│   ├── manifest.json
│   ├── background.js
│   └── icons/
├── src/
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── Searchbar.tsx
│   │   ├── Timezone.tsx
│   │   └── TimezoneList.tsx
│   ├── styles/
│   │   ├── Header.scss
│   │   ├── Searchbar.scss
│   │   ├── Timezone.scss
│   │   └── main.scss
│   ├── App.tsx
│   └── main.tsx
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

The production build will be generated in the `dist/` directory.

## Lint the Project

```bash
npm run lint
```

## Load the Extension in Chrome

After building:

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the project `dist/` directory

If you rebuild, reload the extension from the extensions page.

## Development Notes

- Extension metadata lives in [public/manifest.json](/Users/uryu/Github/timemate-chrome-extension/public/manifest.json)
- Popup UI starts from [src/App.tsx](/Users/uryu/Github/timemate-chrome-extension/src/App.tsx)
- Header interactions and converter UI live in [src/components/Header.tsx](/Users/uryu/Github/timemate-chrome-extension/src/components/Header.tsx)
- Timezone card rendering lives in [src/components/Timezone.tsx](/Users/uryu/Github/timemate-chrome-extension/src/components/Timezone.tsx)
- Local persistence is handled in [src/components/TimezoneList.tsx](/Users/uryu/Github/timemate-chrome-extension/src/components/TimezoneList.tsx)

## Publish Checklist

Before publishing a new version:

1. Update the extension version in [public/manifest.json](/Users/uryu/Github/timemate-chrome-extension/public/manifest.json)
2. Run `npm run lint`
3. Run `npm run build`
4. Load the latest `dist/` build in Chrome and test the popup manually
5. Verify search, pinning, sorting, hour format, and converter behavior

## Notes About APIs

- City search currently uses a free public geocoding API
- Current timezone display is calculated on the client using JavaScript internationalization APIs
- The extension does not require location permission for its current converter default behavior

## Background Script

The extension includes [public/background.js](/Users/uryu/Github/timemate-chrome-extension/public/background.js) to support uninstall feedback via `chrome.runtime.setUninstallURL(...)`.

Update the uninstall survey URL there before release if needed.
