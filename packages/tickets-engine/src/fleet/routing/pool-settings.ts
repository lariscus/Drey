import { DEFAULT_ROUTING, type CapacityConfig, type ClassConfig, type LedgerDefaults, type PoolSettings, type RoutingSettings } from '../protocol';
import { ClassOrder } from './class-config';
import { ModelTable } from './model-table';
import { DEFAULT_CLASSES } from './class-config';
import { NO_CAPACITY, NO_LEDGERS, parsePoolSettings } from './pool-config';
import type { Slot } from './slot';

/** req-286: `service.json` → `discovery.ignored`, the `<provider>:<model>` keys of the cards the owner ignored. */
export function ignoredOf(root: Readonly<Record<string, unknown>>): readonly string[] {
  const discovery = root['discovery'];
  const raw = discovery !== null && typeof discovery === 'object' ? (discovery as Record<string, unknown>)['ignored'] : undefined;
  return Array.isArray(raw) ? raw.filter((key): key is string => typeof key === 'string') : [];
}

/** What the pool reads its settings through. */
export interface PoolSettingsView {
  /** req-287: the owner's class list, strongest first. */
  classes(): readonly ClassConfig[];
  /** req-287: its ranking (R10). */
  order(): ClassOrder;
  table(): ModelTable;
  capacity(): CapacityConfig;
  ledgers(): LedgerDefaults;
  /** req-178: `Upgrade above q` and `Reserve per window`. */
  routing(): RoutingSettings;
}

/**
 * The pool's settings as last read (req-170): the model table, the cap,
 * the ledger defaults and (req-178) the routing. Taken again whenever the slots are read (a config
 * write, the refresh loop); a broken row is left out and said once.
 */
export class PoolSettingsRegistry implements PoolSettingsView {
  private current: PoolSettings = { classes: DEFAULT_CLASSES, models: [], capacity: NO_CAPACITY, ledgers: NO_LEDGERS, routing: DEFAULT_ROUTING };
  private model = new ModelTable([]);
  private ranking = new ClassOrder(DEFAULT_CLASSES);
  private problems: readonly string[] = [];
  private ignoredKeys: readonly string[] = [];

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
    this.ranking = new ClassOrder(parsed.settings.classes);
    this.ignoredKeys = ignoredOf(root);
  }

  /** req-286: the discovered models the owner ignored (`discovery.ignored`). */
  ignored(): readonly string[] {
    return this.ignoredKeys;
  }

  classes(): readonly ClassConfig[] {
    return this.current.classes;
  }

  order(): ClassOrder {
    return this.ranking;
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

  routing(): RoutingSettings {
    return this.current.routing;
  }
}
