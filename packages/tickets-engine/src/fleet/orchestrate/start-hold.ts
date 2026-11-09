import type { EventSink } from '../ports/event-sink';
import type { ChainHold } from '../protocol';

/**
 * What may hold every new start while the Autopilot stays in its state
 * (req-181: the burn rate) — the consumer's port; `fleet/routing`'s
 * `BurnRateHoldSource` satisfies it, a spec passes its own.
 */
export interface StartHold {
  /** Why nothing new may start now; null while it may. */
  current(): ChainHold | null;
  /** The owner's "Allow today once"; resolves once it is stored. */
  lift(): Promise<void>;
}

/** The share as a whole percent: the event goes out when the hold, its percent or its resume time changed — not on every reading. */
function keyOf(hold: ChainHold | null): string {
  return hold === null ? 'null' : JSON.stringify({ ...hold, spent: Math.round(hold.spent * 100) });
}

/** The hold on the runner's event stream (`hold` events, req-181): the same answers, told when they change. */
export class PublishedHold implements StartHold {
  private last = 'null';

  constructor(
    private readonly inner: StartHold,
    private readonly sink: EventSink,
  ) {}

  current(): ChainHold | null {
    const hold = this.inner.current();
    const key = keyOf(hold);
    if (key !== this.last) {
      this.last = key;
      this.sink.publish({ kind: 'hold', hold });
    }
    return hold;
  }

  async lift(): Promise<void> {
    await this.inner.lift();
    this.current();
  }
}
