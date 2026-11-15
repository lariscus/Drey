import type { ChainEntry } from '../contracts/chain';
import type { TicketCard } from '../contracts/tickets';
import { atLastEntry, ownerSendBackTarget } from '../core/pipeline/chain-cursor';
import { renderChainEntry } from '../core/pipeline/chain-list';
import { chainFinished } from '../core/pipeline/chain-placement';
import { cursorAfterGreen } from '../core/pipeline/chain-red-gate';
import type { PersonaLookup } from '../core/pipeline/chain-holder';
import { EDGE_STAGES } from '../core/pipeline/lifecycle-stages';

/** What the owner's chain moves read of the board: the terminal column and the crew's kinds. */
export interface OwnerChainContext {
  readonly terminal: string | null;
  readonly lookup: PersonaLookup;
}

/**
 * The owner's Accept and Send back on a chain ticket of a lifecycle store
 * (req-257, the persona board concept §4): decisions only — BoardService
 * writes them. A ticket in a lifecycle column (Inbox, Prioritized, Done)
 * keeps the column moves it always had ({@link ownerAcceptOf} answers
 * `none`).
 *
 * - Accept moves the cursor to the next position: the owner's step is done
 *   (a You entry), or the owner hands on whatever stands at the cursor.
 *   At a `:shape` entry (req-305) it ends the shaping instead: the entry
 *   drops its mode and the persona's run follows at the same position.
 * - At the chain's LAST entry: a You entry of a repository ticket is the
 *   sign-off — You's `commit` leaving action (milestone 245's machine run)
 *   first, then `done`; any other last entry goes straight to `done` (a
 *   chain that does not end at You ends without a commit, concept §14
 *   reading 5).
 * - Send back moves the cursor to the position the owner picked (req-270's
 *   target picker: any earlier position), else to the nearest earlier agent
 *   position; the owner's send-back never uses the one send-back a ticket
 *   has (reading 6).
 * - req-78: while a red gate's return is pending (`return-to` after the
 *   cursor), Accept sends the ticket straight back to the position that went
 *   red; the owner's Send back and every other cursor write drop the return.
 */
export type OwnerAccept =
  | { readonly kind: 'none' }
  /**
   * req-305: the shaping at a `:shape` entry is over — the entry loses its mode, the cursor stays,
   * and the persona's own run starts at the same position (one entry, one position).
   */
  | { readonly kind: 'shaped'; readonly entries: readonly string[]; readonly at: number; readonly line: string }
  | { readonly kind: 'commit' }
  | { readonly kind: 'done'; readonly line: string }
  /** `returned` (req-78): the cursor goes straight back to the position whose red gate sent the ticket here. */
  | { readonly kind: 'cursor'; readonly at: number; readonly line: string; readonly returned: boolean };

export type OwnerSendBack =
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly error: string }
  | { readonly kind: 'cursor'; readonly at: number; readonly persona: string };

/** The cursor of an `active` chain ticket in a holder's column; null when the owner's move is the column move of old. */
function activeChainOf(card: TicketCard, placement: OwnerChainContext): { readonly at: number; readonly length: number } | null {
  const chain = card.meta.chain;
  if (chain === undefined || chain.length === 0 || EDGE_STAGES.includes(card.phase) || card.phase === placement.terminal) {
    return null;
  }
  if (chainFinished(chain, card.meta.at)) {
    return null;
  }
  return { at: Math.min(Math.max(card.meta.at ?? 1, 1), chain.length), length: chain.length };
}

/** req-305: Accept at an agent's `:shape` entry ends the shaping in place; null at any other entry. */
function shapedAcceptOf(chain: readonly ChainEntry[], at: number, placement: OwnerChainContext): OwnerAccept | null {
  const current = chain[at - 1]!;
  if (current.mode !== 'shape' || placement.lookup(current.persona)?.kind !== 'agent') {
    return null;
  }
  const entries = chain.map((entry, index) => renderChainEntry(index === at - 1 ? { ...entry, mode: null } : entry));
  return { kind: 'shaped', entries, at, line: `shaping done at position ${at} of ${chain.length} — ${current.persona} plans it now` };
}

/** What the owner's Accept does to a chain ticket. */
export function ownerAcceptOf(card: TicketCard, placement: OwnerChainContext): OwnerAccept {
  const active = activeChainOf(card, placement);
  const chain = card.meta.chain;
  if (active === null || chain === undefined) {
    return { kind: 'none' };
  }
  const { at, length } = active;
  const shaped = shapedAcceptOf(chain, at, placement);
  if (shaped !== null) {
    return shaped;
  }
  const back = cursorAfterGreen(length, at, card.meta.returnTo);
  if (back.returned) {
    return { kind: 'cursor', at: back.at, line: `accepted at position ${at} of ${length} — back to position ${back.at}, whose red gate sent it here`, returned: true };
  }
  if (!atLastEntry(chain, at)) {
    return { kind: 'cursor', at: at + 1, line: `accepted at position ${at} of ${length} — position ${at + 1} next`, returned: false };
  }
  const signOff = placement.lookup(chain[at - 1]!.persona)?.kind === 'human';
  if (signOff && card.meta.repo !== null && (card.meta.form ?? 'ship') !== 'scout') {
    return { kind: 'commit' };
  }
  return { kind: 'done', line: `accepted at the last position (${at} of ${length}) — the chain is through` };
}

/** What the owner's Send back does to a chain ticket; `position` = the owner's pick of an earlier position. */
export function ownerSendBackOf(card: TicketCard, placement: OwnerChainContext, position?: number): OwnerSendBack {
  const active = activeChainOf(card, placement);
  const chain = card.meta.chain;
  if (active === null || chain === undefined) {
    return { kind: 'none' };
  }
  if (position !== undefined) {
    return position >= 1 && position < active.at
      ? { kind: 'cursor', at: position, persona: chain[position - 1]!.persona }
      : { kind: 'refused', error: `position ${position} is not before position ${active.at} of ${card.id}` };
  }
  const target = ownerSendBackTarget(chain, active.at, (persona) => placement.lookup(persona)?.kind === 'agent');
  if (target === null) {
    return { kind: 'refused', error: `there is no agent position before position ${active.at} to send ${card.id} back to` };
  }
  return { kind: 'cursor', at: target, persona: chain[target - 1]!.persona };
}

