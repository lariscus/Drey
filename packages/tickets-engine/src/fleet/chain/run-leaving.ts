import { isTerminal } from '../runner/run-state';
import type { GateSeat, GateSeats } from '../runner/gate-runner';
import type { LiveRun } from '../runner/live-run';
import type { RunBookkeeper } from '../runner/run-bookkeeper';
import type { RunRepository } from '../runner/run-repository';
import { syncMainLine, type SyncMainAction, type SyncMainOutcome } from './sync-main-action';

/** The card's status while the builder's leaving action runs (board 7e v2). */
export const SYNC_MAIN_ACTIVITY = 'merging main';

export interface RunLeavingDeps {
  readonly sync: SyncMainAction;
  readonly bookkeeper: Pick<RunBookkeeper, 'note'>;
  readonly repo: Pick<RunRepository, 'persist'>;
  /** The claim's trailer lines for a commit made in it; null without trailers. */
  readonly trailers: (run: LiveRun, op: string) => readonly string[] | null;
  /** The governor's heavy seats (req-180); absent = no governor (a spec). */
  readonly seats?: GateSeats;
}

/**
 * The leaving actions at a run's green end (req-267, the persona board
 * concept §4): after the gate and the closing round, before the hand-on,
 * still inside the run's claim. Today that is the builder's `sync-main`;
 * the card stays with the persona and says `merging main` while it runs.
 * It takes a heavy seat of the governor like a gate command, and no model.
 * Null when the run lists no leaving action.
 */
export class RunLeaving {
  constructor(private readonly deps: RunLeavingDeps) {}

  async afterGreen(run: LiveRun): Promise<SyncMainOutcome | null> {
    if (!(run.request.leaving ?? []).includes('sync-main') || run.request.baseRef === null) {
      return null;
    }
    await this.show(run, SYNC_MAIN_ACTIVITY);
    await this.deps.bookkeeper.note(run, `sync-main: merging ${run.request.baseRef} into ${run.request.branch}`);
    const seat = await this.seat(run);
    let outcome: SyncMainOutcome;
    try {
      outcome = await this.deps.sync.run({
        repoPath: run.request.repoPath,
        worktree: run.info.worktreePath,
        integrationBranch: run.request.baseRef,
        message: this.message(run),
      });
    } finally {
      seat?.release();
    }
    await this.deps.bookkeeper.note(run, syncMainLine(outcome));
    await this.show(run, null);
    return outcome;
  }

  /** The merge commit's message: what it is, then the claim's trailers on a store that checks them. */
  private message(run: LiveRun): string {
    const head = `Merge ${run.request.baseRef} into ${run.request.branch} (sync-main, ${run.request.ticketId})`;
    const trailers = this.deps.trailers(run, 'sync-main');
    return trailers === null ? head : `${head}\n\n${trailers.join('\n')}`;
  }

  private async seat(run: LiveRun): Promise<GateSeat | null> {
    if (this.deps.seats === undefined) {
      return null;
    }
    return this.deps.seats.heavy({
      runId: run.info.id,
      ticket: run.request.ticketId,
      worktree: run.info.worktreePath,
      command: 'sync-main',
      onWait: (reason) => {
        void this.show(run, reason === null ? SYNC_MAIN_ACTIVITY : `${SYNC_MAIN_ACTIVITY} · waits for a heavy seat · ${reason}`);
      },
      cancelled: () => run.info.state === 'stopping' || isTerminal(run.info.state),
    });
  }

  private async show(run: LiveRun, activity: string | null): Promise<void> {
    run.info = { ...run.info, activity: activity ?? undefined };
    await this.deps.repo.persist(run).catch(() => undefined);
  }
}
