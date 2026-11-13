/**
 * The persona board's half of the snapshot (req-270): the holder lanes in the
 * crew's order and every active ticket's {@link TicketHold}, derived from its
 * chain, cursor and `awaiting` by the one holder rule (`chain-holder.ts`).
 * Pure — BoardService hands it the crew it read; the store reader keeps
 * placing tickets in `columns` as before, so nothing that walks the columns
 * loses a ticket.
 */
import type { BoardLane, HoldWhy, TicketHold } from '../contracts/persona-board';
import { YOU_LANE } from '../contracts/persona-board';
import type { BoardColumn, BoardSnapshot, OpenTicketStatus, TicketCard } from '../contracts/tickets';
import { holderOf, type PersonaLookup, type TicketHolder } from './chain-holder';
import { ACTIVE_STAGE, EDGE_STAGES, RUNNING_STAGE } from './lifecycle-stages';
import type { Persona } from './persona';

/** The needs-decision keys that are no question of a run (the second send-back, Pia's turn). */
const NOT_A_QUESTION: readonly string[] = ['second-send-back', 'pia-turn'];

/** The lanes of a crew already in the crew's order; You joins last when the crew has no human record. */
export function lanesOf(personas: readonly Pick<Persona, 'id' | 'kind' | 'title' | 'color' | 'settings'>[]): readonly BoardLane[] {
  const lanes: BoardLane[] = personas.map((persona) => ({
    persona: persona.id,
    title: persona.title === '' ? persona.id : persona.title,
    kind: persona.kind,
    color: persona.color,
    parallel: persona.kind === 'agent' ? persona.settings.parallel : null,
    min: persona.kind === 'agent' ? persona.settings.min : 0,
  }));
  if (!lanes.some((lane) => lane.persona === YOU_LANE)) {
    lanes.push({ persona: YOU_LANE, title: 'You', kind: 'human', color: '', parallel: null, min: 0 });
  }
  return lanes;
}

function whyOf(holder: TicketHolder, decisions: readonly OpenTicketStatus[]): HoldWhy {
  if (holder.kind === 'awaiting') {
    return decisions.some((item) => item.key === 'second-send-back') ? 'second-send-back' : 'question';
  }
  return holder.kind === 'no-persona' ? 'no-persona' : 'entry';
}

/** The open questions of a ticket that waits for the owner's answer (at least the one that parked it). */
function questionsOf(decisions: readonly OpenTicketStatus[]): number {
  return Math.max(1, decisions.filter((item) => item.key === null || !NOT_A_QUESTION.includes(item.key)).length);
}

/** The hold of one active card; null in a lifecycle column. */
export function holdOf(card: TicketCard, lookup: PersonaLookup, decisions: readonly OpenTicketStatus[]): TicketHold | null {
  const holder = holderOf({ stage: 'active', chain: card.meta.chain, at: card.meta.at, awaiting: card.meta.awaiting }, lookup);
  if (holder.kind === 'none') {
    return null;
  }
  const chain = (card.meta.chain ?? []).map((item) => item.persona);
  const entry = holder.entry ?? { position: 1, length: chain.length, named: null, mode: null };
  const why = whyOf(holder, decisions);
  return {
    holder: holder.persona,
    why,
    position: entry.position,
    length: entry.length,
    chain,
    mode: entry.mode,
    named: entry.named,
    claimed: card.meta.claimedBy !== null,
    sentBack: card.meta.sentBack ?? null,
    questions: why === 'question' ? questionsOf(decisions) : 0,
  };
}

/** True for a column whose tickets have no holder: Inbox, Prioritized, Done and the pipeline's terminal one. */
function isLifecycleColumn(column: BoardColumn, terminal: string | null): boolean {
  return EDGE_STAGES.includes(column.phase.id) || column.phase.id === terminal;
}

/** The snapshot as a persona board: `lanes` set, every active card carrying its hold. */
export function withPersonaBoard(snap: BoardSnapshot, lanes: readonly BoardLane[], lookup: PersonaLookup): BoardSnapshot {
  const configured = snap.columns.filter((column) => !column.unknown);
  const terminal = configured.length > 0 ? configured[configured.length - 1]!.phase.id : null;
  const decisionsOf = (id: string): readonly OpenTicketStatus[] => (snap.openStatus ?? []).filter((item) => item.ticketId === id && item.verb === 'needs-decision');
  const columns = snap.columns.map((column) => {
    if (isLifecycleColumn(column, terminal)) {
      return column;
    }
    const tickets = column.tickets.map((card) => {
      const hold = holdOf(card, lookup, decisionsOf(card.id));
      return hold === null ? card : { ...card, hold };
    });
    return { ...column, tickets };
  });
  // Once the pipeline holds only the lifecycle phases, the active tickets stand in the stage's own
  // column: on a persona board that is expected (the lanes draw them), never "not a phase in pipeline.md".
  const issues = snap.issues.filter((issue) => !HOLDER_STAGE_DIRS.some((dir) => issue.message === `directory "${dir}" is not a phase in pipeline.md`));
  return { ...snap, columns, issues, lanes };
}

/** The store stages an active ticket stands in when the pipeline has no holder column for it. */
const HOLDER_STAGE_DIRS: readonly string[] = [ACTIVE_STAGE, RUNNING_STAGE];
