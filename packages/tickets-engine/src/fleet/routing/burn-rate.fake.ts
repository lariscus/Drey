import { DEFAULT_ROUTING, type QuotaWindow, type RoutingSettings, type RunInfo, type SlotView } from '../protocol';
import { BurnRateDayBook, type BurnRateDayFile } from './burn-rate-day';
import { BurnRateGuard } from './burn-rate-guard';
import { BurnRateHoldSource } from './burn-rate-hold-source';
import { BurnRateMeter } from './burn-rate-meter';
import type { ShareEstimates } from './reserve-guard';
import { CostEstimate } from './cost-estimate';
import { RouteRecorder } from './route-recorder';
import { FakeClock } from './routing.fake';
import { SessionBook } from './session-book';

/** A day file in memory; `writes` counts what reached it. */
export class MemoryDayFile implements BurnRateDayFile {
  writes = 0;

  constructor(public stored: unknown = null) {}

  read(): Promise<unknown> {
    return Promise.resolve(this.stored);
  }

  write(value: unknown): Promise<void> {
    this.writes += 1;
    this.stored = JSON.parse(JSON.stringify(value)) as unknown;
    return Promise.resolve();
  }
}

/** A weekly window as a quota source reads it. */
export function week(remaining: number | null, over: Partial<QuotaWindow> = {}): QuotaWindow {
  return { name: '7d', spanMs: 7 * 24 * 3_600_000, remaining, resetsAt: '2026-11-12T08:00:00.000Z', reliability: 'measured', fetchedAt: null, ...over };
}

/** A slot's view with the given windows (the rest as a ready, unbounded slot). */
export function slotView(id: string, windows: readonly QuotaWindow[], over: Partial<SlotView> = {}): SlotView {
  return {
    id,
    label: id,
    provider: 'claude-code',
    billing: null,
    quota: 'claude-code',
    state: 'ready',
    busy: 0,
    total: null,
    windows,
    q: null,
    reason: null,
    lastFetch: null,
    lastFetchError: null,
    implied: false,
    ...over,
  };
}

/** A run record of a slot, started at the instant given. */
export function runOn(slotId: string, startedAt: string, ticket = 'T-0001'): RunInfo {
  return { id: `R-${ticket}-${startedAt}`, ticketId: ticket, persona: 'ben', startedAt, slot: { id: slotId, label: slotId }, costUsd: null, state: 'running' } as unknown as RunInfo;
}

/**
 * The burn rate's real parts over views the spec sets (req-181): meter,
 * day book (in memory), guard, the hold source with its log, at a clock the
 * spec moves. `routing.burnRate` is whatever `settings` holds.
 */
export class BurnRateRig {
  readonly clock: FakeClock;
  readonly file: MemoryDayFile;
  readonly records = new SessionBook();
  readonly logs: string[] = [];
  views: SlotView[] = [];
  settings: RoutingSettings = DEFAULT_ROUTING;
  share = 0.05;
  readonly book: BurnRateDayBook;
  readonly meter: BurnRateMeter;
  readonly guard: BurnRateGuard;
  readonly source: BurnRateHoldSource;

  constructor(now: Date, file = new MemoryDayFile()) {
    this.clock = new FakeClock(now);
    this.file = file;
    const shares: ShareEstimates = { shareOf: () => this.share };
    this.book = new BurnRateDayBook(file, (line) => this.logs.push(line));
    this.meter = new BurnRateMeter({ slots: { views: () => this.views }, records: this.records, shares, book: this.book, clock: this.clock });
    this.guard = new BurnRateGuard({ routing: () => this.settings }, this.meter, this.book, this.clock);
    const lines = new RouteRecorder(new CostEstimate(this.records));
    this.source = new BurnRateHoldSource({ guard: this.guard, lines, timeText: (iso) => iso.slice(11, 16), log: (line) => this.logs.push(line), clock: this.clock });
  }

  /** Sets the views and lets the meter see each (a slot's change). */
  see(views: SlotView[]): void {
    this.views = views;
    views.forEach((view) => this.meter.observe(view));
  }

  ran(run: RunInfo): void {
    this.records.publish({ kind: 'run', info: run });
  }
}
