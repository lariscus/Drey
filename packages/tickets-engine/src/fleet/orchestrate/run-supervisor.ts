import type { FleetHandoverConfig, PermissionDecision, QuestionAnswers, RunDkTarget, RunInfo, RunRequest, SteerRung } from '../protocol';
import { isHeldSession } from '../protocol-session';
import type { StartOutcome, StopOutcome, SupervisorRecord, TakeoverOutcome } from '../run/run-record';
import { isTerminal } from '../run/run-state';
import type { AttachOutcome, AttachmentStore } from './attachment-store';
import type { BackgroundWork } from './background-work';
import type { HandoverSettings } from './handover-settings';
import type { LeftoverClaims, LeftoverClaimsReport } from './leftover-claims';
import type { HeldSessionStarter } from './held-session-starter';
import type { OwnerAnswers } from './owner-answers';
import type { RunAdoption } from './run-adoption';
import type { RunReaper } from './run-reaper';
import type { RunReopener } from './run-reopener';
import type { RunRepository } from './run-repository';
import type { RunStarter } from './run-starter';
import type { RunStopper } from './run-stopper';
import type { RunTakeover } from './run-takeover';
import type { RunnerHandover } from './runner-handover';
import type { SendOutcome, SteerService } from './steer-service';

/** The parts one supervisor delegates to, wired by `buildRunSupervisor`. */
export interface RunSupervisorParts {
  readonly repo: RunRepository;
  readonly background: BackgroundWork;
  readonly settings: HandoverSettings;
  readonly adoption: RunAdoption;
  readonly handover: RunnerHandover;
  readonly starter: RunStarter;
  /** req-168/173: a held session's start (a 1:1, a free session) — no claim, no worktree, quiet and held. */
  readonly heldSessions: HeldSessionStarter;
  readonly stopper: RunStopper;
  readonly steer: SteerService;
  readonly takeover: RunTakeover;
  readonly answers: OwnerAnswers;
  readonly attachments: AttachmentStore;
  readonly reopener: RunReopener;
  readonly reaper: RunReaper;
  readonly leftovers: LeftoverClaims;
}

/** What a dispatched run carries beyond the wire request (E3): the persona the ladder resolved. */
export interface StartOptions {
  readonly persona?: string | null;
}

/**
 * One provider's runs (ADR-0075, ADR-0096): the surface the runner's HTTP
 * routes and the chain orchestrator talk to. It holds no logic of its own —
 * each call goes to the part that owns it.
 */
export class RunSupervisor {
  constructor(private readonly parts: RunSupervisorParts) {}

  adopt(): Promise<void> {
    return this.parts.adoption.adopt();
  }

  /** The handover thresholds the plugin configured (T-0049) — idempotent, applied to the next start. */
  setHandoverConfig(config: FleetHandoverConfig): void {
    this.parts.settings.set(config);
  }

  handoverBlocker(): string | null {
    return this.parts.handover.blocker();
  }

  handOver(): Promise<number> {
    return this.parts.handover.handOver();
  }

  list(): readonly RunInfo[] {
    return this.parts.repo.list();
  }

  records(): readonly SupervisorRecord[] {
    return this.parts.repo.records();
  }

  get(runId: string): RunInfo | null {
    return this.parts.repo.find(runId)?.info ?? null;
  }

  streamPath(runId: string): string | null {
    return this.parts.repo.streamPath(runId);
  }

  start(request: RunRequest, options: StartOptions = {}): Promise<StartOutcome> {
    if (isHeldSession(request)) {
      return this.parts.heldSessions.start(request);
    }
    return this.parts.starter.start(request, { persona: options.persona ?? null });
  }

  stop(runId: string, reason: string | null): Promise<StopOutcome> {
    return this.parts.stopper.stop(runId, reason);
  }

  send(runId: string, text: string): Promise<SendOutcome> {
    return this.parts.steer.send(runId, text);
  }

  takeover(runId: string): Promise<TakeoverOutcome> {
    return this.parts.takeover.takeover(runId);
  }

  interrupt(runId: string): Promise<TakeoverOutcome> {
    return this.parts.takeover.interrupt(runId);
  }

  pauseAfterAction(runId: string): Promise<TakeoverOutcome> {
    return this.parts.takeover.pauseAfterAction(runId);
  }

  release(runId: string): Promise<TakeoverOutcome> {
    return this.parts.takeover.release(runId);
  }

  resume(runId: string): Promise<StartOutcome> {
    return this.parts.reopener.resume(runId);
  }

  attachFile(runId: string, name: string, dataBase64: string): Promise<AttachOutcome> {
    return this.parts.attachments.attach(runId, name, dataBase64);
  }

  answerPermission(runId: string, decision: PermissionDecision): Promise<TakeoverOutcome> {
    return this.parts.answers.answerPermission(runId, decision);
  }

  answerQuestion(runId: string, answers: QuestionAnswers): Promise<StopOutcome & { rung?: SteerRung }> {
    return this.parts.answers.answerQuestion(runId, answers);
  }

  /** The lease reaper's round (M85). */
  reap(): Promise<void> {
    return this.parts.reaper.reap();
  }

  /** True while at least one run is starting/running/stopping — the idle shutdown waits on this. */
  hasLive(): boolean {
    return this.list().some((r) => !isTerminal(r.state) && r.state !== 'detached');
  }

  /** The tickets this supervisor's starting / running / stopping runs hold. */
  liveTickets(): ReadonlySet<string> {
    return new Set(
      this.parts.repo
        .all()
        .filter((run) => ['starting', 'running', 'stopping'].includes(run.info.state))
        .map((run) => run.request.ticketId),
    );
  }

  /** E14-5b (4): the claims of this host no live run holds; `alsoLive` = the other supervisors' live tickets. */
  releaseLeftoverClaims(target: RunDkTarget, retreatByStage: Readonly<Record<string, string | null>>, alsoLive: ReadonlySet<string> = new Set()): Promise<LeftoverClaimsReport> {
    return this.parts.leftovers.release(target, retreatByStage, new Set([...alsoLive, ...this.liveTickets()]));
  }

  /** Resolves when none of the work the supervisor started on its own is still running (docs/testing-flakes.md). */
  idle(): Promise<void> {
    return this.parts.background.idle();
  }
}
