/**
 * The slot a run starts on (req-177) and the pool's grant (req-170), as the
 * run's start asks for them: the consumer's interface — `fleet/routing`'s
 * `PoolGate` satisfies it, a spec passes its own. Without one a run binds
 * no slot (every older wiring).
 */
import type { PoolGrantRecord, RunRequest } from '../protocol';

/** The slot a run was bound to. */
export interface SlotBinding {
  readonly id: string;
  readonly label: string;
  /** req-170: the pool's decision, for the run record and its stream. */
  readonly grant?: PoolGrantRecord;
}

/** Who a start is for, besides its request. */
export interface BindContext {
  /** The slot the resumed session ran on. */
  readonly prefer: string | null;
  /** The persona the dispatch resolved; null on a ring dispatch or an owner's start without one. */
  readonly persona: string | null;
}

export interface SlotBinder {
  /**
   * Asks the pool for the request's model (of its class, when it names one)
   * on a slot of its provider and profile — the preferred one when it is
   * free — and reserves its weight, or says why none serves. A refusal is
   * final for this start: never served by the other profile, never by a
   * smaller class.
   */
  bind(request: RunRequest, runId: string, context: BindContext): SlotBinding | { readonly refused: string };
  /** The run is over (or never started): its slot is free again. */
  release(runId: string): void;
  /** A slot's worker environment (its login folder); undefined when it needs none. */
  envOf(slotId: string): Readonly<Record<string, string>> | undefined;
}
