import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@styles/index.scss';
import App from './App';
import { migrate } from './core/migrate';
import { capToCityLimit } from './core/model';
import { pruneSunCache } from './core/suncache';

// Runs before any rendering — v1 → v2 on first run, and a one-time freeze of
// the old display order into manual order. The app renders from what it
// returns, so a failed write still shows the right list this session.
const migrated = migrate();
// The city limit applies to what's read, too (spec §8).
const initialData = { ...migrated, entries: capToCityLimit(migrated.entries) };

// Sunrise/sunset keys from earlier days and from removed cities (spec §3).
pruneSunCache(initialData.entries, new Date());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App initialData={initialData} />
  </StrictMode>
);
