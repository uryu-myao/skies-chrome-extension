// The only way core/ reaches storage (spec §2.3, §12). The caller injects a
// backend — src/platform/storage/ — so core never knows whether it's
// localStorage or storage.local, and tests hand it an in-memory one.
//
// Reads and writes are synchronous. A backend that persists asynchronously
// (Firefox's storage.local) confirms its writes through flush().
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
  // Resolves once every write issued so far has been stored; rejects if any
  // of them failed since the last flush(). A synchronous backend resolves at
  // once — its failures have already thrown from set() / remove().
  flush(): Promise<void>;
}
