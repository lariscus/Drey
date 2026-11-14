import { decideSendBack } from '../../core/chain-cursor';
import { decideRedGate } from '../../core/chain-red-gate';
import { DEFAULT_MAX_RED } from './breaker';
import { hasScoutReport } from '../../core/scout';
import { capTail, SANITY_CAP } from '../capping';
import type { RunRequest } from '../protocol';
import { cursorChain } from '../run-cursor';
import type { RunStateMachine } from '../run/run-state-machine';
import { shortGateLine } from '../run/run-summary';
import { exitVerdict } from './exit-verdict';
import type { GateRunner } from './gate-runner';
import { messageOf, type LiveRun } from './live-run';
import type { ProcessSupervisor } from './process-supervisor';
import type { RunBookkeeper } from './run-bookkeeper';
import type { RunRepository } from './run-repository';
import type { RunSettler } from './run-settler';
import { syncMainLine, type SyncMainOutcome } from './sync-main-action';

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
  /** req-169: the closing round after the gate verdict (a noteworthy run only); absent = none (a spec). */
  readonly closing?: { afterGate(run: LiveRun): Promise<void> };
  /** req-267: the persona's leaving actions before the hand-on (Ben's `sync-main`); absent = none (a spec). */
  readonly leaving?: { afterGreen(run: LiveRun): Promise<SyncMainOutcome | null> };
}

