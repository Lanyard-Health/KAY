// ==========================================
// Monitor backoff delay calculator
// ==========================================

const HOUR_MS = 60 * 60 * 1000;

/**
 * Calculates the delay before the next enrollment status check based on
 * how many days have elapsed since the initial submission.
 *
 * Schedule:
 *   0–7 days  → 4 hours
 *   8–14 days → 8 hours
 *   15–30 days → 24 hours
 *   31+ days  → 48 hours (stalled)
 */
export function calculateMonitorDelay(submittedAt: Date): { delayMs: number; isStalled: boolean } {
  const now = Date.now();
  const elapsedMs = now - submittedAt.getTime();
  const elapsedDays = elapsedMs / (24 * HOUR_MS);

  if (elapsedDays <= 7) {
    return { delayMs: 4 * HOUR_MS, isStalled: false };
  }

  if (elapsedDays <= 14) {
    return { delayMs: 8 * HOUR_MS, isStalled: false };
  }

  if (elapsedDays <= 30) {
    return { delayMs: 24 * HOUR_MS, isStalled: false };
  }

  return { delayMs: 48 * HOUR_MS, isStalled: true };
}
