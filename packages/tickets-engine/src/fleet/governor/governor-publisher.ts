import type { EventSink } from '../ports/event-sink';
import type { GovernorStatus } from '../protocol-governor';

/**
 * Where the governor speaks (req-180): one line in the runner log per
 * grant, wait, refusal and release (`governor: …`), and a `governor` event
 * on `GET /events` whenever the status changed.
 */
export class GovernorPublisher {
  private lastKey = '';

  constructor(
    private readonly log: (message: string) => void,
    private readonly sink: EventSink,
  ) {}

  line(text: string): void {
    this.log(`governor: ${text}`);
  }

  /** Publishes the status unless it equals the last one published. */
  status(status: GovernorStatus): void {
    const key = JSON.stringify(status);
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.sink.publish({ kind: 'governor', governor: status });
    }
  }
}
