import type { Clock } from '../ports/clock';
import type { RunRequest } from '../protocol';
import type { RunLease } from '../run-lease';
import type { StartOutcome } from '../run/run-record';
import { INITIAL_RUN_STATE, isTerminal } from '../run/run-state';
import type { RunStateMachine } from '../run/run-state-machine';
import type { BackgroundWork } from './background-work';
import { commitLine, type CommitAction, type CommitOutcome } from './commit-action';
import { finishedLines, targetsOfRequest, type FinishedWorktrees } from './finished-worktrees';
import type { GateSeat, GateSeats } from './gate-runner';
import { messageOf, newLiveRun, type LiveRun } from './live-run';
import { newRunInfo } from './opening-notes';
import type { RunBookkeeper } from './run-bookkeeper';
import type { RunClaims } from './run-claims';
import type { RunRepository } from './run-repository';
import type { RunSettler } from './run-settler';
import type { RunStreams } from './run-streams';

/** The card's status while You's leaving action runs (board 7e v2). */
export const COMMIT_ACTIVITY = 'committing';

export interface CommitRunDeps {
  readonly machine: RunStateMachine;
  readonly repo: RunRepository;
  readonly streams: RunStreams;
  readonly claims: RunClaims;
  readonly bookkeeper: RunBookkeeper;
  readonly settler: RunSettler;
  readonly action: CommitAction;
  readonly background: BackgroundWork;
  readonly clock: Clock;
  readonly log: (message: string) => void;
  readonly retiring: () => boolean;
  /** The governor's heavy seats (req-180); absent = no governor (a spec). */
  readonly seats?: GateSeats;
  /** req-185: the landed ticket's worktrees go (branch kept, a dirty one kept); absent = they stay (a spec). */
  readonly finished?: FinishedWorktrees;
}

/**
 * You's leaving action as a machine run (req-267, owner 2026-11-12): the
 * owner's sign-off starts it like a run — the claim first, a record and a
 * stream, the card says `committing` — but no worker, no slot and no model:
 * {@link CommitAction} merges the ticket's branch into main on a heavy seat
 * of the governor. Landed = `done` (the engine moves the ticket into Done
 * afterwards); a protected branch = blocked for the owner; a conflict or a
 * failure = red with git's output as the reason, the ticket stays where the
 * owner signed it off.
 */
export class CommitRun {
  constructor(private readonly deps: CommitRunDeps) {}

