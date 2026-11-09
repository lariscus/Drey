import type { Clock } from '../ports/clock';
import type { GovernorSettings } from '../protocol-governor';
import type { LoadGuard } from './load-guard';
import { QuietHours } from './quiet-hours';
import type { SeatTable } from './seat-table';

/** May a heavy task start now: yes (with a note), it waits for a seat, or the rules refuse it for now. */
export type AdmissionVerdict =
  | { readonly kind: 'grant'; readonly note: string | null }
  | { readonly kind: 'waits'; readonly reason: string }
  | { readonly kind: 'refused'; readonly reason: string };

export interface AdmissionDeps {
  readonly settings: () => GovernorSettings;
  readonly table: SeatTable;
  readonly guard: LoadGuard;
  readonly clock: Clock;
  /** After this long above the reserve with no heavy seat busy, the task starts anyway (no starvation on a busy desk). */
  readonly maxLoadWaitMs: number;
}

/**
 * The heavy-seat rules in their order (req-180): quiet hours first (no new
 * heavy task in the span), then the seat count, then the CPU and memory
 * reserve. Light seats never come here.
 */
export class Admission {
  constructor(private readonly deps: AdmissionDeps) {}

  /** The verdict for a heavy task that has waited since `sinceMs`. */
  judge(sinceMs: number): AdmissionVerdict {
    const settings = this.deps.settings();
    const now = this.deps.clock.now();
    const quiet = QuietHours.parse(settings.quietHours);
    if (quiet !== null && quiet.holds(now)) {
      return { kind: 'refused', reason: `quiet hours until ${quiet.until}` };
    }
    const busy = this.deps.table.busy('heavy');
    if (busy >= settings.heavySeats) {
      return { kind: 'waits', reason: `${busy} of ${settings.heavySeats} heavy seats busy` };
    }
    const load = this.deps.guard.verdict(settings.reserve);
    if (load.ok) {
      return { kind: 'grant', note: null };
    }
    const waited = now.getTime() - sinceMs;
    if (busy === 0 && waited >= this.deps.maxLoadWaitMs) {
      return { kind: 'grant', note: `after ${Math.round(waited / 60_000)} min above the reserve` };
    }
    return { kind: 'refused', reason: `load ${load.load} % above the reserve` };
  }
}
