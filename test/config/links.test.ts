import { afterEach, describe, expect, it, vi } from 'vitest';

// links.ts picks the store on __TARGET__ when it loads; each test sets the
// target, then loads it fresh.
async function linksFor(target: 'chrome' | 'firefox') {
  vi.stubGlobal('__TARGET__', target);
  vi.resetModules();
  return import('../../src/config/links');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('links', () => {
  it('rates on the Chrome Web Store reviews page in the Chrome build', async () => {
    const { STORE } = await linksFor('chrome');
    expect(STORE).toEqual({
      listingUrl: 'https://chromewebstore.google.com/detail/gmjjpjccmmdnainbbgchlnkhmgckcmik',
      rateUrl: 'https://chromewebstore.google.com/detail/gmjjpjccmmdnainbbgchlnkhmgckcmik/reviews',
      rateLabel: 'Rate on Chrome Web Store',
    });
  });

  it('rates on the AMO listing in the Firefox build', async () => {
    const { STORE } = await linksFor('firefox');
    expect(STORE).toEqual({
      listingUrl: 'https://addons.mozilla.org/firefox/addon/skies-world-clock/',
      rateUrl: 'https://addons.mozilla.org/firefox/addon/skies-world-clock/',
      rateLabel: 'Rate on Firefox Add-ons',
    });
  });

  it('sends feedback to the same form in both builds', async () => {
    expect((await linksFor('chrome')).FEEDBACK_URL).toBe('https://forms.gle/ncZLfTs8RKE59ETC9');
    expect((await linksFor('firefox')).FEEDBACK_URL).toBe('https://forms.gle/ncZLfTs8RKE59ETC9');
  });
});
