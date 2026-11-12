/**
 * The git a leaving action drives (req-267): one command in one folder, its
 * stdout; a failed command rejects with git's output in the message (the
 * `TicketsGit` contract). Defined here, at the consumer, so the actions stay
 * free of Node and testable against a fake or the installed git.
 */
export interface LeavingGit {
  run(cwd: string, args: readonly string[]): Promise<string>;
}

/** The message of a failed git command, as the card's reason carries it. */
export function gitOutputOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).trim();
}

/** Git answers a yes/no question by its exit code: `merge-base --is-ancestor`. */
export async function isAncestor(git: LeavingGit, cwd: string, ancestor: string, of: string): Promise<boolean> {
  try {
    await git.run(cwd, ['merge-base', '--is-ancestor', ancestor, of]);
    return true;
  } catch {
    return false;
  }
}

/** The commit a ref points at. */
export async function commitOf(git: LeavingGit, cwd: string, ref: string): Promise<string> {
  return (await git.run(cwd, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();
}

/** The paths with unresolved conflicts in a checkout (empty when the failed merge was no conflict). */
export async function conflictedPaths(git: LeavingGit, cwd: string): Promise<readonly string[]> {
  const out = await git.run(cwd, ['diff', '--name-only', '--diff-filter=U']).catch(() => '');
  return out.split('\n').map((line) => line.trim()).filter((line) => line !== '');
}

/** `git status --porcelain` is empty: nothing uncommitted, nothing untracked. */
export async function isClean(git: LeavingGit, cwd: string): Promise<boolean> {
  return (await git.run(cwd, ['status', '--porcelain'])).trim() === '';
}

/** The worktree that has `branch` checked out, or null (`git worktree list --porcelain`). */
export async function checkoutOfBranch(git: LeavingGit, repoPath: string, branch: string): Promise<string | null> {
  const out = await git.run(repoPath, ['worktree', 'list', '--porcelain']);
  let current: string | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = line.slice('worktree '.length).trim();
    } else if (line.trim() === `branch refs/heads/${branch}`) {
      return current;
    }
  }
  return null;
}
