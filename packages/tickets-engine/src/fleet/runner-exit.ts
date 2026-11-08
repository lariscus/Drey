import type * as http from 'node:http';
import type { Orchestrator } from './orchestrator';
import type { SupervisorSet } from './orchestrate/supervisor-set';
import { removeDescriptor } from './runner-descriptor';
import { retireVerdict, type IdleWatch, type RunnerLiveness } from './runner-lifecycle';
import type { RunnerLog } from './runner-log';

export interface RunnerExitDeps {
  readonly exit: (code: number) => void;
  readonly log: RunnerLog;
  readonly orchestrator: Orchestrator;
  readonly supervisors: SupervisorSet;
  readonly idle: IdleWatch;
  readonly idleMs: number;
  /** The standalone runner's descriptor file; null inside Drey Service (no file). */
  readonly descriptorPath: string | null;
  /** Ends the open `/events` streams: a server close waits for every open response. */
  readonly closeStreams: () => void;
}

/**
 * When and how the runner leaves (req-110, req-51): the exit after a reply
 * (the response leaves first), the graceful stop of the live runs (bounded),
 * the handover to a newer build, the idle span and the reaper's round.
 */
export class RunnerExit {
  private leaving = false;
  private handingOver = false;
  private exited = false;
  private server: http.Server | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(private readonly deps: RunnerExitDeps) {}

  get isLeaving(): boolean {
    return this.leaving;
  }

  liveness(): RunnerLiveness {
    return { live: this.deps.supervisors.liveCount(), keepsAlive: this.deps.orchestrator.keepsRunnerAlive };
  }

  /** The reaper's round (M85) and the idle span (writes only count, req-110); the server the shutdown closes. */
  start(server: http.Server): void {
    this.server = server;
    const reap = setInterval(() => void this.deps.orchestrator.reapAll().catch((error) => this.deps.log.line(`reap failed: ${String(error)}`)), 60_000);
    const idle = setInterval(() => {
      if (!this.leaving && !this.handingOver && this.deps.idle.expired(this.liveness())) {
        this.deps.log.line(`idle for ${Math.round(this.deps.idleMs / 1000)}s — shutting down`);
        this.leaving = true;
        this.shutdown(0);
      }
    }, 15_000);
    this.timers = [reap, idle];
    this.timers.forEach((t) => t.unref());
  }

  /** The exit after a reply: never during a handover — that path ends the process itself once its records are written. */
  leave(why: string): void {
    if (this.leaving || this.handingOver) {
      return;
    }
    this.leaving = true;
    this.deps.log.line(`${why} — ${this.deps.descriptorPath !== null ? 'exiting' : 'going to sleep'} (it starts again when it is needed)`);
    setTimeout(() => this.shutdown(0), 100);
  }

  /**
   * The Autopilot was switched Off (or the master halted, or the Notaus):
   * the runner leaves unless a run is live. Called only on the request that
   * switched it off — a runner without a chain config would otherwise
   * leave right after "Run the chain" (2026-11-07).
   */
  leaveIfDeactivated(): void {
    const state = this.liveness();
    if (retireVerdict(state).exiting) {
      this.leave('the Autopilot is off and nothing is live');
    } else if (!state.keepsAlive) {
      this.deps.log.line('the Autopilot is off — the runner stays for its live runs and leaves after the idle span once they end');
    }
  }

  /**
   * A graceful exit halts the chain FIRST: each stopped run settles and
   * triggers a pass, which used to start fresh workers inside the wait —
   * orphans once the process left. The wait is bounded.
   */
  async stopLiveRuns(): Promise<void> {
    await this.deps.orchestrator.setMaster('halted').catch((error) => this.deps.log.line(`halting the chain failed: ${String(error)}`));
    const stops = this.deps.supervisors.stopLive('the runner was shut down');
    if (stops.length > 0) {
      this.deps.log.line(`stopping ${stops.length} live run${stops.length === 1 ? '' : 's'} before exit`);
    }
    await Promise.race([Promise.allSettled(stops), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  }

  /** The handover's answer: null = accepted (the runner leaves once the records are written), else why not now. */
  handOver(): string | null {
    if (this.handingOver) {
      return null;
    }
    const blocker = this.deps.supervisors.handoverBlocker();
    if (blocker !== null) {
      return blocker;
    }
    this.handingOver = true;
    void this.completeHandover();
    return null;
  }

  shutdown(code: number): void {
    if (this.deps.descriptorPath !== null) {
      removeDescriptor(this.deps.descriptorPath);
    }
    this.timers.forEach((t) => clearInterval(t));
    this.deps.orchestrator.dispose(); // in-process (the service's component) the scan timer must stop with the runner
    this.deps.closeStreams();
    const once = (): void => {
      if (!this.exited) {
        this.exited = true;
        this.deps.exit(code);
      }
    };
    this.server?.close(once);
    setTimeout(once, 2_000).unref();
  }

  private async completeHandover(): Promise<void> {
    const log = this.deps.log.line;
    log('handover requested by a newer build — leaving the live runs to the successor');
    const count = await this.deps.supervisors.handOver(log);
    log(`handed over ${count} live run${count === 1 ? '' : 's'} — exiting`);
    await this.deps.orchestrator.markHandover().catch((error) => log(`handover stamp failed: ${String(error)}`)); // the successor keeps the master
    await this.deps.log.flush();
    this.shutdown(0); // the descriptor goes only now: a successor's boot guard must still find this runner alive
  }
}
