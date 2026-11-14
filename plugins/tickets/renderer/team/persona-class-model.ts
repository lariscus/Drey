// i18n: catalog
/**
 * The Persona page's Model block, pure half (req-288, board 7k v3
 * `DeskPersonaV3`): the classes the owner keeps in Settings → Models, the
 * models of a class the router may use (each with its harness), and the line
 * under the choice — how many models the class has and how many could start
 * a session now. A pinned model is a pool entry `<provider>/<model>`; the
 * harness follows from it. DOM-free.
 */
import { DEFAULT_CLASS_NAMES } from '../../../../packages/tickets-engine/src/contracts/capability-class';
import { splitPoolEntry } from '../../../../packages/tickets-engine/src/core/pool-entry';
import type { ModelRow, ModelsReply } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { SlotView } from '../../../../packages/tickets-engine/src/fleet/protocol-slots';
import { RUNNER_LABEL } from '../settings-workers';

/** One model of a class as the listbox offers it. */
export interface ClassModel {
  /** The pool entry the record pins (`claude-code/claude-opus-5-5`). */
  readonly entry: string;
  readonly model: string;
  /** The harness's name (`Claude Code`). */
  readonly harness: string;
}

/** The owner's classes, strongest first (the table's list, else the shipped one); a stored class the list lacks stays choosable. */
export function classChoicesOf(table: ModelsReply | null, current: string): readonly string[] {
  const names = table === null || table.classes.length === 0 ? DEFAULT_CLASS_NAMES : table.classes.map((entry) => entry.name);
  return current !== '' && !names.includes(current) ? [...names, current] : names;
}

/** The enabled rows of a class, one per harness and model, in the table's order. */
function rowsOf(table: ModelsReply | null, cls: string): readonly ModelRow[] {
  const seen = new Set<string>();
  return (table?.models ?? []).filter((row) => {
    const key = `${row.provider}/${row.model}`;
    if (!row.enabled || row.class !== cls || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** What the listbox offers below *Next free in class*. */
export function classModelsOf(table: ModelsReply | null, cls: string): readonly ClassModel[] {
  return rowsOf(table, cls).map((row) => ({ entry: `${row.provider}/${row.model}`, model: row.model, harness: RUNNER_LABEL[row.provider] ?? row.provider }));
}

/** A pinned entry as the closed listbox shows it: the model id and its harness (from the prefix, else from the table). */
export function pinnedModelOf(entry: string, table: ModelsReply | null): ClassModel {
  const { provider, model } = splitPoolEntry(entry);
  const row = (table?.models ?? []).find((r) => r.model === model && (provider === null || r.provider === provider)) ?? null;
  const harness = provider ?? row?.provider ?? null;
  return { entry, model, harness: harness === null ? '' : (RUNNER_LABEL[harness as keyof typeof RUNNER_LABEL] ?? harness) };
}

/** Whether a pinned entry is a model of the class (a class change drops a pin that is not). */
export function pinFitsClass(entry: string, table: ModelsReply | null, cls: string): boolean {
  const { provider, model } = splitPoolEntry(entry);
  return rowsOf(table, cls).some((row) => row.model === model && (provider === null || row.provider === provider));
}

/** The slots a row can run on: its own slot, else every slot of its provider. */
function slotsOf(row: ModelRow, slots: readonly SlotView[]): readonly SlotView[] {
  return slots.filter((slot) => (row.slot !== null ? slot.id === row.slot : slot.provider === row.provider));
}

/**
 * `2 heavy models · 1 free now`: the class's models, and those that could
 * start a session now — the class below its cap and a slot serving the model
 * with a session left (a slot without a session count has room). Without the
 * slots (no runner awake: nothing runs) every model of the class is free.
 */
export function classCountsOf(table: ModelsReply | null, cls: string, slots: readonly SlotView[]): { readonly models: number; readonly free: number } {
  const rows = rowsOf(table, cls);
  const load = table?.now?.classes.find((entry) => entry.name === cls) ?? null;
  const classFull = load !== null && load.cap !== null && load.busy >= load.cap;
  const free = classFull ? 0 : slots.length === 0 ? rows.length : rows.filter((row) => slotsOf(row, slots).some((slot) => slot.total === null || slot.busy < slot.total)).length;
  return { models: rows.length, free };
}