  async start(request: RunRequest): Promise<StartOutcome> {
    const refusal = this.refusal(request);
    if (refusal !== null) {
      return { ok: false, error: refusal };
    }
    const stamp = this.deps.clock.now().toISOString();
    const id = `R-${stamp.replaceAll(/[-:.]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
    this.deps.log(`run ${id} (${request.ticketId}): the commit, asked by ${request.origin ?? 'the owner'}`);
    const lease = await this.claim(request, id);
    if (typeof lease === 'string') {
      return { ok: false, error: lease };
    }
    const run = await this.open(request, id, stamp, lease);
    this.deps.background.track(this.execute(run));
    return { ok: true, run: run.info };
  }

  private refusal(request: RunRequest): string | null {
    if (this.deps.retiring()) {
      return 'the runner is handing over to a newer build — try again in a moment';
    }
    const live = this.deps.repo.list().find((r) => r.ticketId === request.ticketId && !isTerminal(r.state));
    if (live !== undefined) {
      return `${request.ticketId} already has a live run (${live.id}) — stop it first`;
    }
    return request.baseRef === null ? `${request.ticketId} names no repository — nothing to commit` : null;
  }

  private async claim(request: RunRequest, id: string): Promise<RunLease | null | string> {
    if (request.dk === undefined) {
      return null;
    }
    const lease = this.deps.claims.newLease(request, id, () => this.deps.repo.find(id) ?? null);
    try {
      await lease.claim();
      return lease;
    } catch (error) {
      return `${request.ticketId} could not be claimed through dk - ${messageOf(error)}`;
    }
  }

  /** The record: running at once (no process to wait for), `gating` so the reaper never looks for a worker. */
  private async open(request: RunRequest, id: string, stamp: string, lease: RunLease | null): Promise<LiveRun> {
    const info = newRunInfo({ id, request, prepared: null, decision: null, resumeRef: null, persona: request.machine?.persona ?? null, stamp }, INITIAL_RUN_STATE);
    const run = newLiveRun({ info: { ...info, activity: COMMIT_ACTIVITY }, request, dir: this.deps.repo.dirFor(id), startedAtMs: this.deps.clock.now().getTime(), freshTelemetry: true, ...(lease !== null ? { lease } : {}) });
    run.gating = true;
    await this.deps.repo.ensureDir(run.dir);
    this.deps.repo.add(run);
    const opening = `run ${id} for ${request.ticketId} — the commit: ${request.branch} into ${request.baseRef} (machine run, no worker, no model)`;
    await this.deps.streams.open(run, [{ ts: stamp, kind: 'note', text: opening }]);
    run.info = this.deps.machine.transition(run.info, { kind: 'spawned' });
    await this.deps.repo.persist(run);
    return run;
  }

  private async execute(run: LiveRun): Promise<void> {
    let outcome: CommitOutcome;
    const seat = await this.seat(run);
    try {
      outcome = await this.deps.action.run(this.inputOf(run));
    } catch (error) {
      outcome = { kind: 'failed', reason: messageOf(error) };
    } finally {
      seat?.release();
    }
    if (isTerminal(run.info.state) || run.info.state === 'stopping') {
      return this.deps.settler.finish(run, 'stopped');
    }
    await this.deps.bookkeeper.note(run, commitLine(outcome));
    run.info = { ...run.info, activity: '' };
    await this.settle(run, outcome);
  }

  private inputOf(run: LiveRun): Parameters<CommitAction['run']>[0] {
    const request = run.request;
    return {
      repoPath: request.repoPath,
      worktree: request.worktreePath,
      ticketBranch: request.branch,
      integrationBranch: request.baseRef!,
      policy: request.machine?.policy ?? null,
      scratch: `${request.worktreePath}-commit`,
      message: `Merge ${request.branch} (${request.ticketId}) — the owner's sign-off`,
    };
  }

  private async settle(run: LiveRun, outcome: CommitOutcome): Promise<void> {
    switch (outcome.kind) {
      case 'landed':
        return this.landed(run);
      case 'blocked':
        run.info = { ...run.info, blocked: outcome.reason };
        await this.deps.bookkeeper.parkBlocked(run, outcome.reason);
        return this.deps.settler.finish(run, 'done');
      case 'conflict':
      case 'failed':
        run.info = { ...run.info, gateResult: 'red', gateFailure: outcome.kind === 'conflict' ? `${commitLine(outcome)}\n\n${outcome.output}` : commitLine(outcome) };
        return this.deps.settler.finish(run, 'failed');
    }
  }

  /** Green. On the files backend the run moves the ticket into Done itself; on a store the engine does (dk forbids an agent the terminal stage). */
  private async landed(run: LiveRun): Promise<void> {
    run.info = { ...run.info, gateResult: 'green' };
    if (run.request.nextPhase !== null) {
      const moved = await this.deps.bookkeeper.moveOnSuccess(run, run.request.nextPhase);
      if (!moved.ok) {
        await this.deps.bookkeeper.note(run, `the commit landed but the move failed — ${moved.error}`);
        return this.deps.settler.finish(run, 'failed');
      }
    }
    await this.removeWorktrees(run);
    return this.deps.settler.finish(run, 'done');
  }

  /** req-185: the work is on main — the ticket's worktrees go, each outcome a note on the run. */
  private async removeWorktrees(run: LiveRun): Promise<void> {
    if (this.deps.finished === undefined) {
      return;
    }
    const report = await this.deps.finished.removeAll(targetsOfRequest(run.request));
    for (const line of finishedLines(report, run.request.branch)) {
      await this.deps.bookkeeper.note(run, line);
    }
  }

  private async seat(run: LiveRun): Promise<GateSeat | null> {
    if (this.deps.seats === undefined) {
      return null;
    }
    return this.deps.seats.heavy({
      runId: run.info.id,
      ticket: run.request.ticketId,
      worktree: run.request.worktreePath,
      command: 'commit',
      onWait: (reason) => {
        run.info = { ...run.info, activity: reason === null ? COMMIT_ACTIVITY : `${COMMIT_ACTIVITY} · waits for a heavy seat · ${reason}` };
        void this.deps.repo.persist(run).catch(() => undefined);
      },
      cancelled: () => run.info.state === 'stopping' || isTerminal(run.info.state),
    });
  }
}
