// The card footer's note for a city whose local date differs from the
// reference timezone's (spec §9.2). ±1 is yesterday / tomorrow; across the
// date line it can be ±2 (Kiritimati +14 vs Niue −11), which gets its own
// wording rather than being folded into yesterday / tomorrow. Only called
// for a non-zero delta — the same date shows no note at all.
export function dayDeltaLabel(delta: number): string {
  if (delta === -1) return 'yesterday';
  if (delta === 1) return 'tomorrow';
  return `${Math.abs(delta)} days ${delta < 0 ? 'back' : 'ahead'}`;
}
