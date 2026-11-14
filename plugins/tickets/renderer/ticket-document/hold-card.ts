/**
 * The ticket card on a persona board (boards 7a v2 `DeskWorkV2`, 9a), the pure
 * half: the Flow row is the ticket's chain of personas — `✓ Paul · ✓ Paul ·
 * Ben (3 of 6) · Ralf · Tessa · You` — and the Holder row names who holds it
 * (`You · Ben asks`), the words Mission Control's ticket uses since milestone
 * 260. A ticket in a lifecycle column (Inbox, Prioritized, Done) has no holder:
 * its Flow row is the chain it carries (or the standard flow it would get).
 */
import type { ChainEntry } from '../../../../packages/tickets-engine/src/contracts/chain';
import { YOU_LANE, chainCellsOf, isPersonaBoard, type TicketHold } from '../../../../packages/tickets-engine/src/contracts/persona-board';
import type { I18n } from '../../../../shared/i18n/types';
import type { BoardSnapshot, TicketCard } from '../../shared/tickets';
import type { FlowItem } from './model';
import { titleCase } from './model';

/** A persona's display name: the board's lane, else the persona list, else the id title-cased. */
export type TitleOf = (persona: string) => string;

export function titleOfSnapshot(snapshot: BoardSnapshot, personas: readonly { readonly id: string; readonly title: string }[]): TitleOf {
  return (persona) =>
    snapshot.lanes?.find((lane) => lane.persona === persona)?.title ?? personas.find((p) => p.id === persona)?.title ?? titleCase(persona);
}

/** The Holder row: the holder's name, the reason beside it, and its persona (the 7b picture). */
export interface HolderFact {
  /** `You · Ben asks`, `Ben`. */
  readonly label: string;
  readonly persona: string;
  /** The holder works the entry in the Shape chat (`paul:shape`): board 7b draws its picture. */
  readonly shape: boolean;
}

/** What a persona board's card shows; null on the phase board. */
export interface HoldCard {
  readonly flow: readonly FlowItem[];
  /** Null in a lifecycle column. */
  readonly holder: HolderFact | null;
}

/** The Flow row of a held ticket: done positions ticked, the cursor bold with `(3 of 6)`, the rest plain. */
export function heldFlowOf(i18n: I18n, hold: TicketHold, titleOf: TitleOf): FlowItem[] {
  return chainCellsOf(hold).map((cell) => ({
    title: titleOf(cell.persona),
    state: cell.state === 'done' ? 'past' : cell.state === 'now' ? 'current' : 'future',
    note: cell.state === 'now' ? i18n.t('ticket.hold.flow_position', { at: hold.position, of: hold.length }) : null,
  }));
}

/** Who holds the ticket and why (the holder rule, concept §3), in the words of board 7a v2. */
export function holderFactOf(i18n: I18n, hold: TicketHold, titleOf: TitleOf): HolderFact {
  const name = titleOf(hold.holder);
  const note =
    hold.why === 'question'
      ? i18n.t('work.hold.asks', { name: titleOf(hold.named ?? hold.holder) })
      : hold.why === 'second-send-back'
        ? i18n.t('work.hold.sent_back_twice')
        : hold.why === 'no-persona'
          ? i18n.t('work.hold.no_persona')
          : null;
  return {
    label: note === null ? name : i18n.t('ticket.card.holder_note', { name, note }),
    persona: hold.holder,
    shape: hold.mode === 'shape' && hold.holder !== YOU_LANE && hold.why === 'entry',
  };
}

/**
 * The chain a ticket in a lifecycle column carries: its own `chain:`, else the
 * board's standard flow (what a start would copy). Done tickets have walked it.
 */
export function lifecycleFlowOf(card: TicketCard, flow: readonly ChainEntry[], titleOf: TitleOf, done: boolean): FlowItem[] {
  const own = card.meta.chain ?? [];
  const entries = own.length > 0 ? own : flow;
  return entries.map((entry) => ({ title: titleOf(entry.persona), state: done ? 'past' : 'future', note: null }));
}

/** The persona board's card facts; null on the phase board (no lanes), where the card keeps its phases. */
export function holdCardOf(i18n: I18n, snapshot: BoardSnapshot, card: TicketCard, titleOf: TitleOf): HoldCard | null {
  if (!isPersonaBoard(snapshot)) {
    return null;
  }
  if (card.hold !== undefined) {
    return { flow: heldFlowOf(i18n, card.hold, titleOf), holder: holderFactOf(i18n, card.hold, titleOf) };
  }
  const terminal = snapshot.pipeline[snapshot.pipeline.length - 1]?.id ?? 'done';
  const done = card.phase === terminal || card.phase === 'archive';
  return { flow: lifecycleFlowOf(card, snapshot.flow ?? [], titleOf, done), holder: null };
}
