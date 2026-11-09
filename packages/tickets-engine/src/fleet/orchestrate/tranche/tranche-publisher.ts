import type { EventSink } from '../../ports/event-sink';
import type { TrancheStatus } from '../../protocol';

/**
 * The tranche on the runner's event stream (req-179): after every write of
 * the chain state, a `tranche` event when the tranche's status changed —
 * its counters, its spend, a raised or cleared checkpoint.
 */
export class TranchePublisher {
  private last = 'null';

  constructor(
    private readonly sink: EventSink,
    private readonly status: () => TrancheStatus | null,
  ) {}

  publish(): void {
    const tranche = this.status();
    const json = JSON.stringify(tranche);
    if (json !== this.last) {
      this.last = json;
      this.sink.publish({ kind: 'tranche', tranche });
    }
  }
}
