// i18n: catalog
/**
 * The page's Work block, model half (R11, req-171): the persona's ordered
 * models read against the model table of Settings → Models (`poolModels`,
 * ADR-0095): class, factor and busy sessions per row (req-239: the live runs and
 * sessions on that model against the sessions the slots serving it allow). A pool entry is `<model>`
 * or `<provider>/<model>` (`splitPoolEntry`); an entry the table lacks is
 * shown with what the persona's own harness says. DOM-free.
 */
import { splitPoolEntry } from '../../../../packages/tickets-engine/src/core/pool-entry';
import type { ModelRow, ModelsReply, RunInfo } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { SlotView } from '../../../../packages/tickets-engine/src/fleet/protocol-slots';
import type { I18n } from '../../../../shared/i18n/types';
import { providerLabelOf } from '../settings/models-model';
import { RUNNER_LABEL } from '../settings-workers';
import { isLiveRun } from './team-model';

/** The slots a table row can run on: its own slot, else every slot of its provider. */
function slotsOf(row: ModelRow, slots: readonly SlotView[]): readonly SlotView[] {
  return slots.filter((slot) => (row.slot !== null ? slot.id === row.slot : slot.provider === row.provider));
}

/** The live runs and sessions that run on this table row: its model, its provider, and its slot when the row names one. */
function liveOn(row: ModelRow, runs: readonly RunInfo[]): number {
  return runs.filter((run) => {
    const model = run.grant?.model ?? run.model ?? null;
    return isLiveRun(run) && model !== null && splitPoolEntry(model).model === row.model && run.provider === row.provider && (row.slot === null || run.slot?.id === row.slot);
  }).length;
}

/** One row of the ordered models. */
export interface ModelLine {
  readonly index: number;
  /** The pool entry as stored. */
  readonly entry: string;
  readonly model: string;
  /** `Claude Code · class A · factor 3`, or `Claude Code · not in the model table`. */
  readonly detail: string;
  /** `0 / 2 busy`: the live sessions on the model of the sessions its slots allow; null while the slots are unknown. */
  readonly busy: string | null;
}

export function tableRowOf(entry: string, table: ModelsReply | null): ModelRow | null {
  const { provider, model } = splitPoolEntry(entry);
  return (table?.models ?? []).find((row) => row.model === model && (provider === null || row.provider === provider)) ?? null;
}

export function modelLinesOf(pool: readonly string[], worker: string, table: ModelsReply | null, slots: readonly SlotView[], runs: readonly RunInfo[], i18n: I18n): readonly ModelLine[] {
  return pool.map((entry, position) => {
    const { provider, model } = splitPoolEntry(entry);
    const row = tableRowOf(entry, table);
    if (row === null) {
      const label = RUNNER_LABEL[(provider ?? worker) as keyof typeof RUNNER_LABEL] ?? provider ?? worker;
      return { index: position + 1, entry, model, detail: i18n.t('persona.page.model_unlisted', { provider: label }), busy: null };
    }
    const serving = slotsOf(row, slots);
    const busy = liveOn(row, runs);
    const total = serving.reduce((sum, slot) => sum + (slot.total ?? 0), 0);
    return {
      index: position + 1,
      entry,
      model,
      detail: i18n.t('persona.page.model_line', { provider: providerLabelOf(row, slots), class: row.class, factor: i18n.formatNumber(row.cost, { maximumFractionDigits: 2 }) }),
      busy: serving.length === 0 ? null : total > 0 ? i18n.t('persona.page.busy_of', { busy, total }) : i18n.t('persona.page.busy', { busy }),
    };
  });
}

/** What `Add a model…` offers: the table's rows the pool does not hold, as pool entries (`provider/model` where the model id alone is ambiguous). */
export function addableModelsOf(pool: readonly string[], table: ModelsReply | null): readonly string[] {
  const rows = table?.models ?? [];
  const taken = new Set(pool.map((entry) => splitPoolEntry(entry).model));
  const entries = rows.filter((row) => !taken.has(row.model)).map((row) => (rows.filter((other) => other.model === row.model).length > 1 ? `${row.provider}/${row.model}` : row.model));
  return [...new Set(entries)];
}

/** Moves one entry up or down; the order is the fallback order (strongest first). */
export function movedPool(pool: readonly string[], index: number, by: -1 | 1): readonly string[] {
  const to = index + by;
  if (index < 0 || index >= pool.length || to < 0 || to >= pool.length) {
    return pool;
  }
  const next = [...pool];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}
