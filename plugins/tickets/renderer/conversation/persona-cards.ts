/**
 * The persona board's four Mission Control cards on the desktop (req-273,
 * board MCCardsV2): the one `personaCardsOf` model over the board snapshot
 * and the fleet's runs, and what each button does through the plugin IPC.
 * The Mission Control target (`targets.ts`) draws the cards as messages
 * beside the burn-rate card.
 */
import { personaCardsOf, type CardNeed, type CardTicket, type PersonaCard, type PersonaCardAction, type PersonaCardFormat } from '../../../../shared/persona-cards';
import type { RunInfo } from '../../../../packages/tickets-engine/src/fleet/protocol';
import { needsOf } from '../../../../packages/tickets-engine/src/server/needs';
import type { BoardSnapshot } from '../../shared/tickets';

/** What the Mission Control target needs of the persona board's cards. */
export interface PersonaCardsBinding {
  cards(): readonly PersonaCard[];
  /** The agents of the crew in the crew's order: the Assign… picker's rows. */
  agents(): readonly { readonly persona: string; readonly title: string }[];
  /** Runs one button (Assign… excepted); resolves the words of a refusal, or null when it went through. */
  act(card: PersonaCard, action: PersonaCardAction): Promise<string | null>;
  /** Hands the ticket to the picked persona; the same answer as `act`. */
  assign(card: PersonaCard, persona: string): Promise<string | null>;
  /** Fires on every board and fleet change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export interface PersonaCardsDeps {
  snapshot(): BoardSnapshot | null;
  runs(): readonly RunInfo[];
  format(): PersonaCardFormat;
  invoke(method: string, payload?: unknown): Promise<unknown>;
  /** Opens the ticket's document in Drey. */
  openTicket(id: string, path: string): void;
  /** Shows the Assistant, whose composer takes the owner's own answer. */
  revealComposer(): void;
  subscribe(listener: () => void): () => void;
}

type Reply = { readonly ok?: boolean; readonly error?: string };

const wordsOf = (reply: unknown): string | null => {
  const r = (typeof reply === 'object' && reply !== null ? reply : {}) as Reply;
  return r.ok === false ? (r.error ?? '') || 'refused' : null;
};

export function createPersonaCardsBinding(deps: PersonaCardsDeps): PersonaCardsBinding {
  const call = async (method: string, payload: unknown): Promise<string | null> => {
    try {
      return wordsOf(await deps.invoke(method, payload));
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  const needsOfBoard = (snap: BoardSnapshot): readonly CardNeed[] => needsOf(snap, [...deps.runs()]);
  const formKeyOf = (card: PersonaCard): string => {
    const snap = deps.snapshot();
    const need = snap === null ? undefined : needsOfBoard(snap).find((item) => item.ticketId === card.ticketId && item.runId === card.runId);
    return (need as { questions?: readonly { key?: string }[] } | undefined)?.questions?.[0]?.key ?? 'q0';
  };
  const hand = (card: PersonaCard, persona: string): Promise<string | null> => call('personaBoardMove', { kind: 'hand', id: card.ticketId, persona });
  const answer = (card: PersonaCard, text: string): Promise<string | null> => {
    if (card.runId === null) {
      return Promise.resolve(null);
    }
    return call('fleetAnswer', { runId: card.runId, answers: { [formKeyOf(card)]: text.trim() } });
  };
  return {
    cards: () => {
      const snap = deps.snapshot();
      if (snap === null || snap.lanes === undefined) {
        return [];
      }
      const tickets: CardTicket[] = snap.columns.flatMap((column) =>
        column.tickets.map((card) => ({ id: card.id, title: card.meta.title ?? card.id, cost: card.usage?.cost ?? null, hold: card.hold ?? null })),
      );
      const lanes = snap.lanes.map((lane) => ({ persona: lane.persona, title: lane.title, color: lane.color }));
      return personaCardsOf({ lanes, tickets, needs: needsOfBoard(snap) }, deps.format());
    },
    agents: () => (deps.snapshot()?.lanes ?? []).filter((lane) => lane.kind === 'agent').map((lane) => ({ persona: lane.persona, title: lane.title })),
    act: (card, action) => {
      switch (action.id) {
        case 'do_myself':
          return hand(card, 'you');
        case 'option':
          return answer(card, action.answer ?? action.label);
        case 'write_answer':
          deps.revealComposer();
          return Promise.resolve(null);
        case 'accept':
          return call('acceptTicket', { id: card.ticketId });
        case 'send_back':
        case 'resolve': {
          const path = deps.snapshot()?.columns.flatMap((column) => column.tickets).find((ticket) => ticket.id === card.ticketId)?.path;
          if (path !== undefined) {
            deps.openTicket(card.ticketId, path);
          }
          return Promise.resolve(null);
        }
        case 'let_resolve':
          return call('fleetStart', { origin: 'drey:mission-control', id: card.ticketId });
        case 'assign':
          return Promise.resolve(null);
      }
    },
    assign: (card, persona) => hand(card, persona),
    subscribe: deps.subscribe,
  };
}
