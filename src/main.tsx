import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@styles/index.scss';
import App from './App';
import { migrate, removeLegacySunCache } from './core/migrate';
import { capToCityLimit } from './core/model';
import { loadRatingPrompt, recordPopupOpen, saveRatingPrompt } from './core/ratingPrompt';
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

  // 3.1.x's sunrise/sunset cache, in localStorage on both targets (spec §3).
  removeLegacySunCache(localStorageStore());

  // The rating card counts popup opens (spec §9.7) — here, once per open,
  // not in a React effect that StrictMode runs twice.
  const openedAt = new Date();
  const ratingPrompt = recordPopupOpen(loadRatingPrompt(store), openedAt);
  saveRatingPrompt(store, ratingPrompt);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App initialData={initialData} store={store} initialRatingPrompt={ratingPrompt} openedAt={openedAt} />
    </StrictMode>
  );
});
