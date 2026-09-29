import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@styles/index.scss';
import App from './App';
import { migrate } from './core/migrate';
import { capToCityLimit } from './core/model';
import { pruneSunCache } from './core/suncache';
import { initStorage } from './platform/storage';
import { localStorageStore } from './platform/storage/localStorageStore';

// Storage first (Firefox reads storage.local into memory here), then the
// migration — v1 → v2 on first run, and a one-time freeze of the old display
// order into manual order — then the first render (spec §3.1). A promise
// chain, not top-level await, which the build target doesn't support. The
// app renders from what migrate() returns, so a failed write still shows the
// right list this session.
initStorage().then(async (store) => {
  const migrated = await migrate(store);
  // The city limit applies to what's read, too (spec §8).
  const initialData = { ...migrated, entries: capToCityLimit(migrated.entries) };

  // Sunrise/sunset keys from earlier days and from removed cities (spec §3).
  // The cache is in localStorage on both targets, not the persistent store.
  pruneSunCache(localStorageStore(), initialData.entries, new Date());

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App initialData={initialData} store={store} />
    </StrictMode>
  );
});
