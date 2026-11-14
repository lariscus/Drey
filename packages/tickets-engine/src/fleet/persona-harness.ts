import { splitPoolEntry, type Persona } from '../core/persona';
import { migratedModelOf, shippedClassRank } from '../core/persona-model-migration';
import { isWorkerProvider, type CapabilityClass, type ModelRow, type WorkerProviderId } from './protocol';

/** The harness and model a persona's session without a ticket runs on, and the class it asks the pool for. */
export interface PersonaHarness {
  readonly provider: WorkerProviderId;
  readonly model: string | null;
  readonly class: CapabilityClass | null;
}

/** The persona's class and pin; an unmigrated v2 record through the migration's rule. */
function ownOf(persona: Persona, rows: readonly ModelRow[]): { readonly class: CapabilityClass | null; readonly model: string | null } {
  if (persona.class !== null || persona.legacy === undefined) {
    return { class: persona.class, model: persona.model };
  }
  const classOf = (provider: string | null, model: string): CapabilityClass | null => rows.find((row) => row.model === model && (provider === null || row.provider === provider))?.class ?? null;
  const migrated = migratedModelOf(persona.legacy, { classOf, rank: shippedClassRank });
  return { class: migrated.class, model: migrated.model };
}

/**
 * Where a persona's session without a ticket runs (req-288: the harness
 * follows from the model) — a 1:1 and a free session: the pinned model on its
 * harness (the prefix of the entry, else the model's table row), else the
 * first model of its class the router may use, in the table's order. null when
 * nothing names a harness: no pin with a known harness, no model of the class.
 */
export function personaHarnessOf(persona: Persona, rows: readonly ModelRow[] | null): PersonaHarness | null {
  const table = rows ?? [];
  const own = ownOf(persona, table);
  if (own.model !== null) {
    return pinnedHarnessOf(own.model, own.class, table);
  }
  const first = table.find((row) => row.enabled && row.class === own.class) ?? null;
  return first === null ? null : { provider: first.provider, model: first.model, class: first.class };
}

/** A pinned entry on its harness: the prefix, else the model's table row; null when neither names one. */
function pinnedHarnessOf(pin: string, cls: CapabilityClass | null, table: readonly ModelRow[]): PersonaHarness | null {
  const entry = splitPoolEntry(pin);
  const row = table.find((r) => r.model === entry.model && (entry.provider === null || r.provider === entry.provider)) ?? null;
  const provider = entry.provider !== null && isWorkerProvider(entry.provider) ? entry.provider : (row?.provider ?? null);
  return provider === null ? null : { provider, model: entry.model, class: row?.class ?? cls };
}

/** Why a persona has no harness, for the refusal of its session. */
export function noHarnessReason(persona: Persona): string {
  if (persona.model !== null) {
    return `${persona.id} is pinned to ${persona.model}, which names no harness the model table knows`;
  }
  return persona.class === null ? `${persona.id} names no class` : `the model table holds no ${persona.class} model the router may use for ${persona.id}`;
}
