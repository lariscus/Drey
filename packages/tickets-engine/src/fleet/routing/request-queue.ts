import type { QueueEntry } from '../protocol';
import type { Clock } from '../ports/clock';

/** What a pass says of one task the pool did not grant. */
export type QueueWait = Omit<QueueEntry, 'position' | 'since'>;

/**
 * The tasks waiting for the pool (req-170): no process, no slot — only the
 * line the card shows and the position it is served in. Every dispatch
 * pass rebuilds the queue in its own order (priority, then the rightmost
 * column), so when capacity frees the next pass serves it front to back; a
 * task that keeps waiting keeps the time it started to.
 */
export class RequestQueue {
  private entries: readonly QueueEntry[] = [];
  private pending: QueueWait[] | null = null;

  constructor(private readonly clock: Clock) {}

  begin(): void {
    this.pending = [];
  }

  wait(entry: QueueWait): void {
    if (this.pending !== null && !this.pending.some((other) => other.ticket === entry.ticket)) {
      this.pending.push(entry);
    }
  }

  /** The pass is over: what it noted is the queue, in its order. */
  end(): void {
    if (this.pending === null) {
      return;
    }
    const now = this.clock.now().toISOString();
    const before = new Map(this.entries.map((entry) => [entry.ticket, entry] as const));
    this.entries = this.pending.map((entry, index) => ({ ...entry, position: index + 1, since: before.get(entry.ticket)?.since ?? now }));
    this.pending = null;
  }

  /** The chain stopped dispatching: nobody waits for the pool any more. */
  clear(): void {
    this.entries = [];
    this.pending = null;
  }

  list(): readonly QueueEntry[] {
    return this.entries;
  }
}
