/**
 * The breaker's numbers (M85, req-257): the circuit breaker is the persona's
 * (`persona-breaker.ts`); these are the thresholds and waits it and the red-gate
 * loop share.
 */

/** Consecutive red gates a persona tolerates. */
export const DEFAULT_MAX_RED = 3;
/** The breather after a red gate before the persona starts again. */
export const RED_COOLDOWN_MS = 60_000;
/** The first retry waits this long; every further failure doubles it. */
export const FAILURE_BACKOFF_MS = 60_000;
/** A failing ticket never waits longer than this between attempts. */
export const FAILURE_BACKOFF_MAX_MS = 30 * 60_000;

/** The wait before the next attempt after `count` consecutive failures. */
export function failureBackoffMs(count: number): number {
  return Math.min(FAILURE_BACKOFF_MS * 2 ** Math.max(0, count - 1), FAILURE_BACKOFF_MAX_MS);
}
