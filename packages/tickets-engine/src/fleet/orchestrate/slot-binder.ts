/**
 * The slot a run starts on (req-177), as the run's start asks for it: the
 * consumer's interface — `fleet/routing`'s `SlotGate` satisfies it, a spec
 * passes its own. Without one a run binds no slot (every older wiring).
 */
import type { RunRequest } from '../protocol';

/** The slot a run was bound to. */
export interface SlotBinding {
  readonly id: string;
  readonly label: string;
}

export interface SlotBinder {
  /**
   * Reserves a slot of the request's provider and profile for the run — the
   * preferred one (the slot the resumed session ran on) when it is free —
   * or says why none serves. A refusal is final for this start: never
   * served by the other profile.
   */
  bind(request: RunRequest, runId: string, prefer: string | null): SlotBinding | { readonly refused: string };
  /** The run is over (or never started): its slot is free again. */
  release(runId: string): void;
  /** A slot's worker environment (its login folder); undefined when it needs none. */
  envOf(slotId: string): Readonly<Record<string, string>> | undefined;
}
