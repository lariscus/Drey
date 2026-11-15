import { checkoutOfBranch, commitOf, conflictedPaths, gitOutputOf, isAncestor, isClean, type LeavingGit } from './leaving-git';
import type { MainRef, MainTarget } from '../runner/main-ref';

/** What the commit works on: the ticket's branch, the repository's integration branch, a scratch checkout. */
export interface CommitInput {
  readonly repoPath: string;
  /** The ticket's worktree: it must be clean, its branch's tip is what lands. */
  readonly worktree: string;
  readonly ticketBranch: string;
  /** `repos.md` `branch:` — "main". */
  readonly integrationBranch: string;
  /** `repos.md` `policy:` — set: the integration branch is protected, the merge is the owner's on the host. */
  readonly policy: string | null;
  /** Where the merge is made: a detached worktree created and removed here, never the owner's checkout. */
  readonly scratch: string;
  readonly message: string;
}

export type CommitOutcome =
  /** The ticket's tip is on main; `already` = it was before this action (an earlier push, a merged pull request). */
  | { readonly kind: 'landed'; readonly commit: string; readonly main: string; readonly already: boolean }
  /** The protected branch: the work branch is pushed, the merge waits for the owner. */
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'conflict'; readonly main: string; readonly files: readonly string[]; readonly output: string }
  | { readonly kind: 'failed'; readonly reason: string };

type Attempt = { readonly kind: 'merged'; readonly commit: string } | Exclude<CommitOutcome, { kind: 'landed' | 'blocked' }>;

/**
 * You's leaving action (req-267, the persona board concept §4): after the
 * owner's sign-off the ticket's branch is merged into main — an ordinary
 * merge in a scratch worktree detached at main, pushed to main's upstream
 * and proven from a fresh fetch; without an upstream the local branch moves,
 * only when no checkout has it. A conflict is aborted and reported. Git runs
 * only in the ticket's worktree, the scratch checkout and the repository's
 * object store — never in the owner's checkout.
 */
export class CommitAction {
  constructor(
    private readonly git: LeavingGit,
    private readonly main: MainRef,
  ) {}

  async run(input: CommitInput): Promise<CommitOutcome> {
    if (!(await isClean(this.git, input.worktree).catch(() => false))) {
      return { kind: 'failed', reason: `the worktree ${input.worktree} has uncommitted changes — only committed work lands` };
    }
    const tip = await commitOf(this.git, input.repoPath, `refs/heads/${input.ticketBranch}`).catch(() => null);
    if (tip === null) {
      return { kind: 'failed', reason: `the branch ${input.ticketBranch} does not exist — nothing to commit` };
    }
    const resolved = await this.main.resolve(input.repoPath, input.integrationBranch);
    if (!resolved.ok) {
      return { kind: 'failed', reason: resolved.error };
    }
    const target = resolved.target;
    if (await isAncestor(this.git, input.repoPath, tip, target.ref)) {
      return { kind: 'landed', commit: tip, main: target.ref, already: true };
    }
    if (input.policy !== null) {
      return this.policyPush(input, target);
    }
    return target.remote === null ? this.landLocal(input, target, tip) : this.landRemote(input, target, tip);
  }

  /** The protected branch: push the work branch where the owner's host can merge it, and wait for the owner. */
  private async policyPush(input: CommitInput, target: MainTarget): Promise<CommitOutcome> {
    if (target.remote !== null) {
      try {
        await this.git.run(input.repoPath, ['push', target.remote, `refs/heads/${input.ticketBranch}:refs/heads/${input.ticketBranch}`]);
      } catch (error) {
        return { kind: 'failed', reason: `pushing ${input.ticketBranch} to ${target.remote} failed — ${gitOutputOf(error)}` };
      }
    }
    return { kind: 'blocked', reason: `${target.branch} is protected (${input.policy}) — the policy merge awaits the owner` };
  }

