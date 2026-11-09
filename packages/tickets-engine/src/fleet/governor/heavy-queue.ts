import type { GovernorWait } from '../protocol-governor';
import type { HeavyAsk, SeatLease } from './resource-governor';

/** A heavy task waiting for its seat. */
export interface Waiter {
  readonly ask: HeavyAsk;
  readonly sinceMs: number;
  /** The reason last logged and shown; null before the first refusal. */
  reason: string | null;
  readonly resolve: (lease: SeatLease) => void;
  readonly reject: (error: Error) => void;
}

/** The heavy tasks that wait, first come first served (req-180). */
export class HeavyQueue {
  private readonly waiters: Waiter[] = [];

  push(waiter: Waiter): void {
    this.waiters.push(waiter);
  }

  remove(waiter: Waiter): void {
    const at = this.waiters.indexOf(waiter);
    if (at >= 0) {
      this.waiters.splice(at, 1);
    }
  }

  /** A copy: the pump removes while it walks. */
  list(): readonly Waiter[] {
    return [...this.waiters];
  }

  /** The waits as the status shows them (only those with a reason yet). */
  views(): readonly GovernorWait[] {
    return this.waiters
      .filter((waiter) => waiter.reason !== null)
      .map((waiter) => ({
        runId: waiter.ask.runId,
        ticket: waiter.ask.ticket,
        task: waiter.ask.task,
        reason: waiter.reason ?? '',
        since: new Date(waiter.sinceMs).toISOString(),
      }));
  }
}
