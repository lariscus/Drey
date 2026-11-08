import { IllegalRunTransition } from './illegal-run-transition';
import type { RunEvent, RunEventKind } from './run-event';
import type { RunState } from './run-state';

/** One row of the table: from which states an event is taken, and where it leads. */
interface TransitionRule {
  readonly from: readonly RunState[];
  /** The target; `settled` names its own (the outcome). */
  readonly to: RunState | 'outcome';
}

const NOT_OVER: readonly RunState[] = ['starting', 'running', 'stopping', 'detached'];

/**
 * The run state machine (ADR-0096): the one place a run's state changes.
 * The table is the whole contract — the supervisor reports an event and
 * gets the record back with its new state, or an {@link IllegalRunTransition}
 * for an event the state does not take. Everything else a run carries
 * (pid, end stamp, gate verdict) the caller sets beside the state.
 */
export class RunStateMachine {
  private readonly table: Readonly<Record<RunEventKind, TransitionRule>> = {
    spawned: { from: ['starting', 'running'], to: 'running' },
    respawning: { from: ['starting', 'running'], to: 'starting' },
    adopted: { from: ['starting', 'running', 'detached'], to: 'running' },
    orphaned: { from: ['starting', 'running', 'stopping'], to: 'detached' },
    'stop-requested': { from: NOT_OVER, to: 'stopping' },
    'claim-lost': { from: NOT_OVER, to: 'stopping' },
    settled: { from: NOT_OVER, to: 'outcome' },
  };

  /** The state the event leads to, or null when the state does not take it. */
  next(state: RunState, event: RunEvent): RunState | null {
    const rule = this.table[event.kind];
    if (!rule.from.includes(state)) {
      return null;
    }
    return rule.to === 'outcome' && event.kind === 'settled' ? event.outcome : (rule.to as RunState);
  }

  /** Whether a run in this state takes the event. */
  can(state: RunState, event: RunEvent): boolean {
    return this.next(state, event) !== null;
  }

  /** The record with the state the event leads to; throws for an event the state does not take. */
  transition<T extends { readonly state: RunState }>(record: T, event: RunEvent): T {
    const next = this.next(record.state, event);
    if (next === null) {
      throw new IllegalRunTransition(record.state, event.kind);
    }
    return { ...record, state: next };
  }
}
