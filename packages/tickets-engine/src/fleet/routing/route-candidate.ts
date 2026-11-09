/**
 * The shapes the routing's stages hand each other (req-178): one way a
 * session could run (a row of the persona's pool), that way on one slot,
 * and a slot's refusal. Interfaces only.
 */
import type { FullLedger, ModelRow, PoolEntry, QueueReason, SlotView, WorkerProviderId } from '../protocol';

/** One way a session could run: a row (or an untabled model) on a provider. */
export interface RouteOption {
  readonly row: ModelRow | null;
  readonly entry: PoolEntry;
  readonly provider: WorkerProviderId;
}

/** An option on one slot that passed the filter. */
export interface RouteCandidate extends RouteOption {
  readonly view: SlotView;
  /** The pool order (strongest entry first, then the table's order): the last tie-break. */
  readonly order: number;
}

/** Why an option does not run on a slot: the queue's reason, the text, the ledger when that is it. */
export interface SlotRefusal {
  readonly reason: QueueReason;
  readonly text: string;
  /** The short form the route line lists (`no image input`); absent = the text. */
  readonly short?: string;
  readonly ledger?: FullLedger;
}
