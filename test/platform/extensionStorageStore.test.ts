import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extensionStorageStore } from '../../src/platform/storage/extensionStorageStore';
import { fakeArea, firefoxStore } from '../helpers/stores';

// Firefox's backend (spec §2.3, §10.6), over a stand-in for storage.local.

beforeEach(() => {
  vi.restoreAllMocks();
});

// Flushes pending promise callbacks so a released write can run to the end.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('init()', () => {
  it('reads everything in storage.local into memory', async () => {
    const { store } = await firefoxStore({
      'timemate.data.v2': '{"version":2}',
      'timemate.timezones.v1': '[]',
      'timemate.sort-mode.v1': 'alphabet',
    });

    expect(store.get('timemate.data.v2')).toBe('{"version":2}');
    expect(store.get('timemate.sort-mode.v1')).toBe('alphabet');
    expect(store.get('missing')).toBeNull();
    expect(store.keys().sort()).toEqual(['timemate.data.v2', 'timemate.sort-mode.v1', 'timemate.timezones.v1']);
  });

  it('skips values that are not strings — this app only ever writes strings', async () => {
    const { store } = await firefoxStore({ 'timemate.data.v2': '{}', 'someone-else': { an: 'object' } });
    expect(store.keys()).toEqual(['timemate.data.v2']);
  });

  it('reads storage once, at init, and answers get() from memory after that', async () => {
    const fake = fakeArea({ a: '1' });
    const get = vi.spyOn(fake.area, 'get');
    const store = extensionStorageStore(fake.area);
    await store.init();
    store.get('a');
    store.get('b');
    store.keys();
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('writes', () => {
  it('get() sees a write at once, before storage has it', async () => {
    const firefox = await firefoxStore();
    firefox.options.holdWrites = true;

    firefox.store.set('a', '1');

    expect(firefox.store.get('a')).toBe('1');
    await tick();
    expect(firefox.data.has('a')).toBe(false);
    firefox.releaseNext();
    await firefox.store.flush();
    expect(firefox.data.get('a')).toBe('1');
  });

  it('sends each write at once — nothing waits for a debounce window', async () => {
    const firefox = await firefoxStore();
    firefox.store.set('a', '1');
    await Promise.resolve();
    expect(firefox.calls).toEqual([{ op: 'set', key: 'a', value: '1' }]);
  });

  it('runs writes one at a time, in call order: the second starts only when the first is done', async () => {
    const firefox = await firefoxStore({ b: 'old' });
    firefox.options.holdWrites = true;

    firefox.store.set('a', '1');
    firefox.store.remove('b');
    firefox.store.set('a', '2');
    await tick();
    expect(firefox.calls).toHaveLength(1);
    expect(firefox.heldCount()).toBe(1);

    firefox.releaseNext();
    await tick();
    expect(firefox.calls).toHaveLength(2);
    firefox.releaseNext();
    await tick();
    firefox.releaseNext();
    await firefox.store.flush();

    expect(firefox.calls).toEqual([
      { op: 'set', key: 'a', value: '1' },
      { op: 'remove', key: 'b' },
      { op: 'set', key: 'a', value: '2' },
    ]);
    // The later value of `a` is the one that stays.
    expect(firefox.data.get('a')).toBe('2');
    expect(firefox.data.has('b')).toBe(false);
  });

  it('flush() resolves once everything issued so far is stored', async () => {
    const firefox = await firefoxStore();
    firefox.store.set('a', '1');
    firefox.store.set('b', '2');
    await expect(firefox.store.flush()).resolves.toBeUndefined();
    expect(Object.fromEntries(firefox.data)).toEqual({ a: '1', b: '2' });
  });
});

describe('a failed write', () => {
  it('is logged, makes flush() reject, and puts memory back to what storage holds', async () => {
    const firefox = await firefoxStore({ a: 'stored' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    firefox.failWritesTo('a');

    firefox.store.set('a', 'new');
    expect(firefox.store.get('a')).toBe('new');

    await expect(firefox.store.flush()).rejects.toThrow('storage.local set a failed');
    expect(error).toHaveBeenCalled();
    expect(firefox.store.get('a')).toBe('stored');
    expect(firefox.data.get('a')).toBe('stored');
  });

  it('of a key that was never stored, removes it from memory again', async () => {
    const firefox = await firefoxStore();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    firefox.failWritesTo('a');

    firefox.store.set('a', 'new');
    await expect(firefox.store.flush()).rejects.toThrow();

    expect(firefox.store.get('a')).toBeNull();
    expect(firefox.store.keys()).toEqual([]);
  });

  it('of a remove, brings the key back in memory', async () => {
    const firefox = await firefoxStore({ a: 'stored' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    firefox.failWritesTo('a');

    firefox.store.remove('a');
    expect(firefox.store.get('a')).toBeNull();
    await expect(firefox.store.flush()).rejects.toThrow();

    expect(firefox.store.get('a')).toBe('stored');
  });

  it('does not undo a later write to the same key that is already on its way', async () => {
    const firefox = await firefoxStore({ a: 'stored' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    firefox.options.holdWrites = true;
    firefox.failWritesTo('a');

    firefox.store.set('a', 'first');
    firefox.store.set('a', 'second');
    await tick();
    firefox.releaseNext(); // `first` fails while `second` is queued
    await tick();
    expect(firefox.store.get('a')).toBe('second');

    firefox.restoreWrites();
    firefox.releaseNext();
    await expect(firefox.store.flush()).rejects.toThrow(); // reports `first`
    expect(firefox.store.get('a')).toBe('second');
    expect(firefox.data.get('a')).toBe('second');
  });

  it('is reported once: the next flush() starts clean', async () => {
    const firefox = await firefoxStore();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    firefox.failWritesTo('a');
    firefox.store.set('a', '1');
    await expect(firefox.store.flush()).rejects.toThrow();

    firefox.store.set('b', '2');
    await expect(firefox.store.flush()).resolves.toBeUndefined();
  });

  it('does not hold up the writes after it', async () => {
    const firefox = await firefoxStore();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    firefox.failWritesTo('a');

    firefox.store.set('a', '1');
    firefox.store.set('b', '2');
    await expect(firefox.store.flush()).rejects.toThrow();

    expect(firefox.data.get('b')).toBe('2');
    expect(firefox.store.get('b')).toBe('2');
  });
});

describe('memory and storage agree', () => {
  // A fixed pseudo-random run of sets, removes and failing writes.
  it('after any sequence of writes, once flushed', async () => {
    const firefox = await firefoxStore({ k0: 'init0', k3: 'init3' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let round = 0; round < 20; round++) {
      firefox.restoreWrites();
      if (next(3) === 0) firefox.failWritesTo(`k${next(5)}`);
      for (let i = 0; i < 10; i++) {
        const key = `k${next(5)}`;
        if (next(4) === 0) firefox.store.remove(key);
        else firefox.store.set(key, `v${round}.${i}`);
      }
      await firefox.store.flush().catch(() => {});

      const inMemory = Object.fromEntries(firefox.store.keys().map((key) => [key, firefox.store.get(key)]));
      expect(inMemory).toEqual(Object.fromEntries(firefox.data));
    }
  });
});

describe('when storage.local cannot be read', () => {
  it('runs read-only: logs, refuses every write, and leaves storage untouched', async () => {
    const fake = fakeArea({ 'timemate.data.v2': 'unread' });
    fake.options.failRead = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = extensionStorageStore(fake.area);
    await store.init();

    expect(store.get('timemate.data.v2')).toBeNull();
    store.set('timemate.data.v2', 'defaults');
    store.remove('timemate.data.v2');

    expect(store.get('timemate.data.v2')).toBeNull();
    await expect(store.flush()).rejects.toThrow('could not be read');
    expect(fake.calls).toEqual([]);
    expect(fake.data.get('timemate.data.v2')).toBe('unread');
    expect(error).toHaveBeenCalled();
  });
});
