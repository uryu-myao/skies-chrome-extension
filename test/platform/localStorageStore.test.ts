import { describe, expect, it } from 'vitest';
import { localStorageStore } from '../../src/platform/storage/localStorageStore';
import { fakeWebStorage } from '../helpers/stores';

// Chrome's backend (spec §2.3): a pass-through to localStorage, so Chrome
// keeps 3.1.2's behaviour — including failures that throw from set().

describe('localStorageStore', () => {
  it('reads, writes and removes straight through to the Storage object', () => {
    const web = fakeWebStorage({ a: '1' });
    const store = localStorageStore(web);

    expect(store.get('a')).toBe('1');
    expect(store.get('missing')).toBeNull();
    store.set('b', '2');
    store.remove('a');

    expect(Object.fromEntries(web.data)).toEqual({ b: '2' });
  });

  it('lists every key', () => {
    const store = localStorageStore(fakeWebStorage({ a: '1', b: '2', c: '3' }));
    expect(store.keys()).toEqual(['a', 'b', 'c']);
  });

  it('throws from set() when localStorage does, as before', () => {
    const web = fakeWebStorage();
    web.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => localStorageStore(web).set('a', '1')).toThrow('QuotaExceededError');
  });

  it('has nothing to flush: every write already happened', async () => {
    const web = fakeWebStorage();
    const store = localStorageStore(web);
    store.set('a', '1');
    expect(web.data.get('a')).toBe('1');
    await expect(store.flush()).resolves.toBeUndefined();
  });
});
