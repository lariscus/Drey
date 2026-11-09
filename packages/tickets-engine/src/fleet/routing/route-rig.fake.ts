import type { QuotaWindow } from '../protocol';
import { CapacityCap } from './capacity-cap';
import { Ledgers, type SessionCost } from './ledgers';
import { PoolGate } from './pool-gate';
import type { PoolGrant } from './pool-grant';
import { PoolSettingsRegistry } from './pool-settings';
import type { ShareEstimates } from './reserve-guard';
import { FakeClock, FakeQuotaSource, grantOf } from './routing.fake';
import type { Slot } from './slot';
import { SlotRegistry } from './slot-registry';
import { SlotReservations } from './slot-reservations';
import { SlotStateResolver } from './slot-state-resolver';
import { SurplusCalculator } from './surplus-calculator';

export const RIG_NOW = new Date('2026-11-09T12:00:00Z');

const WEEK_MS = 7 * 24 * 3_600_000;

/** A weekly window half through its span, so `q` is twice the remaining share (q 1.4 = 70 % left). */
export function windowWithQ(q: number, over: Partial<QuotaWindow> = {}): QuotaWindow {
  return { name: '7d', spanMs: WEEK_MS, remaining: q / 2, resetsAt: new Date(RIG_NOW.getTime() + WEEK_MS / 2).toISOString(), reliability: 'measured', fetchedAt: RIG_NOW.toISOString(), ...over };
}

/**
 * The pool's decision over real slots for the routing specs (req-178): the
 * slots and `service.json`'s pool keys as given, the windows a spec sets per
 * slot (so each has the surplus it wants), the session records the cost
 * estimate reads, and the share estimate the reserve asks.
 */
export class RouteRig {
  readonly clock = new FakeClock(RIG_NOW);
  readonly reservations = new SlotReservations();
  readonly settings = new PoolSettingsRegistry(() => undefined);
  readonly source = new FakeQuotaSource();
  readonly records: SessionCost[] = [];
  readonly registry: SlotRegistry;
  readonly grant: PoolGrant;
  readonly gate: PoolGate;

  constructor(
    private readonly slots: readonly Slot[],
    shares?: ShareEstimates,
  ) {
    this.registry = new SlotRegistry({
      config: { load: () => Promise.resolve({ slots: [...slots], errors: [], refreshMs: 60_000 }) },
      sourceOf: () => this.source,
      reservations: this.reservations,
      resolver: new SlotStateResolver(new SurplusCalculator()),
      clock: this.clock,
      onChange: () => undefined,
      log: () => undefined,
    });
    const cap = new CapacityCap(this.settings, this.reservations);
    const records = { all: () => this.records };
    const ledgers = new Ledgers(records, this.settings, this.clock);
    this.grant = grantOf({ slots: this.registry, settings: this.settings, cap, reservations: this.reservations, ledgers, records, ...(shares !== undefined ? { shares } : {}) });
    this.gate = new PoolGate(this.registry, this.reservations, this.grant);
  }

  /** Loads the slots and the pool keys, and gives every slot named in `q` a window with that surplus. */
  async load(config: Record<string, unknown>, q: Readonly<Record<string, number>> = {}): Promise<void> {
    for (const [id, value] of Object.entries(q)) {
      this.source.readings.set(id, { kind: 'windows', windows: [windowWithQ(value)] });
    }
    await this.registry.load();
    await this.registry.refresh(undefined, true);
    this.settings.apply(config, this.slots, null);
  }

  /** Replaces one slot's windows and reads them. */
  async windows(id: string, windows: readonly QuotaWindow[]): Promise<void> {
    this.source.readings.set(id, { kind: 'windows', windows });
    await this.registry.refresh(id, true);
  }
}
