import { acceptanceCommands } from '../../core/ticket-files';
import { capTail, SANITY_CAP } from '../capping';
import type { RunDkTarget } from '../protocol';
import { messageOf, type LiveRun } from './live-run';
import type { RunBookkeeper } from './run-bookkeeper';

/** The gate's shell: the owner's command in the worktree; rejects with the output on a failure. */
export type GateShell = (command: string, cwd: string) => Promise<void>;

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
 * plan's deliverable, so the gate checks they came into existence.
 */
export class GateRunner {
  constructor(
    private readonly bookkeeper: RunBookkeeper,
    private readonly shell: GateShell,
    private readonly trailers: TrailerCheck,
  ) {}

  /** Null when green, else the failure (multi-line, bounded by SANITY_CAP so run.json stays sane). */
  async run(run: LiveRun): Promise<string | null> {
    if (run.request.gate === 'structural') {
      return this.structural(run);
    }
    for (const command of run.request.acceptance) {
      await this.bookkeeper.note(run, `gate: ${command}`);
      try {
        await this.shell(command, run.info.worktreePath);
      } catch (error) {
        return `\`${command}\` failed\n\n${capTail(combinedOutput(error), SANITY_CAP).text}`;
      }
    }
    return this.trailerGate(run);
  }

  private async structural(run: LiveRun): Promise<string | null> {
    const text = await this.bookkeeper.syncedText(run);
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
    await this.bookkeeper.note(run, 'gate: dk validate --trailers');
    const failure = await this.trailers(target, run.info.worktreePath, `${run.request.baseRef}..HEAD`);
    return failure === null ? null : `dk validate --trailers failed\n\n${failure}`;
  }
}
