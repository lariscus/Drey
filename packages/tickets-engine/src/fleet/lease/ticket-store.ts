/**
 * The runner's ticket store (ADR-0096, ADR-0090): the one backend every run
 * writes through — claim, release, `put` inside the claim, comments. The
 * shape is the engine's `TicketStore` port; the runner gets one per dricket
 * target from the composition root (`DkTicketStores` in production,
 * `FakeTicketStore` in the specs). The legacy file writer is gone
 * (req-176): a run without a store target writes no ticket.
 */
import type { TicketStore } from '../../ports/ticket-store';
import type { RunDkTarget } from '../protocol';

export type { TicketStore };
export { TicketStoreError } from '../../ports/ticket-store';

/** The store of a run's dricket target. */
export type StoreForTarget = (target: RunDkTarget) => TicketStore;
