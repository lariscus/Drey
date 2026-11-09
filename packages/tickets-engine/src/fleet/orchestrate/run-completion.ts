import { hasScoutReport } from '../../core/scout';
import type { RunRequest } from '../protocol';
import type { RunStateMachine } from '../run/run-state-machine';
import { shortGateLine } from '../run/run-summary';
import { exitVerdict } from './exit-verdict';
import type { GateRunner } from './gate-runner';
import type { LiveRun } from './live-run';
import type { ProcessSupervisor } from './process-supervisor';
import type { RunBookkeeper } from './run-bookkeeper';
import type { RunRepository } from './run-repository';
import type { RunSettler } from './run-settler';

export interface RunCompletionDeps {
  readonly machine: RunStateMachine;
  readonly repo: RunRepository;
  readonly gate: GateRunner;
  readonly bookkeeper: RunBookkeeper;
  readonly settler: RunSettler;
  readonly processes: ProcessSupervisor;
  /**
   * The quality rungs (M85, flagged off): on a green gate, an instruction to
   * re-run the step with — a second worker reviews the branch before the
   * move — or null to move as normal. Asked once per run.
   */
  readonly secondOpinion?: (request: RunRequest) => Promise<string | null>;
}

/** The exit code as the notes say it. */
function exitWord(code: number | null): string {
  return `exit ${code ?? 'signal'}`;
}

/**
 * What a worker's exit does to its run (ADR-0077): the verdict
 * (`exit-verdict.ts`) picks the path, one handler per path; only a
 * finished turn reaches the machine gate, and only a green gate moves.
 */
export class RunCompletion {
  constructor(private readonly deps: RunCompletionDeps) {}

  async onWorkerExit(run: LiveRun, code: number | null): Promise<void> {
    const verdict = exitVerdict(run);
    const { bookkeeper, settler } = this.deps;
    switch (verdict.kind) {
      case 'ignore':
        return;
      case 'claim-lost': // dk answered exit 13: the ticket is another actor's now — no gate, no move, no write
        return settler.finish(run, 'failed');
      case 'stopped':
        return settler.finish(run, 'stopped');
      case 'interactive':
        await bookkeeper.note(run, `interactive dialog ended (${exitWord(code)}) — the owner moves the ticket`);
        return settler.finish(run, 'done');
      case 'session':
        await bookkeeper.note(run, `${run.info.kind === 'free' ? 'free' : '1:1'} session ended (${exitWord(code)})`);
        return settler.finish(run, 'done');
      case 'no-result':
        return this.noResult(run, code);
      case 'reopened':
        await bookkeeper.note(run, `reopened session ended (${exitWord(code)})`);
        return settler.finish(run, 'done');
      case 'blocked':
        return this.blocked(run, verdict.blocked);
      case 'scout':
        return this.scout(run, code);
      case 'gate':
        return this.gate(run, code);
    }
  }

  /** A worker that ends without a result — a spawn that never came up, a crash — has claimed nothing: the step fails red. */
  private async noResult(run: LiveRun, code: number | null): Promise<void> {
    await run.eventQueue;
    const why = run.info.lastError ?? null;
    await this.deps.bookkeeper.note(run, `worker ended without finishing its turn (${exitWord(code)}) — no agent-done, the step fails${why !== null ? ` — ${why}` : ''}`);
    await this.deps.settler.finish(run, 'failed');
  }

  /**
   * The refusal half of agent-decided completion: a green gate over the
   * branch would say nothing about the step's own report, and moving on it
   * stranded tickets (T-0062/T-0071).
   */
  private async blocked(run: LiveRun, blocked: string): Promise<void> {
    run.info = { ...run.info, blocked };
    await this.deps.bookkeeper.note(run, `blocked — ${(blocked.split('\n')[0] ?? '').slice(0, 200)} — no gate runs, the ticket stays put`);
    await this.deps.bookkeeper.parkBlocked(run, blocked);
    await this.deps.settler.finish(run, 'done');
  }

  /** E8: the exploration's last word is only whether the ticket carries a report, so a report-less end is visible. */
  private async scout(run: LiveRun, code: number | null): Promise<void> {
    const text = await this.deps.bookkeeper.syncedText(run);
    const written = text !== null && hasScoutReport(text);
    await this.deps.bookkeeper.note(
      run,
      written
        ? `scout run finished (${exitWord(code)}) — the ## Report chapter waits for the owner in Needs you`
        : `scout run finished (${exitWord(code)}) without a ## Report chapter — the ticket file carries no report`,
    );
    await this.deps.settler.finish(run, 'done');
  }

  private async gate(run: LiveRun, code: number | null): Promise<void> {
    run.gating = true;
    const failure = await this.deps.gate.run(run);
    if (failure !== null) {
      run.info = { ...run.info, gateFailure: failure, gateResult: 'red' };
      await this.deps.bookkeeper.note(run, `machine gate failed — ${shortGateLine(failure)}`);
      return this.deps.settler.finish(run, 'failed');
    }
    run.info = { ...run.info, gateResult: 'green' };
    if (await this.secondOpinion(run)) {
      return;
    }
    const handedOn = await this.handOn(run);
    if (handedOn !== null) {
      await this.deps.bookkeeper.note(run, handedOn);
      return this.deps.settler.finish(run, 'failed');
    }
    await this.deps.bookkeeper.note(run, `run finished (${exitWord(code)})`);
    await this.deps.settler.finish(run, 'done');
  }

  /** The move or the park after a green gate; null when it went through, else the note of its failure. */
  private async handOn(run: LiveRun): Promise<string | null> {
    if (run.request.nextPhase !== null) {
      const moved = await this.deps.bookkeeper.moveOnSuccess(run, run.request.nextPhase);
      return moved.ok ? null : `the gate passed but the move failed — ${moved.error}`;
    }
    if (run.request.parkFor !== undefined) {
      const parked = await this.deps.bookkeeper.parkOnSuccess(run, run.request.parkFor);
      return parked.ok ? null : `the gate passed but parking the ticket failed — ${parked.error}`;
    }
    return null;
  }

  /** The quality rungs (M85): one round only, a fresh worker reviews the step; its own gate decides. True when it took over. */
  private async secondOpinion(run: LiveRun): Promise<boolean> {
    if (run.audited || this.deps.secondOpinion === undefined) {
      return false;
    }
    const brief = await this.deps.secondOpinion(run.request).catch(() => null);
    if (brief === null || run.handle === null) {
      return false;
    }
    run.audited = true;
    const handle = this.deps.processes.spawn(run, { instruction: brief, resumeRef: null });
    run.gating = false;
    run.info = this.deps.machine.transition({ ...run.info, pid: handle.pid }, { kind: 'spawned' });
    await this.deps.bookkeeper.note(run, 'second opinion — a fresh worker reviews the step before it moves');
    await this.deps.repo.persist(run);
    return true;
  }
}
