import { COMPACT_CAPABILITY, HANDOVER_CANDIDATE_STATES, resolveHandover, type HandoverCandidate, type HandoverDecision } from '../runner/handover';
import type { Clock } from '../ports/clock';
import type { RunRequest, WorkerProviderId } from '../protocol';
import { isTerminal } from '../runner/run-state';
import type { HandoverSettings } from './handover-settings';
import type { RunRepository } from '../runner/run-repository';

/**
 * The session handover's resolution (T-0049): only the supervisor holds
 * every record (boot-adopted terminal ones included), and only the
 * worktree preparation tells whether the worktree invalidated prior
 * sessions — so this is the one place the rules run.
 */
export class SessionHandover {
  constructor(
    private readonly repo: RunRepository,
    private readonly settings: HandoverSettings,
    private readonly provider: WorkerProviderId,
    private readonly clock: Clock,
  ) {}

  resolve(request: RunRequest, sessionInvalidated: boolean): HandoverDecision | null {
    if (request.handover === undefined) {
      return null;
    }
    const candidate = this.candidate(request);
    return resolveHandover({
      requested: request.handover,
      phase: request.phase,
      candidate,
      provider: this.provider,
      model: request.model,
      sessionInvalidated,
      sessionInUse: this.sessionInUse(candidate?.sessionRef ?? null),
      capability: COMPACT_CAPABILITY[this.provider],
      config: this.settings.config,
      nowMs: this.clock.now().getTime(),
    });
  }

  /**
   * The short continuation a resumed session is prompted with (req-80), or
   * null for the full brief: only when the run whose session resumes carried
   * the same brief — a changed plan, description or gate must reach the
   * worker whole.
   */
  continuationFor(runId: string, request: RunRequest, sessionRef: string): string | null {
    if (request.continuationInstruction === undefined || request.briefDigest === undefined) {
      return null;
    }
    const resumed = this.repo
      .all()
      .filter((r) => r.info.id !== runId && r.info.sessionRef === sessionRef && r.request.ticketId === request.ticketId)
      .sort((a, b) => b.info.startedAt.localeCompare(a.info.startedAt))[0];
    return resumed !== undefined && resumed.request.briefDigest === request.briefDigest ? request.continuationInstruction : null;
  }

  /**
   * The newest terminal record of this ticket and model: its provider is the
   * supervisor's own, `detached` never qualifies (its worker may still
   * live), and the resolution judges phase, session and staleness.
   */
  private candidate(request: RunRequest): HandoverCandidate | null {
    const newest = this.repo
      .all()
      .filter((r) => r.request.ticketId === request.ticketId && (r.info.model ?? r.request.model) === request.model && HANDOVER_CANDIDATE_STATES.includes(r.info.state))
      .sort((a, b) => b.info.startedAt.localeCompare(a.info.startedAt))[0];
    if (newest === undefined) {
      return null;
    }
    return {
      phase: newest.info.phase ?? newest.request.phase,
      provider: newest.info.provider,
      model: newest.info.model ?? null,
      state: newest.info.state,
      sessionRef: newest.info.sessionRef,
      lastTurnContext: newest.info.lastTurnContext ?? null,
      endedAt: newest.info.endedAt,
    };
  }

  /** Whether any non-terminal run holds the session — a detached one counts, its worker may still live. */
  private sessionInUse(sessionRef: string | null): boolean {
    return sessionRef !== null && this.repo.all().some((r) => !isTerminal(r.info.state) && r.info.sessionRef === sessionRef);
  }
}
