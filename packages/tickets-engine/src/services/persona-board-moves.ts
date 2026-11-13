import type { ChainEntry } from '../contracts/chain';
import type { PersonaBoardMove } from '../contracts/persona-board';
import type { TicketCard } from '../contracts/tickets';
import type { PersonaLookup } from '../core/chain-holder';
import { renderChainEntry } from '../core/chain-list';
import { EDGE_STAGES } from '../core/lifecycle-stages';

/**
 * The owner's moves on a persona board (req-270, the persona board concept
 * §4) — decisions only; BoardService writes them as one `put`.
 *
 * - `start`: a ticket in Inbox or Prioritized dropped onto a persona's column
 *   becomes `active`, and the dropped-on persona takes the entry at the
 *   cursor (reading 10). A ticket without a chain gets the standard flow
 *   first (`flow:`), else a chain of that one persona.
 * - `hand`: the entry at the cursor becomes the target persona — two builders
 *   build differently, so a drag from Ben to another builder reassigns the
 *   step, it does not move the ticket on (Accept does that). Refused while a
 *   run holds the claim (the card offers Stop first) and while the ticket
 *   waits for the owner's answer (a question, the second send-back): those
 *   are decided by answering, Accept or Send back. A ticket that stands at You
 *   for want of a persona is assigned this way.
 * - `park`: back to Prioritized (or Inbox), the chain and the cursor kept.
 */
export type PersonaMoveWrite =
  | { readonly kind: 'refused'; readonly error: string }
  | { readonly kind: 'none' }
  | {
      readonly kind: 'write';
      /** The column the put places the ticket in: `active` for start, the edge stage for park, null = keep. */
      readonly phase: 'active' | 'prioritized' | 'inbox' | null;
      /** The new chain and cursor; null = unchanged. */
      readonly chain: { readonly entries: readonly string[]; readonly at: number } | null;
      readonly line: string;
    };

export interface PersonaMoveInput {
  readonly move: PersonaBoardMove;
  readonly card: TicketCard;
  readonly lookup: PersonaLookup;
  /** `pipeline.md`'s `flow:` — the chain a chainless ticket gets on start. */
  readonly flow: readonly ChainEntry[];
}

const refuse = (error: string): PersonaMoveWrite => ({ kind: 'refused', error });

/** The chain with the entry at the cursor handed to `persona` (its mode and notify stay). */
function handedChain(chain: readonly ChainEntry[], at: number | undefined, persona: string): { readonly entries: readonly string[]; readonly at: number } {
  if (chain.length === 0) {
    return { entries: [persona], at: 1 };
  }
  const position = Math.min(Math.max(at ?? 1, 1), chain.length);
  const entries = chain.map((entry, index) => renderChainEntry(index === position - 1 ? { ...entry, persona } : entry));
  return { entries, at: position };
}

function startOf(input: PersonaMoveInput, persona: string): PersonaMoveWrite {
  const { card } = input;
  if (!EDGE_STAGES.includes(card.phase) || card.phase === 'done') {
    return refuse(`${card.id} is not in Inbox or Prioritized — drag it between the persona columns instead`);
  }
  const chain = card.meta.chain !== undefined && card.meta.chain.length > 0 ? card.meta.chain : input.flow;
  const handed = handedChain(chain, card.meta.chain === undefined ? 1 : card.meta.at, persona);
  return { kind: 'write', phase: 'active', chain: handed, line: `started at position ${handed.at} of ${handed.entries.length} with ${persona}` };
}

function handOf(input: PersonaMoveInput, persona: string): PersonaMoveWrite {
  const { card } = input;
  const hold = card.hold;
  if (hold === undefined) {
    return refuse(`${card.id} has no holder — start it from Inbox or Prioritized`);
  }
  if (hold.claimed) {
    return refuse(`${card.id} is running at ${hold.holder} — stop the run first, then hand it on`);
  }
  if (hold.why === 'question' || hold.why === 'second-send-back') {
    return refuse(`${card.id} waits for your answer — answer it, Accept or Send back`);
  }
  if (hold.why === 'entry' && hold.named === persona) {
    return { kind: 'none' };
  }
  const handed = handedChain(card.meta.chain ?? [], card.meta.at, persona);
  return { kind: 'write', phase: null, chain: handed, line: `position ${handed.at} of ${handed.entries.length} handed to ${persona}` };
}

function parkOf(input: PersonaMoveInput, stage: 'prioritized' | 'inbox'): PersonaMoveWrite {
  const { card } = input;
  const hold = card.hold;
  if (hold === undefined) {
    return card.phase === stage ? { kind: 'none' } : refuse(`${card.id} is not on a persona's column`);
  }
  if (hold.claimed) {
    return refuse(`${card.id} is running at ${hold.holder} — stop the run first, then park it`);
  }
  return { kind: 'write', phase: stage, chain: null, line: `parked in ${stage === 'inbox' ? 'Inbox' : 'Prioritized'} at position ${hold.position} of ${hold.length}` };
}

/** What a persona board move writes. */
export function personaMoveOf(input: PersonaMoveInput): PersonaMoveWrite {
  const { move } = input;
  if (move.kind === 'park') {
    return parkOf(input, move.stage);
  }
  if (input.lookup(move.persona) === null) {
    return refuse(`"${move.persona}" is not in the crew`);
  }
  return move.kind === 'start' ? startOf(input, move.persona) : handOf(input, move.persona);
}
