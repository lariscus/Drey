/**
 * A red gate that sends the ticket back (req-78, the persona board's form of
 * the row: ADR-0098 later change). An entry may name where its red machine
 * gate goes — `tessa(on-red paul)`, `tessa(on-red 2)`: the persona of the
 * nearest earlier position that names it, or that earlier position. Pure:
 * the runner and the board service write what these functions decide.
 *
 * - The red gate is milestone 248's send-back with the gate's failure as its
 *   reason: the cursor goes to the target and `return-to` records the
 *   position that went red. It does NOT use the ticket's one persona
 *   send-back — the target is configured, and the loop has its own bound.
 * - The return: when the entry at the cursor ends green while `return-to`
 *   stands after it, the cursor goes straight back to `return-to` — the
 *   positions between are not walked again, a You entry between included.
 * - The bound: `red-backs` counts the red-gate send-backs of the loop; the
 *   red gate that would make it reach the persona breaker's threshold
 *   (`max-red` of the column, else 3) stays with its persona as before, and
 *   the breaker of milestone 247 takes it from there. A green end that is
 *   no return ends the loop and its count.
 */
import type { ChainEntry, ChainRedTarget } from '../../contracts/chain';

/** The position an `on-red` target names in this chain from the entry at `from`; null when it names no earlier position. */
export function redTargetPosition(chain: readonly ChainEntry[], from: number, target: ChainRedTarget): number | null {
  if (typeof target === 'number') {
    return Number.isInteger(target) && target >= 1 && target < from ? target : null;
  }
  for (let position = Math.min(from, chain.length + 1) - 1; position >= 1; position--) {
    if (chain[position - 1]!.persona === target) {
      return position;
    }
  }
  return null;
}

/** What a red gate of the entry at `at` does. */
export type RedGateDecision =
  /** No `on-red` on the entry: the red gate stays with its persona (as before). */
  | { readonly kind: 'stay' }
  /** The target names no earlier position (a replan moved it): it stays, and the note says why. */
  | { readonly kind: 'unresolved'; readonly reason: string }
  /** The loop reached its bound: it stays, the persona breaker takes it. */
  | { readonly kind: 'bound'; readonly redBacks: number; readonly maxRed: number }
  /** Back to `to`; the cursor returns to `from` when `to` is through. `redBacks` = the count after this one. */
  | { readonly kind: 'back'; readonly from: number; readonly to: number; readonly redBacks: number; readonly maxRed: number };

export interface RedGateAsk {
  readonly chain: readonly ChainEntry[];
  readonly at: number;
  /** The red-gate send-backs of the loop so far. */
  readonly redBacks: number;
  /** The persona breaker's threshold for this run. */
  readonly maxRed: number;
}

/** The red gate's decision (see the module comment). */
export function decideRedGate(ask: RedGateAsk): RedGateDecision {
  const target = ask.chain[ask.at - 1]?.onRed;
  if (target === undefined) {
    return { kind: 'stay' };
  }
  const to = redTargetPosition(ask.chain, ask.at, target);
  if (to === null) {
    return { kind: 'unresolved', reason: `on-red ${target} names no earlier position of this chain` };
  }
  const redBacks = ask.redBacks + 1;
  if (redBacks >= ask.maxRed) {
    return { kind: 'bound', redBacks: ask.redBacks, maxRed: ask.maxRed };
  }
  return { kind: 'back', from: ask.at, to, redBacks, maxRed: ask.maxRed };
}

/** Where the cursor goes when the entry at `at` ends green: straight back to `returnTo` when it stands after `at` in the chain, else on. */
export function cursorAfterGreen(length: number, at: number, returnTo: number | undefined): { readonly at: number; readonly returned: boolean } {
  if (returnTo !== undefined && returnTo > at && returnTo <= length) {
    return { at: returnTo, returned: true };
  }
  return { at: at + 1, returned: false };
}

/** The status log's line for a red gate that sent the ticket back: from where, to where, the count, the gate's line. */
export function redBackLine(chain: readonly ChainEntry[], decision: Extract<RedGateDecision, { kind: 'back' }>, gate: string): string {
  const who = (position: number): string => `${position} (${chain[position - 1]?.persona ?? '?'})`;
  const why = gate.trim() === '' ? '' : `: ${gate.trim()}`;
  return `red gate at position ${who(decision.from)} — sent back to ${who(decision.to)} (red ${decision.redBacks} of ${decision.maxRed - 1}); returns to position ${decision.from} when position ${decision.to} is through${why}`;
}
