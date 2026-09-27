import { describe, expect, it } from 'vitest';
import { RECENT_UPDATES } from '../../src/components/recentUpdates';

// Spec §9.4: Recent updates is "recent", not a changelog. Two or three lines,
// replaced on each release — a fourth line fails here, so an old one has to go.
describe('RECENT_UPDATES', () => {
  it('holds two or three lines', () => {
    expect(RECENT_UPDATES.length).toBeGreaterThanOrEqual(2);
    expect(RECENT_UPDATES.length).toBeLessThanOrEqual(3);
  });

  it('has no empty or repeated lines', () => {
    expect(RECENT_UPDATES.every((line) => line.trim().length > 0)).toBe(true);
    expect(new Set(RECENT_UPDATES).size).toBe(RECENT_UPDATES.length);
  });
});
