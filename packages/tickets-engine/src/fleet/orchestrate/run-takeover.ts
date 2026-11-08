import type { TakeoverOutcome } from '../run/run-record';
import type { LiveRun } from './live-run';
import type { RunBookkeeper } from './run-bookkeeper';
import type { RunRepository } from './run-repository';
import { HANDBACK_CONTINUE } from './steer-service';

/**
 * The owner takes a live run over (ADR-0075): the worker's session stays up
 * past a finished turn until it is handed back, and the run is marked
 * `held` so every surface can show who drives. Only providers whose handle
 * can hold take part; the interrupt and the soft pause ride the same hold.
 */
export class RunTakeover {
  constructor(
    private readonly repo: RunRepository,
    private readonly bookkeeper: RunBookkeeper,
  ) {}

  async takeover(runId: string): Promise<TakeoverOutcome> {
    const run = this.holdable(runId);
    if (typeof run === 'string') {
      return { ok: false, error: run };
    }
    run.handle!.setHold!(true);
    run.info = { ...run.info, held: true };
    await this.repo.persist(run);
    await this.bookkeeper.note(run, 'taken over by the owner');
    return { ok: true };
  }

  /** The implicit takeover when the owner first acts on a run (a prompt, an interrupt): held once, where the worker can hold. */
  async hold(run: LiveRun, why: string): Promise<void> {
    if (run.info.held === true || run.handle === null || run.handle.setHold === undefined) {
      return;
    }
    run.handle.setHold(true);
    run.info = { ...run.info, held: true };
    await this.repo.persist(run);
    await this.bookkeeper.note(run, `taken over by the owner (${why})`);
  }

  /** The soft stop of the held run's current turn (the session stays). */
  async interrupt(runId: string): Promise<TakeoverOutcome> {
    const run = this.holdable(runId);
    if (typeof run === 'string') {
      return { ok: false, error: run };
    }
    await this.hold(run, 'interrupt');
    run.paused = true; // before the interrupt: its result must not read as "done"
    const done = (await run.handle!.interrupt?.()) ?? false;
    if (!done) {
      run.paused = false;
      return { ok: false, error: `the ${run.info.provider} worker took no interrupt — it may be idle already` };
    }
    run.agentDone = false;
    run.blocked = null;
    run.info = { ...run.info, paused: true };
    await this.repo.persist(run);
    await this.bookkeeper.note(run, 'turn interrupted by the owner — the session is kept');
    return { ok: true };
  }

  /** "Pause after the current action": interrupted at the next finished tool call — an edit is never cut off half-way. */
  async pauseAfterAction(runId: string): Promise<TakeoverOutcome> {
    const run = this.holdable(runId);
    if (typeof run === 'string') {
      return { ok: false, error: run };
    }
    if (run.paused === true || run.softPause === true) {
      return { ok: true };
    }
    if (run.info.turn === 'idle' || run.info.waiting != null) {
      return { ok: false, error: 'the worker has no action in progress to pause after' };
    }
    run.softPause = true;
    await this.bookkeeper.note(run, 'pause requested — the worker pauses after its current action');
    return { ok: true };
  }

  /**
   * Hands a held run back. An idle worker has finished its turn, so the run
   * ends and the gate decides; a busy one carries on. A paused worker is
   * idle only because the owner stopped its turn: it continues the step.
   */
  async release(runId: string): Promise<TakeoverOutcome> {
    const run = this.holdable(runId);
    if (typeof run === 'string') {
      return { ok: false, error: run };
    }
    if (run.paused === true && run.info.turn !== 'busy') {
      return this.handBackPaused(run);
    }
    run.handle!.setHold!(false);
    run.info = { ...run.info, held: false };
    await this.repo.persist(run);
    await this.bookkeeper.note(run, 'handed back to the runner');
    return { ok: true };
  }

  private async handBackPaused(run: LiveRun): Promise<TakeoverOutcome> {
    run.paused = false;
    run.agentDone = false;
    run.blocked = null;
    run.info = { ...run.info, held: false, paused: false };
    await this.repo.persist(run);
    const rung = await run.handle!.steer(HANDBACK_CONTINUE);
    run.handle!.setHold!(false);
    await this.bookkeeper.note(
      run,
      rung === 'refused' ? 'handed back to the runner — the worker took no message, the run ends' : 'handed back after a pause — the worker continues the step',
    );
    return { ok: true };
  }

  /** The live run with a hold-capable worker, or the reason there is none. */
  private holdable(runId: string): LiveRun | string {
    const run = this.repo.find(runId);
    if (run === undefined) {
      return `unknown run "${runId}"`;
    }
    if (run.info.state !== 'running' && run.info.state !== 'starting') {
      return `run ${runId} is ${run.info.state} — nothing to take over`;
    }
    if (run.handle === null || run.handle.setHold === undefined) {
      return `the ${run.info.provider} worker cannot be taken over`;
    }
    return run;
  }
}
