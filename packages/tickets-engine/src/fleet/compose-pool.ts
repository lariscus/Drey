/**
 * The wiring of the capacity pool (req-170) and its routing (req-178): the
 * composition root's helper beside `compose-routing` (split out of it for
 * req-178). It hands every part of the decision its collaborators — the
 * ledgers over the session book, the hard filter (capabilities, caps,
 * reserve), the soft choice, the step up and the decision's record.
 */
import type { PoolDesk } from './api/model-routes';
import type { Clock } from './ports/clock';
import { WORKER_PROVIDERS, type FleetPools, type PoolLoad, type SlotView, type WorkerProviderId } from './protocol';
import { CapabilityFilter } from './routing/capability-filter';
import type { CapacityCap } from './routing/capacity-cap';
import { CostEstimate } from './routing/cost-estimate';
import { Ledgers } from './routing/ledgers';
import { ModelsDevImport, type RegistryHttp } from './routing/models-dev-import';
import { parsePoolSettings, poolKeysOf } from './routing/pool-config';
import { PoolGrant, type ProviderThrottle } from './routing/pool-grant';
import { PoolMigration } from './routing/pool-migration';
import type { PoolSettingsRegistry } from './routing/pool-settings';
import { RequestQueue } from './routing/request-queue';
import { ReserveGuard } from './routing/reserve-guard';
import { RouteRecorder } from './routing/route-recorder';
import { RunShareTracker } from './routing/run-share-tracker';
import type { ServiceConfigFile } from './routing/service-config-file';
import { SessionBook } from './routing/session-book';
import { SlotFit } from './routing/slot-fit';
import type { SlotRegistry } from './routing/slot-registry';
import type { SlotReservations } from './routing/slot-reservations';
import { StepUp } from './routing/step-up';
import { SurplusChoice } from './routing/surplus-choice';

/** The capacity pool's parts (req-170, req-178). */
export interface Pool {
  readonly settings: PoolSettingsRegistry;
  readonly grant: PoolGrant;
  readonly cap: CapacityCap;
  readonly ledgers: Ledgers;
  readonly queue: RequestQueue;
  readonly book: SessionBook;
  /** req-178: what runs take of their slots' windows (the reserve's estimate); an event sink beside the book. */
  readonly shares: RunShareTracker;
  readonly migration: PoolMigration;
  /** The live load per slot and in all. */
  load(): PoolLoad;
  /** The sessions a provider's slots serve in all; null when one of them names none (unbounded). */
  sessionsOf(provider: WorkerProviderId): number | null;
  /** req-63's pool sizes into the slots' sessions, once; the slots are read again when it wrote. */
  migrate(pools: FleetPools | undefined): Promise<void>;
}

export interface PoolParts {
  readonly clock: Clock;
  readonly log: (message: string) => void;
  readonly throttle?: ProviderThrottle;
  readonly registry: SlotRegistry;
  readonly settings: PoolSettingsRegistry;
  readonly cap: CapacityCap;
  readonly reservations: SlotReservations;
  readonly config: ServiceConfigFile;
}

/** The sessions a provider's slots serve in all; null when one of them is unbounded. */
function sessionsOf(views: readonly SlotView[], provider: WorkerProviderId): number | null {
  const ofProvider = views.filter((view) => view.provider === provider);
  return ofProvider.length === 0 || ofProvider.some((view) => view.total === null) ? null : ofProvider.reduce((sum, view) => sum + (view.total ?? 0), 0);
}

/** The plugin's pool sizes, per provider. */
function sizesOf(pools: FleetPools): Partial<Record<WorkerProviderId, number>> {
  return Object.fromEntries(WORKER_PROVIDERS.map((provider) => [provider, pools[provider].size]));
}

/** The pool's decision: the filter (req-170's checks, the capabilities, the reserve), the choice, the step up, the record. */
function composeGrant(parts: PoolParts, ledgers: Ledgers, book: SessionBook, shares: RunShareTracker): PoolGrant {
  const { registry, settings, cap, reservations, throttle } = parts;
  const reserve = new ReserveGuard(settings, shares);
  const fit = new SlotFit({ cap, reservations, ledgers, capabilities: new CapabilityFilter(), reserve, ...(throttle !== undefined ? { throttle } : {}) });
  return new PoolGrant({ slots: registry, settings, ledgers, fit, choice: new SurplusChoice(), stepUp: new StepUp(settings, fit), recorder: new RouteRecorder(new CostEstimate(book)) });
}

/** The capacity pool's parts over the slots (req-170). */
export function composePool(parts: PoolParts): Pool {
  const { registry, settings, cap, config } = parts;
  const book = new SessionBook();
  const ledgers = new Ledgers(book, settings, parts.clock);
  const shares = new RunShareTracker(parts.clock);
  const migration = new PoolMigration(config, parts.log);
  return {
    settings,
    grant: composeGrant(parts, ledgers, book, shares),
    cap,
    ledgers,
    queue: new RequestQueue(parts.clock),
    book,
    shares,
    migration,
    load: () => cap.load(registry.views()),
    sessionsOf: (provider) => sessionsOf(registry.views(), provider),
    migrate: async (pools) => {
      if (pools !== undefined && (await migration.run(sizesOf(pools)))) {
        await registry.load();
      }
    },
  };
}

/** The pool as the `/models` routes see it. */
export function poolDeskOf(pool: Pool, registry: SlotRegistry, http: RegistryHttp): PoolDesk {
  const importer = new ModelsDevImport(http);
  return {
    settings: () => pool.settings.settings(),
    errors: () => pool.settings.errors(),
    load: () => pool.load(),
    queue: () => pool.queue.list(),
    providerDay: () => pool.ledgers.providerDay(registry.list().map((slot) => slot.id)),
    check: (keys) => parsePoolSettings(keys, registry.list()).errors,
    stored: poolKeysOf,
    reload: () => registry.load(),
    importCapabilities: () => importer.fill(pool.settings.settings().models),
  };
}
