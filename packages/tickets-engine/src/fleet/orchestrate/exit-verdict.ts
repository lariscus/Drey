import { isOneOnOne } from '../protocol-session';
import { isTerminal } from '../run/run-state';
import type { LiveRun } from './live-run';

/**
 * What a worker's exit means for its run (ADR-0077, agent-decided
 * completion): the gate is the safety net for the agent's claimed-done
 * work, so only a finished turn reaches it.
 *
 * - `ignore` — someone else decides: the reaper got here first, a successor
 *   took the run over, a fresh fallback replaces the worker, the gate already
 *   runs, or the run is detached.
 * - `claim-lost` / `stopped` — the run was stopped; it ends without a gate.
 * - `interactive` — a dialog never gates or moves; the owner moves the ticket.
 * - `session` — a 1:1 (req-168) holds no ticket: its worker's end ends the session.
 * - `no-result` — the worker ended without finishing its turn: it claimed nothing.
 * - `reopened` — an owner's reopened session ends done, nothing moves.
 * - `blocked` — the worker declared the step incomplete: no gate, the ticket stays put.
 * - `scout` — the exploration ends; the report chapter is the deliverable.
 * - `gate` — a finished turn: the machine gate decides.
 */
export type ExitVerdict =
  | { readonly kind: 'ignore' }
  | { readonly kind: 'claim-lost' }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'interactive' }
  | { readonly kind: 'session' }
  | { readonly kind: 'no-result' }
  | { readonly kind: 'reopened' }
  | { readonly kind: 'blocked'; readonly blocked: string }
  | { readonly kind: 'scout' }
  | { readonly kind: 'gate' };

const IGNORE: ExitVerdict = { kind: 'ignore' };

/** The verdicts that hold whatever the worker did: someone else decides, or the run was stopped. */
function standing(run: LiveRun): ExitVerdict | null {
  if (isTerminal(run.info.state)) {
    return IGNORE;
  }
  if (run.claimLost !== undefined) {
    return { kind: 'claim-lost' };
  }
  if (run.handover !== undefined || run.fallbackActive === true || run.gating) {
    return IGNORE;
  }
  if (run.info.state === 'stopping') {
    return { kind: 'stopped' };
  }
  return run.info.state === 'detached' ? IGNORE : null;
}

/** The verdict of one worker exit. */
export function exitVerdict(run: LiveRun): ExitVerdict {
  const held = standing(run);
  if (held !== null) {
    return held;
  }
  if (isOneOnOne(run.request)) {
    return { kind: 'session' };
  }
  if (run.request.interactive !== undefined) {
    return { kind: 'interactive' };
  }
  if (!run.agentDone) {
    return { kind: 'no-result' };
  }
  if (run.reopened === true) {
    return { kind: 'reopened' };
  }
  const blocked = run.blocked ?? null;
  if (blocked !== null) {
    return { kind: 'blocked', blocked };
  }
  return run.request.form === 'scout' ? { kind: 'scout' } : { kind: 'gate' };
}
