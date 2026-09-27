import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@styles/index.scss';
import App from './App';
import { migrate } from './core/migrate';
import { pruneSunCache } from './core/suncache';

// Runs before any rendering — v1 → v2 on first run, and a one-time freeze of
// the old display order into manual order. The app renders from what it
// returns, so a failed write still shows the right list this session.
const initialData = migrate();

// Sunrise/sunset keys from earlier days and from removed cities (spec §3).
pruneSunCache(initialData.entries, new Date());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App initialData={initialData} />
  </StrictMode>
);
