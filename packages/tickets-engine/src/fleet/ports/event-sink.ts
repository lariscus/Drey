/**
 * What the runner tells whoever listens (ADR-0096, req-176 step 5): a run's
 * record as it was persisted, and every line of its stream as it was
 * written. The core publishes; the runner's `/events` route streams it.
 */
import type { NormalizedEvent } from '../harness/contract';
import type { RunInfo, SlotView } from '../protocol';

export type RunnerEvent =
  | { readonly kind: 'run'; readonly info: RunInfo }
  | { readonly kind: 'line'; readonly runId: string; readonly event: NormalizedEvent }
  /** req-177: a slot's state, windows or busy count changed. */
  | { readonly kind: 'slot'; readonly slot: SlotView };

export interface EventSink {
  publish(event: RunnerEvent): void;
}

/** A sink nobody listens to. */
export const NULL_SINK: EventSink = { publish: () => undefined };
