import type { EventSink, RunnerEvent } from '../ports/event-sink';

/** One listener of the runner's events. */
export type RunnerListener = (event: RunnerEvent) => void;

/**
 * The runner's event fan-out: the core publishes into it (it is the
 * core's `EventSink`), every open `/events` stream listens. A listener that
 * throws is dropped, never the publisher's problem.
 */
export class EventHub implements EventSink {
  private readonly listeners = new Set<RunnerListener>();

  publish(event: RunnerEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        this.listeners.delete(listener);
      }
    }
  }

  /** Listens until the returned function is called. */
  subscribe(listener: RunnerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get size(): number {
    return this.listeners.size;
  }
}
