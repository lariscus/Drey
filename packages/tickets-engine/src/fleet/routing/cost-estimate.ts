import type { SessionCost, SessionRecords } from './ledgers';

/** Who a start spends for and on what. */
export interface CostSubject {
  readonly ticket: string;
  readonly persona: string | null;
  readonly model: string | null;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const modelOf = (record: SessionCost): string | null => record.grant?.model ?? record.model ?? null;

/**
 * The estimated cost of a run (req-178, the route line's `est $0.40`): the
 * median of the ended sessions that are most like it — the ticket's on the
 * same model, else the ticket's on any model, else the persona's on the
 * model, else the model's — over the session records the ledgers sum
 * (ADR-0081). Null when none ran yet: an estimate is never invented.
 */
export class CostEstimate {
  constructor(private readonly records: SessionRecords) {}

  usdFor(subject: CostSubject): number | null {
    const ended = this.records.all().filter((r) => r.endedAt !== undefined && r.endedAt !== null && r.costUsd !== null);
    const sameModel = (r: SessionCost): boolean => subject.model !== null && modelOf(r) === subject.model;
    const tiers: readonly ((r: SessionCost) => boolean)[] = [
      (r) => r.ticketId === subject.ticket && sameModel(r),
      (r) => r.ticketId === subject.ticket,
      (r) => subject.persona !== null && r.persona === subject.persona && sameModel(r),
      sameModel,
    ];
    for (const tier of tiers) {
      const costs = ended.filter(tier).map((r) => r.costUsd ?? 0);
      if (costs.length > 0) {
        return Math.round(median(costs) * 100) / 100;
      }
    }
    return null;
  }
}
