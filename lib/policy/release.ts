// Release timing (BUILDOUT §6.3). The scheduler and the remaining rules land with §6.3; the due
// date is set when the maker adds tracking so the scheduler only has to read it.

const DAY_MS = 24 * 3600_000;

/** `days` may be fractional so the demo can release after minutes (RELEASE_AFTER_DAYS=0.002). */
export function releaseDueAt(shippedAt: Date, days: number): Date {
  if (!(days > 0)) throw new Error(`invalid release delay: ${days}`);
  return new Date(shippedAt.getTime() + Math.round(days * DAY_MS));
}
