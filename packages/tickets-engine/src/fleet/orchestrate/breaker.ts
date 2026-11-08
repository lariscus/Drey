import type { Clock } from '../ports/clock';
import type { RunInfo } from '../protocol';
import { shortGateLine } from '../run/run-summary';
import type { ChainBoard } from './chain-board';
import type { ChainState } from './chain-state';
import { messageOf } from './live-run';
import { isQuotaError } from './pool-sizes';
import type { RunBookkeeper } from './run-bookkeeper';

/** Consecutive red gates a column tolerates without its own `max-red:`. */
export const DEFAULT_MAX_RED = 3;
/** The breather after a red gate before the column fires again. */
export const RED_COOLDOWN_MS = 60_000;
/** The first retry waits this long; every further failure doubles it. */
export const FAILURE_BACKOFF_MS = 60_000;
/** A failing ticket never waits longer than this between attempts. */
export const FAILURE_BACKOFF_MAX_MS = 30 * 60_000;

/** The wait before the next attempt after `count` consecutive failures. */
export function failureBackoffMs(count: number): number {
  return Math.min(FAILURE_BACKOFF_MS * 2 ** Math.max(0, count - 1), FAILURE_BACKOFF_MAX_MS);
}

/**
 * The circuit breaker (M85): a red gate raises the column's streak and
 * cools it down; past `max-red` (or a spent daily token budget) the column
 * holds and the failing ticket parks in inbox. A failure without a gate
 * verdict backs the ticket off, doubling per failure, and parks it after
 * `max-red` in a row.
 */
export class Breaker {
  constructor(
    private readonly state: ChainState,
    private readonly board: ChainBoard,
    private readonly bookkeeper: RunBookkeeper,
    private readonly env: { readonly clock: Clock; readonly log: (message: string) => void; readonly persist: () => Promise<void> },
  ) {}

  /** A failed run of the column: the per-ticket back-off, the streak, the trip. */
  async failed(info: RunInfo, column: string): Promise<void> {
    const maxRed = this.state.phases.find((p) => p.id === column)?.maxRed ?? DEFAULT_MAX_RED;
    if (info.gateFailure !== null) {
      return this.red(info, column, info.gateFailure, maxRed);
    }
    if (isQuotaError(info.lastError)) {
      return this.env.persist(); // a spent quota is the pool's pause, not the ticket's fault
    }
    // Every failure counts per ticket — a run that ended without a result used to re-dispatch at once, forever.
    const count = (this.state.ticketFailures[info.ticketId]?.count ?? 0) + 1;
    this.state.ticketFailures[info.ticketId] = { count, until: new Date(this.env.clock.now().getTime() + failureBackoffMs(count)).toISOString() };
    await this.env.persist();
    if (count >= maxRed) {
      await this.parkNext(column, `${count} failed runs in a row — ${(info.lastError ?? 'the worker ended without a result').slice(0, 200)}`, info.ticketId);
    } else {
      this.env.log(`${info.ticketId} failed without a gate verdict (${count}/${maxRed}) — it waits ${Math.round(failureBackoffMs(count) / 1000)} s before the next attempt`);
    }
  }

  private async red(info: RunInfo, column: string, gateFailure: string, maxRed: number): Promise<void> {
    if (!isQuotaError(info.lastError)) {
      const count = (this.state.ticketFailures[info.ticketId]?.count ?? 0) + 1;
      this.state.ticketFailures[info.ticketId] = { count, until: new Date(this.env.clock.now().getTime() + failureBackoffMs(count)).toISOString() };
    }
    const streak = (this.state.redStreak[column] ?? 0) + 1;
    this.state.redStreak[column] = streak;
    this.state.cooldownUntil[column] = new Date(this.env.clock.now().getTime() + RED_COOLDOWN_MS).toISOString();
    await this.env.persist();
    const budget = this.state.phases.find((p) => p.id === column)?.tokenBudget ?? 0;
    if (streak >= maxRed) {
      await this.trip(column, `${streak} red gates in a row`, gateFailure, info.ticketId);
    } else if (budget > 0 && (this.state.tokensUsed[column] ?? 0) > budget) {
      await this.trip(column, 'daily token budget spent', gateFailure, info.ticketId);
    } else {
      this.env.log(`red gate on ${column} (${streak}/${maxRed}) — the column cools down`);
    }
  }

  /** The breaker trips: the column holds, its failing candidate parks. */
  private async trip(column: string, reason: string, gateFailure: string, ticketId: string): Promise<void> {
    this.state.columns[column] = 'held';
    this.state.tripped[column] = { reason, at: this.env.clock.now().toISOString() };
    this.env.log(`circuit breaker tripped on ${column} — ${reason}; the column holds`);
    await this.env.persist();
    await this.parkNext(column, `${reason}; last gate: ${shortGateLine(gateFailure).slice(0, 200)}`, ticketId);
  }

  /** Parks the ticket that failed in inbox — not whichever sits first in the column (that one may only wait behind it). */
  private async parkNext(column: string, reason: string, failedTicketId: string): Promise<void> {
    const config = this.state.config;
    const door = config === null ? null : this.board.door(config);
    if (config === null || door === null) {
      return;
    }
    try {
      const snap = await this.board.read(config);
      const candidate = snap?.columns.find((c) => c.phase.id === column)?.tickets.find((t) => t.id === failedTicketId && t.meta.run === null && t.meta.claimedBy === null) ?? null;
      if (candidate === null) {
        this.env.log(`the breaker found no candidate to park on ${column}`);
        return;
      }
      if (await this.bookkeeper.parkCard(door, candidate, column, reason)) {
        delete this.state.ticketFailures[candidate.id];
        await this.env.persist();
        this.env.log(`parked ${candidate.id} in inbox (${column} breaker) - re-prioritizing revives it`);
      }
    } catch (error) {
      this.env.log(`parking the breaker's candidate failed: ${messageOf(error)}`);
    }
  }
}
