import type { CapacityConfig, LedgerDefaults, PoolSettings } from '../protocol';
import { ModelTable } from './model-table';
import { NO_CAPACITY, NO_LEDGERS, parsePoolSettings } from './pool-config';
import type { Slot } from './slot';

/** What the pool reads its settings through. */
export interface PoolSettingsView {
  table(): ModelTable;
  capacity(): CapacityConfig;
  ledgers(): LedgerDefaults;
}

/**
 * The pool's settings as last read (req-170): the model table, the cap and
 * the ledger defaults. Taken again whenever the slots are read (a config
 * write, the refresh loop); a broken row is left out and said once.
 */
export class PoolSettingsRegistry implements PoolSettingsView {
  private current: PoolSettings = { models: [], capacity: NO_CAPACITY, ledgers: NO_LEDGERS };
  private model = new ModelTable([]);
  private problems: readonly string[] = [];

  constructor(private readonly log: (message: string) => void) {}

  /** Takes `service.json`'s root as read with the slots (the slot registry's load). */
  apply(root: Record<string, unknown>, slots: readonly Slot[], error: string | null): void {
    const parsed = parsePoolSettings(root, slots);
    const problems = error === null ? parsed.errors : [error, ...parsed.errors];
    if (problems.join('; ') !== this.problems.join('; ') && problems.length > 0) {
      this.log(`service.json pool: ${problems.join('; ')}`);
    }
    this.problems = problems;
    this.current = parsed.settings;
    this.model = new ModelTable(parsed.settings.models);
  }

  settings(): PoolSettings {
    return this.current;
  }

  errors(): readonly string[] {
    return this.problems;
  }

  table(): ModelTable {
    return this.model;
  }

  capacity(): CapacityConfig {
    return this.current.capacity;
  }

  ledgers(): LedgerDefaults {
    return this.current.ledgers;
  }
}
