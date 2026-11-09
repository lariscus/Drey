import type { Clock } from '../../ports/clock';
import type { TrancheConfig, TrancheEnd } from '../../protocol';
import { dollars, spentOf } from './figures';
import type { TrancheRecord } from './tranche-record';

/** The day's budget a tranche takes its share of: the provider ledger over the slots (ADR-0095); null = none set. */
export interface DayBudget {
  limitUsd(): number | null;
}

/** A tranche's three limits, as numbers the status carries. */
export interface TrancheLimits {
  readonly total: number | null;
  readonly budget: number | null;
  readonly endsAt: string | null;
}

/**
 * Whether a tranche is spent (req-179): its runs released, its budget share
 * spent, or its time span over — whichever comes first. Runs count at the
 * start, so a tranche never releases more than N; the spend counts settled
 * runs; the span runs on the wall clock from the release.
 */
export class TrancheBudget {
  constructor(
    private readonly day: DayBudget,
    private readonly clock: Clock,
  ) {}

  limits(record: TrancheRecord, config: TrancheConfig): TrancheLimits {
    const dayLimit = config.budgetShare === null ? null : this.day.limitUsd();
    return {
      total: config.runs,
      budget: dayLimit === null || config.budgetShare === null ? null : dollars(dayLimit * config.budgetShare),
      endsAt: config.minutes === null ? null : new Date(Date.parse(record.startedAt) + config.minutes * 60_000).toISOString(),
    };
  }

  /** The limit the tranche reached; null while it has room on all three. */
  exhaustedBy(record: TrancheRecord, config: TrancheConfig): TrancheEnd | null {
    const limits = this.limits(record, config);
    if (limits.total !== null && record.started >= limits.total) {
      return 'runs';
    }
    if (limits.budget !== null && spentOf(record.facts) >= limits.budget) {
      return 'budget';
    }
    return limits.endsAt !== null && this.clock.now().getTime() >= Date.parse(limits.endsAt) ? 'time' : null;
  }

  runsLeft(record: TrancheRecord, config: TrancheConfig): number | null {
    return config.runs === null ? null : Math.max(0, config.runs - record.started);
  }
}