  /** Merge on the remote's main, push; a refused push fetches and tries once more. Then the proof. */
  private async landRemote(input: CommitInput, target: MainTarget, tip: string): Promise<CommitOutcome> {
    let lastFailure = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const merged = await this.mergeInScratch(input, target.ref, tip);
      if (merged.kind !== 'merged') {
        return merged;
      }
      try {
        await this.git.run(input.repoPath, ['push', target.remote!, `${merged.commit}:refs/heads/${target.remoteBranch!}`]);
        return this.proof(input, target, tip, merged.commit);
      } catch (error) {
        lastFailure = gitOutputOf(error);
        const refetched = await this.main.refetch(input.repoPath, target);
        if (refetched !== null) {
          return { kind: 'failed', reason: refetched };
        }
      }
    }
    return { kind: 'failed', reason: `pushing to ${target.ref} failed twice — ${lastFailure}` };
  }

  /** The tip is an ancestor of the remote's main after a fresh fetch. */
  private async proof(input: CommitInput, target: MainTarget, tip: string, merge: string): Promise<CommitOutcome> {
    const refetched = await this.main.refetch(input.repoPath, target);
    if (refetched !== null) {
      return { kind: 'failed', reason: `pushed ${merge.slice(0, 10)}, but the proof could not fetch — ${refetched}` };
    }
    if (!(await isAncestor(this.git, input.repoPath, tip, target.ref))) {
      return { kind: 'failed', reason: `pushed ${merge.slice(0, 10)}, but ${target.ref} does not contain ${tip.slice(0, 10)} after a fresh fetch` };
    }
    return { kind: 'landed', commit: merge, main: target.ref, already: false };
  }

  /** No upstream: the local branch moves to the merge — only when no checkout has it, or that checkout would go stale. */
  private async landLocal(input: CommitInput, target: MainTarget, tip: string): Promise<CommitOutcome> {
    const checkedOut = await checkoutOfBranch(this.git, input.repoPath, target.branch).catch(() => null);
    if (checkedOut !== null) {
      return { kind: 'failed', reason: `${target.branch} has no upstream and is checked out in ${checkedOut} — Drey does not move a checked-out branch; merge ${input.ticketBranch} there by hand` };
    }
    const before = await commitOf(this.git, input.repoPath, `refs/heads/${target.branch}`);
    const merged = await this.mergeInScratch(input, before, tip);
    if (merged.kind !== 'merged') {
      return merged;
    }
    try {
      await this.git.run(input.repoPath, ['update-ref', `refs/heads/${target.branch}`, merged.commit, before]);
    } catch (error) {
      return { kind: 'failed', reason: `${target.branch} moved while the merge was made — ${gitOutputOf(error)}` };
    }
    return { kind: 'landed', commit: merged.commit, main: target.branch, already: false };
  }

  /** The merge in a scratch worktree detached at `base`; the scratch goes again in every case. */
  private async mergeInScratch(input: CommitInput, base: string, tip: string): Promise<Attempt> {
    await this.removeScratch(input);
    try {
      await this.git.run(input.repoPath, ['worktree', 'add', '--detach', input.scratch, base]);
    } catch (error) {
      return { kind: 'failed', reason: `the merge checkout ${input.scratch} could not be created — ${gitOutputOf(error)}` };
    }
    try {
      await this.git.run(input.scratch, ['merge', '--no-ff', '--no-edit', '-m', input.message, tip]);
      return { kind: 'merged', commit: await commitOf(this.git, input.scratch, 'HEAD') };
    } catch (error) {
      const output = gitOutputOf(error);
      const files = await conflictedPaths(this.git, input.scratch);
      await this.git.run(input.scratch, ['merge', '--abort']).catch(() => undefined);
      return files.length > 0 ? { kind: 'conflict', main: base, files, output } : { kind: 'failed', reason: `git merge ${input.ticketBranch} failed — ${output}` };
    } finally {
      await this.removeScratch(input);
    }
  }

  private async removeScratch(input: CommitInput): Promise<void> {
    await this.git.run(input.repoPath, ['worktree', 'remove', '--force', input.scratch]).catch(() => undefined);
    await this.git.run(input.repoPath, ['worktree', 'prune']).catch(() => undefined);
  }
}

/** The outcome as one line for the run's stream and the card's reason. */
export function commitLine(outcome: CommitOutcome): string {
  switch (outcome.kind) {
    case 'landed':
      return outcome.already ? `commit: already on ${outcome.main} (${outcome.commit.slice(0, 10)})` : `commit: merged into ${outcome.main} (${outcome.commit.slice(0, 10)})`;
    case 'blocked':
      return `commit: ${outcome.reason}`;
    case 'conflict':
      return `commit: merging into ${outcome.main} conflicts in ${outcome.files.join(', ')} — the merge was aborted`;
    case 'failed':
      return `commit failed — ${outcome.reason}`;
  }
}
