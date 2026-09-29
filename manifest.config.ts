// Source of the extension's manifest.json. The skies:manifest plugin in
// vite.config.ts writes one per build target into dist/<target>/.
// `version` is never written here: it comes from package.json at build time,
// so there is one place to bump it.

export type BuildTarget = 'chrome' | 'firefox';

export const BUILD_TARGETS: readonly BuildTarget[] = ['chrome', 'firefox'];

// Shared by every target. The Chrome manifest is exactly this plus the
// version, and must stay byte-identical to what 3.1.2 shipped — key order
// included — so nothing changes for existing Chrome users.
const base = {
  name: 'Skies — World Clock & Time Zones',
  short_name: 'Skies',
  description:
    'View multiple city time zones in one popup—now with a built-in Time Converter for instant cross-time-zone planning.',
  background: {
    service_worker: 'background.js',
  },
  action: {
    default_popup: 'index.html',
    default_icon: {
      16: 'icons/logos/logo-16.png',
      32: 'icons/logos/logo-32.png',
      48: 'icons/logos/logo-48.png',
      128: 'icons/logos/logo-128.png',
    },
  },
  icons: {
    16: 'icons/logos/logo-16.png',
    32: 'icons/logos/logo-32.png',
    48: 'icons/logos/logo-48.png',
    128: 'icons/logos/logo-128.png',
  },
};

type Manifest = { manifest_version: 3; version: string } & Record<string, unknown>;

// Firefox's changes to the shared manifest. Each field replaces the shared
// one outright rather than merging into it — `background` must lose
// `service_worker`, which Firefox doesn't support.
function firefoxOverrides(shared: typeof base) {
  return {
    background: {
      scripts: ['background.js'],
    },
    action: {
      ...shared.action,
      // Firefox parks a new MV3 button in the extensions menu; a popup-only
      // extension belongs on the toolbar.
      default_area: 'navbar',
    },
    icons: {
      ...shared.icons,
      // about:addons draws the 48px icon at 2x on HiDPI screens.
      96: 'icons/logos/logo-96.png',
    },
    // storage.local holds the data (spec §2.3): Firefox clears an extension's
    // localStorage when the user clears browsing data. No user-visible
    // warning. Chrome still declares nothing.
    permissions: ['storage'],
    browser_specific_settings: {
      gecko: {
        // Permanent: AMO ties the listing and every user's installed copy to it.
        id: 'skies@useskies.com',
        // 140 is the first desktop release that reads data_collection_permissions.
        strict_min_version: '140.0',
        // Nothing is collected or sent: the extension makes no network requests
        // at all — sky, city search, flags and fonts are all bundled — and
        // npm run check:offline, part of every build, keeps it that way.
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  };
}

export function manifestFor(target: BuildTarget, version: string): Manifest {
  const shared = { manifest_version: 3 as const, version, ...base };
  return target === 'firefox' ? { ...shared, ...firefoxOverrides(base) } : shared;
}

// Files in public/ that only one target's manifest uses. The other targets'
// builds leave them out, so the Chrome package holds exactly what it did
// before Firefox existed.
export const TARGET_ONLY_FILES: Record<BuildTarget, readonly string[]> = {
  chrome: [],
  firefox: ['icons/logos/logo-96.png'],
};
