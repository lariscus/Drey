import type { BurnRateHold } from '../protocol';

/** The decision (`BurnRateGuard` satisfies it). */
export interface BurnRateDecision {
  hold(): BurnRateHold | null;
  lift(): Promise<void>;
}

/** The refusal's runner-log line (`RouteRecorder` satisfies it). */
export interface BurnRateLines {
  burnRateLine(hold: BurnRateHold, resumes: string): string;
}

export interface BurnRateHoldSourceDeps {
  readonly guard: BurnRateDecision;
  readonly lines: BurnRateLines;
  /** `00:00`: an instant as the machine's clock writes it. */
  readonly timeText: (iso: string) => string;
  readonly log: (message: string) => void;
}

/**
 * The burn rate as the chain asks it before every start (req-181; the
 * chain's `StartHold` port): the guard's hold, and the runner log told once
 * when it is raised (`route refused · burn rate …`) and once when it clears
 * — the day turned, the windows reset, or the owner allowed the day.
 */
export class BurnRateHoldSource {
  private last: BurnRateHold | null = null;

  constructor(private readonly deps: BurnRateHoldSourceDeps) {}

  current(): BurnRateHold | null {
    const hold = this.deps.guard.hold();
    this.announce(hold);
    return hold;
  }

  /** "Allow today once"; resolves once the day's book stored it. */
  async lift(): Promise<void> {
    await this.deps.guard.lift();
    this.deps.log('burn rate: allowed for the rest of today by the owner');
    this.last = null;
  }

  private announce(hold: BurnRateHold | null): void {
    if (hold !== null && this.last === null) {
      this.deps.log(this.deps.lines.burnRateLine(hold, this.deps.timeText(hold.resumesAt)));
    } else if (hold === null && this.last !== null) {
      this.deps.log('burn rate: the hold cleared — new runs start again');
    }
    this.last = hold;
  }
}
