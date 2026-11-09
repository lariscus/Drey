import type { Clock } from '../ports/clock';
import type { ProcessPriority } from '../ports/process-priority';
import type { GovernorSettings, GovernorStatus, HeavyTask, SeatHolder } from '../protocol-governor';
import type { Admission, AdmissionVerdict } from './admission';
import type { GovernorPublisher } from './governor-publisher';
import type { GovernorSweep } from './governor-sweep';
import { HeavyQueue, type Waiter } from './heavy-queue';
import { HeldSeat, type SeatHost } from './held-seat';
import type { LoadGuard } from './load-guard';
import { parallelismEnv } from './parallelism-env';
import type { PortLeases } from './port-leases';
import { QuietHours } from './quiet-hours';
import type { HeavyAsk, ResourceGovernor, SeatAsk, SeatLease, SeatSeed } from './resource-governor';
import type { SeatTable } from './seat-table';

export interface SeatGovernorDeps {
  readonly settings: () => GovernorSettings;
  readonly table: SeatTable;
  readonly guard: LoadGuard;
  readonly admission: Admission;
  readonly ports: PortLeases;
  readonly priority: ProcessPriority;
  readonly sweep: GovernorSweep;
  readonly publisher: GovernorPublisher;
  readonly clock: Clock;
  /** The light seats' total: the slots' sessions summed, null when a slot has no cap. */
  readonly lightTotal: () => number | null;
}

/**
 * The resource governor (req-180): light seats for model runs, heavy seats
 * for tests, builds, dev servers and browsers, granted by {@link Admission}
 * in arrival order; every wait and refusal is logged once per reason and
 * handed to the waiting task; a heavy process runs at low priority.
 */
export class SeatGovernor implements ResourceGovernor, SeatHost {
  private readonly queue = new HeavyQueue();

  constructor(private readonly deps: SeatGovernorDeps) {}

  light(ask: SeatAsk): SeatLease {
    const id = this.deps.table.take('light', this.holder(ask, 'model run', null));
    const port = this.deps.ports.lease(ask.worktree, ask.runId, ask.ticket);
    this.publish();
    return new HeldSeat(id, this, { ...this.parallelism(), ...(port === null ? {} : { DREY_DEV_PORT: String(port) }) }, port);
  }

  heavy(ask: HeavyAsk): Promise<SeatLease> {
    return new Promise<SeatLease>((resolve, reject) => {
      this.queue.push({ ask, sinceMs: this.deps.clock.now().getTime(), reason: null, resolve, reject });
      this.pump();
    });
  }

  adoptSeat(id: number, pid: number): void {
    this.deps.table.setPid(id, pid);
    const seat = this.deps.table.entries('heavy').find((entry) => entry.id === id);
    if (seat !== undefined && this.deps.settings().lowPriority && !this.deps.priority.lower(pid)) {
      this.deps.publisher.line(`could not lower the priority of ${seat.holder.ticket} ${seat.holder.task} (pid ${pid})`);
    }
    this.publish();
  }

  releaseSeat(id: number): void {
    const seat = this.deps.table.release(id);
    if (seat === null) {
      return;
    }
    if (seat.cls === 'heavy') {
      this.deps.publisher.line(`heavy seat released by ${seat.holder.ticket} ${seat.holder.task} · ${this.count()}`);
    }
    this.pump();
  }

  runSettled(runId: string): void {
    this.deps.ports.returnFor(runId);
    for (const seat of this.deps.table.entries().filter((entry) => entry.holder.runId === runId)) {
      this.releaseSeat(seat.id);
    }
    this.publish();
  }

  seed(runs: readonly SeatSeed[]): void {
    for (const run of runs) {
      if (run.pid !== null) {
        this.deps.table.take('light', this.holder(run, 'model run', run.pid));
      }
      if (run.devPort !== null) {
        this.deps.ports.seed({ port: run.devPort, worktree: run.worktree, runId: run.runId, ticket: run.ticket });
      }
    }
    this.publish();
  }

  tick(): void {
    this.deps.guard.sample();
    this.pump();
  }

  async sweep(): Promise<void> {
    await this.deps.sweep.run();
    this.pump();
  }

  status(): GovernorStatus {
    const settings = this.deps.settings();
    const quiet = QuietHours.parse(settings.quietHours);
    const sample = this.deps.guard.latest;
    const heavy = this.deps.table.holders('heavy');
    const devRuns = new Set(heavy.filter((h) => h.task === 'dev server').map((h) => h.runId));
    return {
      heavy: { busy: heavy.length, total: settings.heavySeats, holders: heavy },
      light: { busy: this.deps.table.busy('light'), total: this.deps.lightTotal() },
      load: { cpu: sample?.cpu ?? null, memory: sample?.memory ?? null, reserve: settings.reserve },
      lowPriority: settings.lowPriority,
      quietHours: settings.quietHours,
      quietUntil: quiet !== null && quiet.holds(this.deps.clock.now()) ? quiet.until : null,
      waiting: this.queue.views(),
      devServers: this.deps.ports.list().map((lease) => ({ port: lease.port, ticket: lease.ticket, runId: lease.runId, listening: devRuns.has(lease.runId) })),
    };
  }

  /** Grants the waiting tasks in order while the rules allow; the rest learn why they wait. */
  private pump(): void {
    let blocked: AdmissionVerdict | null = null;
    for (const waiter of this.queue.list()) {
      if (waiter.ask.cancelled?.() === true) {
        this.cancel(waiter);
        continue;
      }
      const verdict: AdmissionVerdict = blocked ?? this.deps.admission.judge(waiter.sinceMs);
      if (verdict.kind === 'grant') {
        this.grant(waiter, verdict.note);
      } else {
        blocked = verdict;
        this.noteWait(waiter, verdict.kind, verdict.reason);
      }
    }
    this.publish();
  }

  private grant(waiter: Waiter, note: string | null): void {
    const { ask } = waiter;
    this.queue.remove(waiter);
    const id = this.deps.table.take('heavy', this.holder(ask, ask.task, null));
    this.deps.publisher.line(`heavy seat granted to ${ask.ticket} ${ask.task} · ${this.count()}${note === null ? '' : ` · ${note}`}`);
    if (waiter.reason !== null) {
      ask.onWait?.(null);
    }
    waiter.resolve(new HeldSeat(id, this, this.parallelism(), null));
  }

  private noteWait(waiter: Waiter, kind: 'waits' | 'refused', reason: string): void {
    if (waiter.reason === reason) {
      return;
    }
    waiter.reason = reason;
    this.deps.publisher.line(`${waiter.ask.ticket} ${waiter.ask.task} ${kind} · ${reason}`);
    waiter.ask.onWait?.(reason);
  }

  private cancel(waiter: Waiter): void {
    this.queue.remove(waiter);
    this.deps.publisher.line(`${waiter.ask.ticket} ${waiter.ask.task} no longer waits · the run stopped`);
    waiter.reject(new Error('the run stopped while it waited for a heavy seat'));
  }

  private holder(ask: SeatAsk, task: HeavyTask | 'model run', pid: number | null): SeatHolder {
    return { runId: ask.runId, ticket: ask.ticket, task, since: this.deps.clock.now().toISOString(), pid };
  }

  private parallelism(): Readonly<Record<string, string>> {
    const { heavySeats, reserve } = this.deps.settings();
    return parallelismEnv({ cpus: this.deps.guard.cpuCount(), heavySeats, reserve });
  }

  private count(): string {
    return `${this.deps.table.busy('heavy')} of ${this.deps.settings().heavySeats}`;
  }

  private publish(): void {
    this.deps.publisher.status(this.status());
  }
}
