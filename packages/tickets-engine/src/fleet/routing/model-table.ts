import type { ModelRow, WorkerProviderId } from '../protocol';

/** What the table needs of a slot. */
export interface TableSlot {
  readonly id: string;
  readonly provider: WorkerProviderId;
}

/**
 * The model table (req-170, board 7l v3): one row per model and slot with its
 * category, capability class, cost factor and the router switch (req-287). A
 * row names a slot or a provider — a provider row is served by every slot of
 * that provider. A model the table does not hold is *untabled*: it has no
 * class, and a start on it weighs {@link UNTABLED_COST}. A switched-off row
 * keeps its class but is never granted.
 */
export class ModelTable {
  constructor(readonly rows: readonly ModelRow[]) {}

  /** True when the table holds no row at all (a machine not yet set up). */
  get empty(): boolean {
    return this.rows.length === 0;
  }

  /** The rows of a model, in table order; a provider narrows them to its slots. */
  rowsOf(model: string, provider: WorkerProviderId | null = null): readonly ModelRow[] {
    return this.rows.filter((row) => row.model === model && (provider === null || row.provider === provider));
  }

  serves(row: ModelRow, slot: TableSlot): boolean {
    return row.slot === null ? row.provider === slot.provider : row.slot === slot.id;
  }

  /** The row a model runs under on one slot; null when the table does not hold it there. */
  rowOn(model: string, slot: TableSlot): ModelRow | null {
    return this.rows.find((row) => row.model === model && this.serves(row, slot)) ?? null;
  }

}

/** What one session of a model the table does not hold weighs against the caps. */
export const UNTABLED_COST = 1;
