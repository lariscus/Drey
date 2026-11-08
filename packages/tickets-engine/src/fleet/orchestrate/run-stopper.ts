import type { StopOutcome } from '../run/run-record';
import { isTerminal } from '../run/run-state';
import type { RunStateMachine } from '../run/run-state-machine';
import type { LiveRun } from './live-run';
import type { ProcessSupervisor } from './process-supervisor';
import type { RunBookkeeper } from './run-bookkeeper';
import type { RunRepository } from './run-repository';
import type { RunSettler } from './run-settler';

/**
 * Stopping a run: the owner's stop (or the chain's, or the shutdown's) and
 * the store's verdict that the claim is lost. The worker dies FIRST; the
 * release note follows with the run's end — a shutdown that gave up
 * waiting on a ticket write used to leave the worker alive (the orphans).
 */
export class RunStopper {
  constructor(
    private readonly machine: RunStateMachine,
    private readonly repo: RunRepository,
    private readonly processes: ProcessSupervisor,
    private readonly finisher: { readonly settler: RunSettler; readonly bookkeeper: RunBookkeeper; readonly log: (message: string) => void },
  ) {}

  async stop(runId: string, reason: string | null): Promise<StopOutcome> {
    const run = this.repo.find(runId);
    if (run === undefined) {
      return { ok: false, error: `unknown run "${runId}"` };
    }
    if (isTerminal(run.info.state)) {
      return { ok: false, error: `run ${runId} already ended (${run.info.state})` };
    }
    if (run.handover !== undefined) {
      // Its successor owns it now; a stop here would be undone by the resume.
      return { ok: false, error: 'the runner is handing over to a newer build — try again in a moment' };
    }
    run.info = this.machine.transition(run.info, { kind: 'stop-requested' });
    run.stopNote = `stopped by the owner${reason !== null ? ` — ${reason}` : ''}`;
    if (run.handle !== null) {
      await run.handle.stop(); // the exit sees `stopping` and finishes the run
      return { ok: true };
    }
    // A detached run has no attached worker: the guarded kill by recorded pid frees the ticket it blocks.
    if (run.info.pid !== null) {
      await this.processes.kill(run.info.pid, run.startedAtMs);
    }
    await this.finisher.settler.finish(run, 'stopped');
    return { ok: true };
  }

  /** Exit 13 (or an epoch that moved): another actor owns the ticket — stop the worker, write nothing. */
  async claimLost(run: LiveRun, why: string): Promise<void> {
    if (run.claimLost !== undefined || isTerminal(run.info.state)) {
      return;
    }
    run.claimLost = why;
    this.finisher.log(`run ${run.info.id}: claim on ${run.request.ticketId} lost - ${why}`);
    run.info = this.machine.transition({ ...run.info, gateFailure: `claim lost - ${why}` }, { kind: 'claim-lost' });
    run.stopNote = `claim lost - ${why}`;
    await this.finisher.bookkeeper.note(run, `claim lost - ${why} - the worker is stopped and the ticket is not written`);
    if (run.handle !== null) {
      await run.handle.stop(); // the exit sees `claimLost` and fails the run
    } else {
      await this.finisher.settler.finish(run, 'failed');
    }
  }
}
