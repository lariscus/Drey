import type { TerminalRunState } from './run-state';

/**
 * What happens to a run, as the state machine hears it (ADR-0096). The
 * supervisor reports these; only `RunStateMachine` turns them into a state.
 *
 * - `spawned` — a worker is up: the first one, a fresh fallback's
 *   replacement, or the second opinion's reviewer.
 * - `respawning` — a resume the adapter could not establish is replaced by a
 *   fresh worker under the same run id (T-0049).
 * - `adopted` — a runner restart took the worker back (re-attach) or resumed
 *   its session in place (req-51).
 * - `orphaned` — a runner restart found the run without a supervised worker.
 * - `stop-requested` — the owner, the chain or the shutdown stops the run.
 * - `claim-lost` — the store gave the ticket to another actor (E14-5).
 * - `settled` — the run ends with this outcome.
 */
export type RunEvent =
  | { readonly kind: 'spawned' }
  | { readonly kind: 'respawning' }
  | { readonly kind: 'adopted' }
  | { readonly kind: 'orphaned' }
  | { readonly kind: 'stop-requested' }
  | { readonly kind: 'claim-lost' }
  | { readonly kind: 'settled'; readonly outcome: TerminalRunState };

export type RunEventKind = RunEvent['kind'];
