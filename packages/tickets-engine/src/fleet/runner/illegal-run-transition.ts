import type { RunEventKind } from './run-event';
import type { RunState } from './run-state';

/** A run event the state machine does not allow in the run's current state — a programming error, never a user one. */
export class IllegalRunTransition extends Error {
  constructor(
    readonly from: RunState,
    readonly event: RunEventKind,
  ) {
    super(`a ${from} run cannot take "${event}"`);
    this.name = 'IllegalRunTransition';
  }
}
