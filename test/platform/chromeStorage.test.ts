import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '../../src/core/migrate';
import { createEntry, renameEntry, saveAppData, toggleIncludeInCoreTime } from '../../src/core/model';
import { localStorageStore } from '../../src/platform/storage/localStorageStore';
import { NOW, SCENARIOS, uuidSequence, type CoreApi } from '../helpers/chromeScenarios';
import { fakeWebStorage } from '../helpers/stores';
import expected from '../fixtures/storage-written-by-3.1.2.json';

// Chrome regression (spec §10.6): the same popup opens, run by today's code
// through the Chrome backend, leave localStorage byte-identical to what
// 3.1.2 left — every key, every character. The fixture was written by
// 3.1.2's own code (see its _comment), not by hand.

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const fixtures = expected.scenarios as Record<string, { input: Record<string, string>; output: Record<string, string> }>;

describe('Chrome storage matches 3.1.2 byte for byte', () => {
  it('has a 3.1.2 result for every scenario', () => {
    expect(Object.keys(fixtures)).toEqual(SCENARIOS.map((scenario) => scenario.name));
  });

  it.each(SCENARIOS.map((scenario) => [scenario.name, scenario] as const))('%s', async (name, scenario) => {
    const { input, output } = fixtures[name];
    const web = fakeWebStorage(input);
    const store = localStorageStore(web);
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    vi.spyOn(crypto, 'randomUUID').mockImplementation(uuidSequence());
    const api: CoreApi = {
      migrate: (now) => migrate(store, now),
      save: (data) => saveAppData(store, data),
      createEntry,
      renameEntry,
      toggleIncludeInCoreTime,
    };

    await scenario.run(api);

    expect(Object.fromEntries(web.data)).toEqual(output);
  });
});
