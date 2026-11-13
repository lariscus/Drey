import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { Clock } from '../ports/clock';
import type { QuotaWindow } from '../protocol';
import { CapabilityFilter } from './capability-filter';
import type { CapacityCap } from './capacity-cap';
import { CostEstimate } from './cost-estimate';
import type { Ledgers, SessionRecords } from './ledgers';
import { PoolGrant, type PoolSlots, type ProviderThrottle } from './pool-grant';
import type { PoolSettingsView } from './pool-settings';
import type { HttpReply, QuotaHttp, QuotaReading, QuotaSource } from './quota-source';
import { ReserveGuard, type ShareEstimates } from './reserve-guard';
import { RouteRecorder } from './route-recorder';
import { DEFAULT_RUN_SHARE } from './run-share-tracker';
import type { Slot } from './slot';
import { SlotFit } from './slot-fit';
import type { SlotReservations } from './slot-reservations';
import { StepUp } from './step-up';
import { SurplusChoice } from './surplus-choice';

/** A clock the spec moves. */
export class FakeClock implements Clock {
  constructor(public current: Date) {}

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** A quota endpoint answering from a script; every call is recorded (url and headers). */
export class FakeQuotaHttp implements QuotaHttp {
  readonly calls: { url: string; headers: Readonly<Record<string, string>> }[] = [];

  constructor(private readonly answer: (url: string, headers: Readonly<Record<string, string>>) => HttpReply) {}

  getJson(url: string, headers: Readonly<Record<string, string>>): Promise<HttpReply> {
    this.calls.push({ url, headers });
    return Promise.resolve(this.answer(url, headers));
  }
}

/** A quota source handing out whatever the spec set for a slot. */
export class FakeQuotaSource implements QuotaSource {
  readonly reads: string[] = [];
  readonly readings = new Map<string, QuotaReading>();

  read(slot: Slot): Promise<QuotaReading> {
    this.reads.push(slot.id);
    return Promise.resolve(this.readings.get(slot.id) ?? { kind: 'unavailable', detail: 'nothing set' });
  }
}

/** A recorded sample response of `fixtures/`. */
export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')) as unknown;
}

export function slot(over: Partial<Slot> & Pick<Slot, 'id'>): Slot {
  return { label: over.id, provider: 'claude-code', billing: null, sessions: null, login: {}, quota: 'counting', limits: [], implied: false, ...over };
}

export function window(over: Partial<QuotaWindow> = {}): QuotaWindow {
  return { name: '7d', spanMs: 7 * 24 * 3_600_000, remaining: 0.5, resetsAt: null, reliability: 'measured', fetchedAt: null, ...over };
}

/** What a spec hands {@link grantOf}: req-170's parts, the session records for the cost estimate, the share estimate for the reserve. */
export interface GrantParts {
  readonly slots: PoolSlots;
  readonly settings: PoolSettingsView;
  readonly cap: CapacityCap;
  readonly reservations: SlotReservations;
  readonly ledgers: Ledgers;
  readonly records?: SessionRecords;
  readonly shares?: ShareEstimates;
  readonly throttle?: ProviderThrottle;
}

/** Every run takes the default share wherever it runs. */
export const FLAT_SHARES: ShareEstimates = { shareOf: () => DEFAULT_RUN_SHARE };

/** The pool's decision wired as `compose-pool` wires it (req-178): filter, choice, step up, record. */
export function grantOf(parts: GrantParts): PoolGrant {
  const { slots, settings, cap, reservations, ledgers, throttle } = parts;
  const reserve = new ReserveGuard(settings, parts.shares ?? FLAT_SHARES);
  const fit = new SlotFit({ cap, reservations, ledgers, capabilities: new CapabilityFilter(), reserve, ...(throttle !== undefined ? { throttle } : {}) });
  const records = parts.records ?? { all: () => [] };
  return new PoolGrant({ slots, settings, ledgers, fit, choice: new SurplusChoice(), stepUp: new StepUp(settings, fit), recorder: new RouteRecorder(new CostEstimate(records)) });
}
