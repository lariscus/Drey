import type { FleetHandoverConfig, RunDkTarget, RunInfo, WorkerProviderId } from '../protocol';
import type { SupervisorRecord } from '../run/run-record';
import type { LeftoverClaimsReport } from './leftover-claims';
import type { RunSupervisor } from './run-supervisor';

/**
 * The runner's supervisors, one per provider (ADR-0075): runs carry their
 * provider, so a start routes by it and every other call by the run id. One
 * run belongs to exactly one supervisor.
 */
export class SupervisorSet {
  constructor(private readonly byProvider: ReadonlyMap<WorkerProviderId, RunSupervisor>) {}

  /** The provider's supervisor; an unknown provider runs on OpenCode's. */
  forProvider(provider: WorkerProviderId | string): RunSupervisor {
    return this.byProvider.get(provider as WorkerProviderId) ?? this.byProvider.get('opencode') ?? this.all()[0]!;
  }

  ofRun(runId: string): RunSupervisor | null {
    return this.all().find((s) => s.get(runId) !== null) ?? null;
  }

  all(): readonly RunSupervisor[] {
    return [...this.byProvider.values()];
  }

  /** How many supervisors hold a live run — the idle shutdown waits on it. */
  liveCount(): number {
    return this.all().filter((s) => s.hasLive()).length;
  }

  list(): readonly RunInfo[] {
    return this.all().flatMap((s) => s.list());
  }

  records(): readonly SupervisorRecord[] {
    const byId = new Map<string, SupervisorRecord>();
    for (const record of this.all().flatMap((s) => s.records())) {
      if (!byId.has(record.info.id)) {
        byId.set(record.info.id, record);
      }
    }
    return [...byId.values()];
  }

  async adoptAll(): Promise<void> {
    for (const one of this.all()) {
      await one.adopt();
    }
  }

  setHandoverConfig(config: FleetHandoverConfig): void {
    this.all().forEach((s) => s.setHandoverConfig(config));
  }

  handoverBlocker(): string | null {
    return this.all().map((s) => s.handoverBlocker()).find((b) => b !== null) ?? null;
  }

  /** Every live run left to the successor; the count. */
  async handOver(log: (message: string) => void): Promise<number> {
    let count = 0;
    for (const sup of this.all()) {
      count += await sup.handOver().catch((error) => {
        log(`handover failed: ${String(error)}`);
        return 0;
      });
    }
    return count;
  }

  /** Stops every starting or running run; the stops, to be awaited (bounded) by the caller. */
  stopLive(reason: string): readonly Promise<unknown>[] {
    return this.all().flatMap((sup) =>
      sup
        .list()
        .filter((info) => info.state === 'starting' || info.state === 'running')
        .map((info) => sup.stop(info.id, reason)),
    );
  }

  /** E14-5b: one pass over all supervisors — a live run of another provider's supervisor is no leftover. */
  releaseLeftoverClaims(target: RunDkTarget, retreat: Readonly<Record<string, string | null>>): Promise<LeftoverClaimsReport> {
    const live = new Set(this.all().flatMap((s) => [...s.liveTickets()]));
    return this.forProvider('opencode').releaseLeftoverClaims(target, retreat, live);
  }
}
