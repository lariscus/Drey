import { acceptanceCommands } from '../../core/ticket/ticket-files';
import { capTail, SANITY_CAP } from '../telemetry/capping';
import type { RunDkTarget } from '../protocol';
import { isTerminal } from './run-state';
import { messageOf, type LiveRun } from './live-run';
import type { RunBookkeeper } from './run-bookkeeper';
import type { RunRepository } from './run-repository';

/** What the governor's seat adds to a gate command (req-180): its environment, and the pid once it runs. */
export interface GateShellOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly onSpawn?: (pid: number) => void;
}

/** The gate's shell: the owner's command in the worktree; rejects with the output on a failure. */
export type GateShell = (command: string, cwd: string, opts?: GateShellOptions) => Promise<void>;

/** A held heavy seat as the gate sees it (req-180). */
export interface GateSeat {
  readonly env: Readonly<Record<string, string>>;
  adopt(pid: number): void;
  release(): void;
}

/** The resource governor as the gate asks it: a heavy seat per acceptance command (req-180). */
export interface GateSeats {
  heavy(ask: {
    readonly runId: string;
    readonly ticket: string;
    readonly worktree: string;
    readonly command: string;
    readonly onWait: (reason: string | null) => void;
    readonly cancelled: () => boolean;
  }): Promise<GateSeat>;
}

export interface GateRunnerDeps {
  readonly bookkeeper: RunBookkeeper;
  readonly shell: GateShell;
  readonly trailers: TrailerCheck;
  /** req-180: the governor's heavy seats and the record the wait shows on; absent = no governor (a spec). */
  readonly seats?: GateSeats;
  readonly repo?: Pick<RunRepository, 'persist'>;
  /** req-183: the review checkout's question — null while the branch still points at the reviewed commit; absent = no reviews (a spec). */
  readonly review?: ReviewHead;
}

/** The review checkout as the gate asks it (req-183). */
export interface ReviewHead {
  moved(run: LiveRun): Promise<string | null>;
}

/** `dk validate --trailers <range>` inside the worktree: null = passes, else the output. */
export type TrailerCheck = (target: RunDkTarget, worktree: string, range: string) => Promise<string | null>;

/** The failed command's combined output — stdout and stderr, or the error's message. */
function combinedOutput(error: unknown): string {
  const err = error as { stdout?: unknown; stderr?: unknown };
  const out = [typeof err.stdout === 'string' ? err.stdout : '', typeof err.stderr === 'string' ? err.stderr : ''].join('\n').trim();
  return out !== '' ? out : messageOf(error);
}

/**
 * The machine gate (ADR-0075): the ticket's acceptance commands, in order,
 * in the worktree, then — on a store with commit trailers — `dk validate
 * --trailers` over the branch. A structural run (the plan phase) instead
 * reads what the run produced: writing the executable criteria IS the
 * plan's deliverable, so the gate checks they came into existence. Each
 * command takes a heavy seat of the governor first (req-180) and may wait
 * for it; the wait's reason stands on the run as its activity.
 */
export class GateRunner {
  constructor(private readonly deps: GateRunnerDeps) {}

  /** Null when green, else the failure (multi-line, bounded by SANITY_CAP so run.json stays sane). */
  async run(run: LiveRun): Promise<string | null> {
    const moved = await this.reviewMoved(run);
    if (moved !== null) {
      return moved;
    }
    if (run.request.gate === 'structural') {
      return this.structural(run);
    }
    for (const command of run.request.acceptance) {
      await this.deps.bookkeeper.note(run, `gate: ${command}`);
      try {
        await this.seated(run, command);
      } catch (error) {
        return `\`${command}\` failed\n\n${capTail(combinedOutput(error), SANITY_CAP).text}`;
      }
    }
    return this.trailerGate(run);
  }

  /** The command on its heavy seat: the seat's environment, the pid handed back, the seat given back at the end. */
  private async seated(run: LiveRun, command: string): Promise<void> {
    const seat = await this.seat(run, command);
    try {
      const cwd = run.info.worktreePath;
      await (seat === null ? this.deps.shell(command, cwd) : this.deps.shell(command, cwd, { env: seat.env, onSpawn: (pid) => seat.adopt(pid) }));
    } finally {
      seat?.release();
    }
  }

  private async seat(run: LiveRun, command: string): Promise<GateSeat | null> {
    if (this.deps.seats === undefined) {
      return null;
    }
    let shown: Promise<void> = Promise.resolve();
    const seat = await this.deps.seats.heavy({
      runId: run.info.id,
      ticket: run.request.ticketId,
      worktree: run.info.worktreePath,
      command,
      onWait: (reason) => {
        shown = shown.then(() => this.showWait(run, command, reason));
      },
      cancelled: () => run.info.state === 'stopping' || isTerminal(run.info.state),
    });
    await shown;
    return seat;
  }

  /** The wait's reason on the run (its activity line) and in its stream; null = the seat came. */
  private async showWait(run: LiveRun, command: string, reason: string | null): Promise<void> {
    run.info = { ...run.info, activity: reason === null ? `gate: ${command}` : `waits for a heavy seat · ${reason}` };
    if (reason !== null) {
      await this.deps.bookkeeper.note(run, `gate: \`${command}\` waits — ${reason}`);
    }
    await this.deps.repo?.persist(run).catch(() => undefined);
  }

  /** req-183: a review gates only the commit the reviewer judged — a later commit on the branch fails it. */
  private async reviewMoved(run: LiveRun): Promise<string | null> {
    if (run.info.review === undefined || this.deps.review === undefined) {
      return null;
    }
    await this.deps.bookkeeper.note(run, `gate: the branch still at the reviewed commit ${run.info.review.commit.slice(0, 10)}`);
    return this.deps.review.moved(run);
  }

  private async structural(run: LiveRun): Promise<string | null> {
    const text = await this.deps.bookkeeper.syncedText(run);
    if (text === null) {
      return 'the ticket file disappeared — nothing to gate';
    }
    if (acceptanceCommands(text).length === 0) {
      return 'the run produced no executable acceptance criteria — a plan must end with at least one `- [ ] `command`` line';
    }
    return null;
  }

  /** E14-5: every commit of the branch must carry the Dricket-* trailers of a live claim. */
  private async trailerGate(run: LiveRun): Promise<string | null> {
    const target = run.request.dk;
    if (target === undefined || !target.trailers || run.request.baseRef === null) {
      return null;
    }
    await this.deps.bookkeeper.note(run, 'gate: dk validate --trailers');
    const failure = await this.deps.trailers(target, run.info.worktreePath, `${run.request.baseRef}..HEAD`);
    return failure === null ? null : `dk validate --trailers failed\n\n${failure}`;
  }
}
