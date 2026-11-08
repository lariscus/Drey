/**
 * The run's state (ADR-0075, ADR-0096): the union lives on the wire
 * (`protocol.ts`, every client reads it); the classifications every part of
 * the runner asks about live here, beside the machine that changes it.
 */
import type { RunState } from '../protocol';

export type { RunState };

/** The run is over; its record is history. */
export type TerminalRunState = Extract<RunState, 'done' | 'stopped' | 'failed'>;

export const TERMINAL_RUN_STATES: readonly TerminalRunState[] = ['done', 'stopped', 'failed'];

/** A worker is supervised: the run takes a pool slot and holds its ticket. */
export const LIVE_RUN_STATES: readonly RunState[] = ['starting', 'running', 'stopping'];

/** The ticket is not free: a live run, or a detached one whose worker may still live (D-34). */
export const BLOCKING_RUN_STATES: readonly RunState[] = ['starting', 'running', 'stopping', 'detached'];

/** The state a new run record starts in. */
export const INITIAL_RUN_STATE: RunState = 'starting';

export function isTerminal(state: RunState): state is TerminalRunState {
  return (TERMINAL_RUN_STATES as readonly RunState[]).includes(state);
}

/** Neither over nor detached: a run that is starting, running or being stopped. */
export function isLive(state: RunState): boolean {
  return LIVE_RUN_STATES.includes(state);
}
