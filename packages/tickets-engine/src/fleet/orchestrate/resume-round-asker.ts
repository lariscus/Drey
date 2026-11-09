import type { NormalizedEvent, WorkerHandle } from '../harness/contract';
import type { LiveRun } from './live-run';
import type { RoundSpawnPlan } from './process-supervisor';

/** What the round spent, as its own process reported it. */
export interface RoundUsage {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number | null;
}

export type RoundReply =
  | { readonly kind: 'answered'; readonly text: string; readonly usage: RoundUsage }
  | { readonly kind: 'skipped'; readonly reason: string };

/** How the closing round reaches the worker (the port {@link ClosingRound} asks). */
export interface ClosingRoundAsker {
  ask(run: LiveRun, prompt: string): Promise<RoundReply>;
}

/** The spawn the asker needs from the process supervisor. */
export interface RoundSpawner {
  spawnRound(run: LiveRun, round: RoundSpawnPlan): WorkerHandle;
}

export interface ResumeRoundAskerDeps {
  readonly spawner: RoundSpawner;
  /** Every event of the round lands in the run's stream too (the Sessions area shows the round). */
  readonly stream: (run: LiveRun, event: NormalizedEvent) => void;
  readonly delay: (ms: number) => Promise<void>;
  /** The round's bound; past it the worker is stopped and the round skipped. */
  readonly boundMs?: number;
}

/**
 * The closing round's one bounded wait: the round is bookkeeping that holds
 * the run's ticket and slot, not the owner's work, so it is cut after ten
 * minutes (the run's own work is never cut — ADR-0014 stands for it).
 */
export const CLOSING_ROUND_BOUND_MS = 10 * 60_000;
/** After the answer, the worker gets this long to exit by itself before it is stopped. */
const EXIT_GRACE_MS = 5_000;

/**
 * The closing round as the second prompt of the run's own session (R14,
 * req-169): the worker's harness resumes the session the run reported
 * (`sessionRef`) with the round's prompt, read-only, and the round's answer
 * is the turn's `result` text. A run without a session ref, or a harness
 * that cannot resume it, gets no round — the entry is written from the
 * runner's facts alone and says why (decided in req-169: a fresh request of
 * the same model would only guess at a session it never saw).
 */
export class ResumeRoundAsker implements ClosingRoundAsker {
  constructor(private readonly deps: ResumeRoundAskerDeps) {}

  async ask(run: LiveRun, prompt: string): Promise<RoundReply> {
    const resumeRef = run.info.sessionRef ?? '';
    if (resumeRef === '') {
      return { kind: 'skipped', reason: 'the worker reported no session to resume' };
    }
    let answer: { text: string; usage: RoundUsage } | null = null;
    let resumeFailed: string | null = null;
    let settle: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => (settle = resolve));
    const handle = this.deps.spawner.spawnRound(run, {
      instruction: prompt,
      resumeRef,
      onEvent: (event) => {
        this.deps.stream(run, event);
        if (event.kind === 'result') {
          answer = { text: event.text ?? '', usage: { tokensIn: event.tokensIn ?? 0, tokensOut: event.tokensOut ?? 0, costUsd: event.costUsd ?? null } };
          settle();
        }
      },
      onResumeFailed: (reason) => {
        resumeFailed = reason;
        settle();
      },
    });
    const outcome = await Promise.race([
      answered.then(() => 'answered' as const),
      handle.exited.then(() => 'exited' as const),
      this.deps.delay(this.deps.boundMs ?? CLOSING_ROUND_BOUND_MS).then(() => 'bound' as const),
    ]);
    await this.finish(handle, outcome === 'exited' ? 'gone' : outcome === 'answered' && resumeFailed === null ? 'grace' : 'stop');
    return this.replyOf(outcome, answer, resumeFailed);
  }

  /** The worker goes: already gone, by itself within the grace after its answer, else stopped now. */
  private async finish(handle: WorkerHandle, how: 'gone' | 'grace' | 'stop'): Promise<void> {
    if (how === 'gone') {
      return;
    }
    const gone = how === 'grace' && (await Promise.race([handle.exited.then(() => true), this.deps.delay(EXIT_GRACE_MS).then(() => false)]));
    if (!gone) {
      await handle.stop().catch(() => undefined);
    }
  }

  private replyOf(outcome: 'answered' | 'exited' | 'bound', answer: { text: string; usage: RoundUsage } | null, resumeFailed: string | null): RoundReply {
    if (resumeFailed !== null) {
      return { kind: 'skipped', reason: `the session could not be resumed — ${resumeFailed}` };
    }
    if (answer !== null) {
      return { kind: 'answered', ...answer };
    }
    return { kind: 'skipped', reason: outcome === 'bound' ? `the round passed its ${Math.round((this.deps.boundMs ?? CLOSING_ROUND_BOUND_MS) / 60_000)}-minute bound` : 'the worker ended without an answer' };
  }
}
