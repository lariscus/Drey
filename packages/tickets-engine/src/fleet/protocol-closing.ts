import { ALL_CLOSING_SIGNALS, type ClosingSignal } from '../core/closing-signals';

/**
 * What a run's closing round needs to know at dispatch (R14, req-169): the
 * signals the vault asks for (pipeline.md's `closing-signals:`, all five by
 * default) and whether this run repeats a step whose last run failed its
 * gate. Absent on a request = every older sender: all five, no retry.
 */
export interface ClosingRoundSpec {
  readonly signals: readonly ClosingSignal[];
  readonly retry: boolean;
}

export const DEFAULT_CLOSING_SPEC: ClosingRoundSpec = { signals: ALL_CLOSING_SIGNALS, retry: false };

/**
 * The lead-in of the one line a worker reports friction with in its final
 * message (req-169, replacing the friction file): what it lacked, guessed
 * or hit twice. The line is the closing round's `friction` signal and the
 * journal entry's `friction:` field.
 */
export const FRICTION_MARKER = 'FRICTION:';

/** The longest friction report the runner keeps. */
export const FRICTION_MAX = 300;
