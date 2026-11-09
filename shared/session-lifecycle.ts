/**
 * The lifecycle figures every side of a session reads (req-168, R12):
 * the runner releases a held 1:1 after this long without a turn; the
 * service window and the clients show the release time from it.
 */

/** A held 1:1 is released after this long without a turn (req-157's lifecycle as req-168 builds it). */
export const ONE_ON_ONE_IDLE_MS = 15 * 60_000;