/** The note of a dialog, a session or a reopened session that ended: the ticket stays where the owner put it. */
function endedLine(run: LiveRun, kind: 'interactive' | 'session' | 'reopened', code: number | null): string {
  if (kind === 'interactive') {
    return `interactive dialog ended (${exitWord(code)}) — the owner moves the ticket`;
  }
  return kind === 'session' ? `${run.info.kind === 'free' ? 'free' : '1:1'} session ended (${exitWord(code)})` : `reopened session ended (${exitWord(code)})`;
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
      case 'session':
      case 'reopened':
        await bookkeeper.note(run, endedLine(run, verdict.kind, code));
        return settler.finish(run, 'done');
      case 'no-result':
        return this.noResult(run, code);
      case 'blocked':
        return this.blocked(run, verdict.blocked);
      case 'send-back':
        return this.sendBack(run, verdict);
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
    await this.deps.closing?.afterGate(run); // req-280: a blocked step's FRICTION reaches the journal too
    await this.deps.bookkeeper.parkBlocked(run, blocked);
    await this.deps.settler.finish(run, 'done');
  }

  /**
   * req-257: a chain run's send-back (concept §4) — no gate runs. The first
   * send-back of a ticket moves the cursor to the named earlier position
   * (`x-sent-back`, the invalidation in the status log); a second goes to
   * the owner with both; a position that is no earlier one of this chain is
   * a red gate with the reason.
   */
  private async sendBack(run: LiveRun, ask: { readonly position: number; readonly reason: string }): Promise<void> {
    const cursor = run.request.cursor!;
    const chain = cursorChain(cursor);
    const decision = decideSendBack({ chain, at: cursor.at, sentBack: cursor.sentBack, target: ask.position });
    await this.deps.closing?.afterGate(run);
    if (decision.kind === 'refused') {
      run.info = { ...run.info, gateFailure: decision.reason, gateResult: 'red' };
      await this.deps.bookkeeper.note(run, `send-back refused — ${decision.reason}`);
      return this.deps.settler.finish(run, 'failed');
    }
    const written = await this.deps.bookkeeper.sendBack(run, { decision, reason: ask.reason, chain });
    const said = decision.kind === 'moved' ? `sent back to position ${decision.at}` : 'a second send-back — the ticket goes to the owner';
    await this.deps.bookkeeper.note(run, written.ok ? said : `${said} failed — ${written.error}`);
    await this.deps.settler.finish(run, written.ok ? 'done' : 'failed');
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
    await this.deps.closing?.afterGate(run); // req-280: a scout's FRICTION reaches the journal too
    await this.deps.settler.finish(run, 'done');
  }

  private async gate(run: LiveRun, code: number | null): Promise<void> {
    run.gating = true;
    const failure = await this.deps.gate.run(run);
    if (failure !== null) {
      run.info = { ...run.info, gateFailure: failure, gateResult: 'red' };
      await this.deps.bookkeeper.note(run, `machine gate failed — ${shortGateLine(failure)}`);
      await this.deps.closing?.afterGate(run);
      await this.redBack(run, failure);
      return this.deps.settler.finish(run, 'failed');
    }
    run.info = { ...run.info, gateResult: 'green' };
    if (await this.secondOpinion(run)) {
      return;
    }
    await this.deps.closing?.afterGate(run); // before the move: the round runs while the run still holds its ticket
    const left = await this.leave(run);
    if (left !== null) {
      run.info = { ...run.info, gateFailure: left, gateResult: 'red' };
      await this.deps.bookkeeper.note(run, `the ticket stays with ${run.info.persona ?? 'the persona'} — ${shortGateLine(left)}`);
      return this.deps.settler.finish(run, 'failed');
    }
    const handedOn = await this.handOn(run);
    if (handedOn !== null) {
      await this.deps.bookkeeper.note(run, handedOn);
      return this.deps.settler.finish(run, 'failed');
    }
    await this.deps.bookkeeper.note(run, `run finished (${exitWord(code)})`);
    await this.deps.settler.finish(run, 'done');
  }

  /**
   * req-78: a chain run's red gate whose entry names an `on-red` target sends the ticket back
   * there (`core/chain-red-gate.ts`) — milestone 248's send-back with the gate's failure as its
   * reason, the return recorded, inside the claim. The run stays failed (the persona breaker counts
   * it); past the loop's bound, or with no target, the ticket stays with the persona as before.
   */
  private async redBack(run: LiveRun, failure: string): Promise<void> {
    const cursor = run.request.cursor;
    if (cursor === undefined) {
      return;
    }
    const chain = cursorChain(cursor);
    const decision = decideRedGate({ chain, at: cursor.at, redBacks: cursor.redBacks ?? 0, maxRed: cursor.maxRed ?? DEFAULT_MAX_RED });
    if (decision.kind === 'unresolved' || decision.kind === 'bound') {
      const why = decision.kind === 'bound' ? `the red-gate loop reached its bound (${decision.redBacks} of ${decision.maxRed - 1} sent back)` : decision.reason;
      await this.deps.bookkeeper.note(run, `on-red not followed — ${why}; the ticket stays with ${run.info.persona ?? 'the persona'}`);
    }
    if (decision.kind !== 'back') {
      return;
    }
    const written = await this.deps.bookkeeper.redBack(run, { decision, chain, gate: shortGateLine(failure) });
    if (written.ok) {
      run.info = { ...run.info, redBackTo: decision.to };
    }
    await this.deps.bookkeeper.note(run, written.ok ? `red gate — sent back to position ${decision.to}, returns to ${decision.from}` : `red gate — sending back failed — ${written.error}`);
  }

  /**
   * req-267 (owner 2026-11-12): the leaving actions inside the claim. A
   * `sync-main` conflict is the persona's own — the run ends red with the
   * conflict as its gate failure, so the next run of the same persona gets it
   * as its task (the autopilot retries, the breaker caps it); it is no
   * send-back. Null when nothing ran or it went through.
   */
  private async leave(run: LiveRun): Promise<string | null> {
    const outcome = await this.deps.leaving?.afterGreen(run).catch((error: unknown) => ({ kind: 'failed' as const, reason: messageOf(error) }));
    if (outcome === undefined || outcome === null || outcome.kind === 'current' || outcome.kind === 'merged') {
      return null;
    }
    return outcome.kind === 'conflict'
      ? `${syncMainLine(outcome)} — merge ${outcome.main} into the branch and resolve it\n\n${capTail(outcome.output, SANITY_CAP).text}`
      : syncMainLine(outcome);
  }

  /** The move or the park after a green gate; null when it went through, else the note of its failure. */
  private async handOn(run: LiveRun): Promise<string | null> {
    if (run.request.cursor !== undefined) {
      const advanced = await this.deps.bookkeeper.advanceOnSuccess(run);
      return advanced.ok ? null : `the gate passed but handing the ticket on failed — ${advanced.error}`;
    }
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
