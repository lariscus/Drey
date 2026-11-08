import type { BoardColumn, PipelinePhase, TicketCard } from '../../contracts/tickets';
import { dispatchable, isAutoPhase } from '../chain';
import type { ColumnMode, WorkerProviderId } from '../protocol';

/** What one pass knows about why a candidate did not run. */
export interface WaitContext {
  readonly busy: ReadonlySet<string>;
  readonly dispatched: ReadonlySet<string>;
  readonly detached: ReadonlySet<string>;
  readonly ownerHeld: ReadonlySet<string>;
  readonly refusedByColumn: ReadonlyMap<string, string>;
  readonly poolOf: (card: TicketCard, phase: PipelinePhase) => WorkerProviderId | null;
}

/** The lines one card earns this pass, and whether it waits in a held column. */
export interface CardWait {
  readonly lines: readonly string[];
  readonly held: boolean;
}

const NONE: CardWait = { lines: [], held: false };

/** A busy ticket: a run the owner stopped (or that ended blocked), or a detached run — say so, or the column looks idle. */
function busyLines(card: TicketCard, column: BoardColumn, mode: ColumnMode, ctx: WaitContext): readonly string[] {
  if (mode === 'held' || !isAutoPhase(column.phase)) {
    return [];
  }
  return [
    ctx.ownerHeld.has(card.id) ? `dispatch holds ${card.id}: its last run ended stopped or blocked — the owner moves or starts it to release the ticket` : null,
    ctx.detached.has(card.id) ? `dispatch holds ${card.id}: a detached run still blocks it — stop the run (its worker may still be alive) to free the ticket` : null,
  ].filter((line): line is string => line !== null);
}

/** A free candidate in a playing auto column: what holds it, if anything. */
function freeLine(card: TicketCard, column: BoardColumn, ctx: WaitContext): string | null {
  if (card.blocked.length > 0) {
    return `dispatch holds ${card.id}: blocked by ${card.blocked.join(', ')} — the blockers must reach the terminal phase first`;
  }
  if (card.meta.claimedBy !== null) {
    return `dispatch holds ${card.id}: claimed by ${card.meta.claimedBy} — the pool waits`;
  }
  if (card.meta.interactive) {
    return `dispatch holds ${card.id}: reserved for an interactive dialog — the owner plans or refines it themselves`;
  }
  if (card.meta.run !== null) {
    return `dispatch holds ${card.id}: a run stamp without a live run — stop or resume the detached run`;
  }
  if (!dispatchable(card, ctx.busy)) {
    return null;
  }
  const refused = ctx.refusedByColumn.get(column.phase.id);
  if (refused !== undefined) {
    return `dispatch waits ${card.id}: ${column.phase.id}'s dispatch of ${refused} was refused — the queue cannot advance`;
  }
  return `dispatch waits ${card.id}: no free ${ctx.poolOf(card, column.phase) ?? 'worker'} pool slot yet — more important tickets go first`;
}

/**
 * Why a candidate the plan left behind waits (the chain log must say WHY
 * nothing moves — the owner once watched ten silent minutes): a hold, a
 * claim, a dependency, a refused start ahead of it, or no free slot.
 * Manual columns are the owner's queue — silence there.
 */
export function cardWait(card: TicketCard, column: BoardColumn, mode: ColumnMode, ctx: WaitContext): CardWait {
  if (ctx.dispatched.has(card.id)) {
    return NONE;
  }
  if (ctx.busy.has(card.id)) {
    return { lines: busyLines(card, column, mode, ctx), held: false };
  }
  if (mode === 'held') {
    return { lines: [], held: dispatchable(card, ctx.busy) };
  }
  if (!isAutoPhase(column.phase)) {
    return NONE;
  }
  const line = freeLine(card, column, ctx);
  return { lines: line === null ? [] : [line], held: false };
}
