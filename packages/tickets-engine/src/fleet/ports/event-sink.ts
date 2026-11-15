/**
 * What the runner tells whoever listens (ADR-0096, req-176 step 5): a run's
 * record as it was persisted, and every line of its stream as it was
 * written. The core publishes; the runner's `/events` route streams it.
 */
import type { NormalizedEvent } from '../harness/contract';
import type { ChainHold, GovernorStatus, PoolLoad, RunInfo, SlotView } from '../protocol';

export type RunnerEvent =
  | { readonly kind: 'run'; readonly info: RunInfo }
  | { readonly kind: 'line'; readonly runId: string; readonly event: NormalizedEvent }
  /** req-177: a slot's state, windows or busy count changed. */
  | { readonly kind: 'slot'; readonly slot: SlotView }
  /** req-170: the pool's live load changed (a grant, a release, a new cap). */
  | { readonly kind: 'pool'; readonly pool: PoolLoad }
  /** req-180: the governor's seats, waits, load or settings changed. */
  | { readonly kind: 'governor'; readonly governor: GovernorStatus }
  /** req-181: the start hold (the burn rate) was raised, changed or cleared; null = nothing holds. */
  | { readonly kind: 'hold'; readonly hold: ChainHold | null };

export interface EventSink {
  publish(event: RunnerEvent): void;
}

/** A sink nobody listens to. */
export const NULL_SINK: EventSink = { publish: () => undefined };
