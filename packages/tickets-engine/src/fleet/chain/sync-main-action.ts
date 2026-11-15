import { commitOf, conflictedPaths, gitOutputOf, isAncestor, isClean, type LeavingGit } from './leaving-git';
import type { MainRef } from '../runner/main-ref';

/** What `sync-main` works on: the ticket's worktree on its branch, and the repository's integration branch. */
export interface SyncMainInput {
  readonly repoPath: string;
  readonly worktree: string;
  /** `repos.md` `branch:` — "main". */
  readonly integrationBranch: string;
  /** The merge commit's message (the caller adds the claim's trailers on a store that asks for them). */
  readonly message: string;
}

export type SyncMainOutcome =
  /** The branch already contains main: nothing was merged. */
  | { readonly kind: 'current'; readonly main: string }
  /** main was merged; `commit` is the merge commit. */
  | { readonly kind: 'merged'; readonly main: string; readonly commit: string }
  /** The merge conflicted and was aborted: the branch is as it was. */
  | { readonly kind: 'conflict'; readonly main: string; readonly files: readonly string[]; readonly output: string }
  /** Anything else: a dirty worktree, a fetch that failed, a merge that failed without a conflict. */
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * The builder's leaving action (req-267, the persona board concept §4): when
 * a ticket leaves the persona, the integration branch is merged into the
 * ticket's branch in its worktree, so review and test see the work against
 * today's main and the later commit meets fewer conflicts. Machine work, no
 * model; a conflict is aborted and reported, never resolved here.
 */
export class SyncMainAction {
  constructor(
    private readonly git: LeavingGit,
    private readonly main: MainRef,
  ) {}

  async run(input: SyncMainInput): Promise<SyncMainOutcome> {
    if (!(await isClean(this.git, input.worktree).catch(() => false))) {
      return { kind: 'failed', reason: `the worktree ${input.worktree} has uncommitted changes — main is merged into committed work only` };
    }
    const resolved = await this.main.resolve(input.repoPath, input.integrationBranch);
    if (!resolved.ok) {
      return { kind: 'failed', reason: resolved.error };
    }
    const main = resolved.target.ref;
    if (await isAncestor(this.git, input.worktree, main, 'HEAD')) {
      return { kind: 'current', main };
    }
    try {
      await this.git.run(input.worktree, ['merge', '--no-ff', '--no-edit', '-m', input.message, main]);
    } catch (error) {
      return this.failedMerge(input.worktree, main, gitOutputOf(error));
    }
    return { kind: 'merged', main, commit: await commitOf(this.git, input.worktree, 'HEAD') };
  }

  /** A merge that stopped: the conflict's files, then the abort, so the branch is left as the run handed it over. */
  private async failedMerge(worktree: string, main: string, output: string): Promise<SyncMainOutcome> {
    const files = await conflictedPaths(this.git, worktree);
    await this.git.run(worktree, ['merge', '--abort']).catch(() => undefined);
    if (files.length > 0) {
      return { kind: 'conflict', main, files, output };
    }
    return { kind: 'failed', reason: `git merge ${main} failed — ${output}` };
  }
}

/** The outcome as one line for the run's stream and the card's reason. */
export function syncMainLine(outcome: SyncMainOutcome): string {
  switch (outcome.kind) {
    case 'current':
      return `sync-main: the branch already contains ${outcome.main}`;
    case 'merged':
      return `sync-main: merged ${outcome.main} (${outcome.commit.slice(0, 10)})`;
    case 'conflict':
      return `sync-main: merging ${outcome.main} conflicts in ${outcome.files.join(', ')} — the merge was aborted`;
    case 'failed':
      return `sync-main failed — ${outcome.reason}`;
  }
}
