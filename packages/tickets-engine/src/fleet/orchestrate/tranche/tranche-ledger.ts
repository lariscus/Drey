import type { Clock } from '../../ports/clock';
import type { ChainState } from '../chain-state';
import type { RunFact, TrancheCheckpoint, TrancheRecord } from './tranche-record';

/**
 * The tranche's counters (req-179): the one writer of `ChainState.tranche`.
 * A release opens the next tranche (its index restarts each UTC day), a
 * start counts, a settle of a started ticket becomes a fact, a checkpoint is
 * raised and cleared. `chain.json` carries the record across restarts.
 */
export class TrancheLedger {
  constructor(
    private readonly state: Pick<ChainState, 'tranche'>,
    private readonly clock: Clock,
  ) {}

  current(): TrancheRecord | null {
    return this.state.tranche;
  }

  /** Opens the next tranche: index + 1 on the same day, 1 on a new one. */
  open(): TrancheRecord {
    const now = this.clock.now();
    const day = now.toISOString().slice(0, 10);
    const previous = this.state.tranche;
    const index = previous !== null && previous.day === day ? previous.index + 1 : 1;
    // A run still out when the next tranche opens settles into it: a fact belongs to the tranche it finishes in.
    const pending = previous?.pending ?? [];
    this.state.tranche = { index, day, startedAt: now.toISOString(), started: 0, pending, facts: [], anomalyFrom: 0, checkpoint: null };
    return this.state.tranche;
  }

  started(ticket: string): void {
    const record = this.require();
    this.state.tranche = { ...record, started: record.started + 1, pending: [...record.pending, ticket] };
  }

  /** A settled run of a ticket this tranche released becomes a fact; false for any other run. */
  settled(fact: RunFact): boolean {
    const record = this.state.tranche;
    const at = record?.pending.indexOf(fact.ticket) ?? -1;
    if (record === null || at < 0) {
      return false;
    }
    const pending = [...record.pending.slice(0, at), ...record.pending.slice(at + 1)];
    this.state.tranche = { ...record, pending, facts: [...record.facts, fact] };
    return true;
  }

  raise(checkpoint: TrancheCheckpoint): void {
    this.state.tranche = { ...this.require(), checkpoint };
  }

  /** "Release anyway" after an early stop: the same tranche goes on, the rules look past the anomaly. */
  continueAfterEarlyStop(): void {
    const record = this.require();
    this.state.tranche = { ...record, checkpoint: null, anomalyFrom: record.facts.length };
  }

  private require(): TrancheRecord {
    return this.state.tranche ?? this.open();
  }
}
