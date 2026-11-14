import { DEFAULT_CLASS_NAMES, type ClassName } from '../contracts/capability-class';
import { isWorkerProvider } from '../fleet/protocol';
import type { Persona, PersonaLegacyModels } from './persona';
import { splitPoolEntry } from './pool-entry';

/** The class a v2 record falls back to when neither the model table nor its floor names one. */
export const MIGRATION_FALLBACK_CLASS: ClassName = 'heavy';

/** What the rule reads of the model table: a model's class and the rank of a class (0 = strongest). */
export interface MigrationClassTable {
  classOf(provider: string | null, model: string): ClassName | null;
  rank(name: ClassName): number;
}

/** A migrated record's class, its pinned model, and why. */
export interface MigratedModel {
  readonly class: ClassName;
  readonly model: string | null;
  readonly why: string;
}

/** The old default as a pool entry, the provider from its prefix or else the v2 worker. */
function defaultEntryOf(legacy: PersonaLegacyModels): { readonly provider: string | null; readonly model: string; readonly entry: string } {
  const parsed = splitPoolEntry(legacy.models.default);
  const head = legacy.worker.split('/')[0] ?? '';
  const provider = parsed.provider ?? (isWorkerProvider(head) ? head : null);
  return { provider, model: parsed.model, entry: provider === null ? parsed.model : `${provider}/${parsed.model}` };
}

/** The stronger of the default's class and the floor (the floor folds in, never lowers). */
function foldedClass(found: ClassName | null, floor: ClassName | null, table: MigrationClassTable): { readonly name: ClassName; readonly why: string } {
  if (found === null) {
    return floor !== null ? { name: floor, why: `the floor ${floor} (the table does not hold the default)` } : { name: MIGRATION_FALLBACK_CLASS, why: `${MIGRATION_FALLBACK_CLASS} (the table does not hold the default)` };
  }
  if (floor !== null && table.rank(floor) < table.rank(found)) {
    return { name: floor, why: `the default's class ${found}, raised to the floor ${floor}` };
  }
  return { name: found, why: `the default's class ${found}` };
}

/**
 * The one-time move of a v2 record onto Persona v3 (req-288): the class of
 * the old default model (the model table's row; the floor `min-class:` folded
 * in — raised, never lowered), and the old default pinned only when the pool
 * held that one model. A default the table does not hold takes the floor, else
 * {@link MIGRATION_FALLBACK_CLASS}.
 */
export function migratedModelOf(legacy: PersonaLegacyModels, table: MigrationClassTable): MigratedModel {
  const entry = defaultEntryOf(legacy);
  const folded = foldedClass(table.classOf(entry.provider, entry.model), legacy.minClass, table);
  const pool = [...new Set(legacy.models.pool.map((item) => splitPoolEntry(item).model))];
  const pinned = pool.length === 1 && pool[0] === entry.model ? entry.entry : null;
  return { class: folded.name, model: pinned, why: pinned === null ? `class ${folded.why}` : `class ${folded.why}, ${pinned} pinned (the pool held only it)` };
}

/** The rank of a class in the shipped list (a class of the owner's own after them). */
export function shippedClassRank(name: ClassName): number {
  const at = DEFAULT_CLASS_NAMES.indexOf(name);
  return at < 0 ? DEFAULT_CLASS_NAMES.length : at;
}

/**
 * A persona raised to a class floor (the board migration's moved `min-class`,
 * req-268 × req-288): its `class:` becomes the floor when that is stronger — a
 * record that names no class yet keeps the floor in its v2 keys for the
 * migration to fold in. Never lowers.
 */
export function raisedToFloor<P extends Pick<Persona, 'kind' | 'class' | 'legacy'>>(persona: P, floor: ClassName | null): P {
  if (floor === null || persona.kind !== 'agent') {
    return persona;
  }
  if (persona.class !== null) {
    return shippedClassRank(floor) < shippedClassRank(persona.class) ? { ...persona, class: floor } : persona;
  }
  const legacy = persona.legacy;
  if (legacy === undefined) {
    return { ...persona, class: floor };
  }
  if (legacy.minClass !== null && shippedClassRank(floor) >= shippedClassRank(legacy.minClass)) {
    return persona;
  }
  return { ...persona, legacy: { ...legacy, minClass: floor } };
}
