/**
 * A run's cost over ACP (req-182). A harness that reports the session's
 * cumulative cost (`usage_update` → `cost.amount`, opencode) is believed —
 * minus what the session had spent before this run; a resumed session's
 * spend before is unknown until its first report, so that turn is priced
 * from the table. A report of nothing or 0 (a coding plan, a flat rate)
 * falls back to the price table over the run's tokens, as for Kimi.
 */
export class AcpCost {
  /** The session's cost when this run began; null until known (a resumed session's first report). */
  private base: number | null;
  private reported: number | null = null;

  constructor(resumed: boolean) {
    this.base = resumed ? null : 0;
  }

  /** After a turn: the session's cumulative cost as last reported, and the turn's price-table cost. */
  settle(cumulative: number | null, turnTableCost: number | null): void {
    if (cumulative === null) {
      return;
    }
    if (this.base === null) {
      this.base = Math.max(0, cumulative - (turnTableCost ?? 0));
    }
    this.reported = cumulative;
  }

  /** The run's cost: the reported spend when there is one above zero, else the table's figure (null = unknown). */
  total(tableCost: number | null): number | null {
    const own = this.reported === null || this.base === null ? 0 : this.reported - this.base;
    return own > 0 ? own : tableCost;
  }
}
