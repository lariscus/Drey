import { vi } from 'vitest';
import type { RunInfo, RunRequest } from '../protocol';
import type { StartOutcome } from '../run/run-record';
import { CapacityCap } from '../routing/capacity-cap';
import { Ledgers } from '../routing/ledgers';
import { PoolGate } from '../routing/pool-gate';
import type { PoolGrant } from '../routing/pool-grant';
import { PoolSettingsRegistry } from '../routing/pool-settings';
import { RequestQueue } from '../routing/request-queue';
import { FakeClock, FakeQuotaSource, grantOf } from '../routing/routing.fake';
import { SessionBook } from '../routing/session-book';
import type { Slot } from '../routing/slot';
import { SlotRegistry } from '../routing/slot-registry';
import { SlotReservations } from '../routing/slot-reservations';
import { SlotStateResolver } from '../routing/slot-state-resolver';
import { SurplusCalculator } from '../routing/surplus-calculator';
import type { FakeFleet } from './chain-harness.fake';
import type { DispatchPool } from './dispatch-pool';
import type { StartOptions } from './run-supervisor';

/**
 * The real capacity pool of `fleet/routing` for the chain's specs (req-170):
 * slots and `service.json`'s pool keys as given, the session records in a
 * `SessionBook`, and a fake fleet whose start binds through the `PoolGate`
 * exactly as the runner's start does — a refusal spawns nothing.
 */
export class PoolRig {
  readonly reservations = new SlotReservations();
  readonly settings = new PoolSettingsRegistry(() => undefined);
  readonly book = new SessionBook();
  readonly queue: RequestQueue;
  readonly registry: SlotRegistry;
  readonly grant: PoolGrant;
  readonly gate: PoolGate;

  constructor(
    private readonly slots: readonly Slot[],
    now: Date,
  ) {
    const clock = new FakeClock(now);
    this.queue = new RequestQueue(clock);
    this.registry = new SlotRegistry({
      config: { load: () => Promise.resolve({ slots: [...slots], errors: [], refreshMs: 60_000 }) },
      sourceOf: () => new FakeQuotaSource(),
      reservations: this.reservations,
      resolver: new SlotStateResolver(new SurplusCalculator()),
      clock,
      onChange: () => undefined,
      log: () => undefined,
    });
    const cap = new CapacityCap(this.settings, this.reservations);
    this.grant = grantOf({ slots: this.registry, settings: this.settings, cap, reservations: this.reservations, ledgers: new Ledgers(this.book, this.settings, clock), records: this.book });
    this.gate = new PoolGate(this.registry, this.reservations, this.grant);
  }

  async load(config: Record<string, unknown>): Promise<void> {
    await this.registry.load();
    this.settings.apply(config, this.slots, null);
  }

  dispatchPool(): DispatchPool {
    const cap = new CapacityCap(this.settings, this.reservations);
    return { classes: this.grant, queue: this.queue, load: () => cap.load(this.registry.views()), sessionsOf: () => null };
  }

  /** The fleet's start binds through the gate first; the grant lands on the record like the runner's. */
  binding(fleet: FakeFleet): FakeFleet {
    const inner = fleet.port.start;
    const start = vi.fn(async (request: RunRequest, options?: StartOptions): Promise<StartOutcome> => {
      const runId = `R-bind-${fleet.records.length + 1}`;
      const bound = this.gate.bind(request, runId, { prefer: null, persona: options?.persona ?? null });
      if ('refused' in bound) {
        return { ok: false, error: bound.refused };
      }
      const outcome = await inner(request, options);
      if (outcome.ok) {
        this.reservations.release(runId);
        this.reservations.reserve(bound.id, outcome.run.id, { model: bound.grant.model, class: bound.grant.class, cost: bound.grant.cost });
        const record = fleet.records.find((r) => r.info.id === outcome.run.id)!;
        fleet.records[fleet.records.indexOf(record)] = { ...record, info: { ...record.info, slot: { id: bound.id, label: bound.label }, grant: bound.grant } };
      }
      return outcome;
    });
    return { ...fleet, start, port: { ...fleet.port, start } };
  }

  /** A run settled: its seat is free and its cost counts. */
  settle(info: RunInfo): void {
    this.reservations.release(info.id);
    this.book.publish({ kind: 'run', info });
  }
}
