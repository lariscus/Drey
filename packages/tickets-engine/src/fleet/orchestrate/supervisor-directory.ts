import { WORKER_PROVIDERS, type RunRequest, type WorkerProviderId } from '../protocol';
import type { StartOutcome, StopOutcome, SupervisorRecord } from '../run/run-record';
import type { StartOptions } from './run-supervisor';

/** The slice of a run supervisor the orchestrator drives (interface at the consumer). */
export interface SupervisorPort {
  readonly start: (request: RunRequest, options?: StartOptions) => Promise<StartOutcome>;
  readonly stop: (runId: string, reason: string | null) => Promise<StopOutcome>;
  readonly records: () => readonly SupervisorRecord[];
  /** The lease reaper round (M85). */
  readonly reap: () => Promise<void>;
}

/**
 * Every supervisor's runs as the chain sees them (M85): the records across
 * providers (one run belongs to exactly one supervisor), the chain's own
 * stops — told apart from an owner's — and the history a retry reads.
 */
export class SupervisorDirectory {
  /** Run ids the chain itself stopped (column brake, Notaus): only an owner's own stop holds a ticket. */
  private readonly machineStopped = new Set<string>();

  constructor(private readonly supervisorOf: (provider: WorkerProviderId) => SupervisorPort) {}

  all(): readonly SupervisorRecord[] {
    const byId = new Map<string, SupervisorRecord>();
    for (const provider of WORKER_PROVIDERS) {
      for (const record of this.supervisorOf(provider).records()) {
        if (!byId.has(record.info.id)) {
          byId.set(record.info.id, record); // a port that serves several providers must not duplicate
        }
      }
    }
    return [...byId.values()];
  }

  find(runId: string): SupervisorRecord | null {
    return this.all().find((r) => r.info.id === runId) ?? null;
  }

  start(request: RunRequest, options: StartOptions): Promise<StartOutcome> {
    return this.supervisorOf(request.provider).start(request, options);
  }

  /** Stops every matching run as the chain's own stop. */
  async stopMatching(matches: (record: SupervisorRecord) => boolean, reason: string): Promise<void> {
    const stops = this.all()
      .filter(matches)
      .map((record) => {
        this.machineStopped.add(record.info.id);
        return this.supervisorOf(record.info.provider)
          .stop(record.info.id, reason)
          .catch(() => undefined);
      });
    await Promise.all(stops);
  }

  /** Whether the chain stopped this run itself; asked once at its settle. */
  takeMachineStop(runId: string): boolean {
    return this.machineStopped.delete(runId);
  }

  async reapAll(): Promise<void> {
    for (const provider of WORKER_PROVIDERS) {
      await this.supervisorOf(provider).reap();
    }
  }

  /** How many runs of the ticket failed in this column since its last success there (D-62: escalate-on-fail). */
  failedRunsInColumn(ticketId: string, column: string): number {
    let failed = 0;
    for (const record of this.inColumn(ticketId, column)) {
      if (record.info.state === 'done') {
        break;
      }
      if (record.info.state === 'failed') {
        failed += 1;
      }
    }
    return failed;
  }

  /**
   * The ticket's most recent failed run's gate failure in this column, or
   * null (T-0048): what a retry's instruction carries. A later success there
   * clears the slate — another column's message never rides along.
   */
  lastGateFailure(ticketId: string, column: string): string | null {
    const latest = this.inColumn(ticketId, column).find((r) => r.info.state === 'failed' || r.info.state === 'done');
    return latest !== undefined && latest.info.state === 'failed' ? (latest.info.gateFailure ?? null) : null;
  }

  /**
   * req-78: the ticket's most recent failed run's gate failure at this chain
   * position, or null — a chain run's retry reads its own position's failure
   * (two personas share one `active` column), and a red gate's target reads
   * the failure of the position that sent it back. A later success there
   * clears the slate.
   */
  lastGateFailureAt(ticketId: string, position: number): string | null {
    const latest = this.all()
      .filter((r) => r.info.ticketId === ticketId && r.info.chainPosition?.at === position && (r.info.state === 'failed' || r.info.state === 'done'))
      .sort((a, b) => b.info.startedAt.localeCompare(a.info.startedAt))[0];
    return latest !== undefined && latest.info.state === 'failed' ? (latest.info.gateFailure ?? null) : null;
  }

  private inColumn(ticketId: string, column: string): readonly SupervisorRecord[] {
    return this.all()
      .filter((r) => r.info.ticketId === ticketId && (r.request.column ?? null) === column)
      .sort((a, b) => b.info.startedAt.localeCompare(a.info.startedAt));
  }
}
