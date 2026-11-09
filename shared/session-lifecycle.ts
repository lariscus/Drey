/**
 * The lifecycle every side of a session reads (req-168, req-173, R12):
 * the runner releases a held session after this long without a turn; the
 * service window and the clients show the release time from it and name
 * the session's state from the run record with the same rule.
 */

/** A held 1:1 is released after this long without a turn (req-157's lifecycle as req-168 builds it). */
export const ONE_ON_ONE_IDLE_MS = 15 * 60_000;

/** req-173: a held free session stands as long as a 1:1 before it is released — one span for every held session. */
export const HELD_SESSION_IDLE_MS = ONE_ON_ONE_IDLE_MS;

/** The session kinds (R12): a ticket `run`, a persona `1:1`, `shape` with Paul (typed only, req-229), a `free` session. */
export type SessionKind = 'run' | '1:1' | 'shape' | 'free';

/** The kinds that are held between the owner's lines and released after idle (no ticket, no gate). */
export const HELD_SESSION_KINDS: readonly SessionKind[] = ['1:1', 'free'];

/**
 * The session's state (R12): `queued` — the record exists, no worker yet;
 * `held` — the worker stands between turns and the session is kept for the
 * next line; `running` — the worker is at work; `released` — the session
 * is over (done, stopped, failed, or out of the service's reach).
 */
export type SessionState = 'queued' | 'held' | 'running' | 'released';

/** What the state is read from: the run record's own fields. */
export interface SessionStateSource {
  readonly state: 'starting' | 'running' | 'stopping' | 'done' | 'stopped' | 'failed' | 'detached';
  readonly held?: boolean;
  readonly turn?: 'busy' | 'idle' | null;
}

/** The record's session state, one rule for the runner, the service window and the clients. */
export function sessionStateOf(run: SessionStateSource): SessionState {
  switch (run.state) {
    case 'starting':
      return 'queued';
    case 'running':
    case 'stopping':
      return run.held === true && run.turn !== 'busy' ? 'held' : 'running';
    default:
      return 'released';
  }
}
