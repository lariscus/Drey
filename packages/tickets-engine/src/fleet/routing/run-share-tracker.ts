import type { Clock } from '../ports/clock';
import type { EventSink, RunnerEvent } from '../ports/event-sink';
import type { QuotaWindow, SlotView } from '../protocol';
import { isTerminal } from '../run/run-state';
import type { ShareEstimates, ShareSubject } from './reserve-guard';

/** A run's share of a window while nothing is known of its ticket or persona there: a twentieth. */
export const DEFAULT_RUN_SHARE = 0.05;

/** Samples kept per runner life (the newest win). */
const MAX_SAMPLES = 500;

/** After its end a run waits this long for a newer reading of its slot, then it is forgotten unsampled. */
const PENDING_TTL_MS = 30 * 60_000;

/** A start that never reports an end (it failed before its worker spawned) is forgotten after this. */
const LIVE_TTL_MS = 24 * 3_600_000;

interface Started {
  readonly remaining: number | null;
  readonly fetchedAt: string | null;
}

interface Pending {
  readonly subject: ShareSubject;
  readonly slotId: string;
  readonly start: ReadonlyMap<string, Started>;
  /** The most runs the slot carried at once while this one lived: a window's drop is shared among them. */
  concurrency: number;
  readonly startedAtMs: number;
  endedAtMs: number | null;
}

interface Sample {
  readonly ticket: string;
  readonly persona: string | null;
  readonly slotId: string;
  readonly window: string;
  readonly share: number;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const newer = (reading: QuotaWindow, start: Started): boolean => reading.fetchedAt !== null && (start.fetchedAt === null || reading.fetchedAt > start.fetchedAt);

/**
 * What a run takes of its slot's windows (req-178), for the reserve per
 * window: at the start the routing notes the windows' remaining shares; once
 * the run has ended, the first newer reading of the slot gives the drop,
 * shared among the runs the slot carried at once. A window that went up
 * (it reset) gives no sample. The estimate is the median of the ticket's
 * runs on that slot and window, else the persona's, else
 * {@link DEFAULT_RUN_SHARE}. Kept in memory: a restarted runner learns again.
 */
export class RunShareTracker implements EventSink, ShareEstimates {
  private readonly pending = new Map<string, Pending>();
  private readonly samples: Sample[] = [];

  constructor(private readonly clock: Clock) {}

  /** The run was granted this slot: note its windows as they stand. */
  begin(runId: string, subject: ShareSubject, view: SlotView): void {
    const start = new Map(view.windows.map((window) => [window.name, { remaining: window.remaining, fetchedAt: window.fetchedAt }] as const));
    this.pending.set(runId, { subject, slotId: view.id, start, concurrency: Math.max(1, view.busy), startedAtMs: this.clock.now().getTime(), endedAtMs: null });
  }

  publish(event: RunnerEvent): void {
    if (event.kind === 'run' && isTerminal(event.info.state)) {
      const pending = this.pending.get(event.info.id);
      if (pending !== undefined && pending.endedAtMs === null) {
        pending.endedAtMs = this.clock.now().getTime();
      }
    } else if (event.kind === 'slot') {
      this.observe(event.slot);
    }
  }

  shareOf(subject: ShareSubject, slotId: string, window: string): number {
    const here = this.samples.filter((s) => s.slotId === slotId && s.window === window);
    const ofTicket = here.filter((s) => s.ticket === subject.ticket);
    if (ofTicket.length > 0) {
      return median(ofTicket.map((s) => s.share));
    }
    const ofPersona = subject.persona === null ? [] : here.filter((s) => s.persona === subject.persona);
    return ofPersona.length > 0 ? median(ofPersona.map((s) => s.share)) : DEFAULT_RUN_SHARE;
  }

  /** A slot's newest view: live runs learn how crowded it got, ended ones take their sample. */
  private observe(view: SlotView): void {
    const nowMs = this.clock.now().getTime();
    for (const [runId, pending] of this.pending) {
      if (pending.slotId !== view.id) {
        continue;
      }
      if (pending.endedAtMs === null) {
        pending.concurrency = Math.max(pending.concurrency, view.busy);
        if (nowMs - pending.startedAtMs > LIVE_TTL_MS) {
          this.pending.delete(runId);
        }
      } else if (this.sample(pending, view.windows)) {
        this.pending.delete(runId);
      } else if (nowMs - pending.endedAtMs > PENDING_TTL_MS) {
        this.pending.delete(runId);
      }
    }
  }

  /** Records the drop of every window read since the start; false while no window is newer. */
  private sample(pending: Pending, windows: readonly QuotaWindow[]): boolean {
    const read = windows.filter((window) => {
      const start = pending.start.get(window.name);
      return start !== undefined && newer(window, start);
    });
    for (const window of read) {
      const start = pending.start.get(window.name)!;
      if (start.remaining !== null && window.remaining !== null && window.remaining <= start.remaining) {
        this.keep({ ticket: pending.subject.ticket, persona: pending.subject.persona, slotId: pending.slotId, window: window.name, share: (start.remaining - window.remaining) / pending.concurrency });
      }
    }
    return read.length > 0;
  }

  private keep(sample: Sample): void {
    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.shift();
    }
  }
}
