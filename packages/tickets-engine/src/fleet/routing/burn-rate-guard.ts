import type { Clock } from '../ports/clock';
import type { BurnRateHold, BurnRateReading } from '../protocol';
import type { RoutingSettingsView } from './reserve-guard';

/** Today's burn rate (`BurnRateMeter` satisfies it). */
export interface BurnRateReadings {
  reading(): BurnRateReading;
}

/** The owner's "Allow today once", kept for the day (`BurnRateDayBook` satisfies it; the meter's reading turns its day). */
export interface DayLift {
  readonly lifted: boolean;
  /** Resolves once the lift is stored. */
  lift(): Promise<void>;
}

/** The next UTC midnight after `now` — when the day turns and the hold clears. */
export function nextDayOf(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

/**
 * The burn rate (req-181, board 7l's `Burn rate`): at most `routing.burnRate`
 * of the weekly quota per day over all slots. Reached — today's share at or
 * above the limit — it holds every new start until the next UTC midnight;
 * the owner may allow the rest of the day once. A limit of 0 is off; with
 * no slot to count nothing holds. Beside `ReserveGuard`, which keeps a share
 * of each slot's windows back, this one bounds the day over all of them.
 */
export class BurnRateGuard {
  constructor(
    private readonly settings: RoutingSettingsView,
    private readonly meter: BurnRateReadings,
    private readonly day: DayLift,
    private readonly clock: Clock,
  ) {}

  /** Why nothing new may start today; null while it may. */
  hold(): BurnRateHold | null {
    const limit = this.settings.routing().burnRate;
    if (limit <= 0) {
      return null;
    }
    const reading = this.meter.reading();
    if (this.day.lifted || reading.basis === null || reading.spent < limit - 1e-9) {
      return null;
    }
    return { reason: 'burn-rate', spent: reading.spent, limit, resumesAt: nextDayOf(this.clock.now()), basis: reading.basis };
  }

  /** The owner allows the rest of today once: nothing holds until the day turns; resolves once it is stored. */
  lift(): Promise<void> {
    this.meter.reading(); // turns the book to today first, so the lift is today's
    return this.day.lift();
  }
}
