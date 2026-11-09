import { COMPACT_CAPABILITY } from '../handover';
import type { Clock } from '../ports/clock';
import type { ProcessTable } from '../ports/process-table';
import { DEFAULT_RUN_LIMITS, limitExceeded, type RunLimits } from '../run/run-limits';
import { isTerminal } from '../run/run-state';
import type { BackgroundWork } from './background-work';
import type { HandoverSettings } from './handover-settings';
import type { IdleRelease } from './idle-release';
import { currentPid, messageOf, type LiveRun } from './live-run';
import type { RunBookkeeper } from './run-bookkeeper';
import type { RunRepository } from './run-repository';
import type { RunSettler } from './run-settler';

/** A working run silent this long is flagged "looks stuck"... */
export const STUCK_FLAG_MS = 10 * 60_000;
/** ...and failed (back-off retry) after this much silence. */
export const STUCK_FAIL_MS = 40 * 60_000;
/** A spawn with no worker and no sign of life for this long never started. */
const NEVER_STARTED_MS = 2 * 60_000;

export interface RunReaperDeps {
  readonly repo: RunRepository;
  readonly settler: RunSettler;
  readonly bookkeeper: RunBookkeeper;
  readonly settings: HandoverSettings;
  readonly background: BackgroundWork;
  readonly clock: Clock;
  readonly table: ProcessTable;
  readonly log: (message: string) => void;
  /** Per-run ceilings (0 = unlimited) over the defaults; the request's own beat them. */
  readonly limits?: Partial<RunLimits>;
  /** A lost exit event of a worker that finished its turn: replayed, never reaped as a failure. */
  readonly replayExit: (run: LiveRun) => Promise<void>;
  /** req-168: lets a held 1:1 go after its idle span; absent = no sessions released (a spec). */
  readonly idle?: IdleRelease;
}

/**
 * The lease reaper and the hang watchdog (M85, M1b): a run whose worker is
 * provably dead but whose record still holds the ticket, a run past its
 * ceilings, a claude-code transcript past the context cap, a working run
 * silent for 40 minutes — each is failed and its ticket freed. A
 * silent-but-alive worker short of that is never touched: a local model
 * may think for minutes (ADR-0014).
 */
export class RunReaper {
  constructor(private readonly deps: RunReaperDeps) {}

  async reap(): Promise<void> {
    for (const run of this.deps.repo.all()) {
      await this.sweep(run);
    }
    // The watchdog's fire-and-forget writes are part of this sweep.
    await Promise.all(this.deps.repo.all().map((run) => run.stuckLog));
  }

  private async sweep(run: LiveRun): Promise<void> {
    const state = run.info.state;
    if (state === 'detached') {
      return this.settleIfWorkerGone(run);
    }
    if (isTerminal(state) || state === 'stopping' || run.gating || run.handover !== undefined) {
      return;
    }
    if ((await this.deps.idle?.releaseIfDue(run)) === true) {
      return;
    }
    const over = this.overLimit(run) ?? this.overContextCap(run) ?? this.hung(run);
    if (over !== null) {
      run.info = { ...run.info, lastError: over.message };
      return this.fail(run, over.note);
    }
    await this.reapDeadWorker(run);
  }

  /** The run limits, for a run the runner drives (not held, not a dialog, not done). */
  private overLimit(run: LiveRun): { message: string; note: string } | null {
    if (!this.drivenAndWorking(run)) {
      return null;
    }
    const over = limitExceeded(run.info, { ...DEFAULT_RUN_LIMITS, ...this.deps.limits, ...run.request.limits }, this.deps.clock.now().getTime());
    return over === null ? null : { message: `run limit: ${over}`, note: `run limit: ${over} — the run is stopped; the step fails and backs off` };
  }

