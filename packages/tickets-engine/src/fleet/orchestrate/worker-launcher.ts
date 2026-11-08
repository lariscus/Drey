import type { WorkerHandle } from '../harness/contract';
import type { RunStateMachine } from '../run/run-state-machine';
import type { BackgroundWork } from './background-work';
import type { LiveRun } from './live-run';
import type { ProcessSupervisor } from './process-supervisor';
import type { RunClaims } from './run-claims';
import type { RunRepository } from './run-repository';
import type { RunStreams } from './run-streams';

/** How the run's worker resumes, if it does. */
export interface LaunchResume {
  readonly resumeRef: string | null;
  /** The prompt instead of the request's full brief (a resume's continuation, req-80). */
  readonly instruction?: string;
  readonly compactFirst?: boolean;
  /** Only the resolution path asks for a fresh fallback (T-0049). */
  readonly fallbackOnFailure?: boolean;
}

export interface WorkerLauncherDeps {
  readonly machine: RunStateMachine;
  readonly repo: RunRepository;
  readonly processes: ProcessSupervisor;
  readonly claims: RunClaims;
  readonly background: BackgroundWork;
  readonly streams: RunStreams;
  readonly log: (message: string) => void;
}

/**
 * The run's worker as the run's own (ADR-0075): the brief with the claim's
 * trailers, a quiet start's silence (req-75), the take-back record and the
 * spend base — the one launch for the first worker and the fresh
 * fallback's replacement alike (T-0049).
 */
export class WorkerLauncher {
  constructor(private readonly deps: WorkerLauncherDeps) {}

  launch(run: LiveRun, resume: LaunchResume): WorkerHandle {
    const trailers = this.deps.claims.trailerBlock(run);
    const base = resume.instruction ?? run.request.instruction;
    return this.deps.processes.spawn(run, {
      instruction: trailers === null ? base : `${base}\n\n${trailers}`,
      resumeRef: resume.resumeRef,
      ...(resume.compactFirst === true ? { compactFirst: true } : {}),
      // Read off the record so the fresh fallback stays quiet, too.
      ...(run.info.quietStart === true ? { holdAtSpawn: true } : {}),
      recordAttach: true,
      trackUsageBase: true,
      ...(resume.fallbackOnFailure === true ? { onResumeFailed: (reason: string) => this.deps.background.track(this.fallback(run, reason)) } : {}),
    });
  }

  /**
   * The resume the adapter reported unestablishable (T-0049): the dying
   * worker is stopped and a FRESH one takes the run over — same id,
   * record, stream and instruction — so a broken session never fails the
   * run. A run being stopped is never revived: the table refuses it.
   */
  async fallback(run: LiveRun, reason: string): Promise<void> {
    if (run.fallbackActive === true || !this.deps.machine.can(run.info.state, { kind: 'respawning' }) || run.handle === null) {
      return;
    }
    run.fallbackActive = true;
    this.deps.log(`run ${run.info.id}: the resume failed — ${reason}; starting fresh under the same run id`);
    await run.handle.stop().catch(() => undefined);
    run.handle = null;
    run.info = this.deps.machine.transition({ ...run.info, pid: null, handoverMode: 'fresh', resumedFrom: null, sessionRef: null }, { kind: 'respawning' });
    const handle = this.launch(run, { resumeRef: null });
    // A held run stays held on its replacement: its quiet stand must not end before the owner's first prompt.
    if (run.info.held === true) {
      handle.setHold?.(true);
    }
    run.fallbackActive = false;
    run.info = this.deps.machine.transition({ ...run.info, pid: handle.pid }, { kind: 'spawned' });
    await this.deps.streams.say(run, `the resume failed (${reason}) — the run starts fresh with the same instruction`);
    await this.deps.repo.persist(run);
  }
}
