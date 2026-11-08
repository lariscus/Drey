import type { Clock } from '../ports/clock';
import { processStartMs, type ExecFn } from '../procs';
import { isTerminal } from '../run/run-state';
import { currentPid, type LiveRun } from './live-run';
import type { ProcessSupervisor } from './process-supervisor';
import type { RunRepository } from './run-repository';

/**
 * The retiring runner's half of a handover to a newer build (req-51): every
 * live run is left to the successor instead of stopped, and nothing new
 * starts afterwards.
 */
export class RunnerHandover {
  private leaving = false;

  constructor(
    private readonly repo: RunRepository,
    private readonly processes: ProcessSupervisor,
    private readonly exec: ExecFn,
    private readonly log: { readonly clock: Clock; readonly line: (message: string) => void },
  ) {}

  /** Set by `handOver`: this runner is going, it starts nothing new. */
  get retiring(): boolean {
    return this.leaving;
  }

  /**
   * Why this runner cannot hand over right now, or null: a run in its
   * machine gate, starting or being stopped is mid-transition — the move or
   * the stop's note would be lost. The client asks again later.
   */
  blocker(): string | null {
    for (const run of this.repo.all()) {
      if (isTerminal(run.info.state) || run.info.state === 'detached') {
        continue;
      }
      if (run.gating) {
        return `run ${run.info.id} (${run.info.ticketId}) is in its machine gate`;
      }
      if (run.info.state === 'stopping' || run.info.state === 'starting') {
        return `run ${run.info.id} (${run.info.ticketId}) is ${run.info.state}`;
      }
    }
    return null;
  }

  /**
   * A worker the successor can bind to (a recorded attach file) keeps
   * running; any other is stopped here — its pipes die with this process,
   * and a worker nobody reads is an unsupervised agent (the T-0007 review) —
   * and its session is resumed by the successor. The ticket keeps its
   * claim: the run goes on.
   */
  async handOver(): Promise<number> {
    this.leaving = true;
    let count = 0;
    for (const run of this.repo.all().filter((r) => r.info.state === 'running' || r.info.state === 'starting')) {
      await this.handOverOne(run);
      count++;
    }
    return count;
  }

  private async handOverOne(run: LiveRun): Promise<void> {
    const attachable = this.processes.canAttach && (await this.repo.hasAttach(run));
    const pid = currentPid(run);
    const pidStartedMs = pid === null ? null : await processStartMs(pid, this.exec).catch(() => null);
    const mode = attachable ? 'reattach' : 'resume';
    run.handover = { mode, at: this.log.clock.now().toISOString(), pidStartedMs, turnIdle: run.info.turn === 'idle' };
    run.info = { ...run.info, pid };
    await this.repo.persist(run);
    if (!attachable && run.handle !== null) {
      await run.handle.stop().catch(() => undefined);
    }
    this.log.line(`run ${run.info.id}: handed over (${mode})`);
  }
}
