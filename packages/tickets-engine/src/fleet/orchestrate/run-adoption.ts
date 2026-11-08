import type { Clock } from '../ports/clock';
import type { ProcessTable } from '../ports/process-table';
import { ZERO_USAGE, type WorkerHandle } from '../harness/contract';
import { closeExecSpan } from '../run/exec-span';
import type { RunHandover, StoredRun } from '../run/run-record';
import { isTerminal } from '../run/run-state';
import type { RunStateMachine } from '../run/run-state-machine';
import { messageOf, newLiveRun, type LiveRun } from './live-run';
import type { ProcessSupervisor } from './process-supervisor';
import type { RunBookkeeper } from './run-bookkeeper';
import type { RunClaims } from './run-claims';
import type { RunRepository } from './run-repository';
import type { RunStreams } from './run-streams';

/** The opening line of a session resumed after a runner handover. */
export const HANDOVER_CONTINUE =
  'The fleet runner was replaced by a newer build and your session was resumed; your last turn may have been cut short. ' +
  'Continue the step where you left off; your original brief is earlier in this conversation.';

export interface RunAdoptionDeps {
  readonly machine: RunStateMachine;
  readonly repo: RunRepository;
  readonly streams: RunStreams;
  readonly processes: ProcessSupervisor;
  readonly claims: RunClaims;
  readonly bookkeeper: RunBookkeeper;
  readonly table: ProcessTable;
  readonly clock: Clock;
  readonly log: (message: string) => void;
}

/**
 * The runs a restarted runner finds (ADR-0075, req-51): terminal records
 * come back as history; a live record whose worker still answers is taken
 * back (re-attach, OpenCode's server); one a retiring runner handed over is
 * resumed in place under the same run id; any other is detached — its
 * ticket freed, the owner can watch, stop or resume it.
 */
export class RunAdoption {
  constructor(private readonly deps: RunAdoptionDeps) {}

  async adopt(): Promise<void> {
    for (const { dir, stored } of await this.deps.repo.found()) {
      // One supervisor per provider adopts its own runs: two adopting every record detached what the first re-attached.
      if ((stored.info.provider ?? 'opencode') !== this.deps.processes.providerId) {
        continue;
      }
      await this.adoptOne(stored, dir).catch(() => undefined); // a broken record is noise; skip the run
    }
  }

  private async adoptOne(stored: StoredRun, dir: string): Promise<void> {
    const state = stored.info.state;
    if (!isTerminal(state) && state !== 'stopping') {
      if (await this.reattach(stored, dir)) {
        return;
      }
      if (stored.handover !== undefined && (await this.resumeInPlace(stored, stored.handover, dir))) {
        return;
      }
    }
    // A run already detached stays as it is: re-detaching it on every boot rewrote its record each time.
    if (isTerminal(state) || state === 'detached') {
      this.deps.repo.add(newLiveRun({ info: stored.info, request: stored.request, dir }));
      return;
    }
    const detached = this.deps.machine.transition(
      {
        ...closeExecSpan(stored.info, stored.info.lastActivity), // req-67: frozen at the last stamp the dead runner left
        endedAt: this.deps.clock.now().toISOString(),
        gateFailure: 'the runner restarted while the worker lived on; watch or resume it manually',
      },
      { kind: 'orphaned' },
    );
    const live = newLiveRun({ info: detached, request: stored.request, dir });
    this.deps.repo.add(live);
    await this.deps.repo.persist(live);
    await this.deps.bookkeeper.releaseAtEnd(live, 'the runner restarted — the worker is detached, start fresh to resume');
  }

  /**
   * Takes a worker that outlived its runner back: live again with a handle
   * bound to the still-running server (a held run stays held). False —
   * nothing changes — when the provider cannot attach, no attach record
   * exists, or the recorded process is gone.
   */
  private async reattach(stored: StoredRun, dir: string): Promise<boolean> {
    if (!this.deps.processes.canAttach || stored.info.sessionRef === null) {
      return false;
    }
    const attach = await this.deps.repo.readAttach(dir);
    const pid = typeof attach?.pid === 'number' ? attach.pid : null;
    if (attach === null || typeof attach.address !== 'string' || typeof attach.password !== 'string' || pid === null) {
      return false;
    }
    if (!(await this.deps.table.alive(pid))) {
      return false;
    }
    // req-67: unwatched while the runner was down — the open span closes at its last stamp.
    const info = this.deps.machine.transition({ ...closeExecSpan(stored.info, stored.info.lastActivity), pid, endedAt: null, gateFailure: null }, { kind: 'adopted' });
    const run = newLiveRun({ info, request: stored.request, dir, ...(stored.usageBase !== undefined ? { usageBase: stored.usageBase } : {}) });
    this.deps.repo.add(run);
    const pidStartedMs = typeof attach.pidStartedMs === 'number' ? attach.pidStartedMs : undefined;
    const handle = this.deps.processes.attach(run, { address: attach.address, password: attach.password, pid, pidStartedMs });
    await this.comeBack(run, handle, stored, 're-attached to its worker after the runner restarted');
    return true;
  }

  /**
   * A handed-over run whose worker cannot be bound to (req-51): a fresh
   * worker resumes the provider session under the same run, so the board
   * and an open takeover tab carry on. A worker still alive is killed
   * first (guarded by its creation time) — one worker per worktree.
   */
  private async resumeInPlace(stored: StoredRun, handover: RunHandover, dir: string): Promise<boolean> {
    const sessionRef = stored.info.sessionRef;
    if (sessionRef === null) {
      return false;
    }
    if (stored.info.pid !== null && handover.pidStartedMs !== null) {
      await this.deps.processes.kill(stored.info.pid, handover.pidStartedMs).catch(() => undefined);
    }
    await this.deps.processes.killRecordedServer(dir);
    const held = stored.info.held === true;
    const info = this.deps.machine.transition({ ...closeExecSpan(stored.info, stored.info.lastActivity), pid: null, endedAt: null, gateFailure: null }, { kind: 'adopted' });
    const run = newLiveRun({ info, request: stored.request, dir, ...(stored.usageBase !== undefined ? { usageBase: stored.usageBase } : {}) });
    let handle: WorkerHandle;
    try {
      // A held run resumes fully silent (req-75): no prompt at all — the resume prompt caused "I'm back" no-op turns.
      handle = this.deps.processes.spawn(run, {
        instruction: HANDOVER_CONTINUE,
        resumeRef: sessionRef,
        ...(held ? { holdAtSpawn: true } : {}),
        usageBase: stored.usageBase ?? ZERO_USAGE, // the same run goes on: its own earlier spend stays counted
        recordAttach: true,
      });
    } catch (error) {
      this.deps.log(`run ${stored.info.id}: the handed-over session could not be resumed — ${messageOf(error)}`);
      return false;
    }
    this.deps.repo.add(run);
    run.info = { ...run.info, pid: handle.pid };
    await this.comeBack(run, handle, stored, 'resumed in place after a runner handover');
    await this.deps.streams.say(run, 'the runner was replaced by a newer build — the session is resumed in a fresh worker');
    return true;
  }

  /** A run back under supervision: still held if it was, recorded, its claim taken up again. */
  private async comeBack(run: LiveRun, handle: WorkerHandle, stored: StoredRun, what: string): Promise<void> {
    if (stored.info.held === true) {
      handle.setHold?.(true);
    }
    await this.deps.repo.persist(run);
    this.deps.log(`run ${run.info.id}: ${what}`);
    await this.deps.claims.resume(run);
  }
}
