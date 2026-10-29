// Settings → About → Recent updates (spec §9.4). Replace these on each
// release; don't add to them.
//
// - Say what changed, in terms a user can check against their own use
//   ("Up to 30 cities (was 10)"). No verdicts ("better", "all-new"), no
//   NEW, no exclamation marks.
// - Two or three lines. It's "recent", not a changelog — a test holds it to
//   2–3, so a new line means dropping an old one.
export const RECENT_UPDATES: readonly string[] = [
  'Alerts before a time difference changes for DST',
  'DST lead time: 14, 7 or 3 days, in Settings',
  'Date format and week start, in Settings',
];
