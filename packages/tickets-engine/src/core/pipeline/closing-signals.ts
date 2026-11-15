import type { TicketIssue } from '../../contracts/tickets';

/**
 * The signals that make a run noteworthy (R14, req-169): only on one of
 * them does a run get its closing round — a journal finding and at most one
 * memory lesson. A smooth run costs no round.
 *
 * - `red-gate` — the machine gate failed.
 * - `retry` — the run repeats a step whose previous run failed its gate.
 * - `steer` — the owner steered the run (or answered it) while it worked.
 * - `cost` — the run cost far more than the persona's typical run.
 * - `friction` — the worker reported friction in its final message.
 */
export type ClosingSignal = 'red-gate' | 'retry' | 'steer' | 'cost' | 'friction';

export const ALL_CLOSING_SIGNALS: readonly ClosingSignal[] = ['red-gate', 'retry', 'steer', 'cost', 'friction'];

/** The pipeline.md key that narrows the list (`closing-signals:`). */
export const CLOSING_SIGNALS_KEY = 'closing-signals';

function isClosingSignal(value: unknown): value is ClosingSignal {
  return typeof value === 'string' && (ALL_CLOSING_SIGNALS as readonly string[]).includes(value);
}

/**
 * pipeline.md's `closing-signals:` — a list of signal names, `none` (or an
 * empty list) for no closing rounds at all; absent = all five. An unknown
 * name is dropped with a noise finding, never guessed; a value that is
 * neither list nor `none` keeps the default.
 */
export function parseClosingSignals(raw: unknown, issues: TicketIssue[]): readonly ClosingSignal[] {
  if (raw === undefined || raw === null) {
    return ALL_CLOSING_SIGNALS;
  }
  if (raw === 'none') {
    return [];
  }
  if (!Array.isArray(raw)) {
    issues.push({ level: 'noise', message: `pipeline.md: ${CLOSING_SIGNALS_KEY} must be a list of ${ALL_CLOSING_SIGNALS.join(', ')} or none — all five apply` });
    return ALL_CLOSING_SIGNALS;
  }
  const picked: ClosingSignal[] = [];
  for (const entry of raw as unknown[]) {
    if (!isClosingSignal(entry)) {
      issues.push({ level: 'noise', message: `pipeline.md: ${CLOSING_SIGNALS_KEY} "${String(entry)}" is not a signal — ignored` });
    } else if (!picked.includes(entry)) {
      picked.push(entry);
    }
  }
  return picked;
}
