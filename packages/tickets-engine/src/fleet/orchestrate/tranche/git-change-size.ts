import type { RunInfo } from '../../protocol';
import type { ChangeLines, ChangeSizeReader } from './run-facts';

/** The git command a reader runs; the composition root passes the chain's git. */
export type GitRun = (cwd: string, args: readonly string[]) => Promise<string>;

/**
 * The lines a run's own commits added and removed (req-179): `git log
 * --numstat` since the run's start in its worktree — the branch's earlier
 * work is not this run's change. A binary file counts no lines; a worktree
 * that cannot be read gives null, never a guess.
 */
export class GitChangeSize implements ChangeSizeReader {
  constructor(private readonly git: () => GitRun) {}

  async linesOf(run: Pick<RunInfo, 'worktreePath' | 'startedAt'>): Promise<ChangeLines | null> {
    if (run.worktreePath.trim() === '') {
      return null;
    }
    try {
      const out = await this.git()(run.worktreePath, ['log', `--since=${run.startedAt}`, '--numstat', '--format=']);
      return numstatLines(out);
    } catch {
      return null;
    }
  }
}

/** Sums `git --numstat` lines (`12\t3\tpath`; `-\t-\tpath` for a binary file). */
export function numstatLines(out: string): ChangeLines {
  let added = 0;
  let removed = 0;
  for (const line of out.split('\n')) {
    const [plus, minus] = line.trim().split('\t');
    if (plus !== undefined && minus !== undefined && /^\d+$/.test(plus) && /^\d+$/.test(minus)) {
      added += Number(plus);
      removed += Number(minus);
    }
  }
  return { added, removed };
}
