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
import { BurnRateDayBook, type BurnRateDayFile } from './routing/burn-rate-day';
import { BurnRateGuard } from './routing/burn-rate-guard';
import { BurnRateHoldSource } from './routing/burn-rate-hold-source';
import { BurnRateMeter } from './routing/burn-rate-meter';
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
  /** req-181: today's share of the weekly quota over all slots; a slot's change goes in through `observe`. */
  readonly burnMeter: BurnRateMeter;
  /** req-181: the day's book behind the meter and the owner's lift (`burn-rate.json`), loaded at the start. */
  readonly burnBook: BurnRateDayBook;
  /** req-181: the burn rate's hold, as the chain asks it before every start. */
  readonly burnRate: BurnRateHoldSource;
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
  /** req-181: where the burn rate's day book is kept. */
  readonly burnRateFile: BurnRateDayFile;
  /** req-181: an instant as the runner log writes the resume time (`00:00`). */
  readonly timeText: (iso: string) => string;
}

/** The parts of one decision the pool builds once and shares. */
interface GrantInner {
  readonly ledgers: Ledgers;
  readonly shares: RunShareTracker;
  readonly recorder: RouteRecorder;
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
function composeGrant(parts: PoolParts, inner: GrantInner): PoolGrant {
  const { registry, settings, cap, reservations, throttle } = parts;
  const { ledgers, shares, recorder } = inner;
  const reserve = new ReserveGuard(settings, shares);
  const fit = new SlotFit({ cap, reservations, ledgers, capabilities: new CapabilityFilter(), reserve, ...(throttle !== undefined ? { throttle } : {}) });
  return new PoolGrant({ slots: registry, settings, ledgers, fit, choice: new SurplusChoice(), stepUp: new StepUp(settings, fit), recorder });
}

/** req-181: the burn rate's meter over the slots and runs, its guard, and the hold the chain asks. */
function composeBurnRate(parts: PoolParts, records: SessionBook, shares: RunShareTracker, recorder: RouteRecorder): Pick<Pool, 'burnMeter' | 'burnBook' | 'burnRate'> {
  const burnBook = new BurnRateDayBook(parts.burnRateFile, parts.log);
  const burnMeter = new BurnRateMeter({ slots: parts.registry, records, shares, book: burnBook, clock: parts.clock });
  const guard = new BurnRateGuard(parts.settings, burnMeter, burnBook, parts.clock);
  return { burnMeter, burnBook, burnRate: new BurnRateHoldSource({ guard, lines: recorder, timeText: parts.timeText, log: parts.log }) };
}

/** The capacity pool's parts over the slots (req-170). */
export function composePool(parts: PoolParts): Pool {
  const { registry, settings, cap, config } = parts;
  const book = new SessionBook();
  const ledgers = new Ledgers(book, settings, parts.clock);
  const shares = new RunShareTracker(parts.clock);
  const migration = new PoolMigration(config, parts.log);
  const recorder = new RouteRecorder(new CostEstimate(book));
  return {
    settings,
    grant: composeGrant(parts, { ledgers, shares, recorder }),
    cap,
    ledgers,
    queue: new RequestQueue(parts.clock),
    book,
    shares,
    migration,
    ...composeBurnRate(parts, book, shares, recorder),
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
