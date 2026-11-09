/** A repeating timer (req-180): `every` arms it, the returned function disarms it. Injected, so a spec fires ticks by hand. */
export interface GovernorTimers {
  every(ms: number, fn: () => void): () => void;
}

/** What the ticker drives: the short tick and the long sweep. */
export interface TickTarget {
  tick(): void;
  sweep(): Promise<void>;
}

/**
 * The governor's two clocks (req-180): the short tick samples the load and
 * re-checks the waiting tasks, the long one sweeps gone processes and dev
 * servers (a process-table probe each, so less often).
 */
export class GovernorTicker {
  private stops: (() => void)[] = [];

  constructor(
    private readonly timers: GovernorTimers,
    private readonly periods: { readonly tickMs: number; readonly sweepMs: number },
  ) {}

  start(target: TickTarget): void {
    this.stop();
    target.tick();
    this.stops = [this.timers.every(this.periods.tickMs, () => target.tick()), this.timers.every(this.periods.sweepMs, () => void target.sweep())];
  }

  stop(): void {
    for (const stop of this.stops) {
      stop();
    }
    this.stops = [];
  }
}
