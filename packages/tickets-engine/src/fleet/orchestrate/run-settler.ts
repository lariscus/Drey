import { costOf } from '../../core/model-prices';
import type { Clock } from '../ports/clock';
import type { RunInfo } from '../protocol';
import { freezeExecSpan } from '../run/exec-span';
import type { TerminalRunState } from '../run/run-state';
import type { RunStateMachine } from '../run/run-state-machine';
import { usageSummary } from '../run/run-summary';
import type { LiveRun } from './live-run';
import type { RunBookkeeper } from './run-bookkeeper';
import type { RunRepository } from './run-repository';

export interface RunSettlerDeps {
  readonly machine: RunStateMachine;
  readonly repo: RunRepository;
  readonly bookkeeper: RunBookkeeper;
  readonly clock: Clock;
  readonly log: (message: string) => void;
  /** Run settled (terminal): the orchestrator's slot-freed trigger (M85). */
  readonly onRunSettled?: (info: RunInfo) => void;
  /** req-183: a review's read-only checkout goes with its run; absent = no reviews (a spec). */
  readonly review?: ReviewCloser;
}

/** The review checkout as the settle asks it (req-183). */
export interface ReviewCloser {
  close(run: LiveRun): Promise<void>;
}

/**
 * A run's end (ADR-0075): the state machine's `settled`, the clock frozen,
 * the effective cost, the record written, the ticket handed back in one
 * write, the copy dropped, the persona's lesson, a review's checkout
 * removed (req-183), and the slot freed.
 */
export class RunSettler {
  constructor(private readonly deps: RunSettlerDeps) {}

  /**
   * A run settles ONCE. The reaper stops the worker and then finishes the
   * run itself, but the stop resolves the worker's `exited` promise, so the
   * exit handler can reach here first: two settles would hand the ticket
   * back twice and fire `onRunSettled` twice. A second caller waits for the
   * first settle instead.
   */
  finish(run: LiveRun, state: TerminalRunState): Promise<void> {
    run.settling ??= this.settle(run, state);
    return run.settling;
  }

  private async settle(run: LiveRun, state: TerminalRunState): Promise<void> {
    await run.stuckLog; // a "looks stuck" write still in flight would race the settle
    await run.eventQueue; // a usage event folded just before the exit must reach the settled cost and the Verlauf line
    const stamp = this.deps.clock.now().toISOString();
    const last = run.info;
    run.info = this.deps.machine.transition(
      {
        ...freezeExecSpan(last, stamp),
        endedAt: stamp,
        pid: null,
        // Costtracking (concept §4.3): the provider's own cost wins; one that reports none gets the
        // price-table estimate HERE, so every reader sees one effective number. Unknown model: null.
        ...(last.costUsd === null ? { costUsd: costOf(last.model ?? null, last.tokensIn, last.tokensOut) } : {}),
      },
      { kind: 'settled', outcome: state },
    );
    run.handle = null;
    await this.deps.repo.removeAttach(run);
    this.deps.log(`run ${run.info.id} → ${state}`);
    await this.deps.repo.persist(run);
    await this.deps.bookkeeper.releaseAtEnd(run, run.stopNote === undefined ? null : `${run.stopNote}${usageSummary(run.info)}`);
    await this.deps.bookkeeper.closeRun(run, state);
    await this.deps.review?.close(run);
    void this.deps.onRunSettled?.(run.info);
  }
}
