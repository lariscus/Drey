/**
 * The chain's cursor arithmetic (req-257, the persona board concept §4):
 * where `at:` / `x-at` goes when an entry ends, when a persona sends the
 * ticket back, and when the owner does. Pure — the runner and BoardService
 * write what these functions decide.
 *
 * - An entry ends green: the cursor moves to the next position; past the
 *   last entry the chain is finished (the ticket goes to `done`, after
 *   You's `commit` where the chain ends at You).
 * - A persona's send-back (`send-back: <position> <reason>`) names an
 *   EARLIER position of this ticket's chain. The first one moves the
 *   cursor there and invalidates that entry and every later one — each
 *   runs again; `sent-back: from>to` marks the one send-back a ticket has.
 *   A second does not move the cursor: the ticket goes to You with both
 *   reasons. Anything but an earlier position is refused (a red gate).
 * - The owner's own Send back at You is never refused and never uses the
 *   one send-back (concept §14 reading 6).
 */
import type { ChainEntry, ChainSendBack } from '../contracts/chain';
import { renderSendBack } from './chain-list';

/** Where the cursor goes after the entry at `at` ended green. */
export type CursorAdvance = { readonly kind: 'next'; readonly at: number } | { readonly kind: 'finished' };

/** The cursor after the entry at `at` (1-based, clamped) ended green. */
export function advanceCursor(chain: readonly ChainEntry[], at: number | undefined): CursorAdvance {
  const current = Math.min(Math.max(at ?? 1, 1), Math.max(chain.length, 1));
  return current >= chain.length ? { kind: 'finished' } : { kind: 'next', at: current + 1 };
}

/** True when the cursor stands at the chain's last entry (`x-at` = the chain's length). */
export function atLastEntry(chain: readonly ChainEntry[], at: number | undefined): boolean {
  return chain.length > 0 && Math.min(Math.max(at ?? 1, 1), chain.length) === chain.length;
}

/** What a persona's send-back does. */
export type SendBackDecision =
  /** The first send-back: the cursor moves to `at`, `sentBack` is written, `invalidated` run again. */
  | { readonly kind: 'moved'; readonly at: number; readonly sentBack: ChainSendBack; readonly invalidated: readonly number[] }
  /** The ticket already used its send-back: the cursor stays, the ticket goes to You with both reasons. */
  | { readonly kind: 'to-owner'; readonly earlier: ChainSendBack }
  /** The target is no earlier position of this chain: a red gate with `reason`. */
  | { readonly kind: 'refused'; readonly reason: string };

/** What the run's verdict asked: back to `target` from the entry at `at`. */
export interface SendBackAsk {
  readonly chain: readonly ChainEntry[];
  readonly at: number | undefined;
  readonly sentBack: ChainSendBack | undefined;
  readonly target: number;
}

/** A persona's send-back (concept §4): checked, then the first moves the cursor and the second goes to You. */
export function decideSendBack(ask: SendBackAsk): SendBackDecision {
  const from = Math.min(Math.max(ask.at ?? 1, 1), Math.max(ask.chain.length, 1));
  if (!Number.isInteger(ask.target) || ask.target < 1 || ask.target >= from) {
    const range = from > 1 ? ` (1${from > 2 ? `–${from - 1}` : ''})` : ' — there is none';
    return { kind: 'refused', reason: `send-back to position ${ask.target} is not an earlier position of this chain${range}` };
  }
  if (ask.sentBack !== undefined) {
    return { kind: 'to-owner', earlier: ask.sentBack };
  }
  const invalidated: number[] = [];
  for (let position = ask.target; position <= ask.chain.length; position++) {
    invalidated.push(position);
  }
  return { kind: 'moved', at: ask.target, sentBack: { from, to: ask.target }, invalidated };
}

/** The status log's line for a send-back that moved the cursor: who, from where, to where, why, what runs again. */
export function invalidationLine(chain: readonly ChainEntry[], sentBack: ChainSendBack, reason: string): string {
  const who = (position: number): string => `${position} (${chain[position - 1]?.persona ?? '?'})`;
  const last = chain.length;
  const again = sentBack.to === last ? `position ${last} runs again` : `positions ${sentBack.to}–${last} run again`;
  const why = reason.trim() === '' ? '' : `: ${reason.trim()}`;
  return `sent back ${renderSendBack(sentBack)} — from ${who(sentBack.from)} to ${who(sentBack.to)}${why}; ${again}`;
}

/**
 * The owner's Send back at You without a named target (until req-270's
 * picker): the nearest earlier position whose persona `isAgent` says works
 * with a run; null when the chain has none before the cursor.
 */
export function ownerSendBackTarget(chain: readonly ChainEntry[], at: number | undefined, isAgent: (persona: string) => boolean): number | null {
  const from = Math.min(Math.max(at ?? 1, 1), Math.max(chain.length, 1));
  for (let position = from - 1; position >= 1; position--) {
    if (isAgent(chain[position - 1]!.persona)) {
      return position;
    }
  }
  return null;
}