  /**
   * The mid-run context cap (req-80) reached OpenCode only — it compacts
   * its own session. claude-code has no native compact here, so a
   * transcript past the cap is ended; the next run starts fresh from the
   * handover section and the diff stat.
   */
  private overContextCap(run: LiveRun): { message: string; note: string } | null {
    const cap = this.deps.settings.contextCap(run.request.model);
    const context = run.info.lastTurnContext ?? 0;
    if (cap <= 0 || context < cap || COMPACT_CAPABILITY[run.info.provider] === 'native' || !this.drivenAndWorking(run)) {
      return null;
    }
    const message = `context cap: ${context} tokens, over the ${cap} cap — the worker cannot compact`;
    return { message, note: `${message}; the step ends here and the next run starts fresh from the handover` };
  }

  private drivenAndWorking(run: LiveRun): boolean {
    return run.info.held !== true && run.request.interactive === undefined && !run.agentDone;
  }

  /**
   * The hang watchdog: a working run (not held, not waiting on the owner, not
   * standing idle) silent for STUCK_FLAG_MS is flagged `stuck` once; past
   * STUCK_FAIL_MS it is failed.
   */
  private hung(run: LiveRun): { message: string; note: string } | null {
    const waiting = run.info.waiting !== undefined && run.info.waiting !== null;
    if (run.info.state !== 'running' || !this.drivenAndWorking(run) || waiting || run.info.turn === 'idle') {
      return null;
    }
    const silence = this.silenceMs(run);
    if (silence > STUCK_FAIL_MS) {
      const message = `hung: no output for ${Math.round(silence / 60_000)} min`;
      return { message, note: `${message} — the run is stopped; the step fails and backs off` };
    }
    if (silence > STUCK_FLAG_MS && run.info.stuck !== true) {
      run.info = { ...run.info, stuck: true };
      run.stuckLog = this.deps.bookkeeper
        .note(run, `looks stuck: no output for ${Math.round(silence / 60_000)} min`)
        .then(() => this.deps.repo.persist(run))
        .catch((error: unknown) => this.deps.log(`run ${run.info.id}: flagging the run stuck failed — ${messageOf(error)}`));
    }
    return null;
  }

  /**
   * The opencode handle reports its pid only once the server has booted —
   * re-read before judging "never started" (the T-0007 review: the reaper
   * killed runs whose agents were mid-flight).
   */
  private async reapDeadWorker(run: LiveRun): Promise<void> {
    const pid = currentPid(run);
    if (pid !== null && pid !== run.info.pid) {
      run.info = { ...run.info, pid };
      await this.deps.repo.persist(run);
    }
    if (pid === null) {
      // Fresh activity means a worker is alive even without a recorded pid — never reap it (ADR-0014).
      if (run.info.held !== true && this.silenceMs(run) > NEVER_STARTED_MS) {
        run.info = { ...run.info, gateFailure: 'lease lost — the worker never started; reaped' };
        await this.fail(run, 'lease reaper: the worker never started — run reaped, ticket freed');
      }
      return;
    }
    if (await this.deps.table.alive(pid)) {
      return;
    }
    if (run.agentDone) {
      this.deps.background.track(this.deps.replayExit(run)); // the exit handler owns the gate
      return;
    }
    run.info = { ...run.info, gateFailure: 'lease lost — the worker process is gone; reaped' };
    await this.fail(run, 'lease reaper: the worker process is gone — run reaped, ticket freed');
  }

  /** D-34: a detached worker provably gone ends the run — the claim (if any) goes, the ticket is free. */
  private async settleIfWorkerGone(run: LiveRun): Promise<void> {
    const pids = await this.deps.table.recordedPids(run.dir, run.info.pid);
    if (!(await this.deps.table.gone(pids, Date.parse(run.info.lastActivity)))) {
      return;
    }
    run.stopNote = `the worker of run ${run.info.id} is gone - the run is over`;
    run.info = { ...run.info, gateFailure: 'the worker is gone: it ended while no runner watched it' };
    await this.deps.settler.finish(run, 'failed');
  }

  private async fail(run: LiveRun, note: string): Promise<void> {
    await this.deps.bookkeeper.note(run, note);
    if (run.handle !== null) {
      await run.handle.stop().catch(() => undefined);
    }
    await this.deps.settler.finish(run, 'failed');
  }

  private silenceMs(run: LiveRun): number {
    return this.deps.clock.now().getTime() - Math.max(run.startedAtMs, Date.parse(run.info.lastActivity) || 0);
  }
}
