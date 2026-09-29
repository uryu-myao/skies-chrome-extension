import type { KeyValueStore } from '../../core/store';
import { extensionStorageStore, type StorageArea } from './extensionStorageStore';
import { localStorageStore } from './localStorageStore';

declare const browser: { storage: { local: StorageArea } };

// The persistent store for this build (spec §2.3): storage.local on
// Firefox, localStorage on Chrome. __TARGET__ is fixed at compile time, so
// the Chrome bundle drops the Firefox branch — browser.storage included.
export async function initStorage(): Promise<KeyValueStore> {
  if (__TARGET__ === 'firefox') {
    const store = extensionStorageStore(browser.storage.local);
    await store.init();
    return store;
  }
  return localStorageStore();
}
