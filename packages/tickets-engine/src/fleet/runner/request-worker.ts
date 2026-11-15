import { parseWorkerValue, resolveAssignment, type Assignment } from './assignment';
import type { WorkerProviderId } from '../protocol';
import type { ComposeRunInput } from './request';

/** Who runs the ticket and on which model. */
export interface RunWorkerPin {
  readonly provider: WorkerProviderId;
  readonly model: string | null;
}

export type RunWorker = ({ readonly ok: true } & RunWorkerPin) | { readonly ok: false; readonly error: string };

/**
 * E3: a loaded persona beats the legacy ring for provider and model —
 * a harness the fleet cannot run (an 'api' persona) leaves the ring's
 * choice in place, as does every ring refusal when no persona resolved.
 * An owner-picked worker in the start dialog still wins over the
 * persona (the concept's override order: the owner is the final
 * authority); the persona's prompt and memory apply regardless.
 */
export function resolveRunWorker(input: ComposeRunInput): RunWorker {
  const pinned = personaPin(input);
  if (pinned !== null) {
    return { ok: true, ...pinned };
  }
  const assignment = ringAssignment(input);
  return assignment.ok ? { ok: true, provider: assignment.provider, model: assignment.model } : { ok: false, error: assignment.error };
}

/** The persona's harness and model, or null when no persona resolved, the owner picked, or its harness is unrunnable. */
function personaPin(input: ComposeRunInput): RunWorkerPin | null {
  const persona = input.persona ?? null;
  const ownerPicked = (input.workerChoice ?? null) !== null;
  if (persona === null || ownerPicked) {
    return null;
  }
  const personaWorker = parseWorkerValue(persona.worker);
  return personaWorker === null ? null : { provider: personaWorker.provider, model: persona.model };
}

/** The assignment ring: the owner's pick or the ticket pin, then repo, the configured default. */
function ringAssignment(input: ComposeRunInput): Assignment {
  return resolveAssignment({
    ticketWorker: input.workerChoice ?? input.card.meta.worker,
    repoWorker: input.repo?.worker ?? null,
    configuredDefault: input.defaultWorker,
  });
}
