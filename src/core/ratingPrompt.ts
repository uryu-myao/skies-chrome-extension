// The rating card (spec §9.7): when it shows, and what each answer records.
// One key, read and written whole, through the injected store.
import type { KeyValueStore } from './store';

export const RATING_PROMPT_STORAGE_KEY = 'timemate.rating-prompt.v1';

export type RatingPromptStatus = 'pending' | 'rated' | 'feedback' | 'dismissed';

// Times are milliseconds since the epoch.
export interface RatingPromptState {
  // The first popup open this key saw — for users from before it existed,
  // the first open after the update.
  firstSeenAt: number;
  openCount: number;
  // When a DST alert was first actually shown; never updated after that.
  dstAlertSeenAt: number | null;
  // How many popup opens rendered the card (once per open at most).
  shownCount: number;
  lastShownAt: number | null;
  // Anything but 'pending' is final.
  status: RatingPromptStatus;
}

export interface RatingPromptContext {
  // When this popup open began: a DST alert recorded at or after it was
  // seen this time, and the card waits for the next open.
  openedAt: Date;
  isEditMode: boolean;
  isSettingsOpen: boolean;
  isCitySettingsOpen: boolean;
  isDstBannerShown: boolean;
}

export type RatingPromptAnswer = 'rated' | 'feedback' | 'not-now';

const DAY_MS = 24 * 60 * 60 * 1000;
export const RATING_PROMPT_MAX_SHOWN = 2;
export const RATING_PROMPT_RESHOW_DAYS = 14;
export const RATING_PROMPT_MIN_DAYS = 7;
export const RATING_PROMPT_MIN_OPENS = 10;

const STATUSES: readonly RatingPromptStatus[] = ['pending', 'rated', 'feedback', 'dismissed'];

export function shouldShowRatingPrompt(state: RatingPromptState, now: Date, context: RatingPromptContext): boolean {
  if (state.status !== 'pending') return false;
  if (state.shownCount >= RATING_PROMPT_MAX_SHOWN) return false;
  if (
    state.shownCount > 0 &&
    (state.lastShownAt === null || now.getTime() - state.lastShownAt < RATING_PROMPT_RESHOW_DAYS * DAY_MS)
  ) {
    return false;
  }

  // Either a DST alert from an earlier open, or a week and ten opens of use.
  const sawDstAlert = state.dstAlertSeenAt !== null && state.dstAlertSeenAt < context.openedAt.getTime();
  const usedForAWhile =
    now.getTime() - state.firstSeenAt >= RATING_PROMPT_MIN_DAYS * DAY_MS && state.openCount >= RATING_PROMPT_MIN_OPENS;
  if (!sawDstAlert && !usedForAWhile) return false;

  return !context.isEditMode && !context.isSettingsOpen && !context.isCitySettingsOpen && !context.isDstBannerShown;
}

// One popup open: starts the record on the first one, counts the rest.
export function recordPopupOpen(state: RatingPromptState | null, now: Date): RatingPromptState {
  if (!state) {
    return {
      firstSeenAt: now.getTime(),
      openCount: 1,
      dstAlertSeenAt: null,
      shownCount: 0,
      lastShownAt: null,
      status: 'pending',
    };
  }
  return { ...state, openCount: state.openCount + 1 };
}

// Only the first alert counts; after that the state comes back unchanged
// (the same object), so there's nothing to write.
export function recordDstAlertSeen(state: RatingPromptState, now: Date): RatingPromptState {
  return state.dstAlertSeenAt === null ? { ...state, dstAlertSeenAt: now.getTime() } : state;
}

export function recordRatingPromptShown(state: RatingPromptState, now: Date): RatingPromptState {
  return { ...state, shownCount: state.shownCount + 1, lastShownAt: now.getTime() };
}

// The card's buttons, and Settings' rating links ('rated', whatever the
// status was). Not now ends it only on the last showing; otherwise the card
// waits out the gap before its second one.
export function answerRatingPrompt(state: RatingPromptState, answer: RatingPromptAnswer): RatingPromptState {
  if (answer !== 'not-now') return { ...state, status: answer };
  return state.shownCount >= RATING_PROMPT_MAX_SHOWN ? { ...state, status: 'dismissed' } : state;
}

// Missing or unreadable → null, which recordPopupOpen() starts over from.
export function loadRatingPrompt(store: KeyValueStore): RatingPromptState | null {
  const raw = store.get(RATING_PROMPT_STORAGE_KEY);
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<RatingPromptState> | null;
    if (!value || !isTime(value.firstSeenAt)) return null;
    return {
      firstSeenAt: value.firstSeenAt,
      openCount: isCount(value.openCount) ? value.openCount : 0,
      dstAlertSeenAt: isTime(value.dstAlertSeenAt) ? value.dstAlertSeenAt : null,
      shownCount: isCount(value.shownCount) ? value.shownCount : 0,
      lastShownAt: isTime(value.lastShownAt) ? value.lastShownAt : null,
      status: STATUSES.includes(value.status as RatingPromptStatus) ? (value.status as RatingPromptStatus) : 'pending',
    };
  } catch {
    return null;
  }
}

// Never throws: a lost count is harmless, a popup that fails to open isn't.
export function saveRatingPrompt(store: KeyValueStore, state: RatingPromptState): void {
  try {
    store.set(RATING_PROMPT_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('[Skies] saving the rating prompt state failed', error);
  }
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
