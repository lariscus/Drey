import type { Clock } from '../ports/clock';
import type { QuotaWindow } from '../protocol';
import { spanOf, WEEK_MS, type QuotaReading, type QuotaSource } from './quota-source';
import type { Slot, SlotLimit } from './slot';

/** One finished run, as the counting sees it. */
export interface CountedRun {
  readonly runId: string;
  readonly at: Date;
  readonly tokens: number;
}

/** The first instant of the month after `now` (UTC): a counted monthly window resets there. */
function nextMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * The runner's own counting (req-177): every finished run's telemetry feeds
 * the slot it ran on. Against a configured budget (`limits:` of the slot)
 * a window gets a share, `estimated` once a run was counted and `unknown`
 * before; without a budget it reports what it counted and no share. The
 * fallback for any slot whose provider cannot be read (Copilot; a Claude
 * account between runs with no cache).
 */
export class CountingQuotaSource implements QuotaSource {
  private readonly runs = new Map<string, Map<string, CountedRun>>();

  constructor(private readonly clock: Clock) {}

  /** A finished run of the slot; the same run twice counts once. */
  record(slotId: string, run: CountedRun): void {
    const ofSlot = this.runs.get(slotId) ?? new Map<string, CountedRun>();
    ofSlot.set(run.runId, run);
    this.runs.set(slotId, ofSlot);
  }

  /** Whether any run of the slot was counted. */
  counted(slotId: string): boolean {
    return (this.runs.get(slotId)?.size ?? 0) > 0;
  }

  read(slot: Slot): Promise<QuotaReading> {
    const now = this.clock.now();
    const runs = [...(this.runs.get(slot.id)?.values() ?? [])];
    const windows = slot.limits.length > 0 ? slot.limits.map((limit) => this.window(limit, runs, now)) : [this.unbudgeted(runs, now)];
    return Promise.resolve({ kind: 'windows', windows });
  }

  private window(limit: SlotLimit, runs: readonly CountedRun[], now: Date): QuotaWindow {
    const spanMs = spanOf(limit.window) ?? WEEK_MS;
    const since = limit.window === 'month' ? monthStart(now).getTime() : now.getTime() - spanMs;
    const inside = runs.filter((run) => run.at.getTime() >= since);
    const used = inside.reduce((sum, run) => sum + (limit.unit === 'runs' ? 1 : run.tokens), 0);
    const oldest = inside.reduce<number | null>((min, run) => (min === null || run.at.getTime() < min ? run.at.getTime() : min), null);
    const resetsAt = limit.window === 'month' ? nextMonth(now).toISOString() : oldest === null ? null : new Date(oldest + spanMs).toISOString();
    const known = runs.length > 0;
    return {
      name: limit.window,
      spanMs,
      remaining: known ? Math.max(0, 1 - used / limit.budget) : null,
      resetsAt,
      reliability: known ? 'estimated' : 'unknown',
      fetchedAt: known ? now.toISOString() : null,
      used,
      limit: limit.budget,
      unit: limit.unit,
    };
  }

  /** No budget: the week's counted tokens, no share. */
  private unbudgeted(runs: readonly CountedRun[], now: Date): QuotaWindow {
    const since = now.getTime() - WEEK_MS;
    const used = runs.filter((run) => run.at.getTime() >= since).reduce((sum, run) => sum + run.tokens, 0);
    return { name: '7d', spanMs: WEEK_MS, remaining: null, resetsAt: null, reliability: 'unknown', fetchedAt: runs.length > 0 ? now.toISOString() : null, used, unit: 'tokens' };
  }
}
