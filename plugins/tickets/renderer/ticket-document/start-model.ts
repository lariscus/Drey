/**
 * The ticket card's primary button (req-120, board 9a's `Start build`): on a
 * persona board, a Prioritized ticket starts its chain from the card — the
 * persona board's `start` move (milestone 254) with the persona of the entry
 * at the cursor, the same move a drop on that persona's column makes. The
 * button shows only where the board would accept that drop: a persona board
 * (the snapshot carries lanes), the ticket in Prioritized, a readable chain
 * whose entry at the cursor names a persona of the crew. Pure.
 */
import { isPersonaBoard } from '../../../../packages/tickets-engine/src/contracts/persona-board';
import type { BoardSnapshot, TicketCard } from '../../shared/tickets';

/** The start the card offers: the persona that takes the entry, and its display name. */
export interface CardStart {
  readonly persona: string;
  readonly title: string;
}

/** The card's start, or null when the board shows no start for this ticket. */
export function cardStartOf(snapshot: BoardSnapshot, card: TicketCard): CardStart | null {
  const chain = card.meta.chain ?? [];
  if (!isPersonaBoard(snapshot) || card.phase !== 'prioritized' || chain.length === 0 || card.meta.claimedBy != null) {
    return null;
  }
  const at = Math.min(Math.max(card.meta.at ?? 1, 1), chain.length);
  const lane = (snapshot.lanes ?? []).find((candidate) => candidate.persona === chain[at - 1]!.persona) ?? null;
  return lane === null ? null : { persona: lane.persona, title: lane.title };
}
