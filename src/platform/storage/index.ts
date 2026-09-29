import type { KeyValueStore } from '../../core/store';
import { localStorageStore } from './localStorageStore';

// The persistent store for this build (spec §2.3): localStorage.
export async function initStorage(): Promise<KeyValueStore> {
  return localStorageStore();
}
