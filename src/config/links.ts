// Every link the popup opens, in one place: Settings → About and the rating
// card read them from here (spec §9.4, §9.7). They open as plain
// target="_blank" links — no permission needed — and each one has to be on
// scripts/check-offline.mjs's allowlist.

export interface StoreLinks {
  // The listing — what Share copies.
  listingUrl: string;
  // Where reviews are written. AMO rates on the listing itself; the Chrome
  // Web Store has a separate reviews page.
  rateUrl: string;
  // The rating card's main button.
  rateLabel: string;
}

const CHROME_WEB_STORE_URL = 'https://chromewebstore.google.com/detail/gmjjpjccmmdnainbbgchlnkhmgckcmik';
const FIREFOX_ADD_ONS_URL = 'https://addons.mozilla.org/firefox/addon/skies-world-clock/';

// This build's store, fixed at compile time: each package carries only its
// own links and wording.
export const STORE: StoreLinks =
  __TARGET__ === 'firefox'
    ? { listingUrl: FIREFOX_ADD_ONS_URL, rateUrl: FIREFOX_ADD_ONS_URL, rateLabel: 'Rate on Firefox Add-ons' }
    : {
        listingUrl: CHROME_WEB_STORE_URL,
        rateUrl: `${CHROME_WEB_STORE_URL}/reviews`,
        rateLabel: 'Rate on Chrome Web Store',
      };

export const FEEDBACK_URL = 'https://forms.gle/ncZLfTs8RKE59ETC9';
export const WEBSITE_URL = 'https://useskies.com';
export const GEONAMES_URL = 'https://www.geonames.org/';
export const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/';
