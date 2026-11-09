import { isOneOnOne } from '../protocol-session';
import type { WorkerProviderId } from '../protocol';
import type { StartOutcome } from '../run/run-record';
import { isTerminal } from '../run/run-state';
import type { LiveRun } from './live-run';
import type { ProcessSupervisor } from './process-supervisor';
import type { RunRepository } from './run-repository';
import type { RunSettler } from './run-settler';
import type { RunStarter } from './run-starter';

const RESUMED_AFTER_RESTART =
  'The runner restarted and this session was resumed. Continue the step where you left off; ' +
  'your original brief is earlier in this conversation. Do not search the disk for files already named in it.';

const REOPENED_BY_OWNER =
  'The owner has reopened this session to talk to you. Reply with one short line that you are ready, then wait for their instructions.';

/**
 * A run's session picked up again under a new run: a detached run made
 * "attached again" (its record ends stopped, a fresh worker resumes the
 * session), or an ended run reopened for the owner (held, the ticket left
 * alone — it may have gone on since).
 */
export class RunReopener {
  constructor(
    private readonly repo: RunRepository,
    private readonly starter: RunStarter,
    private readonly settler: RunSettler,
    private readonly worker: { readonly processes: ProcessSupervisor; readonly provider: WorkerProviderId },
  ) {}

  async resume(runId: string): Promise<StartOutcome> {
    const old = this.repo.find(runId);
    if (old === undefined) {
      return { ok: false, error: `unknown run "${runId}"` };
    }
    if (isTerminal(old.info.state)) {
      return this.reopen(old);
    }
    if (old.info.state !== 'detached') {
      return { ok: false, error: `run ${runId} is ${old.info.state} — only a detached or ended run is resumed` };
    }
    if (old.info.sessionRef === null) {
      return { ok: false, error: `run ${runId} never reported a session — nothing to resume (start the ticket fresh)` };
    }
    const sessionRef = old.info.sessionRef;
    old.stopNote = 'resumed in a new run';
    if (old.info.pid !== null) {
      await this.worker.processes.kill(old.info.pid, old.startedAtMs);
    }
    await this.settler.finish(old, 'stopped');
    // The stored handover ask is stripped (T-0049): this start carries its own session explicitly.
    const { handover: _storedAsk, ...restored } = old.request;
    return this.starter.start({ ...restored, origin: `resume of ${runId}`, instruction: RESUMED_AFTER_RESTART }, { resumeRef: sessionRef });
  }

  /** The worker answers the opening line (or the owner's prompt) and stands, waiting for the takeover tab. */
  async reopen(old: LiveRun, prompt: string | null = null): Promise<StartOutcome> {
    // req-168: a released 1:1 has no ticket and no worktree to reopen in — the persona's next line starts a fresh session.
    if (isOneOnOne(old.request)) {
      return { ok: false, error: `run ${old.info.id} was a 1:1 — it does not reopen; the next line on the 1:1 starts a fresh session` };
    }
    if (old.info.sessionRef === null) {
      return { ok: false, error: `run ${old.info.id} never reported a session — nothing to resume` };
    }
    if (old.info.provider !== this.worker.provider) {
      return { ok: false, error: `run ${old.info.id} was a ${old.info.provider} run — the runner's worker is ${this.worker.provider}` };
    }
    return this.starter.start({ ...old.request, instruction: prompt ?? REOPENED_BY_OWNER }, { resumeRef: old.info.sessionRef, reopened: true });
  }
}
