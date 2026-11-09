import type { Clock } from '../ports/clock';
import type { ProcessPriority } from '../ports/process-priority';
import type { GovernorSettings } from '../protocol-governor';
import type { GovernorPublisher } from './governor-publisher';
import type { PortLease, PortLeases } from './port-leases';
import type { SeatEntry, SeatTable } from './seat-table';

/** The two probes of the process table the sweep needs. */
export interface GovernorProcesses {
  alive(pid: number): Promise<boolean>;
  /** The pid listening on a loopback port (Windows), else null. */
  listener(port: number): Promise<number | null>;
}

export interface GovernorSweepDeps {
  readonly table: SeatTable;
  readonly ports: PortLeases;
  readonly processes: GovernorProcesses;
  readonly priority: ProcessPriority;
  readonly settings: () => GovernorSettings;
  readonly publisher: GovernorPublisher;
  readonly clock: Clock;
}

/**
 * The long tick (req-180): a seat whose process is gone leaves (a crash, a
 * kill, a restart's stale record), and a dev server listening on a leased
 * port holds a heavy seat for as long as it listens — at low priority when
 * the setting says so. One pass at a time.
 */
export class GovernorSweep {
  private running: Promise<void> | null = null;

  constructor(private readonly deps: GovernorSweepDeps) {}

  run(): Promise<void> {
    this.running ??= this.pass().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async pass(): Promise<void> {
    for (const lease of this.deps.ports.list()) {
      await this.devServer(lease);
    }
    for (const seat of this.deps.table.entries()) {
      await this.stale(seat);
    }
  }

  private async devServer(lease: PortLease): Promise<void> {
    const pid = await this.deps.processes.listener(lease.port).catch(() => null);
    const seat = this.deps.table.entries('heavy').find((e) => e.holder.task === 'dev server' && e.holder.runId === lease.runId);
    if (pid !== null && seat === undefined) {
      this.deps.table.take('heavy', { runId: lease.runId, ticket: lease.ticket, task: 'dev server', since: this.deps.clock.now().toISOString(), pid });
      if (this.deps.settings().lowPriority && !this.deps.priority.lower(pid)) {
        this.deps.publisher.line(`could not lower the priority of the dev server of ${lease.ticket} (pid ${pid})`);
      }
      this.deps.publisher.line(`dev server of ${lease.ticket} on port ${lease.port} holds a heavy seat · ${this.count()}`);
    } else if (pid === null && seat !== undefined) {
      this.deps.table.release(seat.id);
      this.deps.publisher.line(`dev server of ${lease.ticket} on port ${lease.port} stopped · ${this.count()}`);
    }
  }

  private async stale(seat: SeatEntry): Promise<void> {
    const pid = seat.holder.pid;
    if (pid === null || seat.holder.task === 'dev server' || (await this.deps.processes.alive(pid).catch(() => true))) {
      return;
    }
    if (this.deps.table.release(seat.id) !== null) {
      this.deps.publisher.line(`stale ${seat.cls} seat of ${seat.holder.ticket} ${seat.holder.task} released · pid ${pid} gone`);
    }
  }

  private count(): string {
    return `${this.deps.table.busy('heavy')} of ${this.deps.settings().heavySeats}`;
  }
}
