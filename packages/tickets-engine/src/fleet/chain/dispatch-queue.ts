/**
 * The dispatcher's queue as the fleet report carries it (req-148, boards 5d
 * and 10i, owner ruling O11): every ticket a dispatch pass wanted to start
 * and left waiting, in the order it would serve them. Two sources feed it —
 * the capacity pool's queue (a class without room, `slot`) and, on a persona
 * board, the holders the plan found no place for (`slot` when the big pool
 * is full, `persona` when the persona runs its `parallel:`). A ticket that
 * already waited for the same reason keeps its `since`. Pure.
 */
import type { HolderWait } from './holder-plan';
import type { QueueEntry } from '../protocol-pool';
import type { QueuedTicket, QueuedWhy } from '../protocol-chain';

export interface DispatchQueueInput {
  /** The candidates' ticket ids in dispatch order; a pool entry outside it is served after them, in the pool's order. */
  readonly order: readonly string[];
  /** The capacity pool's queue of this pass. */
  readonly pool: readonly QueueEntry[];
  /** The holder plan's waits of this pass (none on the phase board). */
  readonly waits: ReadonlyMap<string, { readonly persona: string; readonly why: HolderWait }>;
  /** The queue the last pass reported — whose `since` a ticket keeps. */
  readonly previous: readonly QueuedTicket[];
  /** ISO: this pass. */
  readonly now: string;
}

const WHY_OF: Readonly<Record<HolderWait, QueuedWhy>> = { 'pool-full': 'slot', 'persona-full': 'persona' };

/** The queue of one pass (see the module comment). */
export function dispatchQueueOf(input: DispatchQueueInput): QueuedTicket[] {
  const waiting = new Map<string, { readonly persona: string | null; readonly why: QueuedWhy }>();
  for (const entry of input.pool) {
    waiting.set(entry.ticket, { persona: entry.persona, why: 'slot' });
  }
  for (const [ticket, wait] of input.waits) {
    waiting.set(ticket, { persona: wait.persona, why: WHY_OF[wait.why] });
  }
  const ordered = [...input.order.filter((ticket) => waiting.has(ticket)), ...input.pool.map((entry) => entry.ticket).filter((ticket) => !input.order.includes(ticket))];
  const since = new Map(input.previous.map((entry) => [`${entry.ticket}|${entry.why}`, entry.since] as const));
  return [...new Set(ordered)].map((ticket, index) => {
    const { persona, why } = waiting.get(ticket)!;
    return { ticket, persona, why, position: index + 1, since: since.get(`${ticket}|${why}`) ?? input.now };
  });
}
