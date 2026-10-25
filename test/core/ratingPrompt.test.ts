import { describe, expect, it, vi } from 'vitest';
import {
  answerRatingPrompt,
  loadRatingPrompt,
  RATING_PROMPT_STORAGE_KEY,
  recordDstAlertSeen,
  recordPopupOpen,
  recordRatingPromptShown,
  saveRatingPrompt,
  shouldShowRatingPrompt,
  type RatingPromptContext,
  type RatingPromptState,
} from '../../src/core/ratingPrompt';
import { memoryStore } from '../helpers/stores';

const DAY = 24 * 60 * 60 * 1000;
const FIRST_SEEN = Date.parse('2026-10-01T09:00:00Z');

// `day` days after the first open (day 0 is that open).
const at = (day: number) => new Date(FIRST_SEEN + day * DAY);

function state(patch: Partial<RatingPromptState> = {}): RatingPromptState {
  return {
    firstSeenAt: FIRST_SEEN,
    openCount: 1,
    dstAlertSeenAt: null,
    shownCount: 0,
    lastShownAt: null,
    status: 'pending',
    ...patch,
  };
}

// This open began at `now`; nothing covers the list.
function context(now: Date, patch: Partial<RatingPromptContext> = {}): RatingPromptContext {
  return {
    openedAt: now,
    isEditMode: false,
    isSettingsOpen: false,
    isCitySettingsOpen: false,
    isDstBannerShown: false,
    ...patch,
  };
}

const show = (s: RatingPromptState, now: Date, patch: Partial<RatingPromptContext> = {}) =>
  shouldShowRatingPrompt(s, now, context(now, patch));

describe('shouldShowRatingPrompt', () => {
  it('waits on day 1 after 3 opens', () => {
    expect(show(state({ openCount: 3 }), at(1))).toBe(false);
  });

  it('shows on day 7 after 10 opens', () => {
    expect(show(state({ openCount: 10 }), at(7))).toBe(true);
  });

  it('waits after 10 opens if only 5 days have passed', () => {
    expect(show(state({ openCount: 10 }), at(5))).toBe(false);
  });

  it('waits on day 7 with 9 opens', () => {
    expect(show(state({ openCount: 9 }), at(7))).toBe(false);
  });

  it('shows once a DST alert was seen in an earlier open, however new the install', () => {
    const now = at(2);
    const s = state({ openCount: 3, dstAlertSeenAt: at(1).getTime() });
    expect(show(s, now)).toBe(true);
  });

  it('waits for the next open when the DST alert was recorded in this one', () => {
    const openedAt = at(2);
    const now = new Date(openedAt.getTime() + 5_000);
    const s = state({ openCount: 3, dstAlertSeenAt: openedAt.getTime() + 1_000 });
    expect(shouldShowRatingPrompt(s, now, context(openedAt))).toBe(false);
  });

  it.each(['rated', 'feedback', 'dismissed'] as const)('never shows once the status is %s', (status) => {
    expect(show(state({ openCount: 50, dstAlertSeenAt: at(1).getTime(), status }), at(30))).toBe(false);
  });

  it('never shows a third time', () => {
    expect(show(state({ openCount: 50, shownCount: 2, lastShownAt: at(10).getTime() }), at(60))).toBe(false);
  });

  it('waits 14 days after the first showing', () => {
    const s = state({ openCount: 20, shownCount: 1, lastShownAt: at(7).getTime() });
    expect(show(s, at(7 + 10))).toBe(false);
    expect(show(s, at(7 + 14))).toBe(true);
    expect(show(s, at(7 + 20))).toBe(true);
  });

  it('also holds the 14 days for a DST alert', () => {
    const s = state({ openCount: 3, dstAlertSeenAt: at(1).getTime(), shownCount: 1, lastShownAt: at(2).getTime() });
    expect(show(s, at(12))).toBe(false);
    expect(show(s, at(16))).toBe(true);
  });

  it.each([
    ['in edit mode', { isEditMode: true }],
    ['while Settings is open', { isSettingsOpen: true }],
    ['while a city panel is open', { isCitySettingsOpen: true }],
    ['while the DST banner shows', { isDstBannerShown: true }],
  ] as const)('hides %s', (_, patch) => {
    expect(show(state({ openCount: 10 }), at(7), patch)).toBe(false);
  });
});

describe('recording', () => {
  it('starts the record on the first open and counts the rest', () => {
    const first = recordPopupOpen(null, at(0));
    expect(first).toEqual(state({ openCount: 1 }));
    expect(recordPopupOpen(first, at(3))).toEqual(state({ openCount: 2 }));
  });

  it('keeps the first DST alert only', () => {
    const seen = recordDstAlertSeen(state(), at(1));
    expect(seen.dstAlertSeenAt).toBe(at(1).getTime());
    expect(recordDstAlertSeen(seen, at(4))).toBe(seen);
  });

  it('counts a showing', () => {
    expect(recordRatingPromptShown(state({ shownCount: 1 }), at(9))).toEqual(
      state({ shownCount: 2, lastShownAt: at(9).getTime() })
    );
  });
});

describe('answerRatingPrompt', () => {
  it('records Rate and Send feedback', () => {
    expect(answerRatingPrompt(state({ shownCount: 1 }), 'rated').status).toBe('rated');
    expect(answerRatingPrompt(state({ shownCount: 1 }), 'feedback').status).toBe('feedback');
  });

  it('records a rating from Settings whatever the status was', () => {
    expect(answerRatingPrompt(state({ status: 'dismissed' }), 'rated').status).toBe('rated');
  });

  it('keeps waiting after Not now on the first showing', () => {
    const s = state({ shownCount: 1, lastShownAt: at(7).getTime() });
    expect(answerRatingPrompt(s, 'not-now')).toEqual(s);
  });

  it('ends after Not now on the second showing', () => {
    expect(answerRatingPrompt(state({ shownCount: 2 }), 'not-now').status).toBe('dismissed');
  });
});

describe('storage', () => {
  it('reads back what it wrote, as one key', () => {
    const { store, data } = memoryStore();
    const s = state({ openCount: 4, dstAlertSeenAt: at(1).getTime(), shownCount: 1, lastShownAt: at(2).getTime() });
    saveRatingPrompt(store, s);
    expect([...data.keys()]).toEqual([RATING_PROMPT_STORAGE_KEY]);
    expect(loadRatingPrompt(store)).toEqual(s);
  });

  it('starts over from nothing or from data it cannot read', () => {
    expect(loadRatingPrompt(memoryStore().store)).toBeNull();
    expect(loadRatingPrompt(memoryStore({ [RATING_PROMPT_STORAGE_KEY]: '{oops' }).store)).toBeNull();
    expect(loadRatingPrompt(memoryStore({ [RATING_PROMPT_STORAGE_KEY]: '{"openCount":3}' }).store)).toBeNull();
  });

  it('falls back field by field', () => {
    const raw = JSON.stringify({ firstSeenAt: FIRST_SEEN, openCount: -1, shownCount: 'x', status: 'maybe' });
    expect(loadRatingPrompt(memoryStore({ [RATING_PROMPT_STORAGE_KEY]: raw }).store)).toEqual(
      state({ openCount: 0 })
    );
  });

  it('does not throw when the write fails', () => {
    const { store, failWritesTo } = memoryStore();
    failWritesTo(RATING_PROMPT_STORAGE_KEY);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => saveRatingPrompt(store, state())).not.toThrow();
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});
